/**
 * pipeline.ts — 4-phase orchestration, resume, dry-run
 *
 * Impure: orchestrates all phases, manages filesystem, uses ClaudeAdapter.
 */

import path from "path";
import fs from "fs";
import type { ClaudeAdapter, GraderResult, DiscoveredScenario, PipelineOptions } from "./types.ts";
import { discoverScenarios } from "./discovery.ts";
import { runConcurrent } from "./concurrency.ts";
import { runAgentScenario, runTeamScenario } from "./agent-runner.ts";
import { triggerMigration } from "./report.ts";
import {
  scoreScenarioAllTrials,
  scoreTeamScenarioAllTrials,
} from "./scorer.ts";
import { assembleFinalResult } from "./assembler.ts";
import { extractGraders } from "./scenario-parser.ts";
import { runAllGraders } from "./graders.ts";
import type { RawOutput } from "./types.ts";

export interface PipelineResult {
  finalOutputPath: string;
  scenariosRun: number;
  scenariosTotal: number;
  allScenariosTotal: number;
  runDatetime: string;
}

/**
 * Phase 1: Run all agent scenarios in parallel.
 */
async function phaseAgents(
  scenarios: DiscoveredScenario[],
  rawDir: string,
  adapter: ClaudeAdapter,
  options: PipelineOptions
): Promise<void> {
  console.log();
  const trialsLabel = options.trials > 1 ? `, trials=${options.trials}` : "";
  console.log(`=== Phase 1: Agent Runs (parallel=${options.parallel}${trialsLabel}) ===`);
  fs.mkdirSync(rawDir, { recursive: true });

  const timeoutMs =
    options.timeoutPerPhase > 0 ? options.timeoutPerPhase * 1000 : 300 * 1000;
  const teamTimeoutMs =
    options.timeoutPerPhase > 0 ? options.timeoutPerPhase * 1000 : 600 * 1000;

  // Build work items: (scenario, trial)
  const workItems: Array<{ scenario: DiscoveredScenario; trial: number }> = [];
  for (const scenario of scenarios) {
    for (let t = 0; t < options.trials; t++) {
      workItems.push({ scenario, trial: t });
    }
  }

  const tasks = workItems.map(({ scenario, trial }) => async () => {
    const { scenarioFile, agent, scenarioId } = scenario;
    if (agent === "team") {
      await runTeamScenario(
        scenarioFile,
        rawDir,
        scenarioId,
        trial,
        adapter,
        teamTimeoutMs,
        options.trials
      );
    } else {
      await runAgentScenario(
        scenarioFile,
        rawDir,
        agent,
        scenarioId,
        trial,
        adapter,
        timeoutMs,
        options.trials
      );
    }
  });

  const results = await runConcurrent(tasks, options.parallel);
  for (const r of results) {
    if (r.error) {
      console.error(`  ERROR in agent run: ${r.error}`);
    }
  }

  console.log();
  console.log(`Phase 1 complete. Raw outputs in: ${rawDir}`);
}

/**
 * Phase 2: Run deterministic graders on all raw outputs.
 * Returns maps of grader results and override flags.
 */
function phaseGraders(
  scenarios: DiscoveredScenario[],
  rawDir: string,
  trials: number
): { graderResultsMap: Map<string, GraderResult[]>; graderOverrideMap: Map<string, boolean> } {
  console.log();
  console.log("=== Phase 2: Grader Runs (zero LLM calls) ===");

  const graderResultsMap = new Map<string, GraderResult[]>();
  const graderOverrideMap = new Map<string, boolean>();

  for (const { scenarioFile, agent, scenarioId } of scenarios) {
    // Team scenarios run graders inline during phase 1
    if (agent === "team") {
      console.log(`  SKIP (team, graders run inline): ${agent}/${scenarioId}`);
      continue;
    }

    const content = fs.readFileSync(scenarioFile, { encoding: "utf-8" });
    const graderDefs = extractGraders(content);

    for (let t = 0; t < trials; t++) {
      const rawOutputPath =
        t === 0
          ? path.join(rawDir, `${agent}-${scenarioId}.json`)
          : path.join(rawDir, `${agent}-${scenarioId}-t${t}.json`);
      const key = t === 0 ? `${agent}-${scenarioId}` : `${agent}-${scenarioId}-t${t}`;

      if (!fs.existsSync(rawOutputPath)) {
        const label = trials > 1 ? ` [trial ${t + 1}]` : "";
        console.log(`  SKIP (no raw output): ${agent}/${scenarioId}${label}`);
        graderResultsMap.set(key, []);
        graderOverrideMap.set(key, false);
        continue;
      }

      if (!graderDefs || graderDefs.length === 0) {
        graderResultsMap.set(key, []);
        graderOverrideMap.set(key, false);
        continue;
      }

      const rawData: RawOutput = JSON.parse(fs.readFileSync(rawOutputPath, "utf-8"));
      const { results, graderOverride } = runAllGraders(graderDefs, rawData.agent_output ?? "");

      graderResultsMap.set(key, results);
      graderOverrideMap.set(key, graderOverride);

      const label = trials > 1 ? ` [trial ${t + 1}]` : "";
      const status = graderOverride ? "FAIL" : "PASS";
      console.log(`  ${status} (grader): ${agent}/${scenarioId}${label}`);
    }
  }

  console.log();
  console.log("Phase 2 complete.");
  return { graderResultsMap, graderOverrideMap };
}

