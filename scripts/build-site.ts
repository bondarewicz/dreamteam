#!/usr/bin/env bun
/**
 * build-site.ts — sync site/index.html model labels with agent frontmatter.
 *
 * Reads the `model:` field from each agents/<name>.md and rewrites the
 * <dt>Model</dt><dd>...</dd> line that follows the matching <h3 class="codename">name</h3>
 * in site/index.html. Idempotent and safe to run repeatedly.
 *
 * Run locally:   bun scripts/build-site.ts
 * Run in CI:     same — invoked from .github/workflows/deploy-site.yml before deploy
 *
 * Flags:
 *   --check   Exit non-zero if the site is out of sync (CI verification / pre-commit).
 */
import path from "path";
import fs from "fs";
import { readModelSpec } from "./frontmatter.ts";
import { resolveModel } from "./model-tiers.ts";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const SITE_HTML = path.join(REPO_ROOT, "site", "index.html");

/** Agents that appear as cards on site/index.html (coachk has no Model field there). */
const AGENTS_ON_SITE = ["bird", "mj", "shaq", "kobe", "pippen", "magic"] as const;

const checkOnly = process.argv.includes("--check");

/** Compute live counts from the filesystem — never hand-write marketing numbers (ECC anti-pattern). */
function computeCounts(): Record<string, number> {
  const roster = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md") && f !== "coachk.md").length;
  const commands = fs.existsSync(path.join(REPO_ROOT, "commands"))
    ? fs.readdirSync(path.join(REPO_ROOT, "commands")).filter((f) => f.endsWith(".md")).length : 0;
  let scenarios = 0;
  const evalsDir = path.join(REPO_ROOT, "evals");
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".archive" || e.name === "node_modules") continue;
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (/^scenario-.*\.md$/.test(e.name)) scenarios++;
    }
  };
  if (fs.existsSync(evalsDir)) walk(evalsDir);
  return { agents: roster, commands, scenarios, providers: 4 };
}

/** Replace the text inside every <span data-count="KEY">…</span> with the live count. */
function rewriteCounts(html: string): { html: string; changes: string[] } {
  const counts = computeCounts();
  const changes: string[] = [];
  for (const [key, n] of Object.entries(counts)) {
    const re = new RegExp(`(<span data-count="${key}"[^>]*>)([^<]*)(</span>)`, "g");
    html = html.replace(re, (_m, open, cur, close) => {
      if (cur.trim() !== String(n)) changes.push(`${key}: ${cur.trim() || "∅"} -> ${n}`);
      return `${open}${n}${close}`;
    });
  }
  return { html, changes };
}

function readAgentModel(agent: string): string {
  const fp = path.join(AGENTS_DIR, `${agent}.md`);
  const content = fs.readFileSync(fp, "utf-8");
  // Site displays the Claude model the agent runs interactively (resolve tier/pins).
  return resolveModel(readModelSpec(content), "claude");
}

function rewriteModelForAgent(html: string, agent: string, model: string): { html: string; changed: boolean; current: string } {
  // Match the agent's <h3 class="codename">agent</h3> then the next <dt>Model</dt> ... <dd>...</dd>.
  // Lazy match with [\s\S] so we can span multiple lines but stop at the FIRST dd after the h3.
  // `\s*` between </dt> and <dd> handles both inline and multi-line formatting.
  const re = new RegExp(
    `(<h3 class="codename">${agent}</h3>[\\s\\S]*?<dt>Model</dt>\\s*<dd>)([^<]*)(</dd>)`,
    "m",
  );
  const match = html.match(re);
  if (!match) {
    throw new Error(`Could not find <dt>Model</dt><dd>...</dd> block for agent '${agent}' in site/index.html`);
  }
  const current = match[2];
  if (current === model) {
    return { html, changed: false, current };
  }
  return { html: html.replace(re, `$1${model}$3`), changed: true, current };
}

function main() {
  let html = fs.readFileSync(SITE_HTML, "utf-8");
  const results: Array<{ agent: string; model: string; previous: string; changed: boolean }> = [];

  for (const agent of AGENTS_ON_SITE) {
    const model = readAgentModel(agent);
    const { html: next, changed, current } = rewriteModelForAgent(html, agent, model);
    html = next;
    results.push({ agent, model, previous: current, changed });
  }

  const { html: htmlWithCounts, changes: countChanges } = rewriteCounts(html);
  html = htmlWithCounts;

  const changedCount = results.filter((r) => r.changed).length + countChanges.length;

  console.log("Site model sync:");
  for (const r of results) console.log(`  ${r.changed ? "~" : "="} ${r.agent.padEnd(8)} ${r.changed ? `${r.previous} -> ${r.model}` : r.model}`);
  console.log("Site count sync:");
  for (const c of countChanges) console.log(`  ~ ${c}`);
  if (!countChanges.length) console.log("  = counts up to date");

  if (checkOnly) {
    if (changedCount > 0) {
      console.error(`\nsite/index.html is out of sync (${changedCount} item(s) differ).`);
      console.error("Run: bun scripts/build-site.ts");
      process.exit(1);
    }
    console.log("\nsite/index.html is in sync with agents/*.md + filesystem counts.");
    return;
  }

  if (changedCount === 0) {
    console.log("\nsite/index.html already in sync. No changes written.");
    return;
  }

  fs.writeFileSync(SITE_HTML, html, "utf-8");
  console.log(`\nUpdated site/index.html (${changedCount} item(s)).`);
}

main();
