#!/usr/bin/env bun
/**
 * export-site-evals.ts — static eval scoreboard for GH Pages (Phase 5 / Tier 1.1).
 *
 * The web dashboard is a dynamic Bun+SQLite app; GH Pages is static-only. This
 * renders the dashboard run-list (real scores, per-run model) to a SELF-CONTAINED
 * static page at site/evals/index.html — theme CSS inlined, timestamps converted
 * to local time client-side, run rows non-navigating (it's a read-only snapshot).
 * The point: public, clickable proof that every agent is graded across providers —
 * the thing a pile-of-prompts competitor structurally cannot show.
 *
 * Regenerate after a fresh eval baseline:  bun scripts/export-site-evals.ts
 * (CI runs it in deploy-site.yml before publishing site/.)
 */
import fs from "fs";
import path from "path";
import { getAllRuns, getAgentsForAllRuns, getGlobalStats } from "../web/src/db.ts";
import { DashboardPage } from "../web/src/views/Dashboard.ts";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(REPO, "site", "evals");
const THEME = fs.readFileSync(path.join(REPO, "web", "static", "theme.css"), "utf-8");
const PKG_URL = "https://www.npmjs.com/package/@bondarewicz/dreamteam";

const runs = getAllRuns();
const stats = getGlobalStats();
const agentsPerRun = getAgentsForAllRuns();

// Render the live dashboard body, then make it static-safe: run rows don't navigate.
let body = DashboardPage(runs, agentsPerRun, stats);
body = body.replace(/href="\/evals\/[^"]*"/g, 'href="#" onclick="return false" title="Run `dreamteam web` for the interactive report"');

const banner = `
  <div style="margin:0 0 18px;padding:12px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2,var(--surface-3));font-size:13px;color:var(--text-dim)">
    <strong>Live eval scoreboard</strong> — real scores from the Dream Team eval harness, every agent graded by a pinned Coach K judge.
    Each run shows the provider/model it ran on. This is a read-only snapshot; for filters, traces and per-run drill-down run
    <code>dreamteam web</code> locally. <a href="${PKG_URL}" style="color:var(--accent)">Get it on npm →</a>
  </div>`;

const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dream Team — Eval Scoreboard</title>
<meta name="description" content="Public eval scoreboard: every Dream Team agent graded across Claude, Codex and Ollama by a pinned LLM judge. Real scores, not vibes.">
<style>${THEME}</style>
</head><body>
<nav><a href="../">← Dream Team</a><a href="#" style="color:var(--text)">Eval Scoreboard</a><a href="${PKG_URL}" target="_blank" rel="noopener">npm</a></nav>
<div class="container">${banner}${body}</div>
<script>
(function(){
  function pad(n){return String(n).padStart(2,"0");}
  function fmt(d){var s=d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes());var p=d.toLocaleTimeString(undefined,{timeZoneName:"short"}).split(" ");return p.length>1?s+" "+p[p.length-1]:s;}
  document.querySelectorAll("time.local-dt[datetime]").forEach(function(el){var d=new Date(el.getAttribute("datetime"));if(!isNaN(d.getTime())){if(!el.title)el.title=el.textContent.trim();el.textContent=fmt(d);}});
})();
</script>
</body></html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf-8");
console.log(`Wrote site/evals/index.html — ${runs.length} runs, ${(html.length / 1024).toFixed(0)} KB (theme inlined).`);
