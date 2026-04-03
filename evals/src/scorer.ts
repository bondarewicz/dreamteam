/**
 * scorer.ts — Scoring prompt construction, claude invocation with retry, grader hard gate
 *
 * Impure: calls ClaudeAdapter.
 */

import path from "path";
import fs from "fs";
import type { ClaudeAdapter, GraderResult, Score, ScoredResult, TrialResult, RawOutput } from "./types.ts";
import { extractJson } from "./json-extract.ts";
import { extractField, parseScenarioMeta, extractGraders, parseTeamScenario } from "./scenario-parser.ts";
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
 * Build a scoring prompt for a team scenario pipeline.
 */
function buildTeamScoringPrompt(
  scenarioId: string,
  pipelineFields: Record<string, string>,
  phaseOutputs: Array<{ phase_num: number; agent: string; agent_output: string; is_fixture?: boolean }>
): string {
  const phaseSummaries = phaseOutputs.map((p) => {
    const fixtureLabel = p.is_fixture ? " FIXTURE" : "";
    return `Phase ${p.phase_num} (${p.agent})${fixtureLabel}:\n${p.agent_output.slice(0, 1000)}`;
  });
  const allPhasesText = phaseSummaries.join("\n\n---\n\n");

  return (
    `You are Coach K scoring a Dream Team pipeline run against a rubric. Return ONLY valid JSON.\n\n` +
    `SCENARIO: ${scenarioId}\n\n` +
    `PIPELINE EXPECTED BEHAVIOR:\n${pipelineFields.pipeline_expected_behavior ?? ""}\n\n` +
    `PIPELINE FAILURE MODES:\n${pipelineFields.pipeline_failure_modes ?? ""}\n\n` +
    `PIPELINE SCORING RUBRIC:\n${pipelineFields.pipeline_scoring_rubric ?? ""}\n\n` +
    `PHASE OUTPUTS:\n${allPhasesText}\n\n` +
    `Score the full pipeline. Return JSON:\n` +
    `{\n` +
    `  "score": "pass|partial|fail",\n` +
    `  "confidence_stated": <0-100>,\n` +
    `  "justification": "<which rubric criteria were met/missed across the full pipeline>",\n` +
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

  for (let attempt = 0; attempt < 2; attempt++) {
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

    if (attempt === 0) {
      console.log(`  RETRY scoring parse for ${label}`);
    }
  }

  return { parsed: null, error: scoreError || "scoring parse failed after 2 attempts" };
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

  // Grader hard gate: any grader fail OR no parsed score → 'fail'
  // Non-zero exit code alone does NOT force fail — claude can exit non-zero with valid output
  let finalScore: Score = isValidScore ? (rawScore as Score) : "fail";
  if (graderOverride || !parsed) {
    finalScore = "fail";
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

  const primary = trialResults[0];
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
    const scoresSet = new Set(trialResults.map((t) => t.score));
    scoredResult.flaky = scoresSet.size > 1;
    scoredResult.pass_hat_k = trialResults.some((t) => t.score === "pass");
  }

  fs.writeFileSync(scoredFile, JSON.stringify(scoredResult, null, 2), "utf-8");
  return scoredFile;
}

/**
 * Score all trials for a team scenario. Writes scored file to disk.
 */
export async function scoreTeamScenarioAllTrials(
  scenarioFile: string,
  rawDir: string,
  scoredDir: string,
  scenarioId: string,
  adapter: ClaudeAdapter,
  timeoutMs: number,
  trials: number
): Promise<string | null> {
  const scoredFile = path.join(scoredDir, `team-${scenarioId}.json`);

  // Read scenario metadata — with fallback to raw output if file is gone
  let pipelineFieldsRaw: Record<string, string> = {};
  let scenarioName = "";
  let scenarioType = "happy-path";
  let category = "";

  if (fs.existsSync(scenarioFile)) {
    const content = fs.readFileSync(scenarioFile, { encoding: "utf-8" });
    const { pipelineFields } = parseTeamScenario(content);
    const meta = parseScenarioMeta(content);
    scenarioName = meta.scenarioName;
    scenarioType = meta.scenarioType;
    category = meta.category;
    pipelineFieldsRaw = {
      pipeline_expected_behavior: pipelineFields.pipelineExpectedBehavior,
      pipeline_failure_modes: pipelineFields.pipelineFailureModes,
      pipeline_scoring_rubric: pipelineFields.pipelineScoringRubric,
    };
  } else {
    // Fallback: read pipeline_fields from trial-0 raw output
    const rawT0 = path.join(rawDir, `team-${scenarioId}.json`);
    if (fs.existsSync(rawT0)) {
      try {
        const rawData: RawOutput = JSON.parse(fs.readFileSync(rawT0, "utf-8"));
        pipelineFieldsRaw = (rawData.pipeline_fields as Record<string, string>) ?? {};
        console.warn(
          `  WARN: scenario file missing (${scenarioFile}); recovered pipeline_fields from raw output`
        );
      } catch (e) {
        console.error(`  ERROR: could not read raw output for team/${scenarioId}: ${e}`);
        return null;
      }
    } else {
      console.error(`  ERROR: scenario file missing and no raw output for team/${scenarioId}`);
      return null;
    }
  }

  const trialResults: TrialResult[] = [];

  for (let t = 0; t < trials; t++) {
    const rawOutputPath =
      t === 0
        ? path.join(rawDir, `team-${scenarioId}.json`)
        : path.join(rawDir, `team-${scenarioId}-t${t}.json`);

    if (!fs.existsSync(rawOutputPath)) {
      const label = trials > 1 ? ` [trial ${t + 1}]` : "";
      console.log(`  SKIP (no raw output for scoring): team/${scenarioId}${label}`);
      continue;
    }

    const trialLabel = trials > 1 ? ` [trial ${t + 1}/${trials}]` : "";
    console.log(`  Scoring team: team/${scenarioId}${trialLabel}`);

    const rawData: RawOutput = JSON.parse(fs.readFileSync(rawOutputPath, "utf-8"));
    const phaseOutputs = rawData.phases ?? [];

    // Check grader hard gate: any phase with grader_override → fail
    const anyGraderFail = phaseOutputs.some((p) => p.grader_override === true);

    const prompt = buildTeamScoringPrompt(scenarioId, pipelineFieldsRaw, phaseOutputs);
    const { parsed, error: scoreError } = await invokeScoringClaude(
      prompt,
      adapter,
      timeoutMs,
      `team/${scenarioId}${trialLabel}`
    );

    const rawScore = (parsed?.score as string) ?? "";
    const isValidScore = VALID_SCORES.has(rawScore);
    let finalScore: Score = isValidScore ? (rawScore as Score) : "fail";
    if (anyGraderFail || !parsed) finalScore = "fail";

    const effectiveParsed = parsed ?? {
      justification: `scoring parse error: ${scoreError || "no output"}`,
      observations: [{ type: "negative", text: "scoring failed" }],
      confidence_stated: 0,
    };

    const result: TrialResult = {
      score: finalScore,
      confidence_stated: Number(effectiveParsed.confidence_stated ?? 0),
      justification: String(effectiveParsed.justification ?? ""),
      observations: (effectiveParsed.observations as Array<{ type: string; text: string }>) ?? [],
      agent_output_excerpt: rawData.agent_output_excerpt ?? "[team]",
      duration_ms: rawData.duration_ms ?? 0,
      tokens_used: rawData.tokens_used ?? 0,
      input_tokens: rawData.input_tokens ?? 0,
      output_tokens: rawData.output_tokens ?? 0,
      cost_usd: rawData.cost_usd ?? 0,
      timestamp: rawData.timestamp ?? "",
      phases: phaseOutputs,
    };

    if (anyGraderFail) result.grader_override = true;

    console.log(`  Scored team: team/${scenarioId}${trialLabel} -> ${finalScore}`);
    trialResults.push(result);
  }

  if (trialResults.length === 0) return null;

  const primary = trialResults[0];
  const scoredResult: ScoredResult = {
    agent: "team",
    scenario_id: scenarioId,
    scenario_type: scenarioType || "happy-path",
    scenario_name: scenarioName || scenarioId,
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
    phases: primary.phases,
  };

  if (primary.grader_override) scoredResult.grader_override = true;
  if (category) scoredResult.category = category;

  if (trials > 1) {
    scoredResult.trials = trialResults;
    const scoresSet = new Set(trialResults.map((t) => t.score));
    scoredResult.flaky = scoresSet.size > 1;
    scoredResult.pass_hat_k = trialResults.some((t) => t.score === "pass");
  }

  fs.writeFileSync(scoredFile, JSON.stringify(scoredResult, null, 2), "utf-8");
  return scoredFile;
}

