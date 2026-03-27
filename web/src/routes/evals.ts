import {
  getRun, getRunResults, getResult,
  getAgentSummaries, getAgentSummariesAlpha, getDistinctAgents,
  getPreviousBaselineRun, getAllRunsAsc, getPersistentNonPassScenarios,
  getAgentsForAllRuns, getAgentsForRuns, getRunsPage, getGlobalStats
} from "../db.ts";
import type { ScenarioHistoryEntry } from "../db.ts";
import { Layout, maybeLayout } from "../views/Layout.ts";
import { esc } from "../views/html.ts";
import { DashboardPage } from "../views/Dashboard.ts";
import { EvalRunPage, ResultsTableFragment } from "../views/EvalRun.ts";
import { TraceViewerPage } from "../views/TraceViewer.ts";
import { NewEvalRunPage, type ScenarioGroup } from "../views/NewEvalRun.ts";
import { EvalRunLivePage } from "../views/EvalRunLive.ts";
import { startEvalRun, getActiveRun, createSSEResponse } from "../sse.ts";
import path from "path";
import { readdirSync } from "node:fs";

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const PAGE_SIZE = 20;

/** GET / — Dashboard */
export function dashboardHandler(req: Request, _params: Record<string, string>): Response {
  const url = new URL(req.url);
  const rawPage = url.searchParams.get("page") ?? "1";
  const parsedPage = parseInt(rawPage, 10);
  // AC-6: Invalid page params (non-numeric, zero, negative) default to page 1
  const requestedPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const { runs, total, page, totalPages } = getRunsPage(requestedPage, PAGE_SIZE);

  // AC-5: Global stats from ALL runs via SQL aggregation (no full table load into JS memory)
  const stats = getGlobalStats();

  // AC-10: Agent data fetched only for displayed run_ids, not all runs
  const runIds = runs.map(r => r.run_id);
  const agentsPerRun = getAgentsForRuns(runIds);

  const body = DashboardPage(runs, agentsPerRun, stats, { page, totalPages, total });
  return html(maybeLayout(req, "Dashboard", body, "/"));
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

/** Discover scenario groups from the evals/ directory on disk (BR-6, AC-7) */
function loadScenarioGroups(): ScenarioGroup[] {
  const repoRoot = path.join(import.meta.dir, "../../..");
  const evalsDir = path.join(repoRoot, "evals");
  const groups: ScenarioGroup[] = [];
  try {
    const entries = readdirSync(evalsDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "results" || entry.name.startsWith(".")) continue;
      const agentDir = path.join(evalsDir, entry.name);
      const scenarios: string[] = [];
      try {
        const files = readdirSync(agentDir);
        for (const f of files.sort()) {
          if (f.startsWith("scenario-") && f.endsWith(".md")) {
            scenarios.push(f.replace(/\.md$/, ""));
          }
        }
      } catch {
        // skip unreadable agent dirs
      }
      if (scenarios.length > 0) {
        groups.push({ agent: entry.name, scenarios });
      }
    }
  } catch {
    // evals dir missing — return empty
  }
  return groups;
}

/** GET /evals/new — New eval run config form */
export function newEvalRunHandler(req: Request, _params: Record<string, string>): Response {
  const activeRun = getActiveRun();
  const runInProgress = activeRun != null && !activeRun.done;
  const scenarioGroups = loadScenarioGroups();
  const body = NewEvalRunPage(runInProgress, scenarioGroups, runInProgress ? activeRun!.runId : undefined);
  return html(maybeLayout(req, "New Eval Run", body, "/evals/new"));
}

/** POST /api/eval-runs — Start a new eval run */
export async function startEvalRunHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  let agents: string[] = [];
  let scenarios: string[] = [];
  let trials = 3;
  let parallel = 5;

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      agents = params.getAll("agents");
      scenarios = params.getAll("scenarios");
      trials = parseInt(params.get("trials") ?? "3", 10) || 3;
      parallel = parseInt(params.get("parallel") ?? "5", 10) || 5;
    } else if (contentType.includes("application/json")) {
      const body = await req.json() as Record<string, unknown>;
      agents = Array.isArray(body.agents) ? body.agents as string[] : [];
      // Support both legacy "scenario" string and new "scenarios" array
      if (Array.isArray(body.scenarios)) {
        scenarios = body.scenarios as string[];
      } else if (typeof body.scenario === "string" && body.scenario) {
        scenarios = [body.scenario];
      }
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
    const runId = await startEvalRun({ agents, scenarios, trials, parallel });
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
