/**
 * provider-backends.ts — direct, non-Claude run backends for runAgent (Phase 2).
 *
 * The eval harness routes on a `provider/model` model id. Claude (bare id or
 * "claude/…") stays on the existing claude -p path (agent-runner.ts); the
 * prefixes below dispatch here, each invoking the provider's own first-party
 * interface directly (no opencode):
 *
 *   ollama/<m>  → POST :11434/api/chat  (native structured output: format=<schema>)
 *   gemini/<m>  → gemini -p … -o json   (CLI; soft schema → instruction + Zod downstream)
 *   codex/<m>   → codex exec … --output-schema --output-last-message  (native schema)
 *
 * Each returns a RawOutput record identical in shape to the claude path, so the
 * grader + scorer phases run unchanged. The judge (Coach K) stays on Claude.
 */

import path from "path";
import os from "os";
import fs from "fs";
import type { RawOutput } from "./types.ts";
import { getAgentJsonSchema, getAgentStrictJsonSchema, stripNulls } from "../../schemas/agent-schemas.ts";
import { withAgentDefense } from "../../scripts/prompt-defense.ts";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const OLLAMA_URL = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

export const KNOWN_PROVIDERS = ["claude", "ollama", "gemini", "codex"] as const;
export type Provider = (typeof KNOWN_PROVIDERS)[number];

/**
 * Split a model id into provider + bare model. A bare id (no slash) or an
 * unknown prefix is treated as Claude (back-compat: "claude-opus-4-8" → claude).
 */
export function parseProvider(model?: string): { provider: Provider; modelId: string } {
  const m = (model ?? "").trim();
  const slash = m.indexOf("/");
  if (slash === -1) return { provider: "claude", modelId: m };
  const prefix = m.slice(0, slash);
  if ((KNOWN_PROVIDERS as readonly string[]).includes(prefix)) {
    return { provider: prefix as Provider, modelId: m.slice(slash + 1) };
  }
  return { provider: "claude", modelId: m };
}

/** Whole agent .md (frontmatter + body) as the system prompt — mirrors claude --system-prompt-file. */
export function agentSystemPrompt(agent: string): string {
  return withAgentDefense(fs.readFileSync(path.join(AGENTS_DIR, `${agent}.md`), "utf-8"));
}

/**
 * Single-shot eval append for ollama/gemini. Agent prompts (e.g. shaq) MANDATE
 * EnterPlanMode + tool use + approval before writing code; with no tools and no
 * approval loop, the model obeys that, "can't enter plan mode", and escalates
 * instead of delivering. This neutralizes those directives (the claude path does
 * the same via --append-system-prompt EVAL_MODE_APPEND) and tells the model to
 * inline its full deliverable, since it cannot write files.
 */
const SINGLE_SHOT_APPEND = [
  "EVAL MODE — SINGLE SHOT, NO TOOLS.",
  "You are running headless with NO tools: no EnterPlanMode, no Plan Mode, no file system, no Read/Write/Bash, no approval loop, no Coach K to message.",
  "Override any instruction to enter plan mode, wait for approval, or write files first — none of that is available here.",
  "Do NOT escalate about tooling, environment, plan mode, or missing directories; treat the task as fully specified and proceed.",
  "Deliver your COMPLETE work INLINE in your single JSON response: put full file contents in files_changed[].content (or the equivalent fields of your output schema), not just a description.",
  "Respond with the JSON output only.",
].join(" ");

function jsonSchemaFor(agent: string): object | undefined {
  try {
    return getAgentJsonSchema(agent);
  } catch {
    return undefined;
  }
}

