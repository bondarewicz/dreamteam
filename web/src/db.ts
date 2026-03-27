import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(import.meta.dir, "../../data");
const DB_PATH = path.join(DATA_DIR, "dreamteam.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)
  `);
  const row = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  if (row && row.version >= 1) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS eval_runs (
      run_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      trials INTEGER DEFAULT 1,
      scenarios_run INTEGER,
      scenarios_total INTEGER,
      is_complete_baseline INTEGER DEFAULT 0,
      pass_count INTEGER,
      partial_count INTEGER,
      fail_count INTEGER,
      pass_rate REAL,
      meta TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS eval_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
      agent TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      trial_index INTEGER DEFAULT 0,
      score TEXT NOT NULL,
      confidence_stated REAL,
      justification TEXT,
      observations TEXT,
      grader_results TEXT,
      grader_override INTEGER DEFAULT 0,
      duration_ms INTEGER,
      tokens_used INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      agent_output_excerpt TEXT,
      failure_reason TEXT,
      trace TEXT,
      agent_output TEXT,
      scenario_name TEXT,
      scenario_type TEXT,
      category TEXT,
      UNIQUE(run_id, agent, scenario_id, trial_index)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_summaries (
      run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
      agent TEXT NOT NULL,
      pass_count INTEGER,
      partial_count INTEGER,
      fail_count INTEGER,
      pass_rate REAL,
      avg_confidence_stated REAL,
      calibration_gap REAL,
      PRIMARY KEY (run_id, agent)
    )
  `);

  db.run(`INSERT OR IGNORE INTO schema_version (version) VALUES (1)`);
}

export type EvalRun = {
  run_id: string;
  timestamp: string;
  trials: number;
  scenarios_run: number;
  scenarios_total: number;
  is_complete_baseline: number;
  pass_count: number;
  partial_count: number;
  fail_count: number;
  pass_rate: number;
  meta: string | null;
};

export type EvalResult = {
  id: number;
  run_id: string;
  agent: string;
  scenario_id: string;
  trial_index: number;
  score: string;
  confidence_stated: number | null;
  justification: string | null;
  observations: string | null;
  grader_results: string | null;
  grader_override: number;
  duration_ms: number | null;
  tokens_used: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  agent_output_excerpt: string | null;
  failure_reason: string | null;
  trace: string | null;
  agent_output: string | null;
  scenario_name: string | null;
  scenario_type: string | null;
  category: string | null;
};

export type AgentSummary = {
  run_id: string;
  agent: string;
  pass_count: number;
  partial_count: number;
  fail_count: number;
  pass_rate: number;
  avg_confidence_stated: number | null;
  calibration_gap: number | null;
};

export function getAllRuns(): EvalRun[] {
  const db = getDb();
  return db.query("SELECT * FROM eval_runs ORDER BY timestamp DESC").all() as EvalRun[];
}

export type RunsPage = {
  runs: EvalRun[];
  total: number;
  page: number;
  totalPages: number;
};

/** Returns a paginated slice of eval runs (newest first) using LIMIT/OFFSET at the DB level. */
export function getRunsPage(page: number, pageSize: number): RunsPage {
  const db = getDb();
  const countRow = db.query("SELECT COUNT(*) as count FROM eval_runs").get() as { count: number };
  const total = countRow.count;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * pageSize;
  const runs = db.query(
    "SELECT * FROM eval_runs ORDER BY timestamp DESC LIMIT ? OFFSET ?"
  ).all(pageSize, offset) as EvalRun[];
  return { runs, total, page: safePage, totalPages };
}

export function getRun(runId: string): EvalRun | null {
  const db = getDb();
  return db.query("SELECT * FROM eval_runs WHERE run_id = ?").get(runId) as EvalRun | null;
}

export function getRunResults(runId: string, agent?: string, score?: string): EvalResult[] {
  const db = getDb();
  let sql = "SELECT * FROM eval_results WHERE run_id = ?";
  const params: unknown[] = [runId];
  if (agent) { sql += " AND agent = ?"; params.push(agent); }
  if (score) { sql += " AND score = ?"; params.push(score); }
  sql += " ORDER BY agent, scenario_id, trial_index";
  return db.query(sql).all(...params) as EvalResult[];
}