/**
 * Phase 3: Score all scenarios via LLM rubric.
 */
async function phaseScore(
  scenarios: DiscoveredScenario[],
  rawDir: string,
  scoredDir: string,
  graderResultsMap: Map<string, GraderResult[]>,
  graderOverrideMap: Map<string, boolean>,
  adapter: ClaudeAdapter,
  options: PipelineOptions
): Promise<void> {
  console.log();
  const trialsLabel = options.trials > 1 ? `, trials=${options.trials}` : "";
  console.log(`=== Phase 3: Rubric Scoring (parallel=${options.parallel}${trialsLabel}) ===`);
  fs.mkdirSync(scoredDir, { recursive: true });

  const timeoutMs =
    options.timeoutPerPhase > 0 ? options.timeoutPerPhase * 1000 : 300 * 1000;
  const teamTimeoutMs =
    options.timeoutPerPhase > 0 ? options.timeoutPerPhase * 1000 : 600 * 1000;

  const tasks = scenarios.map(({ scenarioFile, agent, scenarioId }) => async () => {
    if (agent === "team") {
      await scoreTeamScenarioAllTrials(
        scenarioFile,
        rawDir,
        scoredDir,
        scenarioId,
        adapter,
        teamTimeoutMs,
        options.trials
      );
    } else {
      await scoreScenarioAllTrials(
        scenarioFile,
        rawDir,
        scoredDir,
        agent,
        scenarioId,
        graderResultsMap,
        graderOverrideMap,
        adapter,
        timeoutMs,
        options.trials
      );
    }
  });

  const results = await runConcurrent(tasks, options.parallel);
  for (const r of results) {
    if (r.error) {
      console.error(`  ERROR in scoring: ${r.error}`);
    }
  }

  console.log();
  console.log(`Phase 3 complete. Scored results in: ${scoredDir}`);
}

/**
 * Phase 4: Assemble final result JSON and trigger DB migration.
 */
async function phaseAssemble(
  rawDir: string,
  resultsDir: string,
  runDatetime: string,
  scenariosTotal: number,
  allScenariosTotal: number,
  trials: number,
  repoRoot: string
): Promise<string> {
  const scoredDir = path.join(rawDir, "scored");
  const finalOutput = path.join(resultsDir, `${runDatetime}.json`);

  console.log();
  console.log("=== Phase 4: Result Assembly ===");
  console.log(`  Reading scored results from: ${scoredDir}`);
  console.log(`  Writing final result to: ${finalOutput}`);

  fs.mkdirSync(resultsDir, { recursive: true });

  const final = assembleFinalResult(
    scoredDir,
    runDatetime,
    scenariosTotal,
    allScenariosTotal,
    trials,
    repoRoot
  );

  fs.writeFileSync(finalOutput, JSON.stringify(final, null, 2), "utf-8");

  console.log(`  Written: ${finalOutput}`);
  console.log(`  Scenarios run: ${final.scenarios_run}/${scenariosTotal}`);
  console.log(
    `  Summary: ${final.summary.pass}P / ${final.summary.partial}p / ${final.summary.fail}F  (pass_rate=${final.summary.pass_rate})`
  );

  // Trigger DB migration (non-fatal)
  console.log();
  console.log("Migrating results to DB and opening web app...");
  triggerMigration(repoRoot);

  console.log();
  console.log("=== Run Complete ===");
  console.log(`  Result file: ${finalOutput}`);

  return finalOutput;
}

/**
 * Main pipeline orchestrator.
 */
