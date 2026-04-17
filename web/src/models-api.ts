/**
 * Anthropic models API helper.
 *
 * Fetches the current list of Claude models from
 *   https://api.anthropic.com/v1/models
 * The `id` field returned by the API is the canonical model identifier — the
 * same string that is stored in agent frontmatter (`model:`), accepted by
 * `claude --model`, and rendered in docs/site. No transformation is applied.
 *
 * On missing/invalid `ANTHROPIC_API_KEY` or any network error, falls back to
 * a curated static list so the UI keeps working offline.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Claude Code model aliases. These are NOT returned by the API — they're
 * Claude Code pseudo-IDs that resolve to the current default Opus/Sonnet/etc.
 * `opusplan` enables plan mode.
 */
export const CLAUDE_CODE_ALIASES = ["opus", "sonnet", "haiku", "opusplan"] as const;

/**
 * Static fallback list. Update when new models ship — the API is the source of
 * truth at runtime, this is only the offline safety net.
 */
const FALLBACK_MODEL_IDS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-7",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

export type ModelRecord = {
  /** Canonical model id. Store this in agent frontmatter / --model / docs. */
  id: string;
  /** Human-friendly label (falls back to id if the API didn't return one). */
  displayName: string;
  /** ISO timestamp from the API, used for sorting. May be empty for fallback. */
  createdAt: string;
};

export type ModelsResult = {
  fetchedAt: number;
  source: "api" | "fallback";
  models: ModelRecord[];
  /** Populated when source === "fallback" to explain why. */
  error?: string;
};

let cache: ModelsResult | null = null;

/**
 * Get the current list of Claude models, cached for 1h.
 * Never throws — always returns a usable list (API result or fallback).
 */
export async function getAvailableModels(opts?: { forceRefresh?: boolean }): Promise<ModelsResult> {
  const now = Date.now();
  if (!opts?.forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    cache = {
      fetchedAt: now,
      source: "fallback",
      models: FALLBACK_MODEL_IDS.map((id) => ({ id, displayName: id, createdAt: "" })),
      error: "ANTHROPIC_API_KEY is not set — using static fallback list",
    };
    return cache;
  }

  try {
    const models = await fetchFromApi(apiKey.trim());
    // Sort newest first so users pick the latest by default.
    models.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    cache = { fetchedAt: now, source: "api", models };
    return cache;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cache = {
      fetchedAt: now,
      source: "fallback",
      models: FALLBACK_MODEL_IDS.map((id) => ({ id, displayName: id, createdAt: "" })),
      error: `API fetch failed (${message}) — using static fallback list`,
    };
    return cache;
  }
}

async function fetchFromApi(apiKey: string): Promise<ModelRecord[]> {
  const results: ModelRecord[] = [];
  let url: string | null = "https://api.anthropic.com/v1/models?limit=100";

  while (url) {
    const resp = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as {
      data?: Array<{ id: string; display_name?: string; created_at?: string }>;
      has_more?: boolean;
      last_id?: string;
    };

    for (const m of json.data ?? []) {
      results.push({
        id: m.id,
        displayName: m.display_name && m.display_name.length > 0 ? m.display_name : m.id,
        createdAt: m.created_at ?? "",
      });
    }

    url = json.has_more && json.last_id
      ? `https://api.anthropic.com/v1/models?limit=100&after_id=${encodeURIComponent(json.last_id)}`
      : null;
  }

  // Only Claude models — the account may technically expose other provider models.
  return results.filter((m) => m.id.startsWith("claude-"));
}
