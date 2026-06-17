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
import { parseProvider, runProviderBackend, agentSystemPrompt } from "./provider-backends.ts";
import { runOllamaAgentLoop } from "./ollama-agent.ts";
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
  phase?: "plan" | "implement";  // S7 two-phase impl turns
  writtenFiles?: string[];   // sandbox-relative files the implement phase wrote (for review, BR-10)
};

/** Roles that produce a one-shot analytical artifact — delegable single-shot in Phase 1. */
export const ANALYSIS_ROLES = new Set(["bird", "mj", "kobe", "pippen", "drexler", "magic"]);
/** Implementation/verification roles — two-phase plan→approve→implement (BR-5). */
export const IMPL_ROLES = new Set(["shaq"]);
/** Providers where delegated implementation is ENABLED. codex + gemini (plan gate 3/3); ollama (constructive tool-loop gate). */
export const IMPL_PROVIDERS = new Set(["codex", "gemini", "ollama"]);

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

/** Sandbox-relative list of files written under workDir (for review, BR-10). */
function manifest(workDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "out.txt" || e.name === "schema.json") continue; // dispatcher's own files, not the agent's
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(workDir, "");
  return out;
}

// ── main entry ──────────────────────────────────────────────────────────────
export type DispatchOpts = {
  sessionDir?: string;
  timeoutMs?: number;
  scrubbed?: string[];
  phase?: "plan" | "implement";  // required for IMPL roles (BR-5 plan-approve-before-write)
  approvedPlan?: string;         // required for implement phase — the human-approved plan
};

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
  const isImpl = IMPL_ROLES.has(agent);
  if (!isImpl && !ANALYSIS_ROLES.has(agent)) return base({ error: `agent '${agent}' is not a delegable role.` });
  if (isImpl && !IMPL_PROVIDERS.has(provider)) return base({ error: `delegated implementation for '${agent}' on ${provider} is gated Phase 3 (not enabled). Re-pin ${agent} to claude or codex.` });
  if (isImpl && opts.phase !== "plan" && opts.phase !== "implement") return base({ error: `'${agent}' is an implementation role — requires --phase plan|implement (plan-approve-before-write, BR-5).` });
  if (isImpl && opts.phase === "implement" && !opts.approvedPlan?.trim()) return base({ error: `implement phase requires the human-approved plan (--plan <file>). Run --phase plan first, get sign-off, then implement.` });

  const auth = assertSubscriptionAuth(provider);
  if (!auth.ok) return base({ error: auth.error, authMode: auth.mode });

  const phase = isImpl ? opts.phase : undefined;
  const timeoutMs = opts.timeoutMs ?? turnTimeoutMs(provider) * (phase === "implement" ? 2 : 1);
  const sessionDir = opts.sessionDir ?? process.env.SESSION_WORKTREE ?? process.cwd();
  const safeId = `${agent}-${Date.now()}`;
  const workDir = path.join(sessionDir, ".dt-delegated", safeId);

  // Prompt + sandbox mode per role/phase:
  //  analysis      → single-shot, write-incapable intent (workspace-write moot; no file work)
  //  impl/plan     → read-only (OS-enforced: cannot write → emits plan)         [S7 gate]
  //  impl/implement→ workspace-write with the approved plan                      [post-approval]
  let prompt: string;
  let sandbox: "read-only" | "workspace-write";
  if (!isImpl) { prompt = `${brief}\n\n${INTERACTIVE_SINGLE_SHOT_APPEND}`; sandbox = "read-only"; }
  else if (phase === "plan") { prompt = `${brief}\n\nPLAN MODE (read-only): produce an implementation PLAN only — the files you will create/modify and the approach. Do NOT write files.`; sandbox = "read-only"; }
  else { prompt = `${brief}\n\nAPPROVED PLAN — implement exactly this, writing the files now:\n${opts.approvedPlan}`; sandbox = "workspace-write"; }

  let locked = false;
  try {
    if (provider === "ollama") {
      locked = await acquireOllamaLock(timeoutMs);
      if (!locked) return base({ error: "ollama busy in another /team session (lock timeout). Retry, skip, or re-pin.", authMode: auth.mode });
    }
    // ollama implementation = orchestrator tool-loop (we execute tools; write tools
    // withheld until the implement phase). Everything else = single-shot backend.
    let output: string, written: string[], rawErr: string | undefined, gateViol = false;
    if (provider === "ollama" && isImpl) {
      const loop = await runOllamaAgentLoop({ modelId, system: agentSystemPrompt(agent), brief: prompt, phase: phase!, worktree: sessionDir, sandbox: workDir, timeoutMs });
      output = extractJson(loop.output); written = loop.writtenFiles; rawErr = loop.error; gateViol = loop.gateViolation;
    } else {
      const raw = await runProviderBackend(provider, agent, safeId, prompt, modelId, timeoutMs, { workDir, keepWorkDir: true, sandbox });
      output = extractJson(raw.agent_output); written = fs.existsSync(workDir) ? manifest(workDir) : []; rawErr = raw.error;
    }
    const dir = fs.existsSync(workDir) ? workDir : undefined;
    if (rawErr) return base({ error: rawErr, authMode: auth.mode, artifactsDir: dir, phase, writtenFiles: written });
    if (gateViol) return base({ error: "BR-5 violation: a write/bash tool was attempted before approval (plan phase)", output, authMode: auth.mode, artifactsDir: dir, phase, writtenFiles: written });

    if (phase === "plan") {
      // Plan turn: lenient gate (non-empty plan) + assert read-only held (no writes).
      if (!output.trim()) return base({ error: "plan phase produced an empty plan", authMode: auth.mode, artifactsDir: dir, phase });
      if (written.length) return base({ error: `BR-5 violation: plan phase wrote ${written.length} file(s) under read-only — ${written.join(", ")}`, output, authMode: auth.mode, artifactsDir: dir, phase, writtenFiles: written });
      return base({ ok: true, output, authMode: auth.mode, cost_usd: 0, artifactsDir: dir, phase, writtenFiles: [] });
    }

    // implement phase (or analysis): full contract gate.
    const gate = validateContract(agent, output);
    if (!gate.ok) return base({ error: `contract gate failed: ${gate.reason}`, output, authMode: auth.mode, artifactsDir: dir, phase, writtenFiles: written });

    // BR-4 hardening (impl): any cited files_changed path must actually exist in the sandbox.
    if (phase === "implement") {
      try {
        const fc = (JSON.parse(output) as any).files_changed;
        if (Array.isArray(fc)) {
          const missing = fc.map((f: any) => (typeof f === "string" ? f : f?.path)).filter((p: any) => typeof p === "string" && p)
            .filter((p: string) => !fs.existsSync(path.isAbsolute(p) ? p : path.join(workDir, p)) && !written.includes(p));
          if (missing.length) return base({ error: `cited file(s) not found in sandbox (hallucinated write?): ${missing.join(", ")}`, output, authMode: auth.mode, artifactsDir: dir, phase, writtenFiles: written });
        }
      } catch { /* output not parseable here is already caught by the gate */ }
    }

    return base({ ok: true, output, authMode: auth.mode, cost_usd: 0, artifactsDir: dir, phase, writtenFiles: written });
  } catch (e) {
    return base({ error: `dispatch error: ${e instanceof Error ? e.message : String(e)}`, authMode: auth.mode, phase });
  } finally {
    if (locked) releaseOllamaLock();
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Analysis:  bun team-dispatch.ts <agent> <briefFile> [--timeout ms]
// Impl (S7): bun team-dispatch.ts <agent> <briefFile> --phase plan [--timeout ms]
//            (human approves the plan) →
//            bun team-dispatch.ts <agent> <briefFile> --phase implement --plan <approvedPlanFile>
if (import.meta.main) {
  const scrubbed = scrubMeteredEnv();                       // BR-1/BR-2 — before any spawn
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined; };
  const positionals = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
  const [agent, briefFile] = positionals;
  const phase = flag("--phase") as "plan" | "implement" | undefined;
  const planFile = flag("--plan");
  const timeoutMs = flag("--timeout") ? parseInt(flag("--timeout")!, 10) : undefined;

  const fail = (error: string) => { console.log(JSON.stringify({ agent, ok: false, error }, null, 2)); process.exit(0); };
  if (!agent || !briefFile) { console.error("usage: bun team-dispatch.ts <agent> <briefFile> [--phase plan|implement] [--plan <file>] [--timeout ms]"); process.exit(2); }
  let brief = "";
  try { brief = fs.readFileSync(briefFile, "utf-8"); } catch (e) { fail(`cannot read brief file ${briefFile}: ${e instanceof Error ? e.message : String(e)}`); }
  let approvedPlan: string | undefined;
  if (planFile) { try { approvedPlan = fs.readFileSync(planFile, "utf-8"); } catch (e) { fail(`cannot read plan file ${planFile}: ${e instanceof Error ? e.message : String(e)}`); } }

  const result = await runDelegatedTurn(agent, brief, { timeoutMs, scrubbed, phase, approvedPlan });
  console.log(JSON.stringify(result, null, 2));
}
