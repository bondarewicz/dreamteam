/**
 * model-tiers.ts — harness-neutral model specs (Phase 3B).
 *
 * An agent's `model:` frontmatter is a capability TIER (deep | mid) plus
 * optional explicit per-provider PINS. The tier resolves to a concrete model
 * per provider via the table below; a pin overrides the tier for that provider.
 *
 *   model:
 *     tier: deep
 *     pin:
 *       claude: claude-opus-5
 *       ollama: qwen3.6
 *
 * This decouples "how capable a model this role needs" from "which exact build
 * on which provider" — version bumps happen in one table, and any agent can be
 * pointed at any provider's model. Legacy flat `model: <id>` still parses (it
 * becomes the claude pin, with the tier inferred from the id).
 */

export const PROVIDERS = ["claude", "ollama", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TIERS = ["deep", "mid"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Tier → concrete model per provider. The one place model versions live.
 *   deep — strongest reasoning (domain, architecture, review)
 *   mid  — balanced (implementation, synthesis)
 * Throwaway discovery subagents are not a tier: Coach K spawns those on an
 * explicit cheap model (see commands/team.md), outside the roster's spec.
 * Non-Claude rows use the strongest models we've verified on each CLI; some
 * tiers collapse where a provider exposes fewer distinct models (pin to override).
 * Codex on a ChatGPT account exposes only gpt-5.5 + gpt-5.4-mini (others 400).
 */
export const TIER_DEFAULTS: Record<Provider, Record<Tier, string>> = {
  // claude: opus 5 = flagship long-horizon agentic coding + high-recall code
  //   review (deep), sonnet 5 = most agentic mid-tier — self-checks + better
  //   error recovery (mid). Fable 5 is not a tier default: it is applied via
  //   explicit pins on the seats that need it (Coach K orchestration, Kobe
  //   bug-recall). [platform.claude.com models]
  claude: { deep: "claude-opus-5", mid: "claude-sonnet-5" },
  // ollama: maps to locally-pulled models. Adjust to whatever you've
  //   `ollama pull`-ed (pin to override).
  ollama: { deep: "qwen3.6", mid: "qwen3.6" },
  // codex (ChatGPT account): only gpt-5.5 + gpt-5.4-mini are accepted (others 400).
  codex: { deep: "gpt-5.5", mid: "gpt-5.5" },
};

export type ModelSpec = {
  tier: Tier;
  pin: Partial<Record<Provider, string>>;
  /**
   * The agent's declared provider for interactive use (hybrid /team). When set,
   * it's the default provider below CLI overrides (--model / --provider). Unset =
   * claude. Evals override per-run via --provider; this is the per-agent default.
   */
  provider?: Provider;
};

/** Infer a tier from a bare Claude model id (opus → deep, everything else → mid). */
export function inferTier(modelId: string): Tier {
  if (/opus/i.test(modelId)) return "deep";
  return "mid"; // sonnet, haiku, and anything unrecognized
}

/**
 * Parse a frontmatter `model:` value into a ModelSpec. Accepts:
 *   - string  "claude-opus-4-8"  → { tier: inferred, pin: { claude: id } }
 *   - string  "deep" | "mid"     → { tier, pin: {} }
 *   - object  { tier?, pin? }    → normalized ModelSpec
 * Unknown/missing → defaults to { tier: "deep", pin: {} }.
 */
export function parseModelSpec(raw: unknown): ModelSpec {
  if (typeof raw === "string") {
    const s = raw.trim();
    if ((TIERS as readonly string[]).includes(s)) return { tier: s as Tier, pin: {} };
    if (s.length === 0) return { tier: "deep", pin: {} };
    return { tier: inferTier(s), pin: { claude: s } };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const tier: Tier = (TIERS as readonly string[]).includes(obj.tier as string) ? (obj.tier as Tier) : "deep";
    const pin: Partial<Record<Provider, string>> = {};
    const rawPin = (obj.pin && typeof obj.pin === "object" ? obj.pin : {}) as Record<string, unknown>;
    for (const p of PROVIDERS) {
      const v = rawPin[p];
      if (typeof v === "string" && v.trim()) pin[p] = v.trim();
    }
    const provider = (PROVIDERS as readonly string[]).includes(obj.provider as string) ? (obj.provider as Provider) : undefined;
    return provider ? { tier, pin, provider } : { tier, pin };
  }
  return { tier: "deep", pin: {} };
}

/** Resolve the concrete model id for a provider: explicit pin, else tier default. */
export function resolveModel(spec: ModelSpec, provider: Provider): string {
  return spec.pin[provider] ?? TIER_DEFAULTS[provider][spec.tier];
}

/** Serialize a ModelSpec back to YAML lines for the frontmatter `model:` block. */
export function renderModelSpecYaml(spec: ModelSpec): string {
  const lines = ["model:", `  tier: ${spec.tier}`];
  if (spec.provider) lines.push(`  provider: ${spec.provider}`);
  const pinned = PROVIDERS.filter((p) => spec.pin[p]);
  if (pinned.length) {
    lines.push("  pin:");
    for (const p of pinned) lines.push(`    ${p}: ${spec.pin[p]}`);
  }
  return lines.join("\n");
}
