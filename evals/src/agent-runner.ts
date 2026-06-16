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
import type { ClaudeAdapter, RawOutput } from "./types.ts";
import { extractPrompt } from "./scenario-parser.ts";
import { runAgentWithSchema } from "./schema-runner.ts";
import { parseProvider, runProviderBackend } from "./provider-backends.ts";

const EVAL_MODE_APPEND =
  "EVAL MODE: You are running in a headless evaluation. Do NOT enter plan mode. Do NOT call EnterPlanMode. Do NOT wait for approval. Execute the task directly and produce your complete final output immediately.";

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

    const { stdout, exitCode } = await adapter.run(args, prompt, timeoutMs);

    if (exitCode !== 0) {
      errorNote = `claude exited non-zero (exit ${exitCode})`;
    }

    const parsed = parseNdjson(stdout);
    agentOutput = parsed.agentOutput;
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
    const agentOutput = JSON.stringify(result.data);
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
  model?: string
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

  // Provider dispatch on the model id. Claude (bare id / "claude/…") keeps its
  // exact existing path; non-claude providers run directly via provider-backends.
  const { provider, modelId } = parseProvider(model);
  let record: RawOutput;
  if (provider === "claude") {
    // Per-agent dispatch: Bird uses the schema-enforced path; all others use --agent.
    if (agent === "bird") {
      record = await runBirdAgentCall(scenarioId, prompt, timeoutMs, model);
    } else {
      record = await runSingleAgentCall(agent, scenarioId, prompt, adapter, timeoutMs, model);
    }
  } else {
    record = await runProviderBackend(provider, agent, scenarioId, prompt, modelId, timeoutMs);
  }

  fs.writeFileSync(rawOutput, JSON.stringify(record, null, 2), "utf-8");
  console.log(`  Done: ${agent}/${scenarioId}${label} (${record.duration_ms}ms)`);
  return rawOutput;
}
