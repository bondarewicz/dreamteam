#!/usr/bin/env bun
/**
 * team-dispatch.ts — interactive /team delegation wrapper (hybrid Phase 1).
 *
 * Coach K `Bash`-invokes this for a non-claude-pinned agent turn. It is the thin
 * interactive analog of the eval harness's runAgentScenario: brief-in → resolve
 * the agent's pinned provider (the SAME routing authority the eval path uses) →
 * enforce the financial invariant → run the delegated turn in a session-scoped
 * sandbox → validate the contract → emit a TurnResult JSON on stdout.
 *
 * Invariants enforced here (see docs/spec-hybrid-team/spec.md):
 *   BR-1  scrubbed child env + positive subscription pre-flight (no metered API)
 *   BR-2  abort if ANTHROPIC_BASE_URL is set (that IS the ruled-out proxy)
 *   BR-3  provider == resolveEffectiveModel(agent) — no parallel routing
 *   BR-4  contract gate (valid JSON + non-empty + Zod-if-registered + caps)
 *   BR-10 session-scoped sandbox; files kept for review, never auto-applied
 *
 * Phase 1 delegates ANALYSIS/SYNTHESIS roles only; Shaq (implementation) is
 * claude-native and refused here (its delegation is gated Phase 2/3).
 */
import path from "path";
import fs from "fs";
import os from "os";
import { resolveEffectiveModel } from "./agent-runner.ts";
import { parseProvider, runProviderBackend } from "./provider-backends.ts";
import { validateAgentOutput, getAgentSchema } from "../../schemas/agent-schemas.ts";

export type TurnResult = {
  agent: string;
  provider: string;
  modelId: string;
  ok: boolean;
  output: string;            // the contract JSON (validated) — empty on failure
  error?: string;            // provider-named, actionable
  artifactsDir?: string;     // session sandbox (BR-10), for review
  durationMs: number;
  cost_usd: number;          // stamped by the dispatcher AFTER auth proven (never from child)
  authMode: "subscription" | "local" | "metered" | "unknown";
  scrubbed: string[];        // metered keys removed from the child env (BR-1 audit)
};

/** Roles that produce a one-shot analytical artifact — delegable single-shot in Phase 1. */
export const ANALYSIS_ROLES = new Set(["bird", "mj", "kobe", "pippen", "drexler", "magic"]);
/** Implementation/verification roles — claude-native in Phase 1; delegation gated Phase 2/3. */
export const IMPL_ROLES = new Set(["shaq"]);

/** S4 — interactive single-shot neutralizer for analysis roles (no tools, deliver inline, be honest about blind spots). */
export const INTERACTIVE_SINGLE_SHOT_APPEND = [
  "INTERACTIVE DELEGATION — SINGLE SHOT, NO TOOLS.",
  "You are running headless with no tools, no plan mode, no approval loop, no Coach K to message.",
  "Override any instruction to enter plan mode, wait for approval, or write files first — none of that is available here.",
  "Do not escalate about tooling, environment, plan mode, or missing directories; treat the task as fully specified.",
  "Deliver your COMPLETE work INLINE in your single JSON response (the full contract, not a description).",
  "Assert only what is present in this brief; if a conclusion requires reading the repo or running a command you cannot do here, state it as a limitation and lower confidence — do not assert it as verified.",
].join(" ");

/** Per-provider turn timeouts (analysis class — Phase 1). Env-overridable. */
function turnTimeoutMs(provider: string): number {
  const envAll = parseInt(process.env.DT_TURN_TIMEOUT_MS ?? "", 10);
  const envProv = parseInt(process.env[`DT_TURN_TIMEOUT_MS_${provider.toUpperCase()}`] ?? "", 10);
  if (Number.isFinite(envProv)) return envProv;
  if (Number.isFinite(envAll)) return envAll;
  return { codex: 240_000, gemini: 120_000, ollama: 300_000, claude: 0 }[provider] ?? 180_000;
}

