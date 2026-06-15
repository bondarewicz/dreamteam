#!/usr/bin/env bun
/**
 * select-baseline.ts — rank scenarios by *measured discrimination* to maintain
 * the baseline-eval subset from evidence instead of filename guesses.
 *
 * For every scenario it computes the Shannon entropy of its pass/partial/fail
 * outcomes across all scored runs in evals/results/:
 *   H = 0   → every run got the same verdict (always-pass or always-fail).
 *             Unanimous = separates no models = wasted baseline quota.
 *   H high  → verdicts are mixed → the scenario splits strong from weak output.
 * The score is H × sample-size confidence, so a 1-of-2 fluke can't outrank a
 * well-sampled mixed scenario. Drexler is dropped wholesale because every one of
 * its scenarios is a regression guardrail that all models pass (H≈0).
 *
 * Use it after each baseline run to refresh scripts/baseline-eval.ts → SUBSET:
 *   bun scripts/select-baseline.ts                 # full report
 *   bun scripts/select-baseline.ts --emit-subset   # comma-joined ids for SUBSET
 *   bun scripts/select-baseline.ts --top 2         # N picks per agent (default 1)
 *   bun scripts/select-baseline.ts --min-n 5       # require >=N samples (default 4)
 */

import fs from "fs";
import path from "path";

const REPO_ROOT = path.join(import.meta.dir, "..");
const RESULTS_DIR = path.join(REPO_ROOT, "evals", "results");

/** Agents with no discriminating scenario — excluded from the baseline regardless. */
const EXCLUDE_AGENTS = new Set(["drexler", "team"]);

interface Args {
  top: number;
  minN: number;
  emitSubset: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { top: 1, minN: 4, emitSubset: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--top":
        a.top = Math.max(1, parseInt(argv[++i] ?? "1", 10));
        break;
      case "--min-n":
        a.minN = Math.max(1, parseInt(argv[++i] ?? "4", 10));
        break;
      case "--emit-subset":
        a.emitSubset = true;
        break;
      case "-h":
      case "--help":
        console.log(
          `select-baseline.ts — rank scenarios by measured discrimination\n\n` +
            `  --top <N>        picks per agent (default 1)\n` +
            `  --min-n <N>      require >=N samples to be eligible (default 4)\n` +
            `  --emit-subset    print only the comma-joined ids (paste into SUBSET)\n`,
        );
        process.exit(0);
      default:
        console.error(`Unknown arg: ${argv[i]}`);
        process.exit(2);
    }
  }
  return a;
}

/** Shannon entropy over outcome classes — 0 when unanimous, higher when mixed. */
function entropy(scores: string[]): number {
  const counts: Record<string, number> = {};
  for (const s of scores) counts[s] = (counts[s] ?? 0) + 1;
  const n = scores.length;
  let h = 0;
  for (const k in counts) {
    const p = counts[k] / n;
    h -= p * Math.log2(p);
  }
  return h;
}

interface Row {
  key: string;
  agent: string;
  n: number;
  pass: number;
  h: number;
  score: number;
}

function loadRows(): Row[] {
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f));
  const byScn = new Map<string, string[]>();
  for (const f of files) {
    let j: any;
    try {
      j = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(j.results)) continue;
    for (const r of j.results) {
      if (!r?.scenario_id || !r?.agent) continue;
      const key = `${r.agent}/${r.scenario_id}`;
      if (!byScn.has(key)) byScn.set(key, []);
      byScn.get(key)!.push(String(r.score ?? "?").toLowerCase());
    }
  }
  const rows: Row[] = [];
  for (const [key, scores] of byScn) {
    const agent = key.split("/")[0];
    const h = entropy(scores);
    const conf = Math.min(scores.length, 8) / 8;
    rows.push({
      key,
      agent,
      n: scores.length,
      pass: scores.filter((s) => s === "pass").length,
      h,
      score: h * conf,
    });
  }
  return rows;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows();
  const agents = [...new Set(rows.map((r) => r.agent))]
    .filter((a) => !EXCLUDE_AGENTS.has(a))
    .sort();

  // Top picks per agent that clear the sample-size bar and actually discriminate.
  const picks: Row[] = [];
  for (const a of agents) {
    const eligible = rows
      .filter((r) => r.agent === a && r.n >= args.minN && r.h > 0)
      .sort((x, y) => y.score - x.score);
    picks.push(...eligible.slice(0, args.top));
  }
  picks.sort((x, y) => y.score - x.score);

  if (args.emitSubset) {
    console.log(picks.map((p) => p.key).join(","));
    return;
  }

  console.log(`Scored runs analysed from ${RESULTS_DIR}\n`);

  console.log("=== Recommended baseline (top discriminator per agent) ===");
  for (const p of picks) {
    console.log(`  H=${p.h.toFixed(2)} score=${p.score.toFixed(2)}  ${p.pass}/${p.n} pass   ${p.key}`);
  }

  console.log("\n=== Always-green — drop from any baseline (n>=3, 100% pass, H=0) ===");
  rows
    .filter((r) => r.n >= 3 && r.h === 0 && r.pass === r.n)
    .sort((x, y) => y.n - x.n)
    .forEach((r) => console.log(`  ${r.pass}/${r.n} pass   ${r.key}`));

  console.log(`\nExcluded agents (no discriminating scenario): ${[...EXCLUDE_AGENTS].join(", ")}`);
  console.log(`Re-emit the subset for baseline-eval.ts: bun scripts/select-baseline.ts --emit-subset`);
}

main();