export function getResult(id: number): EvalResult | null {
  const db = getDb();
  return db.query("SELECT * FROM eval_results WHERE id = ?").get(id) as EvalResult | null;
}

export function getAgentSummaries(runId: string): AgentSummary[] {
  const db = getDb();
  return db.query("SELECT * FROM agent_summaries WHERE run_id = ? ORDER BY pass_rate DESC").all(runId) as AgentSummary[];
}

export function getDistinctAgents(runId: string): string[] {
  const db = getDb();
  const rows = db.query("SELECT DISTINCT agent FROM eval_results WHERE run_id = ? ORDER BY agent").all(runId) as { agent: string }[];
  return rows.map(r => r.agent);
}

/**
 * Bulk query: returns a Map<run_id, string[]> of agents for a specific set of run IDs.
 * Agents are deduplicated and sorted alphabetically per run.
 * Uses agent_summaries with fallback to eval_results (same logic as getAgentsForAllRuns).
 */
export function getAgentsForRuns(runIds: string[]): Map<string, string[]> {
  if (runIds.length === 0) return new Map();
  const db = getDb();
  const map = new Map<string, string[]>();
  const placeholders = runIds.map(() => "?").join(",");

  const summaryRows = db.query(
    `SELECT run_id, agent FROM agent_summaries WHERE run_id IN (${placeholders}) ORDER BY run_id, agent ASC`
  ).all(...runIds) as { run_id: string; agent: string }[];
  for (const row of summaryRows) {
    if (!map.has(row.run_id)) map.set(row.run_id, []);
    map.get(row.run_id)!.push(row.agent);
  }

  const coveredIds = [...map.keys()];
  const uncoveredIds = runIds.filter(id => !coveredIds.includes(id));
  if (uncoveredIds.length > 0) {
    const fallbackPlaceholders = uncoveredIds.map(() => "?").join(",");
    const fallbackRows = db.query(
      `SELECT DISTINCT run_id, agent FROM eval_results WHERE run_id IN (${fallbackPlaceholders}) ORDER BY run_id, agent ASC`
    ).all(...uncoveredIds) as { run_id: string; agent: string }[];
    for (const row of fallbackRows) {
      if (!map.has(row.run_id)) map.set(row.run_id, []);
      map.get(row.run_id)!.push(row.agent);
    }
  }

  return map;
}

/**
 * Bulk query: returns a Map<run_id, string[]> of agents for all runs.
 * Agents are deduplicated and sorted alphabetically per run.
 * Uses agent_summaries (more reliable for completed runs) with fallback to eval_results.
 */
export function getAgentsForAllRuns(): Map<string, string[]> {
  const db = getDb();
  const map = new Map<string, string[]>();

  // Primary: agent_summaries (populated for completed runs)
  const summaryRows = db.query(
    "SELECT run_id, agent FROM agent_summaries ORDER BY run_id, agent ASC"
  ).all() as { run_id: string; agent: string }[];
  for (const row of summaryRows) {
    if (!map.has(row.run_id)) map.set(row.run_id, []);
    map.get(row.run_id)!.push(row.agent);
  }

  // Fallback: eval_results only for run_ids NOT already covered by agent_summaries
  // This handles in-progress or crashed runs that never wrote agent_summaries rows.
  const fallbackRows = db.query(
    "SELECT DISTINCT run_id, agent FROM eval_results WHERE run_id NOT IN (SELECT DISTINCT run_id FROM agent_summaries) ORDER BY run_id, agent ASC"
  ).all() as { run_id: string; agent: string }[];
  for (const row of fallbackRows) {
    if (!map.has(row.run_id)) map.set(row.run_id, []);
    map.get(row.run_id)!.push(row.agent);
  }

  return map;
}

export function isDbEmpty(): boolean {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as count FROM eval_runs").get() as { count: number };
  return row.count === 0;
}

export type GlobalStats = {
  total: number;
  baselines: number;
  latestRun: EvalRun | null;
};

/**
 * Returns aggregate stats for ALL eval runs using SQL-level aggregation.
 * Avoids loading all rows into JS memory just to compute stat card values.
 */
