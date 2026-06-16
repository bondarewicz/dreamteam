/**
 * scorer.ts — Scoring prompt construction, claude invocation with retry, grader hard gate
 *
 * Impure: calls ClaudeAdapter.
 */

import path from "path";
import fs from "fs";
import type { ClaudeAdapter, GraderResult, Score, ScoredResult, TrialResult, RawOutput } from "./types.ts";
import { extractJson } from "./json-extract.ts";
import { extractField, parseScenarioMeta, extractGraders } from "./scenario-parser.ts";
import { runAllGraders } from "./graders.ts";

const VALID_SCORES: Set<string> = new Set(["pass", "partial", "fail"]);

interface ScoreFields {
  expectedBehavior: string;
  failureModes: string;
  scoringRubric: string;
  scenarioName: string;
  scenarioType: string;
  category: string;
}

/**
 * Parse a score JSON response from the LLM.
 * Returns null if the JSON is invalid or score is not a closed enum value.
 */
export function parseScoreJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to extraction
  }

  const extracted = extractJson(raw);
  if (
    extracted !== null &&
    typeof extracted === "object" &&
    !Array.isArray(extracted)
  ) {
    return extracted as Record<string, unknown>;
  }
  return null;
}

/**
 * Build a scoring prompt for a single-agent scenario.
 */
function buildScoringPrompt(
  scenarioId: string,
  agent: string,
  agentOutput: string,
  fields: ScoreFields
): string {
  return (
    `You are Coach K scoring an agent's output against a rubric. Return ONLY valid JSON.\n\n` +
    `SCENARIO: ${scenarioId}\n` +
    `AGENT: ${agent}\n\n` +
    `EXPECTED BEHAVIOR:\n${fields.expectedBehavior}\n\n` +
    `FAILURE MODES:\n${fields.failureModes}\n\n` +
    `SCORING RUBRIC:\n${fields.scoringRubric}\n\n` +
    `AGENT OUTPUT:\n${agentOutput}\n\n` +
    `Score this output. Return JSON:\n` +
    `{\n` +
    `  "score": "pass|partial|fail",\n` +
    `  "confidence_stated": <0-100>,\n` +
    `  "justification": "<which rubric criteria were met/missed>",\n` +
    `  "observations": [{"type": "positive|negative", "text": "..."}]\n` +
    `}`
  );
}

/**
 * Invoke claude for scoring with one retry on parse failure.
 * Returns the parsed score JSON, or null on total failure.
 */
