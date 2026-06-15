#!/usr/bin/env bun
/**
 * baseline-eval.ts — curated cross-model baseline eval (model bake-off).
 *
 * Runs a hand-picked subset of the highest-signal `capability` scenarios across
 * multiple models, with the scoring judge pinned to Sonnet so the baseline stays
 * constant. Sequential, canary-first, and aborts the moment a run trips the
 * subscription session limit — so a hit cap costs one model, not the whole window.
 *
 *   bun scripts/baseline-eval.ts                  # all 3 models, trials 1
 *   bun scripts/baseline-eval.ts --models sonnet,opus
 *   bun scripts/baseline-eval.ts --trials 2
 *   bun scripts/baseline-eval.ts --dry-run        # validate subset, spend nothing
 *   bun scripts/baseline-eval.ts --list           # print the subset and exit
 */

import fs from "fs";
import path from "path";
import { discoverScenarios } from "../evals/src/discovery.ts";

const REPO_ROOT = path.join(import.meta.dir, "..");
const EVALS_DIR = path.join(REPO_ROOT, "evals");
const CLI = path.join(EVALS_DIR, "src", "cli.ts");

/** Judge stays constant across every model run — spares the scarcer Opus weekly cap. */
const JUDGE_MODEL = "claude-sonnet-4-6";

/**
 * Curated baseline subset — selected by *measured discrimination*, not filename
 * guesses. Each scenario is ranked by the entropy of its pass/partial/fail
 * outcomes across all historical runs in evals/results/ (H=0 → always the same
 * verdict → separates nothing; high H → models actually diverge). The H values
 * below are from the 30-run analysis; regenerate with scripts/select-baseline.ts
 * after each baseline so the list self-corrects as evidence accumulates.
 *
 * Excluded on evidence: all of drexler (every scenario H≈0 — pure guardrails),
 * kobe/24 + bird/19 (always-green / floor), and the two multi-agent `team`
 * scenarios (quota hogs that trip the 5-hour cap). Single source of truth —
 * README's "Baseline eval" section points here rather than duplicating the list.
 */
const SUBSET = [
  "shaq/scenario-14-large-scope-implementation", //        H 1.46 — top discriminator
  "mj/scenario-05-microservices-decomposition", //         H 1.37
  "bird/scenario-08-hr-domain-rules", //                   H 1.10
  "mj/scenario-20-saga-pattern-design", //                 H 0.97
  "magic/scenario-06-terminology-alignment", //            H 0.97
  "pippen/scenario-04-hidden-fatal-flaw", //               H 0.86
  "magic/scenario-23-learning-review-no-single-root-cause", // H 0.86
  "shaq/scenario-04-contradictory-spec", //                H 0.81
  "bird/scenario-20-domain-synthesis-under-pressure", //   only scenario to split all 3 models live
  "shaq/scenario-20-high-stakes-implementation", //        60% non-pass (skipped last round — see analysis)
  "coachk/scenario-02-context-curation-not-dumping", //    H 0.59 — coachk's best (weak; agent rarely fails)
  "kobe/scenario-18-expert-subtle-bug", //                 H 0.59 — kobe's best (weak; agent rarely fails)
];

/** Default models, canary (cheapest against quota) first. */
const DEFAULT_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5"];

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};

/** Markers Claude Code writes into an agent output when the subscription cap is hit. */
const LIMIT_MARKERS = [
  /hit your (session|usage) limit/i,
  /(session|usage) limit ·/i,
];

interface Args {
  models: string[];
  trials: number;
  parallel: number;
  dryRun: boolean;
  list: boolean;
}

function printHelp(): void {
  console.log(`baseline-eval.ts — curated cross-model baseline eval

Usage: bun scripts/baseline-eval.ts [options]

  --models <a,b,c>   Models to run (aliases: sonnet, opus, fable). Default: all three.
  --trials <N>       Trials per scenario (default: 2).
  --parallel <N>     Concurrent agent calls (default: 10).
  --dry-run          Validate the subset against the matcher, spend no quota.
  --list             Print the subset and judge model, then exit.
  -h, --help         This help.

Judge is pinned to ${JUDGE_MODEL} via ANTHROPIC_MODEL on every run.
Runs sequentially, canary-first, and aborts the moment a run hits the session limit.`);
}