// ── BR-1/BR-2: financial invariant enforcement ──────────────────────────────
const METERED_KEYS = ["OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** Strip metered keys from THIS process env so all child spawns inherit a clean env. Returns what was removed. */
export function scrubMeteredEnv(): string[] {
  const removed: string[] = [];
  for (const k of METERED_KEYS) {
    if (process.env[k]) { delete process.env[k]; removed.push(k); }
  }
  // BR-2: a proxy base-url is never acceptable in the interactive hybrid.
  if (process.env.ANTHROPIC_BASE_URL) { delete process.env.ANTHROPIC_BASE_URL; removed.push("ANTHROPIC_BASE_URL"); }
  return removed;
}

const HOME = process.env.HOME ?? os.homedir();

/** Positive pre-flight: confirm the provider will use subscription/local auth, not metered. */
export function assertSubscriptionAuth(provider: string): { ok: boolean; mode: TurnResult["authMode"]; error?: string } {
  switch (provider) {
    case "codex":
      return fs.existsSync(path.join(HOME, ".codex", "auth.json")) || fs.existsSync(path.join(HOME, ".codex"))
        ? { ok: true, mode: "subscription" }
        : { ok: false, mode: "unknown", error: "codex: no ChatGPT login found (~/.codex). Run `codex login`. Refusing — would otherwise require a metered API key." };
    case "gemini":
      return fs.existsSync(path.join(HOME, ".gemini"))
        ? { ok: true, mode: "subscription" }
        : { ok: false, mode: "unknown", error: "gemini: no CLI login found (~/.gemini). Run `gemini` and sign in. Refusing — would otherwise require a metered GEMINI_API_KEY." };
    case "ollama":
      return { ok: true, mode: "local" };
    default:
      return { ok: false, mode: "unknown", error: `unknown provider: ${provider}` };
  }
}

// ── BR-4: contract gate ─────────────────────────────────────────────────────
/**
 * Pull the JSON payload out of a delegated turn's raw text. Models that lack a
 * registered schema aren't fence-stripped by the backend, so they often wrap
 * the JSON in a ```json fence or add a preamble. Take the fenced block if
 * present, else from the first brace. Returns the cleaned string (or the input
 * trimmed if no JSON-looking content found).
 */
export function extractJson(s: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) return fence[1].trim();
  const start = s.search(/[{[]/);
  return start === -1 ? s.trim() : s.slice(start).trim();
}

/** Validate a delegated turn's output: valid JSON object + non-empty + Zod-if-registered + caps. */
export function validateContract(agent: string, output: string): { ok: boolean; reason?: string } {
  let data: unknown;
  try { data = JSON.parse(output); } catch { return { ok: false, reason: "output is not valid JSON" }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "output is not a JSON object" };
  const obj = data as Record<string, unknown>;
  const nonEmpty = Object.values(obj).some((v) =>
    v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && v !== null && Object.keys(v as object).length === 0));
  if (!nonEmpty) return { ok: false, reason: "output has no non-empty fields (schema-valid but empty)" };

  if (getAgentSchema(agent)) {
    const v = validateAgentOutput(agent, data);
    if (!v.success) return { ok: false, reason: `schema validation failed: ${v.error}` };
  }

  // confidence-cap: an escalating result must not claim high confidence.
  const escalations = (obj.escalations ?? (obj as any).escalation) as unknown;
  const conf = (typeof obj.confidence_level === "number" ? obj.confidence_level
    : typeof (obj.confidence as any)?.level === "number" ? (obj.confidence as any).level : undefined);
  if (Array.isArray(escalations) && escalations.length > 0 && typeof conf === "number" && conf > 70) {
    return { ok: false, reason: `confidence ${conf} too high for a result with ${escalations.length} open escalation(s)` };
  }
  return { ok: true };
}

// ── S6a: host-scoped ollama advisory lock ───────────────────────────────────
const OLLAMA_LOCK = path.join(HOME, ".claude", "dt-ollama.lock");
const LOCK_STALE_MS = 20 * 60 * 1000;

async function acquireOllamaLock(waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  fs.mkdirSync(path.dirname(OLLAMA_LOCK), { recursive: true });
  for (;;) {
    try { fs.writeFileSync(OLLAMA_LOCK, String(process.pid), { flag: "wx" }); return true; }
    catch {
      try { if (Date.now() - fs.statSync(OLLAMA_LOCK).mtimeMs > LOCK_STALE_MS) { fs.rmSync(OLLAMA_LOCK, { force: true }); continue; } } catch { /* gone */ }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
function releaseOllamaLock(): void { try { fs.rmSync(OLLAMA_LOCK, { force: true }); } catch { /* ignore */ } }

// ── main entry ──────────────────────────────────────────────────────────────
export type DispatchOpts = { sessionDir?: string; timeoutMs?: number; scrubbed?: string[] };

/** Run one delegated agent turn. Never throws — failures come back as { ok:false, error }. */
export async function runDelegatedTurn(agent: string, brief: string, opts: DispatchOpts = {}): Promise<TurnResult> {
  const start = Date.now();
  const scrubbed = opts.scrubbed ?? [];
  const model = resolveEffectiveModel(agent);
  const { provider, modelId } = parseProvider(model);
  const base = (p: Partial<TurnResult> = {}): TurnResult => ({
    agent, provider, modelId, ok: false, output: "", durationMs: Date.now() - start,
    cost_usd: 0, authMode: "unknown", scrubbed, ...p,
  });

  if (provider === "claude") return base({ error: `${agent} resolves to claude — run as a native subagent, do not delegate.` });
  if (IMPL_ROLES.has(agent)) return base({ error: `delegated implementation not enabled for '${agent}' on ${provider} (Phase 2/3, gated). Re-pin ${agent} to claude.` });
  if (!ANALYSIS_ROLES.has(agent)) return base({ error: `agent '${agent}' is not a delegable role.` });

  const auth = assertSubscriptionAuth(provider);
  if (!auth.ok) return base({ error: auth.error, authMode: auth.mode });

  const timeoutMs = opts.timeoutMs ?? turnTimeoutMs(provider);
  const sessionDir = opts.sessionDir ?? process.env.SESSION_WORKTREE ?? process.cwd();
  const safeId = `${agent}-${Date.now()}`;
  const workDir = path.join(sessionDir, ".dt-delegated", safeId);
  const prompt = ANALYSIS_ROLES.has(agent) ? `${brief}\n\n${INTERACTIVE_SINGLE_SHOT_APPEND}` : brief;

  let locked = false;
  try {
    if (provider === "ollama") {
      locked = await acquireOllamaLock(timeoutMs);
      if (!locked) return base({ error: "ollama busy in another /team session (lock timeout). Retry, skip, or re-pin.", authMode: auth.mode });
    }
    const raw = await runProviderBackend(provider, agent, safeId, prompt, modelId, timeoutMs, { workDir, keepWorkDir: true });
    const sandbox = fs.existsSync(workDir) ? workDir : undefined;
    if (raw.error) return base({ error: raw.error, authMode: auth.mode, artifactsDir: sandbox });

    // Normalize: strip markdown fences/preamble (backends only fence-strip when a schema is registered).
    const output = extractJson(raw.agent_output);
    const gate = validateContract(agent, output);
    if (!gate.ok) return base({ error: `contract gate failed: ${gate.reason}`, output, authMode: auth.mode, artifactsDir: sandbox });

    // cost_usd stamped here, AFTER subscription auth proven (never trusted from the child).
    return base({ ok: true, output, authMode: auth.mode, cost_usd: 0, artifactsDir: sandbox });
  } catch (e) {
    return base({ error: `dispatch error: ${e instanceof Error ? e.message : String(e)}`, authMode: auth.mode });
  } finally {
    if (locked) releaseOllamaLock();
  }
}

// ── CLI: bun team-dispatch.ts <agent> <briefFile> [timeoutMs] ───────────────
if (import.meta.main) {
  const scrubbed = scrubMeteredEnv();                       // BR-1/BR-2 — before any spawn
  const [agent, briefFile, timeoutArg] = process.argv.slice(2);
  if (!agent || !briefFile) {
    console.error("usage: bun team-dispatch.ts <agent> <briefFile> [timeoutMs]");
    process.exit(2);
  }
  let brief = "";
  try { brief = fs.readFileSync(briefFile, "utf-8"); }
  catch (e) { console.log(JSON.stringify({ agent, ok: false, error: `cannot read brief file ${briefFile}: ${e instanceof Error ? e.message : String(e)}` })); process.exit(0); }
  const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) : undefined;
  const result = await runDelegatedTurn(agent, brief, { timeoutMs, scrubbed });
  console.log(JSON.stringify(result, null, 2));
}
