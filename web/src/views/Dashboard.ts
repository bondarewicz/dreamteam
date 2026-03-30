import type { EvalRun, GlobalStats } from "../db.ts";
import { esc, pct, passBar, formatDate, agentChip } from "./html.ts";

export type PaginationInfo = {
  page: number;
  totalPages: number;
  total: number;
};

export function DashboardPage(
  runs: EvalRun[],
  agentsPerRun: Map<string, string[]>,
  stats: GlobalStats,
  pagination?: PaginationInfo
): string {
  // AC-3: Empty state when 0 runs total
  if (stats.total === 0) {
    return `
      <div class="page-title">
        <h1>DreamTeam Eval Dashboard</h1>
        <p>No eval runs found. Run an eval to see results here.</p>
      </div>
      <div class="empty-state">No eval data found in database.</div>
    `;
  }

  // AC-5: Stat cards always reflect ALL runs globally via pre-computed stats
  const { total, baselines, latestRun: latest } = stats;
  const latestRate = latest ? pct(latest.pass_rate) : "—";

  const statsHtml = `
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-label">Total Runs</div>
        <div class="stat-value accent">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Baselines</div>
        <div class="stat-value accent">${baselines}</div>
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
    let badgesHtml = "";
    if (run.is_complete_baseline) {
      badgesHtml = `<span class="run-baseline">BASELINE</span>`;
    } else {
      const agents = (agentsPerRun.get(run.run_id) ?? []).sort();
      badgesHtml = agents.map(a => agentChip(a)).join("");
    }

    return `
      <a href="/evals/${encodeURIComponent(run.run_id)}" class="run-row">
        <div class="run-meta">
          <span class="run-date">${esc(formatDate(run.timestamp))}</span>
        </div>
        <div class="run-counts">
          <span class="p">${run.pass_count ?? 0}P</span>
          <span class="pa">${run.partial_count ?? 0}p</span>
          <span class="f">${run.fail_count ?? 0}F</span>
        </div>
        <div>${passBar(run.pass_count, run.partial_count, run.fail_count)}</div>
        <div class="run-passrate">${pct(rate)}</div>
        <div class="run-scenarios">${run.scenarios_run ?? 0}/${run.scenarios_total ?? 0}</div>
        <div class="run-badges">${badgesHtml}</div>
      </a>
    `;
  }).join("");

  // AC-4 / AC-3: No pagination controls when runs fit on one page or 0 runs
  const showPagination = pagination && pagination.totalPages > 1;
  const paginationHtml = showPagination ? renderPagination(pagination) : "";

  return `
    <div class="page-title" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <h1>DreamTeam Eval Dashboard</h1>
        <p>Browse eval runs, track agent performance, and drill into traces.</p>
      </div>
      <a href="/evals/new" class="btn-new-run">+ New Run</a>
    </div>
    <style>
      .btn-new-run { display:inline-flex; align-items:center; background:var(--accent); color:#fff; border-radius:6px; padding:8px 16px; font-size:13px; font-weight:600; text-decoration:none; white-space:nowrap; transition:opacity 0.15s; }
      .btn-new-run:hover { opacity:0.85; }
    </style>
    ${statsHtml}
    <div class="section-gap">
      <h2>All Eval Runs</h2>
      <div class="run-list">
        ${rowsHtml}
      </div>
      ${paginationHtml}
    </div>
  `;
}

function pageLink(pageNum: number, label: string, cls: string = ""): string {
  const href = pageNum === 1 ? "/" : `/?page=${pageNum}`;
  const hxGet = pageNum === 1 ? "/" : `/?page=${pageNum}`;
  return `<a class="page-link${cls ? " " + cls : ""}" href="${href}" hx-get="${hxGet}" hx-target=".container" hx-push-url="true">${label}</a>`;
}

function renderPagination(p: PaginationInfo): string {
  const { page, totalPages } = p;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  // Prev arrow
  const prev = hasPrev
    ? pageLink(page - 1, "&lsaquo;")
    : `<span class="page-link disabled">&lsaquo;</span>`;

  // Next arrow
  const next = hasNext
    ? pageLink(page + 1, "&rsaquo;")
    : `<span class="page-link disabled">&rsaquo;</span>`;

  // Page number buttons with ellipsis for large page counts
  const pages: string[] = [];
  const show = new Set<number>();
  show.add(1);
  show.add(totalPages);
  for (let i = Math.max(1, page - 1); i <= Math.min(totalPages, page + 1); i++) show.add(i);

  const sorted = [...show].sort((a, b) => a - b);
  let last = 0;
  for (const n of sorted) {
    if (last && n - last > 1) pages.push(`<span class="page-ellipsis">&hellip;</span>`);
    if (n === page) {
      pages.push(`<span class="page-link active">${n}</span>`);
    } else {
      pages.push(pageLink(n, String(n)));
    }
    last = n;
  }

  return `
    <div class="pagination">
      ${prev}
      ${pages.join("\n      ")}
      ${next}
    </div>
  `;
}
