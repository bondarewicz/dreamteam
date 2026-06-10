/**
 * sessions-db.ts — persistence for Type-B session evals (cache; never re-judge
 * unless Re-evaluate). Keyed by (project, session_id, prompt_version) so editing
 * the judge prompt produces a fresh, version-stamped score and old ones are
 * detectably stale. See docs/session-evals-design.md §7.
 */
import { getDb } from "./db.ts";
import type { SessionEvalResult } from "./session-judge.ts";

let _ensured = false;
function ensure() {
  if (_ensured) return;
  getDb().run(`
    CREATE TABLE IF NOT EXISTS session_evals (
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      judged_at TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT NOT NULL,
      policy_version TEXT,
      verdicts_json TEXT,
      category_scores_json TEXT,
      aggregate REAL,
      aggregate_verdict TEXT,
      findings_json TEXT,
      error TEXT,
      PRIMARY KEY (project, session_id, prompt_version)
    )
  `);
  _ensured = true;
}

export type StoredEval = {
  project: string;
  session_id: string;
  judged_at: string;
  model: string | null;
  prompt_version: string;
  policy_version: string | null;
  verdicts_json: string | null;
  category_scores_json: string | null;
  aggregate: number | null;
  aggregate_verdict: string | null;
  findings_json: string | null;
  error: string | null;
};

export function saveSessionEval(project: string, sessionId: string, r: SessionEvalResult): void {
  ensure();
  getDb().run(
    `INSERT OR REPLACE INTO session_evals
     (project, session_id, judged_at, model, prompt_version, policy_version,
      verdicts_json, category_scores_json, aggregate, aggregate_verdict, findings_json, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      project, sessionId, r.judgedAt, r.model, r.promptVersion, r.policyVersion,
      JSON.stringify(r.verdicts), JSON.stringify(r.score.categories),
      r.score.aggregate, r.score.aggregateVerdict, JSON.stringify(r.score.findings),
      r.error ?? null,
    ],
  );
}

/** Latest eval for a session (any prompt version), newest judged_at first. */
export function getLatestSessionEval(project: string, sessionId: string): StoredEval | null {
  ensure();
  return getDb().query(
    `SELECT * FROM session_evals WHERE project = ? AND session_id = ? ORDER BY judged_at DESC LIMIT 1`,
  ).get(project, sessionId) as StoredEval | null;
}

/** Map of session_id -> latest aggregate_verdict for a project (for the index). */
export function getEvalVerdictsForProject(project: string): Map<string, { verdict: string; aggregate: number | null; stale: boolean }> {
  ensure();
  const rows = getDb().query(
    `SELECT session_id, aggregate, aggregate_verdict, prompt_version, judged_at FROM session_evals WHERE project = ? ORDER BY judged_at DESC`,
  ).all(project) as Array<{ session_id: string; aggregate: number | null; aggregate_verdict: string; prompt_version: string; judged_at: string }>;
  const map = new Map<string, { verdict: string; aggregate: number | null; stale: boolean }>();
  for (const r of rows) {
    if (!map.has(r.session_id)) map.set(r.session_id, { verdict: r.aggregate_verdict, aggregate: r.aggregate, stale: false });
  }
  return map;
}
