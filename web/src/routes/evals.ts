import {
  getAllRuns, getRun, getRunResults, getResult,
  getAgentSummaries, getAgentSummariesAlpha, getDistinctAgents,
  getPreviousBaselineRun, getAllRunsAsc, getPersistentNonPassScenarios
} from "../db.ts";
import type { ScenarioHistoryEntry } from "../db.ts";
import { Layout, maybeLayout } from "../views/Layout.ts";
import { esc } from "../views/html.ts";
import { DashboardPage } from "../views/Dashboard.ts";
import { EvalRunPage, ResultsTableFragment } from "../views/EvalRun.ts";
import { TraceViewerPage } from "../views/TraceViewer.ts";

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** GET / — Dashboard */
export function dashboardHandler(req: Request, _params: Record<string, string>): Response {
  const runs = getAllRuns();
  const body = DashboardPage(runs);
  return html(maybeLayout(req, "Dashboard", body, "/"));
}

/** GET /evals — redirect to / */
export function evalsIndexHandler(_req: Request, _params: Record<string, string>): Response {
  return new Response(null, { status: 302, headers: { Location: "/" } });
}

/** GET /evals/:runId — Eval run detail */
export function evalRunHandler(req: Request, params: Record<string, string>): Response {
  const runId = params.runId;
  if (!runId) return html("Not Found", 404);

  const run = getRun(runId);
  if (!run) return html(Layout("Not Found", `<div class="empty-state">Run not found: ${esc(runId)}</div>`), 404);

  const url = new URL(req.url);
  const filterAgent = url.searchParams.get("agent") ?? "";
  const filterScore = url.searchParams.get("score") ?? "";

  const results = getRunResults(runId, filterAgent || undefined, filterScore || undefined);
  const summaries = getAgentSummariesAlpha(runId);
  const agents = getDistinctAgents(runId);
  const previousBaseline = getPreviousBaselineRun(runId);
  const allRunsForTrend = getAllRunsAsc();

  // Previous baseline results and summaries for regression detection + agent deltas
  const previousBaselineResults = previousBaseline
    ? getRunResults(previousBaseline.run_id)
    : [];
  const previousBaselineSummaries = previousBaseline
    ? getAgentSummariesAlpha(previousBaseline.run_id)
    : [];

  const persistentNonPass = getPersistentNonPassScenarios();

  const body = EvalRunPage(
    run, results, summaries, agents, filterAgent, filterScore,
    previousBaseline, previousBaselineResults, previousBaselineSummaries, allRunsForTrend,
    persistentNonPass
  );
  return html(maybeLayout(req, run.run_id, body, "/evals"));
}

/** GET /evals/:runId/results — HTMX fragment for filtered results table */
export function evalResultsFragment(req: Request, params: Record<string, string>): Response {
  const runId = params.runId;
  if (!runId) return html("Not Found", 404);

  const url = new URL(req.url);
  const filterAgent = url.searchParams.get("agent") ?? "";
  const filterScore = url.searchParams.get("score") ?? "";

  const results = getRunResults(runId, filterAgent || undefined, filterScore || undefined);
  const tableHtml = ResultsTableFragment(results, runId);
  return html(tableHtml);
}

/** GET /evals/:runId/trace/:resultId — Trace viewer */
export function traceHandler(req: Request, params: Record<string, string>): Response {
  const runId = params.runId;
  const resultId = parseInt(params.resultId ?? "0", 10);

  const result = getResult(resultId);
  if (!result) {
    return html(Layout("Not Found", `<div class="empty-state">Result not found.</div>`), 404);
  }

  const body = TraceViewerPage(result, runId);
  return html(maybeLayout(req, result.scenario_id, body));
}
