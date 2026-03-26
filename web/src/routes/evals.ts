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
import { NewEvalRunPage } from "../views/NewEvalRun.ts";
import { EvalRunLivePage } from "../views/EvalRunLive.ts";
import { startEvalRun, getActiveRun, createSSEResponse } from "../sse.ts";

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

/** GET /evals/new — New eval run config form */
export function newEvalRunHandler(req: Request, _params: Record<string, string>): Response {
  const activeRun = getActiveRun();
  const runInProgress = activeRun != null && !activeRun.done;
  const body = NewEvalRunPage(runInProgress, runInProgress ? activeRun!.runId : undefined);
  return html(maybeLayout(req, "New Eval Run", body, "/evals/new"));
}

/** POST /api/eval-runs — Start a new eval run */
export async function startEvalRunHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  let agents: string[] = [];
  let scenario = "";
  let trials = 3;
  let parallel = 5;

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      agents = params.getAll("agents");
      scenario = params.get("scenario") ?? "";
      trials = parseInt(params.get("trials") ?? "3", 10) || 3;
      parallel = parseInt(params.get("parallel") ?? "5", 10) || 5;
    } else if (contentType.includes("application/json")) {
      const body = await req.json() as Record<string, unknown>;
      agents = Array.isArray(body.agents) ? body.agents as string[] : [];
      scenario = typeof body.scenario === "string" ? body.scenario : "";
      trials = typeof body.trials === "number" ? body.trials : 3;
      parallel = typeof body.parallel === "number" ? body.parallel : 5;
    }
  } catch (err) {
    console.error("Error parsing request body:", err);
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const runId = await startEvalRun({ agents, scenario, trials, parallel });
    // Redirect to live progress page (works for both form submit and JSON)
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("application/json")) {
      return new Response(JSON.stringify({ runId, liveUrl: "/evals/live" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Form submit — redirect to live page
    return new Response(null, { status: 302, headers: { Location: "/evals/live" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("application/json")) {
      return new Response(JSON.stringify({ error: message }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Redirect to live page if run already in progress
    return new Response(null, { status: 302, headers: { Location: "/evals/live" } });
  }
}

/** GET /api/eval-runs/live — SSE stream */
export function evalRunsSSEHandler(_req: Request, _params: Record<string, string>): Response {
  return createSSEResponse();
}

/** GET /evals/live — Live progress page */
export function evalRunLiveHandler(req: Request, _params: Record<string, string>): Response {
  const activeRun = getActiveRun();
  const runInProgress = activeRun != null;
  const body = EvalRunLivePage(
    runInProgress,
    activeRun?.runId,
    activeRun?.startedAt
  );
  return html(maybeLayout(req, "Live Eval Progress", body, "/evals/live"));
}
