/**
 * SSE manager for live eval runs.
 * Handles spawning eval-run.sh and streaming stdout/stderr to connected clients.
 */
import path from "path";
import { getDb } from "./db.ts";
import { migrate } from "./migrate.ts";

const repoRoot = path.join(import.meta.dir, "../../");

export type RunState = {
  runId: string;
  startedAt: number;
  args: string[];
  proc: ReturnType<typeof Bun.spawn>;
  output: string[];       // accumulated lines for late-joining clients
  done: boolean;
  exitCode: number | null;
  controllers: Set<ReadableStreamDefaultController<Uint8Array>>;
};

// Module-level active run (only one at a time)
let activeRun: RunState | null = null;

export function getActiveRun(): RunState | null {
  return activeRun;
}

/** Build CLI args from form params */
function buildArgs(opts: {
  agents: string[];
  scenarios: string[];
  trials: number;
  parallel: number;
}): string[] {
  const args: string[] = [];

  if (opts.agents.length > 0 && !opts.agents.includes("all")) {
    args.push("--agent", opts.agents.join(","));
  }
  // Pass selected scenarios as comma-separated "agent/scenario-id" values to --scenario (BR-5)
  // Keep full agent/scenario-id format to avoid cross-agent basename collisions
  const selectedScenarios = opts.scenarios
    .filter(s => s.trim().length > 0);
  if (selectedScenarios.length > 0) {
    args.push("--scenario", selectedScenarios.join(","));
  }
  args.push("--trials", String(opts.trials));
  args.push("--parallel", String(opts.parallel));

  return args;
}

/** Encode an SSE event */
function sseEvent(event: string, data: string): Uint8Array {
  const text = `event: ${event}\ndata: ${data}\n\n`;
  return new TextEncoder().encode(text);
}

function sseData(data: string): Uint8Array {
  const text = `data: ${data}\n\n`;
  return new TextEncoder().encode(text);
}

/** Broadcast a chunk to all connected SSE clients */
function broadcast(run: RunState, chunk: Uint8Array) {
  for (const ctrl of run.controllers) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      run.controllers.delete(ctrl);
    }
  }
}

/** Start a new eval run. Returns the runId or throws if one is already running. */
export async function startEvalRun(opts: {
  agents: string[];
  scenarios: string[];
  trials: number;
  parallel: number;
}): Promise<string> {
  if (activeRun && !activeRun.done) {
    throw new Error("A run is already in progress");
  }

  const runId = `live-${Date.now()}`;
  const scriptArgs = buildArgs(opts);

  console.log(`[SSE] Starting eval run: bash scripts/eval-run.sh ${scriptArgs.join(" ")}`);

  const proc = Bun.spawn(["bash", "scripts/eval-run.sh", ...scriptArgs], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const run: RunState = {
    runId,
    startedAt: Date.now(),
    args: scriptArgs,
    proc,
    output: [],
    done: false,
    exitCode: null,
    controllers: new Set(),
  };

  activeRun = run;

  // Keepalive heartbeat every 30s to prevent idle timeout
  const heartbeat = setInterval(() => {
    if (run.done) { clearInterval(heartbeat); return; }
    broadcast(run, new TextEncoder().encode(": keepalive\n\n"));
  }, 30_000);

  // Stream stdout
  streamPipe(run, proc.stdout, "stdout");
  // Stream stderr
  streamPipe(run, proc.stderr, "stderr");

  // Wait for process completion
  proc.exited.then((code) => {
    clearInterval(heartbeat);
    run.done = true;
    run.exitCode = code;

    if (code === 0) {
      console.log("[SSE] Eval run completed successfully — running migration");
      try {
        const db = getDb();
        migrate(db);
        console.log("[SSE] Migration complete");
      } catch (err) {
        console.error("[SSE] Migration error:", err);
      }
      const completeMsg = sseEvent("complete", JSON.stringify({ exitCode: 0, runId }));
      run.output.push(`__event:complete:${JSON.stringify({ exitCode: 0, runId })}`);
      broadcast(run, completeMsg);
    } else {
      console.log(`[SSE] Eval run failed with exit code ${code}`);
      const failMsg = sseEvent("failed", JSON.stringify({ exitCode: code }));
      run.output.push(`__event:failed:${JSON.stringify({ exitCode: code })}`);
      broadcast(run, failMsg);
    }

    // Close all controllers
    for (const ctrl of run.controllers) {
      try { ctrl.close(); } catch { /* ignore */ }
    }
    run.controllers.clear();
  });

  return runId;
}

/** Stream a ReadableStream from Bun process pipe into SSE broadcast */
async function streamPipe(
  run: RunState,
  pipe: ReadableStream<Uint8Array> | null,
  _tag: string
) {
  if (!pipe) return;
  const reader = pipe.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Store for late-joining clients
      run.output.push(text);
      // Broadcast as SSE message — split by lines for clean delivery
      const lines = text.split("\n");
      for (const line of lines) {
        if (line === "") continue;
        const chunk = sseData(JSON.stringify({ line }));
        broadcast(run, chunk);
      }
    }
  } catch (err) {
    console.error("[SSE] Stream read error:", err);
  } finally {
    reader.releaseLock();
  }
}

/** Create an SSE Response that streams the active run (or waits for it) */
export function createSSEResponse(): Response {
  const run = activeRun;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!run) {
        // No active run
        controller.enqueue(sseEvent("error", JSON.stringify({ message: "No active run" })));
        controller.close();
        return;
      }

      // Send all buffered output to the new client
      for (const stored of run.output) {
        if (stored.startsWith("__event:")) {
          // Replay terminal events
          const rest = stored.slice("__event:".length);
          const colonIdx = rest.indexOf(":");
          const evtName = rest.slice(0, colonIdx);
          const evtData = rest.slice(colonIdx + 1);
          controller.enqueue(sseEvent(evtName, evtData));
        } else {
          // Replay output lines
          const lines = stored.split("\n");
          for (const line of lines) {
            if (line === "") continue;
            controller.enqueue(sseData(JSON.stringify({ line })));
          }
        }
      }

      if (run.done) {
        controller.close();
        return;
      }

      // Register for live updates
      run.controllers.add(controller);
    },
    cancel(controller) {
      if (run) {
        run.controllers.delete(controller as ReadableStreamDefaultController<Uint8Array>);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
