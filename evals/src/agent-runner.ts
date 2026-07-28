/**
 * agent-runner.ts — NDJSON stream parsing, individual scenario execution
 *
 * Impure: calls ClaudeAdapter, reads/writes files.
 *
 * Per-agent dispatch:
 *   - Bird: uses runAgentWithSchema (--system-prompt-file + --json-schema + --output-format json)
 *           Pulls structured_output (or result string) and validates with Zod.
 *           Feeds the JSON-stringified structured output into agent_output for graders.
 *   - All other agents: use the existing --agent path (unchanged).
 */

import path from "path";
import fs from "fs";
import os from "os";
import type { ClaudeAdapter, RawOutput } from "./types.ts";
import { extractPrompt } from "./scenario-parser.ts";
import { runAgentWithSchema } from "./schema-runner.ts";
import { parseProvider, runProviderBackend } from "./provider-backends.ts";
import { withTransientRetry, classifyError } from "./error-recovery.ts";
import { readModelSpec } from "../../scripts/frontmatter.ts";
import { resolveModel, PROVIDERS, type Provider } from "../../scripts/model-tiers.ts";

const AGENTS_DIR = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."), "agents");

/**
 * The model to actually run for an agent, in precedence order:
 *   1. explicit --model (exact id, e.g. "claude-opus-4-6" or "ollama/qwen3.6")
 *   2. --provider X  → resolve the agent's tier for provider X (prefixed for non-claude dispatch)
 *   3. neither       → resolve the agent's tier for claude (bare id)
 * Reads the REPO agent spec, so tier/pin changes take effect without reinstall.
 */
export function resolveEffectiveModel(agent: string, model?: string, provider?: string): string {
  if (model && model.trim()) return model.trim();
  let spec;
  try {
    spec = readModelSpec(fs.readFileSync(path.join(AGENTS_DIR, `${agent}.md`), "utf-8"));
  } catch {
    return ""; // no spec file → let the claude path fall back to the installed agent default
  }
  // Precedence: explicit --provider (CLI) → the agent's declared `model.provider`
  // (interactive default for hybrid /team) → claude.
  const prov: Provider = (PROVIDERS as readonly string[]).includes(provider ?? "")
    ? (provider as Provider)
    : (spec.provider ?? "claude");
  const resolved = resolveModel(spec, prov);
  return prov === "claude" ? resolved : `${prov}/${resolved}`;
}

const EVAL_MODE_APPEND =
  "EVAL MODE: You are running in a headless evaluation. Do NOT enter plan mode. Do NOT call EnterPlanMode. Do NOT wait for approval. Execute the task directly and produce your complete final output immediately.";

/**
 * Agents whose scenarios write scratch implementation files (per shaq.md, to `.tmp/`).
 * Each run for these gets an isolated, ephemeral cwd so the scenario's hardcoded
 * `.tmp/<topic>/…` paths resolve inside a throwaway dir — never the shared repo
 * `.tmp/`. Without this, leftover files from a prior run (or a sibling parallel
 * trial) get "found" and verified instead of implemented (the scenario-14 failure).
 * Analysis/review agents read the real repo, so they keep the inherited cwd.
 */
const SCRATCH_WRITING_AGENTS = new Set(["shaq", "developer"]);

/**
 * Parse NDJSON stream from claude --output-format stream-json.
 * Skips blank/non-JSON lines. Extracts agent_output from the LAST result event.
 */
export function parseNdjson(raw: string): {
  agentOutput: string;
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
  costUsd: number;
  trace: unknown[];
} {
  const trace: unknown[] = [];
  let resultEvent: Record<string, unknown> | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // skip non-JSON lines
    }
    trace.push(event);
    if (event.type === "result") {
      resultEvent = event; // keep LAST result event
    }
  }

  if (resultEvent !== null) {
    const rawResult = resultEvent.result;
    const agentOutput =
      typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    const usage = (resultEvent.usage ?? {}) as Record<string, number>;
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const costUsd = Number(resultEvent.total_cost_usd ?? 0);
    return {
      agentOutput,
      inputTokens,
      outputTokens,
      tokensUsed: inputTokens + outputTokens,
      costUsd,
      trace,
    };
  }

  // No result event found — return raw stdout as fallback
  return {
    agentOutput: raw,
    inputTokens: 0,
    outputTokens: 0,
    tokensUsed: 0,
    costUsd: 0,
    trace,
  };
}