export async function runPipeline(
  options: PipelineOptions,
  adapter: ClaudeAdapter
): Promise<PipelineResult> {
  const evalsDir = path.join(options.repoRoot, "evals");
  const resultsDir = path.join(options.repoRoot, "evals", "results");

  // Discover scenarios
  const { scenarios, allScenariosTotal } = discoverScenarios(
    evalsDir,
    options.agentFilter,
    options.scenarioFilter
  );

  // Override with resume dir if provided
  const runDatetime = options.resumeDir
    ? path.basename(options.resumeDir)
    : new Date().toISOString().replace(/T/, "-").replace(/:/, "").replace(/:.*$/, "").replace(/-/, "").slice(0, 13).replace(/(\d{4})(\d{2})(\d{2})-(\d{4})/, "$1-$2-$3-$4");

  // Actually format as Python does: YYYY-MM-DD-HHMM
  const now = new Date();
  const formattedRunDatetime = options.resumeDir
    ? path.basename(options.resumeDir)
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  const rawDir = options.resumeDir
    ? options.resumeDir
    : path.join(resultsDir, "raw", formattedRunDatetime);

  const total = scenarios.length;

  console.log();
  console.log("eval-run.ts -- Dream Team Eval Orchestrator");
  console.log(`  Run datetime : ${formattedRunDatetime}`);
  console.log(`  Raw dir      : ${rawDir}`);
  console.log(`  Phase        : ${options.phase}`);
  console.log(`  Parallel     : ${options.parallel}`);
  console.log(`  Trials       : ${options.trials}`);
  console.log(`  Scenarios    : ${total}`);
  console.log();

  if (options.agentFilter) console.log(`  (filtered to agents: ${options.agentFilter})`);
  if (options.scenarioFilter) console.log(`  (filtered to scenario: ${options.scenarioFilter})`);

  // Dry run
  if (options.dryRun) {
    console.log();
    console.log("DRY RUN -- would execute the following:");
    console.log(`  Phase: ${options.phase}`);
    console.log(`  Parallel: ${options.parallel}`);
    console.log(`  Raw dir: ${rawDir}`);
    console.log();

    for (const { scenarioFile, agent, scenarioId } of scenarios) {
      if (agent === "team") {
        const rawOutput = path.join(rawDir, `team-${scenarioId}.json`);
        if (fs.existsSync(rawOutput)) {
          console.log(`  SKIP (exists): ${agent}/${scenarioId}`);
        } else {
          console.log(`  RUN (team): ${agent}/${scenarioId}`);
        }
      } else {
        const rawOutput = path.join(rawDir, `${agent}-${scenarioId}.json`);
        if (fs.existsSync(rawOutput)) {
          console.log(`  SKIP (exists): ${agent}/${scenarioId}`);
        } else {
          console.log(`  RUN: ${agent}/${scenarioId}`);
        }
      }
    }

    console.log();
    console.log("Dry run complete. No changes made.");
    return {
      finalOutputPath: "",
      scenariosRun: 0,
      scenariosTotal: total,
      allScenariosTotal,
      runDatetime: formattedRunDatetime,
    };
  }

  const scoredDir = path.join(rawDir, "scored");
  let graderResultsMap = new Map<string, GraderResult[]>();
  let graderOverrideMap = new Map<string, boolean>();

  if (options.phase === "all" || options.phase === "agents") {
    await phaseAgents(scenarios, rawDir, adapter, options);
  }

  if (options.phase === "all" || options.phase === "graders") {
    const maps = phaseGraders(scenarios, rawDir, options.trials);
    graderResultsMap = maps.graderResultsMap;
    graderOverrideMap = maps.graderOverrideMap;
  }

  if (options.phase === "score") {
    // score phase needs grader data
    const maps = phaseGraders(scenarios, rawDir, options.trials);
    graderResultsMap = maps.graderResultsMap;
    graderOverrideMap = maps.graderOverrideMap;
  }

  if (options.phase === "all" || options.phase === "score") {
    await phaseScore(
      scenarios,
      rawDir,
      scoredDir,
      graderResultsMap,
      graderOverrideMap,
      adapter,
      options
    );
    const finalOutputPath = await phaseAssemble(
      rawDir,
      resultsDir,
      formattedRunDatetime,
      total,
      allScenariosTotal,
      options.trials,
      options.repoRoot
    );

    return {
      finalOutputPath,
      scenariosRun: total,
      scenariosTotal: total,
      allScenariosTotal,
      runDatetime: formattedRunDatetime,
    };
  }

  return {
    finalOutputPath: "",
    scenariosRun: total,
    scenariosTotal: total,
    allScenariosTotal,
    runDatetime: formattedRunDatetime,
  };
}
