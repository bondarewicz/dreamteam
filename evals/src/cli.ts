/**
 * cli.ts — Arg parsing entry point
 *
 * Usage: bun src/cli.ts [options]
 *   --parallel N         Concurrency limit (default: 10)
 *   --resume DIR         Resume from existing raw outputs in DIR
 *   --agent NAME         Run only scenarios for named agent (comma-separated)
 *   --scenario PAT       Run only scenarios matching glob pattern or comma-separated "agent/id"
 *   --phase PHASE        Phase: agents|graders|score|all (default: all)
 *   --trials N           Run each scenario N times (default: 1)
 *   --model ID           Override the model for agent runs (e.g. claude-opus-4-6, claude-opus-4-7).
 *                        Does NOT affect Coach K scoring calls — the judge stays on the default model
 *                        so 4.6 vs 4.7 runs are compared against a constant baseline.
 *   --dry-run            Show what would run without executing
 *   --timeout-per-phase  Timeout in seconds per phase (default: 300 individual, 600 team)
 */

import path from "path";
import { BunClaudeAdapter } from "./claude-adapter.ts";
import { runPipeline } from "./pipeline.ts";
import type { PipelineOptions } from "./types.ts";

function parseArgs(argv: string[]): PipelineOptions & { help: boolean } {
  const opts = {
    parallel: 10,
    resumeDir: "",
    agentFilter: "",
    scenarioFilter: "",
    phase: "all" as PipelineOptions["phase"],
    trials: 1,
    dryRun: false,
    timeoutPerPhase: 0,
    repoRoot: "",
    model: "",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--parallel":
        opts.parallel = parseInt(argv[++i] ?? "10", 10);
        break;
      case "--resume":
        opts.resumeDir = argv[++i] ?? "";
        break;
      case "--agent":
        opts.agentFilter = argv[++i] ?? "";
        break;
      case "--scenario":
        opts.scenarioFilter = argv[++i] ?? "";
        break;
      case "--phase":
        opts.phase = (argv[++i] ?? "all") as PipelineOptions["phase"];
        break;
      case "--trials":
        opts.trials = Math.max(1, parseInt(argv[++i] ?? "1", 10));
        break;
      case "--model":
        opts.model = argv[++i] ?? "";
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--timeout-per-phase":
        opts.timeoutPerPhase = parseInt(argv[++i] ?? "0", 10);
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        process.exit(1);
    }
  }

  const validPhases = new Set(["agents", "graders", "score", "all"]);
  if (!validPhases.has(opts.phase)) {
    console.error(`Error: --phase must be one of: agents|graders|score|all`);
    process.exit(1);
  }

  return opts;
}

function printHelp() {
  console.log(`Usage: bun src/cli.ts [options]
  --parallel N          Concurrency limit (default: 10)
  --resume DIR          Resume from existing raw outputs in DIR
  --agent NAME          Run only scenarios for named agent (comma-separated)
  --scenario PAT        Run only scenarios matching glob pattern or agent/scenario-id
  --phase PHASE         agents|graders|score|all (default: all)
  --trials N            Run each scenario N times (default: 1)
  --model ID            Override model for agent runs (e.g. claude-opus-4-6). Judge stays on default.
  --dry-run             Show what would run without executing
  --timeout-per-phase N Timeout in seconds per phase (default: 300/600)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Resolve repo root from this file's location
  // evals/src/cli.ts -> evals/ -> repo root
  const repoRoot = path.join(import.meta.dir, "../..");
  opts.repoRoot = repoRoot;

  const adapter = new BunClaudeAdapter();

  try {
    await runPipeline(opts, adapter);
  } catch (e) {
    console.error(`Fatal error: ${e}`);
    process.exit(1);
  }
}

main();