/**
 * Execute one agent call via ClaudeAdapter.
 * Returns a raw output record (does not write to disk).
 */
export async function runSingleAgentCall(
  agent: string,
  scenarioId: string,
  prompt: string,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  model?: string
): Promise<RawOutput> {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const startMs = Date.now();

  let agentOutput = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensUsed = 0;
  let costUsd = 0;
  let trace: unknown[] = [];
  let errorNote = "";

  // Scratch-writing agents get a fresh, isolated cwd per run (removed in finally),
  // so their `.tmp/…` writes can never collide across runs or parallel trials.
  let scratchCwd: string | undefined;
  if (SCRATCH_WRITING_AGENTS.has(agent)) {
    const safeId = scenarioId.replace(/[^a-z0-9]/gi, "_");
    scratchCwd = fs.mkdtempSync(path.join(os.tmpdir(), `dt-eval-${agent}-${safeId}-`));
  }

  try {
    const args = [
      "-p",
      "--agent",
      agent,
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      EVAL_MODE_APPEND,
    ];
    if (model) {
      args.push("--model", model);
    }

    const { stdout, exitCode } = await adapter.run(args, prompt, timeoutMs, scratchCwd);

    if (exitCode !== 0) {
      errorNote = `claude exited non-zero (exit ${exitCode})`;
    }

    const parsed = parseNdjson(stdout);
    // parseNdjson can yield undefined when the stream carries no assistant text
    // (e.g. the turn was killed mid tool_use). Coerce here — a downstream
    // `agentOutput.slice()` would throw and lose the whole run's raw output.
    agentOutput = parsed.agentOutput ?? "";
    inputTokens = parsed.inputTokens;
    outputTokens = parsed.outputTokens;
    tokensUsed = parsed.tokensUsed;
    costUsd = parsed.costUsd;
    trace = parsed.trace;

    if (agentOutput === stdout && trace.every((e: unknown) => {
      const ev = e as Record<string, unknown>;
      return ev.type !== "result";
    })) {
      errorNote = (errorNote ? errorNote + " | " : "") + "no result event in stream-json output";
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errorNote = `claude invocation error: ${msg}`;
    agentOutput = "";
  } finally {
    if (scratchCwd) {
      try {
        fs.rmSync(scratchCwd, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — an orphaned tmp dir is harmless
      }
    }
  }

  const durationMs = Date.now() - startMs;

  const record: RawOutput = {
    agent,
    scenario_id: scenarioId,
    agent_output: agentOutput,
    agent_output_excerpt: agentOutput.slice(0, 500),
    duration_ms: durationMs,
    tokens_used: tokensUsed,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    timestamp,
    trace,
  };

  if (errorNote) record.error = errorNote;
  return record;
}

/**
 * Run a single Bird agent call via the schema-enforced path.
 *
 * Uses --system-prompt-file + --json-schema + --output-format json (per architecture.md).
 * Extracts structured_output (or result string) and JSON-stringifies it so the
 * existing graders can parse it as agent_output.
 *
 * Returns a raw output record (does not write to disk).
 */
async function runBirdAgentCall(
  scenarioId: string,
  prompt: string,
  timeoutMs: number,
  model?: string
): Promise<RawOutput> {
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const startMs = Date.now();

  const result = await runAgentWithSchema("bird", prompt, {
    timeoutMs,
    model,
  });

  const durationMs = Date.now() - startMs;

  if (result.ok) {
    // Serialize the structured output as JSON string — this is what graders parse
    const agentOutput = JSON.stringify(result.data ?? null) ?? "";
    return {
      agent: "bird",
      scenario_id: scenarioId,
      agent_output: agentOutput,
      agent_output_excerpt: agentOutput.slice(0, 500),
      duration_ms: durationMs,
      tokens_used: result.inputTokens + result.outputTokens,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: result.costUsd,
      timestamp,
      trace: result.trace ?? [],
    };
  } else {
    // Schema run failed — record the error, return empty agent_output
    return {
      agent: "bird",
      scenario_id: scenarioId,
      agent_output: "",
      agent_output_excerpt: "",
      duration_ms: durationMs,
      tokens_used: result.inputTokens + result.outputTokens,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: result.costUsd,
      timestamp,
      trace: result.trace ?? [],
      error: `schema-runner failed (${result.reason}): ${result.detail}`,
    };
  }
}

/**
 * Run a single agent scenario (one trial). Writes raw output to disk.
 * Returns the raw_output_file path.
 */
export async function runAgentScenario(
  scenarioFile: string,
  rawDir: string,
  agent: string,
  scenarioId: string,
  trial: number,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  trials: number,
  model?: string,
  provider?: string
): Promise<string> {
  const rawOutput =
    trial === 0
      ? path.join(rawDir, `${agent}-${scenarioId}.json`)
      : path.join(rawDir, `${agent}-${scenarioId}-t${trial}.json`);

  if (fs.existsSync(rawOutput)) {
    const label = trials > 1 ? ` [trial ${trial + 1}/${trials}]` : "";
    console.log(`  SKIP (raw output exists): ${agent}/${scenarioId}${label}`);
    return rawOutput;
  }

  const label = trials > 1 ? ` [trial ${trial + 1}/${trials}]` : "";
  console.log(`  Running agent: ${agent}/${scenarioId}${label}`);

  const content = fs.readFileSync(scenarioFile, { encoding: "utf-8" });
  const prompt = extractPrompt(content);
  if (!prompt) {
    console.error(`  WARN: empty prompt extracted for ${agent}/${scenarioId}`);
  }

  // Resolve the effective model from the agent's repo spec (tier/pins), unless an
  // exact --model was given. Then dispatch on the provider prefix: claude (bare id)
  // keeps the existing claude -p path; others run via provider-backends.
  const effectiveModel = resolveEffectiveModel(agent, model, provider);
  const { provider: prov, modelId } = parseProvider(effectiveModel);

  // s20 error recovery: retry ONLY on classified-transient failures (rate limits,
  // 5xx, timeouts, model-loading blips) with exponential backoff. permanent errors
  // (a wrong/unparseable answer — the thing evals measure) and user_actionable ones
  // (auth/quota) are returned on the first attempt, never masked. No cross-provider
  // fallback here: it would corrupt the per-provider comparison (see error-recovery.ts).
  const dispatch = (): Promise<RawOutput> => {
    if (prov === "claude") {
      // Per-agent dispatch: Bird uses the schema-enforced path; all others use --agent.
      // effectiveModel is now always an explicit claude id (repo-sourced), so the
      // --agent path passes --model rather than relying on the installed file.
      return agent === "bird"
        ? runBirdAgentCall(scenarioId, prompt, timeoutMs, effectiveModel || undefined)
        : runSingleAgentCall(agent, scenarioId, prompt, adapter, timeoutMs, effectiveModel || undefined);
    }
    return runProviderBackend(prov, agent, scenarioId, prompt, modelId, timeoutMs);
  };

  const record = await withTransientRetry(dispatch, {
    errorOf: (r) => (r as RawOutput).error,
    onRetry: ({ attempt, delayMs, error }) =>
      console.log(`  RETRY ${agent}/${scenarioId} [transient, attempt ${attempt}] in ${delayMs}ms: ${error}`),
  });
  // Tag any surviving error with its class so the report distinguishes an infra
  // blip from a real capability miss without changing the record shape.
  if (record.error) record.error = `[${classifyError(record.error)}] ${record.error}`;

  fs.writeFileSync(rawOutput, JSON.stringify(record, null, 2), "utf-8");
  console.log(`  Done: ${agent}/${scenarioId}${label} (${record.duration_ms}ms)`);
  return rawOutput;
}
