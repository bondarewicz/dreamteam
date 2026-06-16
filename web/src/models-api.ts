/**
 * Multi-provider model registry for the /admin/models picker.
 *
 * Canonical model id = the string stored in agent frontmatter (`model:`), passed to
 * the eval runner's --model, and routed on by provider prefix:
 *   - claude : bare id ("claude-opus-4-8") — back-compat, no prefix
 *   - others : "<provider>/<model>" ("ollama/qwen3.6", "gemini/gemini-2.5-flash", "codex/gpt-5.5")
 *
 * Per-provider sourcing (only Ollama's CLI/API can enumerate; the gemini & codex CLIs
 * cannot list models, and we keep them key-free → curated static):
 *   - claude : Anthropic /v1/models (DREAMTEAM_MODELS_API_KEY) → fallback static
 *   - ollama : live GET :11434/api/tags (no key)
 *   - gemini : curated static (CLI can't list; stays zero-config)
 *   - codex  : curated static (no keyless listing; gpt-5.5 verified on ChatGPT sub)
 *
 * Why DREAMTEAM_MODELS_API_KEY (not ANTHROPIC_API_KEY): the latter makes the `claude`
 * CLI bill against API credits instead of the subscription. Keep the lookup isolated.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const OLLAMA_URL = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

/** Claude Code pseudo-aliases (resolve to current Opus/Sonnet/etc; `opusplan` = plan mode). */
export const CLAUDE_CODE_ALIASES = ["opus", "sonnet", "haiku", "opusplan"] as const;

/** Offline safety net for Claude (API is source of truth at runtime). */
const FALLBACK_MODEL_IDS = [
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-4-7", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5",
];

/** Curated lists for providers whose CLI can't enumerate models (kept key-free). */
const GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];
const CODEX_MODELS = ["gpt-5.5"]; // gpt-5-codex 400s on ChatGPT accounts; gpt-5.5 verified

export type Provider = "claude" | "ollama" | "gemini" | "codex";

export type ModelRecord = {
  /** Canonical id stored in frontmatter / passed to --model. */
  id: string;
  displayName: string;
  provider: Provider;
  /** ISO timestamp (Anthropic API only); used for sorting. May be empty. */
  createdAt: string;
};

export type ModelsResult = {
  fetchedAt: number;
  /** Refers to the CLAUDE list source (drives the banner). */
  source: "api" | "fallback";
  models: ModelRecord[];
  /** Populated when claude source === "fallback". */
  error?: string;
  /** Per-provider notes for the UI (e.g. "ollama: not reachable"). */
  providerNotes: string[];
};

let cache: ModelsResult | null = null;

export async function getAvailableModels(opts?: { forceRefresh?: boolean }): Promise<ModelsResult> {
  const now = Date.now();
  if (!opts?.forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  const providerNotes: string[] = [];

  // ── Claude (API → fallback) ────────────────────────────────────────────────
  let claudeModels: ModelRecord[];
  let source: "api" | "fallback";
  let error: string | undefined;
  const apiKey = process.env.DREAMTEAM_MODELS_API_KEY?.trim();
  if (apiKey) {
    try {
      claudeModels = await fetchClaudeFromApi(apiKey);
      claudeModels.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      source = "api";
    } catch (err) {
      claudeModels = fallbackClaude();
      source = "fallback";
      error = `Anthropic API fetch failed (${err instanceof Error ? err.message : String(err)}) — using static fallback`;
    }
  } else {
    claudeModels = fallbackClaude();
    source = "fallback";
    error = "DREAMTEAM_MODELS_API_KEY not set — using static Claude fallback list";
  }

  // ── Ollama (live, no key) ────────────────────────────────────────────────────
  const ollamaModels = await fetchOllamaModels();
  if (ollamaModels.length === 0) providerNotes.push("ollama: no models / not reachable on :11434");

  // ── Gemini + Codex (curated static) ──────────────────────────────────────────
  const geminiModels: ModelRecord[] = GEMINI_MODELS.map((m) => ({ id: `gemini/${m}`, displayName: m, provider: "gemini", createdAt: "" }));
  const codexModels: ModelRecord[] = CODEX_MODELS.map((m) => ({ id: `codex/${m}`, displayName: m, provider: "codex", createdAt: "" }));

  cache = {
    fetchedAt: now,
    source,
    error,
    providerNotes,
    models: [...claudeModels, ...ollamaModels, ...geminiModels, ...codexModels],
  };
  return cache;
}

function fallbackClaude(): ModelRecord[] {
  return FALLBACK_MODEL_IDS.map((id) => ({ id, displayName: id, provider: "claude" as const, createdAt: "" }));
}

async function fetchOllamaModels(): Promise<ModelRecord[]> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? [])
      .map((m) => (m.name ?? "").replace(/:latest$/, ""))
      .filter(Boolean)
      .map((name) => ({ id: `ollama/${name}`, displayName: name, provider: "ollama" as const, createdAt: "" }));
  } catch {
    return [];
  }
}

async function fetchClaudeFromApi(apiKey: string): Promise<ModelRecord[]> {
  const results: ModelRecord[] = [];
  let url: string | null = "https://api.anthropic.com/v1/models?limit=100";
  while (url) {
    const resp = await fetch(url, { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const json = (await resp.json()) as {
      data?: Array<{ id: string; display_name?: string; created_at?: string }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const m of json.data ?? []) {
      results.push({
        id: m.id,
        displayName: m.display_name?.length ? m.display_name : m.id,
        provider: "claude",
        createdAt: m.created_at ?? "",
      });
    }
    url = json.has_more && json.last_id
      ? `https://api.anthropic.com/v1/models?limit=100&after_id=${encodeURIComponent(json.last_id)}`
      : null;
  }
  return results.filter((m) => m.id.startsWith("claude-"));
}