export function getGlobalStats(): GlobalStats {
  const db = getDb();
  const aggRow = db.query(
    "SELECT COUNT(*) as total, SUM(is_complete_baseline) as baselines FROM eval_runs"
  ).get() as { total: number; baselines: number | null };
  const latestRun = db.query(
    "SELECT * FROM eval_runs ORDER BY timestamp DESC LIMIT 1"
  ).get() as EvalRun | null;
  return {
    total: aggRow.total,
    baselines: aggRow.baselines ?? 0,
    latestRun,
  };
}

/**
 * Returns the most recent complete-baseline run before the given run.
 * Used for the Focus section trend comparison.
 */
export function getPreviousBaselineRun(currentRunId: string): EvalRun | null {
  const db = getDb();
  const current = db.query("SELECT timestamp FROM eval_runs WHERE run_id = ?").get(currentRunId) as { timestamp: string } | null;
  if (!current) return null;
  return db.query(
    `SELECT * FROM eval_runs
     WHERE is_complete_baseline = 1
       AND run_id != ?
       AND timestamp < ?
     ORDER BY timestamp DESC
     LIMIT 1`
  ).get(currentRunId, current.timestamp) as EvalRun | null;
}

/**
 * Returns agent summaries for a given run_id ordered alphabetically by agent name.
 */
export function getAgentSummariesAlpha(runId: string): AgentSummary[] {
  const db = getDb();
  return db.query("SELECT * FROM agent_summaries WHERE run_id = ? ORDER BY agent ASC").all(runId) as AgentSummary[];
}

/**
 * Returns all eval runs ordered by timestamp ascending (for trend table).
 */
export function getAllRunsAsc(): EvalRun[] {
  const db = getDb();
  return db.query("SELECT * FROM eval_runs ORDER BY timestamp ASC").all() as EvalRun[];
}

export type ScenarioHistoryEntry = {
  run_id: string;
  timestamp: string;
  score: string;
};

/**
 * Returns the score history for a given agent+scenario across ALL runs,
 * ordered by timestamp ascending. Uses worst score across trials per run.
 */
export function getScenarioHistory(agent: string, scenarioId: string): ScenarioHistoryEntry[] {
  const db = getDb();
  // Get all runs ordered by timestamp ascending
  const runs = db.query("SELECT run_id, timestamp FROM eval_runs ORDER BY timestamp ASC").all() as { run_id: string; timestamp: string }[];
  const result: ScenarioHistoryEntry[] = [];
  for (const run of runs) {
    const rows = db.query(
      "SELECT score FROM eval_results WHERE run_id = ? AND agent = ? AND scenario_id = ? ORDER BY score ASC"
    ).all(run.run_id, agent, scenarioId) as { score: string }[];
    if (rows.length === 0) continue;
    // Use worst score across trials
    const scoreOrdFn = (s: string) => s === "fail" ? 0 : s === "partial" ? 1 : 2;
    const worst = rows.reduce((w, r) => scoreOrdFn(r.score) < scoreOrdFn(w.score) ? r : w, rows[0]);
    result.push({ run_id: run.run_id, timestamp: run.timestamp, score: worst.score });
  }
  return result;
}

/**
 * Returns all agent+scenario pairs that have NEVER passed across ALL runs.
 * Returns: array of { agent, scenario_id, history: ScenarioHistoryEntry[] }
 */
export function getPersistentNonPassScenarios(): Array<{
  agent: string;
  scenario_id: string;
  history: ScenarioHistoryEntry[];
}> {
  const db = getDb();
  // Find all agent+scenario combos that appear in at least 2 runs and never passed
  const rows = db.query(`
    SELECT agent, scenario_id
    FROM eval_results
    GROUP BY agent, scenario_id
    HAVING COUNT(DISTINCT run_id) >= 2
      AND SUM(CASE WHEN score = 'pass' THEN 1 ELSE 0 END) = 0
    ORDER BY agent, scenario_id
  `).all() as { agent: string; scenario_id: string }[];

  return rows.map(row => ({
    agent: row.agent,
    scenario_id: row.scenario_id,
    history: getScenarioHistory(row.agent, row.scenario_id),
  }));
}
