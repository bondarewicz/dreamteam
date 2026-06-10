#!/usr/bin/env bun
/**
 * backfill-trace-model.ts
 *
 * Schema-path Bird runs stored `trace: []` (the runner discarded the claude
 * init event — see schema-runner regression). The dashboard's metadata block
 * (TraceViewer) reads model/version/session from the `type:"system"` trace
 * event, so those runs show "—" for every field.
 *
 * This backfills ONLY real, confirmed data: model + CLI version, which are
 * uniform per run. It writes a minimal init event:
 *     trace[0] = { type: "system", model, claude_code_version }
 * Missing fields (session, tools, mcp, permission mode, fast mode, denials)
 * are intentionally left absent — they were never logged for headless runs,
 * so the UI correctly shows "—". Nothing is fabricated.
 *
 * Only runs with a CONFIRMED model below are touched. Any other empty-trace run
 * is reported and skipped (left blank) rather than guessed.
 *
 * Usage:
 *   bun scripts/backfill-trace-model.ts          # dry run
 *   bun scripts/backfill-trace-model.ts --apply  # write
 */

import fs from "fs";
import path from "path";

const RAW_ROOT = path.resolve(import.meta.dir, "..", "evals", "results", "raw");
const APPLY = process.argv.includes("--apply");

// Confirmed, real models only. Source noted for auditability.
const RUN_META: Record<string, { model: string; version: string; source: string }> = {
  "2026-06-09-2159": { model: "claude-fable-5", version: "2.1.170", source: "shell history --model claude-fable-5 + 63 window log files" },
  "2026-06-10-bird-opus": { model: "claude-opus-4-8", version: "2.1.170", source: "explicit --model claude-opus-4-8 this session" },
};

function hasSystemTrace(trace: unknown): boolean {
  return Array.isArray(trace) && trace.some((e) => e && typeof e === "object" && (e as any).type === "system");
}

const runDirs = fs.existsSync(RAW_ROOT)
  ? fs.readdirSync(RAW_ROOT).filter((d) => fs.statSync(path.join(RAW_ROOT, d)).isDirectory())
  : [];

let patched = 0;
const skipped: string[] = [];

for (const run of runDirs.sort()) {
  const dir = path.join(RAW_ROOT, run);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith("bird-"));

  // count empty-trace bird files with real output
  const candidates = files.filter((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return (d.agent_output ?? "") !== "" && !hasSystemTrace(d.trace);
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) continue;

  const meta = RUN_META[run];
  if (!meta) {
    skipped.push(`${run}: ${candidates.length} empty-trace bird files — model NOT confirmed, left blank`);
    continue;
  }

  let n = 0;
  for (const f of candidates) {
    const p = path.join(dir, f);
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    d.trace = [{ type: "system", model: meta.model, claude_code_version: meta.version }];
    if (APPLY) fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf8");
    n++;
  }
  patched += n;
  console.log(`${run}: ${n} files -> model=${meta.model} version=${meta.version}  (${meta.source})`);
}

if (skipped.length) {
  console.log(`\nSKIPPED (model unconfirmed — left blank, no guessing):`);
  for (const s of skipped) console.log(`  ${s}`);
}
console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${patched} raw files backfilled.`);
if (!APPLY) console.log("Re-run with --apply, then re-migrate (bun web/src/migrate.ts).");