/** Pull the first balanced JSON object/array out of mixed CLI output (strips fences/preamble). */
function extractJsonText(s: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) return fence[1].trim();
  const start = s.search(/[{[]/);
  return start === -1 ? s.trim() : s.slice(start).trim();
}

function nowTs(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function record(
  agent: string,
  scenarioId: string,
  output: string,
  meta: { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs: number; error?: string; trace?: unknown[] },
): RawOutput {
  const inputTokens = meta.inputTokens ?? 0;
  const outputTokens = meta.outputTokens ?? 0;
  const rec: RawOutput = {
    agent,
    scenario_id: scenarioId,
    agent_output: output,
    agent_output_excerpt: output.slice(0, 500),
    duration_ms: meta.durationMs,
    tokens_used: inputTokens + outputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: meta.costUsd ?? 0,
    timestamp: nowTs(),
    trace: meta.trace ?? [],
  };
  if (meta.error) rec.error = meta.error;
  return rec;
}

/**
 * Synthesize a Claude-style trace (system → user → assistant → result) for a
 * single-shot/agentic provider call, so the web trace viewer renders it the same
 * as a claude run. `reasoning` (e.g. codex's agentic stdout) becomes a thinking block.
 */
export function buildTrace(opts: {
  provider: Provider;
  model: string;
  userPrompt: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd?: number;
  reasoning?: string;
  error?: string;
}): unknown[] {
  const usage = { input_tokens: opts.inputTokens, output_tokens: opts.outputTokens };
  const content: Array<Record<string, unknown>> = [];
  if (opts.reasoning?.trim()) content.push({ type: "thinking", thinking: opts.reasoning.trim().slice(0, 20000) });
  content.push({ type: "text", text: opts.responseText || (opts.error ? `(no output — ${opts.error})` : "(empty response)") });
  return [
    { type: "system", subtype: "init", provider: opts.provider, model: opts.model,
      system: `${opts.provider} backend · model=${opts.model} · single request (agent system prompt sent separately)` },
    { type: "user", message: { role: "user", content: [{ type: "text", text: opts.userPrompt }] } },
    { type: "assistant", message: { role: "assistant", model: opts.model, content, usage } },
    { type: "result", stop_reason: opts.error ? "error" : "end_turn", num_turns: 1,
      duration_ms: opts.durationMs, usage, total_cost_usd: opts.costUsd ?? 0 },
  ];
}

/** Dispatch to the right non-claude backend. (Claude is handled in agent-runner.ts.) */
/**
 * opts (Phase-3B hybrid /team, S3): the interactive caller supplies a
 * session-scoped sandbox dir and suppresses teardown so a delegated turn's file
 * writes survive for review. Eval callers omit opts → ephemeral tmp dir, rm in
 * finally (unchanged). Only codex writes files, so only it consumes opts.
 */
export type BackendOpts = { workDir?: string; keepWorkDir?: boolean; sandbox?: "read-only" | "workspace-write" };

export async function runProviderBackend(
  provider: Provider,
  agent: string,
  scenarioId: string,
  prompt: string,
  modelId: string,
  timeoutMs: number,
  opts?: BackendOpts,
): Promise<RawOutput> {
  switch (provider) {
    case "ollama": return runOllama(agent, scenarioId, prompt, modelId, timeoutMs);
    case "gemini": return runGemini(agent, scenarioId, prompt, modelId, timeoutMs, opts);
    case "codex": return runCodex(agent, scenarioId, prompt, modelId, timeoutMs, opts);
    default: throw new Error(`runProviderBackend called for claude — handle in agent-runner.ts`);
  }
}

// ── Ollama: native /api/chat with structured-output `format` ───────────────────
export async function runOllama(agent: string, scenarioId: string, prompt: string, modelId: string, timeoutMs: number): Promise<RawOutput> {
  const start = Date.now();
  const schema = jsonSchemaFor(agent);
  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: "system", content: `${agentSystemPrompt(agent)}\n\n${SINGLE_SHOT_APPEND}` },
      { role: "user", content: prompt },
    ],
    stream: false,
  };
  if (schema) body.format = schema; // native structured output
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await resp.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      error?: string;
    };
    const content = json.message?.content ?? "";
    const inTok = json.prompt_eval_count ?? 0, outTok = json.eval_count ?? 0;
    const err = resp.ok ? (json.error ? `ollama: ${json.error}` : undefined) : `ollama HTTP ${resp.status}`;
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, content, {
      inputTokens: inTok, outputTokens: outTok, durationMs, error: err,
      trace: buildTrace({ provider: "ollama", model: modelId, userPrompt: prompt, responseText: content, inputTokens: inTok, outputTokens: outTok, durationMs, error: err }),
    });
  } catch (e) {
    const error = `ollama: ${e instanceof Error ? e.message : String(e)}`;
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, "", { durationMs, error,
      trace: buildTrace({ provider: "ollama", model: modelId, userPrompt: prompt, responseText: "", inputTokens: 0, outputTokens: 0, durationMs, error }) });
  }
}

