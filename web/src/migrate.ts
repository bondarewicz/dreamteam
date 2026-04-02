/**
 * Migration: reads evals/results/*.json and evals/results/raw/*\/*.json
 * and populates the SQLite database.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const RESULTS_DIR = path.join(import.meta.dir, "../../evals/results");
const RAW_DIR = path.join(RESULTS_DIR, "raw");

type RawOutput = {
  agent: string;
  scenario_id: string;
  agent_output?: string;
  agent_output_excerpt?: string;
  trace?: unknown[];
  duration_ms?: number;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  timestamp?: string;
  grader_results?: unknown[];
  score?: string;
  confidence_stated?: number;
  justification?: string;
  failure_reason?: string;
};

type Trial = {
  score: string;
  confidence_stated?: number;
  justification?: string;
  observations?: unknown[];
  grader_results?: unknown[];
  grader_override?: boolean;
  duration_ms?: number;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  agent_output_excerpt?: string;
  failure_reason?: string;
};

type ResultEntry = {
  agent: string;
  scenario_id: string;
  scenario_name?: string;
  scenario_type?: string;
  category?: string;
  score: string;
  confidence_stated?: number;
  justification?: string;
  observations?: unknown[];
  grader_results?: unknown[];
  grader_override?: boolean;
  duration_ms?: number;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  agent_output_excerpt?: string;
  failure_reason?: string;
  timestamp?: string;
  trials?: Trial[];
};

type RunFile = {
  run_id: string;
  date?: string;
  timestamp?: string;
  trials?: number;
  is_complete_baseline?: boolean;
  scenarios_total?: number;
  scenarios_run?: number;
  summary?: {
    pass?: number;
    partial?: number;
    fail?: number;
    pass_rate?: number;
  };
  results?: ResultEntry[];
  meta?: Record<string, unknown>;
};

// Build a lookup map of raw outputs: key = "agent::scenario_id::trialIndex"
function buildRawMap(runDate: string): Map<string, RawOutput> {
  const map = new Map<string, RawOutput>();
  const rawRunDir = path.join(RAW_DIR, runDate);
  if (!fs.existsSync(rawRunDir)) return map;

  const files = fs.readdirSync(rawRunDir);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(rawRunDir, file), "utf8")) as RawOutput;
      // Determine trial index from filename:
      // Base file (no -tN suffix) = trial 0 (first/t1 in report)
      // -t1.json = trial 1 (second/t2 in report)
      // -t2.json = trial 2 (third/t3 in report)
      const trialMatch = file.match(/-t(\d+)\.json$/);
      const trialIndex = trialMatch ? parseInt(trialMatch[1], 10) : 0;
      const key = `${raw.agent}::${raw.scenario_id}::${trialIndex}`;
      map.set(key, raw);
    } catch (_e) {
      // skip malformed files
    }
  }
  return map;
}

export function migrate(db: Database) {
  const insertRun = db.prepare(`
    INSERT OR IGNORE INTO eval_runs
      (run_id, timestamp, trials, scenarios_run, scenarios_total, is_complete_baseline,
       pass_count, partial_count, fail_count, pass_rate, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResult = db.prepare(`
    INSERT OR IGNORE INTO eval_results
      (run_id, agent, scenario_id, trial_index, score, confidence_stated, justification,
       observations, grader_results, grader_override, duration_ms, tokens_used,
       input_tokens, output_tokens, cost_usd, agent_output_excerpt, failure_reason,
       trace, agent_output, scenario_name, scenario_type, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSummary = db.prepare(`
    INSERT OR REPLACE INTO agent_summaries
      (run_id, agent, pass_count, partial_count, fail_count, pass_rate,
       avg_confidence_stated, calibration_gap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();

  let totalRuns = 0;
  let totalResults = 0;

  for (const file of files) {
    const filePath = path.join(RESULTS_DIR, file);
    let run: RunFile;
    try {
      run = JSON.parse(fs.readFileSync(filePath, "utf8")) as RunFile;
    } catch (_e) {
      console.error(`  Skipping malformed file: ${file}`);
      continue;
    }

    if (!run.run_id || !run.results) continue;

    // Extract date portion from filename (strip .json)
    const runDate = file.replace(".json", "");
    const rawMap = buildRawMap(runDate);

    const ts = run.date || run.timestamp || new Date().toISOString();
    const summary = run.summary || {};
    const passCount = summary.pass ?? 0;
    const partialCount = summary.partial ?? 0;
    const failCount = summary.fail ?? 0;
    const passRate = summary.pass_rate ?? (
      (passCount + partialCount + failCount) > 0
        ? passCount / (passCount + partialCount + failCount)
        : 0
    );

    // trials: top-level field OR meta.trials (some JSON files store it in meta)
    const trialsValue = run.trials ?? (
      run.meta && typeof run.meta.trials === "number" ? run.meta.trials : 1
    );

    const scenariosRun = run.scenarios_run ?? run.results.length;
    // Override JSON's is_complete_baseline: only trust it if at least 100 scenarios ran.
    // The JSON flag is unreliable for filtered/partial runs (e.g. --agent or --scenario flags
    // set scenarios_total to the filtered count, making scenarios_run == scenarios_total even
    // for 1-scenario runs). A real baseline must cover all 125 scenarios (~100 threshold to
    // tolerate minor additions/removals over time).
    const isBaseline = (scenariosRun >= 100) ? 1 : 0;

    insertRun.run(
      run.run_id, ts, trialsValue,
      scenariosRun,
      run.scenarios_total ?? run.results.length,
      isBaseline,
      passCount, partialCount, failCount, passRate,
      run.meta ? JSON.stringify(run.meta) : null
    );

    // Collect per-agent stats
    const agentStats: Record<string, {
      pass: number; partial: number; fail: number;
      confidences: number[];
    }> = {};

    const results = run.results;
    for (const r of results) {
      const hasTrials = Array.isArray(r.trials) && r.trials.length > 0;

      const insertSingle = (trial: Trial, trialIndex: number, baseR: ResultEntry) => {
        const rawKey = `${baseR.agent}::${baseR.scenario_id}::${trialIndex}`;
        const raw = rawMap.get(rawKey);

        const graderResults = trial.grader_results ?? baseR.grader_results;
        const observations = trial.observations ?? baseR.observations;

        insertResult.run(
          run.run_id,
          baseR.agent,
          baseR.scenario_id,
          trialIndex,
          trial.score,
          trial.confidence_stated ?? null,
          trial.justification ?? null,
          observations ? JSON.stringify(observations) : null,
          graderResults ? JSON.stringify(graderResults) : null,
          trial.grader_override ? 1 : 0,
          trial.duration_ms ?? raw?.duration_ms ?? null,
          trial.tokens_used ?? raw?.tokens_used ?? null,
          trial.input_tokens ?? raw?.input_tokens ?? null,
          trial.output_tokens ?? raw?.output_tokens ?? null,
          trial.cost_usd ?? raw?.cost_usd ?? null,
          trial.agent_output_excerpt ?? raw?.agent_output_excerpt ?? null,
          trial.failure_reason ?? raw?.failure_reason ?? null,
          raw?.trace ? JSON.stringify(raw.trace) : null,
          raw?.agent_output ?? null,
          baseR.scenario_name ?? null,
          baseR.scenario_type ?? null,
          baseR.category ?? null
        );
        totalResults++;

        // Insert per-phase rows for team results
        if (baseR.agent === "team") {
          const teamOutput = raw?.agent_output ?? null;
          if (teamOutput) {
            try {
              const parsed = JSON.parse(teamOutput);
              let phaseList: unknown[] | null = null;
              if (Array.isArray(parsed)) {
                phaseList = parsed;
              } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).phases)) {
                phaseList = (parsed as Record<string, unknown>).phases as unknown[];
              }
              if (phaseList) {
                for (const phase of phaseList) {
                  if (!phase || typeof phase !== "object") continue;
                  const p = phase as Record<string, unknown>;
                  const isFixture = Boolean(p.is_fixture);
                  if (isFixture) continue;
                  const phaseAgent = typeof p.agent === "string" ? p.agent : null;
                  if (!phaseAgent) continue;
                  const phaseNum = typeof p.phase_num === "number" ? p.phase_num : null;
                  if (phaseNum == null) continue;
                  const phaseTrace = Array.isArray(p.trace) ? p.trace : [];
                  if (phaseTrace.length === 0) continue;

                  // Derive score from phase grader_results
                  let phaseScore = "pass";
                  if (Array.isArray(p.grader_results) && p.grader_results.length > 0) {
                    const allPass = (p.grader_results as Array<{ passed: boolean }>).every(g => g.passed);
                    phaseScore = allPass && !p.grader_override ? "pass" : "fail";
                  } else if (typeof p.score === "string") {
                    phaseScore = p.score;
                  }

                  const phaseScenarioId = `${baseR.scenario_id}--phase-${phaseNum}`;
                  const phaseScenarioName = `${baseR.scenario_name ?? baseR.scenario_id} — Phase ${phaseNum} (${phaseAgent})`;
                  const phaseGraderResults = Array.isArray(p.grader_results) ? JSON.stringify(p.grader_results) : null;

                  insertResult.run(
                    run.run_id,
                    phaseAgent,
                    phaseScenarioId,
                    trialIndex,
                    phaseScore,
                    null, // confidence_stated
                    null, // justification
                    null, // observations
                    phaseGraderResults,
                    p.grader_override ? 1 : 0,
                    typeof p.duration_ms === "number" ? p.duration_ms : null,
                    typeof p.tokens_used === "number" ? p.tokens_used : null,
                    typeof p.input_tokens === "number" ? p.input_tokens : null,
                    typeof p.output_tokens === "number" ? p.output_tokens : null,
                    typeof p.cost_usd === "number" ? p.cost_usd : null,
                    null, // agent_output_excerpt
                    null, // failure_reason
                    JSON.stringify(phaseTrace),
                    typeof p.agent_output === "string" ? p.agent_output : null,
                    phaseScenarioName,
                    "team-phase",
                    baseR.category ?? null
                  );
                  // NOTE: per-phase rows are NOT accumulated in agentStats to avoid
                  // polluting individual agent pass rates
                }
              }
            } catch {
              // skip malformed team output
            }
          }
        }

        // Accumulate agent stats (trial 0 = primary score)
        if (trialIndex === 0) {
          if (!agentStats[baseR.agent]) {
            agentStats[baseR.agent] = { pass: 0, partial: 0, fail: 0, confidences: [] };
          }
          const stats = agentStats[baseR.agent];
          if (trial.score === "pass") stats.pass++;
          else if (trial.score === "partial") stats.partial++;
          else stats.fail++;
          if (trial.confidence_stated != null) stats.confidences.push(trial.confidence_stated);
        }
      };

      if (hasTrials) {
        r.trials!.forEach((trial, i) => insertSingle(trial, i, r));
      } else {
        // Single result — treat as trial 0
        insertSingle({
          score: r.score,
          confidence_stated: r.confidence_stated,
          justification: r.justification,
          observations: r.observations,
          grader_results: r.grader_results,
          grader_override: r.grader_override,
          duration_ms: r.duration_ms,
          tokens_used: r.tokens_used,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cost_usd: r.cost_usd,
          agent_output_excerpt: r.agent_output_excerpt,
          failure_reason: r.failure_reason,
        }, 0, r);
      }
    }

    // Insert agent summaries
    for (const [agent, stats] of Object.entries(agentStats)) {
      const total = stats.pass + stats.partial + stats.fail;
      const rate = total > 0 ? stats.pass / total : 0;
      const avgConf = stats.confidences.length > 0
        ? stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length
        : null;
      const calGap = avgConf != null ? (rate * 100) - avgConf : null;
      insertSummary.run(run.run_id, agent, stats.pass, stats.partial, stats.fail, rate, avgConf, calGap);
    }

    totalRuns++;
  }

  console.log(`  Migrated ${totalRuns} runs, ${totalResults} results`);
}

// ── Standalone entry point ────────────────────────────────────────────────────
// When invoked directly with `bun web/src/migrate.ts`, run migration against
// the shared DB used by the web app.

if (import.meta.main) {
  const { getDb } = await import("./db.ts");
  const db = getDb();
  console.log("Running migration: evals/results/ → SQLite DB");
  migrate(db);
  console.log("Migration complete.");
}
