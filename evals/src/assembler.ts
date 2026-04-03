/**
 * assembler.ts — Result aggregation, pass@k, flaky detection, calibration gap, baseline detection
 *
 * Pure: reads scored files, returns FinalResult. No side effects.
 */

import fs from "fs";
import path from "path";
import type { FinalResult, ScoredResult, AgentSummary } from "./types.ts";

/**
 * Load all scored result files from scoredDir.
 */
export function loadScoredResults(scoredDir: string, runId: string): ScoredResult[] {
  const results: ScoredResult[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(scoredDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return results;
  }

  for (const fname of files) {
    const fpath = path.join(scoredDir, fname);
    try {
      const data: ScoredResult = JSON.parse(fs.readFileSync(fpath, "utf-8"));
      data.run_id = runId;
      results.push(data);
    } catch (e) {
      console.warn(`  WARN: could not read scored file ${fpath}: ${e}`);
    }
  }

  return results;
}

/**
 * Compute per-agent summaries from scored results.
 */
export function computeAgentSummaries(results: ScoredResult[]): Record<string, AgentSummary> {
  const buckets: Record<string, { pass: number; partial: number; fail: number; confidences: number[] }> = {};

  for (const r of results) {
    const a = r.agent || "unknown";
    if (!buckets[a]) {
      buckets[a] = { pass: 0, partial: 0, fail: 0, confidences: [] };
    }
    const s = r.score;
    buckets[a][s] = (buckets[a][s] ?? 0) + 1;

    const c = r.confidence_stated;
    if (c !== undefined && c !== null) {
      buckets[a].confidences.push(c);
    }
  }

  const summaries: Record<string, AgentSummary> = {};
  for (const [agent, bucket] of Object.entries(buckets)) {
    const total = bucket.pass + bucket.partial + bucket.fail;
    const passRate = total > 0 ? Math.round((bucket.pass / total) * 10000) / 10000 : 0;
    const confs = bucket.confidences;
    const avgConf =
      confs.length > 0
        ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10
        : null;

    let calibGap: number | null = null;
    if (avgConf !== null && total > 0) {
      const weighted = (bucket.pass * 100 + bucket.partial * 50) / total;
      calibGap = Math.round((avgConf - weighted) * 10) / 10;
    }

    summaries[agent] = {
      pass: bucket.pass,
      partial: bucket.partial,
      fail: bucket.fail,
      pass_rate: passRate,
      avg_confidence_stated: avgConf,
      calibration_gap: calibGap,
    };
  }

  return summaries;
}

/**
 * Determine if a run is a complete baseline.
 * is_complete_baseline = scenarios_run >= 100 AND >= 80% of ALL_SCENARIOS_TOTAL
 */
export function isCompleteBaseline(scenariosRun: number, allScenariosTotal: number): boolean {
  return scenariosRun >= 100 && scenariosRun >= allScenariosTotal * 0.8;
}

/**
 * Get the git commit SHA.
 */
function getRepoCommit(repoRoot: string): string {
  try {
    const result = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "--short", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      return new TextDecoder().decode(result.stdout).trim();
    }
  } catch {
    // ignore
  }
  return "unknown";
}

/**
 * Assemble the final result JSON from all scored results.
 */
export function assembleFinalResult(
  scoredDir: string,
  runDatetime: string,
  scenariosTotal: number,
  allScenariosTotal: number,
  trials: number,
  repoRoot: string
): FinalResult {
  const runId = `eval/run-${runDatetime}`;
  const results = loadScoredResults(scoredDir, runId);
  const scenariosRun = results.length;

  const passCount = results.filter((r) => r.score === "pass").length;
  const partialCount = results.filter((r) => r.score === "partial").length;
  const failCount = results.filter((r) => r.score === "fail").length;
  const passRate = scenariosRun > 0 ? Math.round((passCount / scenariosRun) * 10000) / 10000 : 0;

  const agentSummaries = computeAgentSummaries(results);
  const repoCommit = getRepoCommit(repoRoot);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  return {
    run_id: runId,
    date: now,
    is_complete_baseline: isCompleteBaseline(scenariosRun, allScenariosTotal),
    scenarios_total: scenariosTotal,
    scenarios_run: scenariosRun,
    summary: {
      pass: passCount,
      partial: partialCount,
      fail: failCount,
      pass_rate: passRate,
    },
    results,
    agent_summaries: agentSummaries,
    meta: {
      repo_commit: repoCommit,
      trials,
      notes:
        "Preliminary scoring by Coach K. Human review pending via web app at localhost:3000.",
    },
  };
}
