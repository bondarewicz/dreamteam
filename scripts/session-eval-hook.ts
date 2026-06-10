#!/usr/bin/env bun
/**
 * session-eval-hook.ts — SessionEnd hook: auto-run the Coach K session judge
 * when a Claude Code session ends, so future sessions show up already scored in
 * the web Sessions view (web/src/views/Sessions.ts → Evaluation tab).
 *
 * Installed by scripts/install.ts (symlinked into ~/.claude/scripts/) and wired
 * via scripts/hooks.json → settings.json SessionEnd.
 *
 * Non-blocking: the entry path reads the hook JSON, applies cheap guards, then
 * spawns a DETACHED worker (this same file with --worker) so the ~40s judge call
 * never delays session exit. The worker reuses web/ judge code + the web SQLite
 * DB (single source of truth — no logic duplicated here).
 *
 * Cost guards (auto-skips): excluded projects (dreamteam-evals), headless/
 * synthetic sessions, sessions below DREAMTEAM_EVAL_MIN_TOOLS (default 4) tool
 * calls, and sessions already scored under the current judge prompt version.
 * Disable entirely with DREAMTEAM_AUTO_EVAL=0.
 */
import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const LOG = path.join(HOME, ".claude", "dreamteam-auto-eval.log");
const EXCLUDED = new Set(["-Users-lb-Github-Bondarewicz-dreamteam-evals"]);

function log(msg: string) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* best effort */ }
}

function repoRoot(): string {
  // Preferred: the marker install.ts writes. Fallback: realpath of this file.
  try {
    const r = fs.readFileSync(path.join(HOME, ".claude", "dreamteam", "repo-root"), "utf8").trim();
    if (r && fs.existsSync(r)) return r;
  } catch { /* fall through */ }
  return path.resolve(path.dirname(fs.realpathSync(import.meta.path)), "..");
}

async function loadWeb() {
  const src = path.join(repoRoot(), "web", "src");
  const [source, judge, db] = await Promise.all([
    import(path.join(src, "sessions-source.ts")),
    import(path.join(src, "session-judge.ts")),
    import(path.join(src, "sessions-db.ts")),
  ]);
  return { ...source, ...judge, ...db } as any;
}

function projIdFromTranscript(tp: string): { project: string; id: string } {
  return { project: path.basename(path.dirname(tp)), id: path.basename(tp, ".jsonl") };
}

async function runWorker(project: string, id: string) {
  const w = await loadWeb();
  if (EXCLUDED.has(project)) return log(`skip ${id}: excluded project`);
  const detail = w.loadSession(project, id);
  if (!detail) return log(`skip ${id}: not loadable`);
  if (detail.headless) return log(`skip ${id}: headless/synthetic`);
  const minTools = parseInt(process.env.DREAMTEAM_EVAL_MIN_TOOLS ?? "4", 10);
  if (detail.toolCalls < minTools) return log(`skip ${id}: ${detail.toolCalls} tools < ${minTools}`);
  const existing = w.getLatestSessionEval(project, id);
  if (existing && existing.prompt_version === w.judgePromptVersion() && !existing.error) {
    return log(`skip ${id}: already scored (${existing.aggregate_verdict})`);
  }
  log(`scoring ${id} (${detail.toolCalls} tools, "${detail.title.slice(0, 50)}")…`);
  const result = await w.runSessionJudge(detail, { now: new Date().toISOString() });
  w.saveSessionEval(project, id, result);
  log(`scored ${id}: ${result.score.aggregateVerdict} ${result.score.aggregate}/5${result.error ? ` ERR:${result.error}` : ""}`);
}

const args = process.argv.slice(2);

if (args[0] === "--worker") {
  // slow path (detached): do the judging
  await runWorker(args[1], args[2]).catch(e => log(`worker error: ${e}`));
  process.exit(0);
}

// entry path (runs inside SessionEnd hook) — keep it FAST + non-blocking
if (process.env.DREAMTEAM_AUTO_EVAL === "0") process.exit(0);

let raw = "";
try { raw = await Bun.stdin.text(); } catch { /* no stdin */ }
let hook: Record<string, any> = {};
try { hook = JSON.parse(raw || "{}"); } catch { /* not JSON */ }

const tp = hook.transcript_path as string | undefined;
if (!tp) process.exit(0);
const { project, id } = projIdFromTranscript(tp);
if (!project || !id || EXCLUDED.has(project)) process.exit(0);

// Detach the judge so session exit returns immediately.
const child = Bun.spawn(["bun", import.meta.path, "--worker", project, id], {
  stdin: "ignore", stdout: "ignore", stderr: "ignore",
});
(child as any).unref?.();
log(`queued ${id}`);
process.exit(0);
