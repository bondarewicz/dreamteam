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
import { getAgentJsonSchema } from "../../schemas/agent-schemas.ts";

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
function agentSystemPrompt(agent: string): string {
  return fs.readFileSync(path.join(AGENTS_DIR, `${agent}.md`), "utf-8");
}

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
  meta: { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs: number; error?: string },
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
    trace: [],
  };
  if (meta.error) rec.error = meta.error;
  return rec;
}

/** Dispatch to the right non-claude backend. (Claude is handled in agent-runner.ts.) */
export async function runProviderBackend(
  provider: Provider,
  agent: string,
  scenarioId: string,
  prompt: string,
  modelId: string,
  timeoutMs: number,
): Promise<RawOutput> {
  switch (provider) {
    case "ollama": return runOllama(agent, scenarioId, prompt, modelId, timeoutMs);
    case "gemini": return runGemini(agent, scenarioId, prompt, modelId, timeoutMs);
    case "codex": return runCodex(agent, scenarioId, prompt, modelId, timeoutMs);
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
      { role: "system", content: agentSystemPrompt(agent) },
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
    return record(agent, scenarioId, content, {
      inputTokens: json.prompt_eval_count ?? 0,
      outputTokens: json.eval_count ?? 0,
      durationMs: Date.now() - start,
      error: resp.ok ? (json.error ? `ollama: ${json.error}` : undefined) : `ollama HTTP ${resp.status}`,
    });
  } catch (e) {
    return record(agent, scenarioId, "", { durationMs: Date.now() - start, error: `ollama: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ── Gemini: CLI headless (soft schema → instruction; Zod re-validates downstream) ──
export async function runGemini(agent: string, scenarioId: string, prompt: string, modelId: string, timeoutMs: number): Promise<RawOutput> {
  const start = Date.now();
  const schema = jsonSchemaFor(agent);
  let system = agentSystemPrompt(agent);
  if (schema) system += `\n\nIMPORTANT: Do not narrate or summarize. Your FINAL message must be ONLY a single JSON object that conforms to this JSON Schema — no prose, no summary, no markdown fences, nothing before or after the JSON:\n${JSON.stringify(schema)}`;
  try {
    const proc = Bun.spawn(["gemini", "-p", prompt, "-m", modelId, "-o", "json", "--approval-mode", "plan"], {
      stdin: new TextEncoder().encode(system),
      stdout: "pipe",
      stderr: "pipe",
    });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    // Parse the ENVELOPE by first brace only — do NOT run fence stripping here: the
    // gemini envelope is clean JSON, but its `.response` value may itself contain a
    // ```json fence, which fence-aware extraction would wrongly grab instead.
    let env: Record<string, unknown> = {};
    const brace = out.search(/[{[]/);
    if (brace !== -1) { try { env = JSON.parse(out.slice(brace)); } catch { /* leave empty */ } }
    const resp = typeof env.response === "string" ? env.response : "";
    const content = schema ? extractJsonText(resp) : resp;
    const tokens = (env.stats as any)?.models?.[modelId]?.tokens?.total ?? 0;
    return record(agent, scenarioId, content, {
      outputTokens: typeof tokens === "number" ? tokens : 0,
      durationMs: Date.now() - start,
      error: code !== 0 ? `gemini exit ${code}` : (resp ? undefined : "gemini: empty response"),
    });
  } catch (e) {
    return record(agent, scenarioId, "", { durationMs: Date.now() - start, error: `gemini: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// ── Codex: codex exec with native --output-schema + --output-last-message ──────
export async function runCodex(agent: string, scenarioId: string, prompt: string, modelId: string, timeoutMs: number): Promise<RawOutput> {
  const start = Date.now();
  const schema = jsonSchemaFor(agent);
  const stem = path.join(os.tmpdir(), `dt-codex-${scenarioId.replace(/[^a-z0-9]/gi, "_")}-${start}`);
  const outFile = `${stem}.out`;
  // Codex has no system-prompt flag — prepend the agent body to the task. Feed via STDIN
  // with a "-" positional: the agent body starts with `---` frontmatter, and a positional
  // beginning with `-` would be mis-parsed as a flag (instant exit 2).
  //
  // NOTE: --output-schema is intentionally NOT used. It maps to OpenAI strict structured
  // output, which requires every property to be in `required` + additionalProperties:false;
  // our compact schemas have optional fields → 400 invalid_json_schema. Phase 3 adds a
  // strict-schema transform; for now we embed the schema in the prompt + Zod re-validate.
  let combined = `${agentSystemPrompt(agent)}\n\n---\n\n${prompt}`;
  if (schema) combined += `\n\nIMPORTANT: Your FINAL message must be ONLY a single JSON object conforming to this JSON Schema — no prose, no markdown fences, nothing before or after:\n${JSON.stringify(schema)}`;
  const args = ["exec", "-", "-m", modelId, "--output-last-message", outFile, "--sandbox", "read-only", "--skip-git-repo-check"];
  try {
    const proc = Bun.spawn(["codex", ...args], { stdin: new TextEncoder().encode(combined), stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    const [, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    let content = "";
    try { content = fs.readFileSync(outFile, "utf-8").trim(); } catch { /* no message */ }
    if (schema && content) content = extractJsonText(content);
    return record(agent, scenarioId, content, {
      durationMs: Date.now() - start,
      error: code !== 0 ? `codex exit ${code}` : (content ? undefined : "codex: empty last message"),
    });
  } catch (e) {
    return record(agent, scenarioId, "", { durationMs: Date.now() - start, error: `codex: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
  }
}