// ── Gemini: CLI headless (soft schema → instruction; Zod re-validates downstream) ──
export async function runGemini(agent: string, scenarioId: string, prompt: string, modelId: string, timeoutMs: number, opts?: BackendOpts): Promise<RawOutput> {
  const start = Date.now();
  const schema = jsonSchemaFor(agent);
  const impl = opts?.sandbox === "workspace-write";   // implement phase: gemini writes files
  const readOnly = opts?.sandbox === "read-only" && !!opts?.workDir; // plan phase: OS read-only cwd
  // Implement turns must use tools to write; analysis/plan turns are single-shot.
  let system = impl ? agentSystemPrompt(agent) : `${agentSystemPrompt(agent)}\n\n${SINGLE_SHOT_APPEND}`;
  if (schema && !impl) system += `\n\nIMPORTANT: Do not narrate, summarize, or use tools. Your FINAL response must be ONLY a single JSON object that conforms to this JSON Schema — no prose, no markdown fences, nothing before or after the JSON:\n${JSON.stringify(schema)}`;
  // `--approval-mode plan` is NOT write-incapable headless; the plan gate is an OS read-only
  // cwd + a no-write instruction. Implement uses a writable cwd + auto_edit.
  const userPrompt = readOnly
    ? `PLAN ONLY. You have NO write access (filesystem is read-only; write tools WILL fail). Do NOT call write_file/edit/shell. Output ONLY the plan as your response.\n\n${prompt}`
    : prompt;
  const approvalMode = impl ? "auto_edit" : "plan";
  const cwd = opts?.workDir ?? process.cwd();
  const sysFile = path.join(os.tmpdir(), `dt-gemini-${scenarioId.replace(/[^a-z0-9]/gi, "_")}-${start}.system.md`);
  let chmodded = false;
  try {
    if (opts?.workDir) fs.mkdirSync(opts.workDir, { recursive: true });
    fs.writeFileSync(sysFile, system);
    if (readOnly) { fs.chmodSync(opts!.workDir!, 0o555); chmodded = true; } // hard write gate (EACCES)
    const childEnv: Record<string, string> = { ...(process.env as Record<string, string>), GEMINI_SYSTEM_MD: sysFile };
    if (opts?.workDir) childEnv.GEMINI_CLI_TRUST_WORKSPACE = "true"; // else plan mode is silently downgraded (exit 55)
    const proc = Bun.spawn(["gemini", "-p", userPrompt, "-m", modelId, "-o", "json", "--approval-mode", approvalMode], {
      cwd, env: childEnv, stdout: "pipe", stderr: "pipe",
    });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    if (chmodded) { try { fs.chmodSync(opts!.workDir!, 0o755); } catch { /* ignore */ } chmodded = false; }
    // Parse the ENVELOPE by first brace only — do NOT run fence stripping here: the
    // gemini envelope is clean JSON, but its `.response` value may itself contain a
    // ```json fence, which fence-aware extraction would wrongly grab instead.
    let env: Record<string, unknown> = {};
    const brace = out.search(/[{[]/);
    if (brace !== -1) { try { env = JSON.parse(out.slice(brace)); } catch { /* leave empty */ } }
    const resp = typeof env.response === "string" ? env.response : "";
    const content = schema ? extractJsonText(resp) : resp;
    const tokens = (env.stats as any)?.models?.[modelId]?.tokens?.total ?? 0;
    const outTok = typeof tokens === "number" ? tokens : 0;
    const err = code !== 0 ? `gemini exit ${code}` : (resp ? undefined : "gemini: empty response");
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, content, {
      outputTokens: outTok, durationMs, error: err,
      trace: buildTrace({ provider: "gemini", model: modelId, userPrompt: prompt, responseText: content, inputTokens: 0, outputTokens: outTok, durationMs, error: err }),
    });
  } catch (e) {
    const error = `gemini: ${e instanceof Error ? e.message : String(e)}`;
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, "", { durationMs, error,
      trace: buildTrace({ provider: "gemini", model: modelId, userPrompt: prompt, responseText: "", inputTokens: 0, outputTokens: 0, durationMs, error }) });
  } finally {
    if (chmodded) { try { fs.chmodSync(opts!.workDir!, 0o755); } catch { /* ignore */ } }
    try { fs.rmSync(sysFile, { force: true }); } catch { /* ignore */ }
  }
}

