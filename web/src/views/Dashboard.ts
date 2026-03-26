import type { EvalRun } from "../db.ts";
import { esc, pct, passBar, formatDate } from "./html.ts";

export function DashboardPage(runs: EvalRun[]): string {
  if (runs.length === 0) {
    return `
      <div class="page-title">
        <h1>DreamTeam Eval Dashboard</h1>
        <p>No eval runs found. Run an eval to see results here.</p>
      </div>
      <div class="empty-state">No eval data found in database.</div>
    `;
  }

  const total = runs.length;
  const latest = runs[0];
  const latestRate = latest ? pct(latest.pass_rate) : "—";
  const baselines = runs.filter(r => r.is_complete_baseline);

  const statsHtml = `
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">Total Runs</div>
        <div class="stat-value accent">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Baselines</div>
        <div class="stat-value accent">${baselines.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Latest Pass Rate</div>
        <div class="stat-value pass">${latestRate}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Latest Pass</div>
        <div class="stat-value pass">${latest?.pass_count ?? 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Latest Partial</div>
        <div class="stat-value partial">${latest?.partial_count ?? 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Latest Fail</div>
        <div class="stat-value fail">${latest?.fail_count ?? 0}</div>
      </div>
    </div>
  `;

  const rowsHtml = runs.map(run => {
    const rate = run.pass_rate ?? 0;
    const baseline = run.is_complete_baseline
      ? `<span class="run-baseline">BASELINE</span>`
      : "";

    return `
      <a href="/evals/${encodeURIComponent(run.run_id)}" class="run-row">
        <div class="run-meta">
          <span class="run-date">${esc(formatDate(run.timestamp))}</span>
          ${baseline}
        </div>
        <div class="run-counts">
          <span class="p">${run.pass_count ?? 0}P</span>
          <span class="pa">${run.partial_count ?? 0}p</span>
          <span class="f">${run.fail_count ?? 0}F</span>
        </div>
        <div>${passBar(rate)}</div>
        <div class="run-passrate">${pct(rate)}</div>
        <div class="run-scenarios">${run.scenarios_run ?? 0}/${run.scenarios_total ?? 0}</div>
      </a>
    `;
  }).join("");

  return `
    <div class="page-title">
      <h1>DreamTeam Eval Dashboard</h1>
      <p>Browse eval runs, track agent performance, and drill into traces.</p>
    </div>
    ${statsHtml}
    <div class="section-gap">
      <h2>All Eval Runs</h2>
      <div class="run-list">
        ${rowsHtml}
      </div>
    </div>
  `;
}
