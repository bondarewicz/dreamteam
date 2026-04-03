/**
 * agent-runner.ts — NDJSON stream parsing, individual + team scenario execution
 *
 * Impure: calls ClaudeAdapter, reads/writes files.
 */

import path from "path";
import fs from "fs";
import type { ClaudeAdapter, RawOutput, PhaseOutput } from "./types.ts";
import { extractGraders } from "./scenario-parser.ts";
import { runAllGraders } from "./graders.ts";
import { extractPrompt, parseTeamScenario } from "./scenario-parser.ts";

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
  timeoutMs: number
): Promise<Omit<RawOutput, "phases" | "pipeline_fields">> {
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
    const { stdout, exitCode } = await adapter.run(
      [
        "-p",
        "--agent",
        agent,
        "--output-format",
        "stream-json",
        "--verbose",
        "--append-system-prompt",
        EVAL_MODE_APPEND,
      ],
      prompt,
      timeoutMs
    );

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

  const record: Omit<RawOutput, "phases" | "pipeline_fields"> = {
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
  trials: number
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

  const record = await runSingleAgentCall(agent, scenarioId, prompt, adapter, timeoutMs);

  fs.writeFileSync(rawOutput, JSON.stringify(record, null, 2), "utf-8");
  console.log(`  Done: ${agent}/${scenarioId}${label} (${record.duration_ms}ms)`);
  return rawOutput;
}

/**
 * Run graders for a phase's output inline (used by team scenario runner).
 */
function runPhaseGraders(
  gradersRaw: string,
  agentOutput: string
): { graderResults: import("./types.ts").GraderResult[]; graderOverride: boolean } | null {
  if (!gradersRaw || gradersRaw === "[]") return null;

  // Parse graders from raw text block (wrap in a fake scenario for extractGraders)
  const fakeScenario = `graders:\n${gradersRaw}\n\nnext_field: done`;
  const graderDefs = extractGraders(fakeScenario);
  if (!graderDefs || graderDefs.length === 0) return null;

  return runAllGraders(graderDefs, agentOutput);
}

/**
 * Run a team scenario (sequential phases). Writes combined raw output to disk.
 * Returns the raw_output_file path.
 */
export async function runTeamScenario(
  scenarioFile: string,
  rawDir: string,
  scenarioId: string,
  trial: number,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  trials: number
): Promise<string> {
  const rawOutput =
    trial === 0
      ? path.join(rawDir, `team-${scenarioId}.json`)
      : path.join(rawDir, `team-${scenarioId}-t${trial}.json`);

  if (fs.existsSync(rawOutput)) {
    const label = trials > 1 ? ` [trial ${trial + 1}/${trials}]` : "";
    console.log(`  SKIP (raw output exists): team/${scenarioId}${label}`);
    return rawOutput;
  }

  const label = trials > 1 ? ` [trial ${trial + 1}/${trials}]` : "";
  console.log(`  Running team scenario: team/${scenarioId}${label}`);

  const content = fs.readFileSync(scenarioFile, { encoding: "utf-8" });
  const { phases, pipelineFields } = parseTeamScenario(content);

  const startMs = Date.now();
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const phaseOutputs: PhaseOutput[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const phase of phases) {
    const pn = phase.phaseNum;
    const phAgent = phase.agent;
    const phPrompt = phase.prompt;

    console.log(`    Phase ${pn} (${phAgent}): running...`);

    let phaseRecord: PhaseOutput;

    if (phAgent === "human") {
      const fixtureText = phase.humanDecision || phPrompt;
      phaseRecord = {
        phase_num: pn,
        agent: phAgent,
        agent_output: fixtureText,
        duration_ms: 0,
        tokens_used: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        is_fixture: true,
        trace: [],
      };
    } else {
      const record = await runSingleAgentCall(
        phAgent,
        `${scenarioId}/phase-${pn}`,
        phPrompt,
        adapter,
        timeoutMs
      );
      totalInputTokens += record.input_tokens;
      totalOutputTokens += record.output_tokens;
      totalCostUsd += record.cost_usd;
      phaseRecord = {
        phase_num: pn,
        agent: phAgent,
        agent_output: record.agent_output,
        duration_ms: record.duration_ms,
        tokens_used: record.tokens_used,
        input_tokens: record.input_tokens,
        output_tokens: record.output_tokens,
        cost_usd: record.cost_usd,
        is_fixture: false,
        trace: record.trace,
      };
      if (record.error) phaseRecord.error = record.error;
    }

    // Run per-phase graders if defined
    const gradersRaw = phase.gradersRaw.trim();
    if (gradersRaw && gradersRaw !== "[]") {
      const graderResult = runPhaseGraders(gradersRaw, phaseRecord.agent_output);
      if (graderResult) {
        phaseRecord.grader_results = graderResult.graderResults;
        phaseRecord.grader_override = graderResult.graderOverride;
      }
    }

    phaseOutputs.push(phaseRecord);
    console.log(`    Phase ${pn} (${phAgent}): done`);
  }

  const durationMs = Date.now() - startMs;

  const combined: RawOutput = {
    agent: "team",
    scenario_id: scenarioId,
    phases: phaseOutputs,
    agent_output: JSON.stringify(phaseOutputs),
    agent_output_excerpt: `[${phaseOutputs.length} phases]`,
    duration_ms: durationMs,
    tokens_used: totalInputTokens + totalOutputTokens,
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    cost_usd: totalCostUsd,
    timestamp,
    trace: [],
    pipeline_fields: {
      pipeline_expected_behavior: pipelineFields.pipelineExpectedBehavior,
      pipeline_failure_modes: pipelineFields.pipelineFailureModes,
      pipeline_scoring_rubric: pipelineFields.pipelineScoringRubric,
    },
  };

  fs.writeFileSync(rawOutput, JSON.stringify(combined, null, 2), "utf-8");
  console.log(`  Done team scenario: team/${scenarioId}${label} (${durationMs}ms)`);
  return rawOutput;
}