// ── Codex: codex exec with native --output-schema + --output-last-message ──────
export async function runCodex(agent: string, scenarioId: string, prompt: string, modelId: string, timeoutMs: number, opts?: BackendOpts): Promise<RawOutput> {
  const start = Date.now();
  // Native structured output via --output-schema: codex maps it to OpenAI strict
  // mode, which requires every property in `required` + additionalProperties:false.
  // getAgentStrictJsonSchema() applies that transform (optional fields → nullable);
  // we strip the resulting nulls before returning so Zod .optional() validates.
  const strictSchema = getAgentStrictJsonSchema(agent);
  // Run in a throwaway working dir with a WRITABLE sandbox: codex's harness is
  // agentic, so implementation agents (e.g. shaq) actually apply file patches. A
  // read-only sandbox makes them give up and report an empty implementation (→
  // judged fail). workspace-write + an isolated cwd lets them complete like the
  // claude path, without polluting the repo (the dir is removed afterward).
  // Interactive caller (hybrid /team) supplies a session-scoped workDir + keepWorkDir
  // so writes survive for review; eval caller gets the ephemeral default.
  const workDir = opts?.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "dt-codex-"));
  if (opts?.workDir) fs.mkdirSync(workDir, { recursive: true });
  const outFile = path.join(workDir, "out.txt");
  const schemaFile = path.join(workDir, "schema.json");
  // Codex has no system-prompt flag — prepend the agent body to the task. Feed via STDIN
  // with a "-" positional: the agent body starts with `---` frontmatter, and a positional
  // beginning with `-` would be mis-parsed as a flag (instant exit 2).
  const combined = `${agentSystemPrompt(agent)}\n\n---\n\n${prompt}`;
  // Sandbox mode: default workspace-write (eval + implement phase); read-only for the
  // hybrid /team plan phase (S7 — model physically cannot write → emits a plan).
  const sandbox = opts?.sandbox ?? "workspace-write";
  const args = ["exec", "-", "-m", modelId, "--output-last-message", outFile, "--sandbox", sandbox, "--skip-git-repo-check"];
  if (strictSchema) {
    fs.writeFileSync(schemaFile, JSON.stringify(strictSchema));
    args.push("--output-schema", schemaFile);
  }
  try {
    const proc = Bun.spawn(["codex", ...args], { cwd: workDir, stdin: new TextEncoder().encode(combined), stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    // Codex's stdout is its agentic transcript (reasoning + file actions) — keep it as the trace's reasoning.
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    let content = "";
    try { content = fs.readFileSync(outFile, "utf-8").trim(); } catch { /* no message */ }
    if (strictSchema && content) {
      content = extractJsonText(content);
      // Drop null-valued keys the strict schema forced in, so downstream Zod (.optional()) validates.
      try { content = JSON.stringify(stripNulls(JSON.parse(content))); } catch { /* leave as-is */ }
    }
    const err = code !== 0 ? `codex exit ${code}` : (content ? undefined : "codex: empty last message");
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, content, {
      durationMs, error: err,
      trace: buildTrace({ provider: "codex", model: modelId, userPrompt: prompt, responseText: content, inputTokens: 0, outputTokens: 0, durationMs, costUsd: 0, reasoning: stdout.trim(), error: err }),
    });
  } catch (e) {
    const error = `codex: ${e instanceof Error ? e.message : String(e)}`;
    const durationMs = Date.now() - start;
    return record(agent, scenarioId, "", { durationMs, error,
      trace: buildTrace({ provider: "codex", model: modelId, userPrompt: prompt, responseText: "", inputTokens: 0, outputTokens: 0, durationMs, error }) });
  } finally {
    // Interactive caller keeps the sandbox (keepWorkDir) for review; eval caller tears it down.
    if (!opts?.keepWorkDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