function parseArgs(argv: string[]): Args {
  // Default trials=2: a single trial undersamples — last round, only 1 of 10
  // scenarios separated the models because most were caught at trials 1. >=2
  // samples each model per scenario so intermediate-pass-rate scenarios reveal spread.
  const a: Args = { models: DEFAULT_MODELS, trials: 2, parallel: 10, dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--models":
        a.models = (argv[++i] ?? "")
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m) => MODEL_ALIASES[m] ?? m);
        break;
      case "--trials":
        a.trials = Math.max(1, parseInt(argv[++i] ?? "1", 10));
        break;
      case "--parallel":
        a.parallel = Math.max(1, parseInt(argv[++i] ?? "10", 10));
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--list":
        a.list = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown arg: ${arg}\n`);
        printHelp();
        process.exit(2);
    }
  }
  if (!a.models.length) {
    console.error("No models specified.");
    process.exit(2);
  }
  return a;
}

/** Confirm every subset id resolves through the real matcher. Zero quota. */
function validateSubset(): void {
  const { scenarios } = discoverScenarios(EVALS_DIR, "", SUBSET.join(","));
  const matched = new Set(scenarios.map((s) => `${s.agent}/${s.scenarioId}`));
  const missing = SUBSET.filter((id) => !matched.has(id));
  if (missing.length) {
    console.error(`\n❌ ${missing.length} subset id(s) do not resolve — fix before running:`);
    for (const m of missing) console.error(`   MISS ${m}`);
    process.exit(1);
  }
  console.log(`✅ Subset validated: all ${SUBSET.length} scenarios resolve.`);
}

function listRawDirs(): Set<string> {
  const rawRoot = path.join(EVALS_DIR, "results", "raw");
  if (!fs.existsSync(rawRoot)) return new Set();
  return new Set(fs.readdirSync(rawRoot));
}

/** Newest run dir under evals/results/raw not present in `before`. */
function newestRawDir(before: Set<string>): string | null {
  const rawRoot = path.join(EVALS_DIR, "results", "raw");
  if (!fs.existsSync(rawRoot)) return null;
  const dirs = fs
    .readdirSync(rawRoot)
    .filter((d) => !before.has(d) && fs.statSync(path.join(rawRoot, d)).isDirectory());
  if (!dirs.length) return null;
  dirs.sort();
  return path.join(rawRoot, dirs[dirs.length - 1]);
}

/** Scan a run dir's raw outputs for the session-limit marker. Returns scenarios that hit it. */
function scanForLimit(runDir: string): string[] {
  const hits: string[] = [];
  for (const f of fs.readdirSync(runDir)) {
    if (!f.endsWith(".json")) continue;
    const text = fs.readFileSync(path.join(runDir, f), "utf-8");
    if (LIMIT_MARKERS.some((re) => re.test(text))) hits.push(f.replace(/\.json$/, ""));
  }
  return hits;
}

async function runModel(
  model: string,
  args: Args,
): Promise<{ ok: boolean; limitHits: string[]; runDir: string | null }> {
  const before = listRawDirs();
  const cliArgs = [
    CLI,
    "--parallel",
    String(args.parallel),
    "--scenario",
    SUBSET.join(","),
    "--model",
    model,
    "--trials",
    String(args.trials),
  ];
  const bar = "─".repeat(60);
  console.log(`\n${bar}\n▶ ${model}  (judge=${JUDGE_MODEL}, trials=${args.trials})\n${bar}`);

  const proc = Bun.spawn(["bun", ...cliArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, ANTHROPIC_MODEL: JUDGE_MODEL },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;

  const runDir = newestRawDir(before);
  const limitHits = runDir ? scanForLimit(runDir) : [];
  return { ok: code === 0 && limitHits.length === 0, limitHits, runDir };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log(`Baseline subset (${SUBSET.length} scenarios):`);
    for (const s of SUBSET) console.log(`  ${s}`);
    console.log(`\nJudge model : ${JUDGE_MODEL}`);
    console.log(`Models      : ${args.models.join(", ")}`);
    return;
  }

  validateSubset();

  if (args.dryRun) {
    console.log(
      `\nDRY RUN — would run ${args.models.length} model(s) × ${SUBSET.length} scenarios × ${args.trials} trial(s); no quota spent.`,
    );
    console.log(`Models: ${args.models.join(", ")}`);
    return;
  }

  const done: string[] = [];
  for (const model of args.models) {
    const { ok, limitHits, runDir } = await runModel(model, args);

    if (limitHits.length) {
      const remaining = args.models.slice(args.models.indexOf(model) + 1);
      console.error(`\n⛔ ${model} hit the subscription session limit on ${limitHits.length} scenario(s):`);
      for (const h of limitHits) console.error(`   ${h}`);
      console.error(`Aborting before the remaining model(s) so the cap doesn't waste them.`);
      console.error(`Re-run after your window resets: ${remaining.length ? remaining.join(", ") : "(none)"}`);
      console.error(`Partial results: ${runDir ?? "(none written)"}`);
      process.exit(1);
    }
    if (!ok) {
      console.error(`\n⛔ ${model} run failed (non-zero exit). Aborting.`);
      process.exit(1);
    }

    done.push(model);
    console.log(`\n✅ ${model} complete → ${runDir}`);
  }

  const bar = "═".repeat(60);
  console.log(`\n${bar}`);
  console.log(`Baseline complete: ${done.join(", ")}`);
  console.log(`Review: cd web && bun run start  → http://localhost:3000`);
  console.log(bar);
}

main();
