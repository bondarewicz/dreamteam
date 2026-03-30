/**
 * DreamTeam Web — Bun.serve() entry point
 * Start: bun run web/index.ts
 */
import { Router } from "./src/router.ts";
import { getDb, isDbEmpty } from "./src/db.ts";
import { migrate } from "./src/migrate.ts";
import {
  dashboardHandler,
  evalRunHandler,
  evalResultsFragment,
  traceHandler,
  newEvalRunHandler,
  startEvalRunHandler,
  evalRunsSSEHandler,
  evalRunLiveHandler,
} from "./src/routes/evals.ts";
import {
  scenariosListHandler,
  scenarioEditHandler,
  scenarioValidateHandler,
  scenarioSaveHandler,
  scenarioGenerateGradersHandler,
  scenarioDryRunHandler,
  scenarioNewHandler,
  scenarioGenerateHandler,
  scenarioNewSaveHandler,
  draftEditHandler,
  draftSaveHandler,
  draftValidateHandler,
  draftGenerateGradersHandler,
  draftDryRunHandler,
  draftPromoteHandler,
} from "./src/routes/scenarios.ts";
import { serveStatic } from "./src/routes/static.ts";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Initialize DB and migrate if empty
console.log("Initializing database...");
const db = getDb();
if (isDbEmpty()) {
  console.log("Database empty — migrating from JSON files...");
  migrate(db);
  console.log("Migration complete.");
} else {
  const count = (db.query("SELECT COUNT(*) as c FROM eval_runs").get() as { c: number }).c;
  console.log(`Database ready (${count} runs loaded).`);
}

// Set up router
const router = new Router();
router.get("/", dashboardHandler);
router.get("/evals/new", newEvalRunHandler);
router.get("/evals/live", evalRunLiveHandler);
router.get("/evals/:runId", evalRunHandler);
router.get("/evals/:runId/results", evalResultsFragment);
router.get("/evals/:runId/trace/:resultId", traceHandler);
router.post("/api/eval-runs", startEvalRunHandler);
router.get("/api/eval-runs/live", evalRunsSSEHandler);

// Scenario browser and editor
router.get("/scenarios", scenariosListHandler);
router.get("/scenarios/new", scenarioNewHandler);

// Draft lifecycle routes — registered BEFORE generic /:agent/:scenarioId to prevent
// 'drafts' being matched as a scenarioId by the generic route
router.get("/scenarios/:agent/drafts/:draftId", draftEditHandler);
router.post("/api/scenarios/:agent/drafts/:draftId/validate", draftValidateHandler);
router.post("/api/scenarios/:agent/drafts/:draftId/generate-graders", draftGenerateGradersHandler);
router.post("/api/scenarios/:agent/drafts/:draftId/dry-run", draftDryRunHandler);
router.post("/api/scenarios/:agent/drafts/:draftId/promote", draftPromoteHandler);
router.post("/api/scenarios/:agent/drafts/:draftId", draftSaveHandler);

// Generic scenario routes
router.get("/scenarios/:agent/:scenarioId", scenarioEditHandler);
router.post("/api/scenarios/generate", scenarioGenerateHandler);
router.post("/api/scenarios/new", scenarioNewSaveHandler);
router.post("/api/scenarios/:agent/:scenarioId/validate", scenarioValidateHandler);
router.post("/api/scenarios/:agent/:scenarioId/generate-graders", scenarioGenerateGradersHandler);
router.post("/api/scenarios/:agent/:scenarioId/dry-run", scenarioDryRunHandler);
router.post("/api/scenarios/:agent/:scenarioId", scenarioSaveHandler);

// Static file serving — manual pattern since router doesn't support wildcards directly
const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // max value — needed for SSE connections
  async fetch(req) {
    const url = new URL(req.url);

    // Static files
    if (url.pathname.startsWith("/static/")) {
      const file = url.pathname.slice("/static/".length);
      const fakeReq = req;
      const fakeParams = { "*": file };
      return serveStatic(fakeReq, fakeParams);
    }

    return router.handle(req);
  },
  error(err) {
    console.error("Server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`DreamTeam running at http://localhost:${PORT}`);

// Auto-open browser
try {
  const platform = process.platform;
  if (platform === "darwin") {
    Bun.spawn(["open", `http://localhost:${PORT}`]);
  } else if (platform === "linux") {
    Bun.spawn(["xdg-open", `http://localhost:${PORT}`]);
  } else if (platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", `http://localhost:${PORT}`]);
  }
} catch {
  // Browser open is optional
}