async function invokeScoringClaude(
  prompt: string,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  label: string
): Promise<{ parsed: Record<string, unknown> | null; error: string }> {
  let scoreError = "";
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let stdout = "";
    try {
      const result = await adapter.run(["-p"], prompt, timeoutMs);
      stdout = result.stdout;
      if (result.exitCode !== 0) {
        // Log warning but do not treat as scoring failure — claude can exit non-zero
        // while still producing valid JSON output (transient reasons, warnings, etc.)
        console.warn(`  WARN scoring ${label}: claude exited non-zero (exit ${result.exitCode})`);
      }
    } catch (e: unknown) {
      scoreError = `claude invocation error: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`  ERROR: ${scoreError}`);
    }

    const parsed = parseScoreJson(stdout);
    if (parsed !== null) {
      return { parsed, error: scoreError };
    }

    // Backoff before retrying — most non-zero exits with no output are transient
    // rate/usage throttling on the judge call; a short, growing pause lets them clear.
    if (attempt < MAX_ATTEMPTS - 1) {
      console.log(`  RETRY scoring parse for ${label} (attempt ${attempt + 2}/${MAX_ATTEMPTS})`);
      // Backoff base is overridable (set to 0 in unit tests to avoid real sleeps).
      const backoffBaseMs = Number(process.env.EVAL_SCORING_BACKOFF_MS ?? 2000);
      await new Promise((r) => setTimeout(r, backoffBaseMs * (attempt + 1)));
    }
  }

  // Caller maps a null parse to score 'error' (judge failure), not 'fail' (model failure).
  return { parsed: null, error: scoreError || `scoring parse failed after ${MAX_ATTEMPTS} attempts` };
}

/**
 * Score a single trial of a scenario.
 * Returns a TrialResult or null if no raw output exists.
 */
export async function scoreSingleTrial(
  agent: string,
  scenarioId: string,
  rawOutputPath: string,
  fields: ScoreFields,
  graderResults: GraderResult[],
  graderOverride: boolean,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  trialIndex: number,
  trials: number
): Promise<TrialResult | null> {
  if (!fs.existsSync(rawOutputPath)) {
    const label = trials > 1 ? ` [trial ${trialIndex + 1}]` : "";
    console.log(`  SKIP (no raw output for scoring): ${agent}/${scenarioId}${label}`);
    return null;
  }

  const trialLabel = trials > 1 ? ` [trial ${trialIndex + 1}/${trials}]` : "";
  console.log(`  Scoring: ${agent}/${scenarioId}${trialLabel}`);

  const rawData: RawOutput = JSON.parse(fs.readFileSync(rawOutputPath, "utf-8"));
  const agentOutput = rawData.agent_output ?? "";

  const prompt = buildScoringPrompt(scenarioId, agent, agentOutput, fields);
  const { parsed, error: scoreError } = await invokeScoringClaude(
    prompt,
    adapter,
    timeoutMs,
    `${agent}/${scenarioId}${trialLabel}`
  );

  const rawScore = (parsed?.score as string) ?? "";
  const isValidScore = VALID_SCORES.has(rawScore);

  // Grader hard gate vs judge failure are different things:
  //  - graderOverride: a deterministic (non-advisory) grader failed → real 'fail'.
  //  - !parsed: the judge call itself failed (throttle / non-zero exit / unparseable) →
  //    'error', NOT 'fail'. A throttled judge must never masquerade as a model failure.
  let finalScore: Score;
  if (graderOverride) {
    finalScore = "fail";
  } else if (!parsed) {
    finalScore = "error";
  } else if (isValidScore) {
    finalScore = rawScore as Score;
  } else {
    finalScore = "error"; // judge returned an unrecognised verdict
  }

  const effectiveParsed = parsed ?? {
    justification: `scoring parse error: ${scoreError || "no output"}`,
    observations: [{ type: "negative", text: "scoring failed" }],
    confidence_stated: 0,
  };
  if (!parsed) {
    if (!effectiveParsed.justification) {
      effectiveParsed.justification = `scoring parse error: ${scoreError || "no output"}`;
    }
    if (!effectiveParsed.observations) {
      effectiveParsed.observations = [{ type: "negative", text: "scoring failed" }];
    }
    if (effectiveParsed.confidence_stated === undefined) {
      effectiveParsed.confidence_stated = 0;
    }
  }

  const result: TrialResult = {
    score: finalScore,
    confidence_stated: Number(effectiveParsed.confidence_stated ?? 0),
    justification: String(effectiveParsed.justification ?? ""),
    observations: (effectiveParsed.observations as Array<{ type: string; text: string }>) ?? [],
    agent_output_excerpt: rawData.agent_output_excerpt ?? agentOutput.slice(0, 500),
    duration_ms: rawData.duration_ms ?? 0,
    tokens_used: rawData.tokens_used ?? 0,
    input_tokens: rawData.input_tokens ?? 0,
    output_tokens: rawData.output_tokens ?? 0,
    cost_usd: rawData.cost_usd ?? 0,
    timestamp: rawData.timestamp ?? "",
  };

  if (graderResults.length > 0) result.grader_results = graderResults;
  if (graderOverride) result.grader_override = true;

  console.log(`  Scored: ${agent}/${scenarioId}${trialLabel} -> ${finalScore}`);
  return result;
}

/**
 * Score all trials for a single agent scenario. Writes scored file to disk.
 * Returns the scored_file path or null if nothing was scored.
 */
export async function scoreScenarioAllTrials(
  scenarioFile: string,
  rawDir: string,
  scoredDir: string,
  agent: string,
  scenarioId: string,
  graderResultsMap: Map<string, GraderResult[]>,
  graderOverrideMap: Map<string, boolean>,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  trials: number
): Promise<string | null> {
  const scoredFile = path.join(scoredDir, `${agent}-${scenarioId}.json`);
  const content = fs.readFileSync(scenarioFile, { encoding: "utf-8" });
  const { scenarioName, scenarioType, category } = parseScenarioMeta(content);

  const fields: ScoreFields = {
    expectedBehavior: extractField("expected_behavior", content),
    failureModes: extractField("failure_modes", content),
    scoringRubric: extractField("scoring_rubric", content),
    scenarioName,
    scenarioType,
    category,
  };

  const trialResults: TrialResult[] = [];

  for (let t = 0; t < trials; t++) {
    const rawOutputPath =
      t === 0
        ? path.join(rawDir, `${agent}-${scenarioId}.json`)
        : path.join(rawDir, `${agent}-${scenarioId}-t${t}.json`);

    const key = t === 0 ? `${agent}-${scenarioId}` : `${agent}-${scenarioId}-t${t}`;

    // Get grader results — from map or recompute inline
    let graderResults = graderResultsMap.get(key) ?? [];
    let graderOverride = graderOverrideMap.get(key) ?? false;

    if (!graderResultsMap.has(key) && fs.existsSync(rawOutputPath)) {
      // Recompute graders if not pre-computed (e.g. score-only phase)
      const rawData: RawOutput = JSON.parse(fs.readFileSync(rawOutputPath, "utf-8"));
      const graderDefs = extractGraders(content);
      if (graderDefs && graderDefs.length > 0) {
        const { results, graderOverride: go } = runAllGraders(graderDefs, rawData.agent_output ?? "");
        graderResults = results;
        graderOverride = go;
      }
    }

    const result = await scoreSingleTrial(
      agent,
      scenarioId,
      rawOutputPath,
      fields,
      graderResults,
      graderOverride,
      adapter,
      timeoutMs,
      t,
      trials
    );
    if (result) trialResults.push(result);
  }

  if (trialResults.length === 0) return null;

  // Representative trial = first that the judge actually scored; only falls back to an
  // 'error' trial when every trial failed to score (→ scenario score 'error', not 'fail').
  const primary = trialResults.find((t) => t.score !== "error") ?? trialResults[0];
  const scoredResult: ScoredResult = {
    agent,
    scenario_id: scenarioId,
    scenario_type: fields.scenarioType || "happy-path",
    scenario_name: fields.scenarioName || scenarioId,
    score: primary.score,
    confidence_stated: primary.confidence_stated,
    justification: primary.justification,
    observations: primary.observations,
    agent_output_excerpt: primary.agent_output_excerpt,
    duration_ms: primary.duration_ms,
    tokens_used: primary.tokens_used,
    input_tokens: primary.input_tokens ?? 0,
    output_tokens: primary.output_tokens ?? 0,
    cost_usd: primary.cost_usd ?? 0,
    timestamp: primary.timestamp,
  };

  if (primary.grader_results) scoredResult.grader_results = primary.grader_results;
  if (primary.grader_override) scoredResult.grader_override = true;
  if (category) scoredResult.category = category;

  if (trials > 1) {
    scoredResult.trials = trialResults;
    // Flakiness is real-verdict variance — an unscored ('error') trial isn't a verdict.
    const scoresSet = new Set(trialResults.filter((t) => t.score !== "error").map((t) => t.score));
    scoredResult.flaky = scoresSet.size > 1;
    scoredResult.pass_hat_k = trialResults.some((t) => t.score === "pass");
  }

  fs.writeFileSync(scoredFile, JSON.stringify(scoredResult, null, 2), "utf-8");
  return scoredFile;
}
