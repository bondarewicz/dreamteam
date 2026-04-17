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

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const SITE_HTML = path.join(REPO_ROOT, "site", "index.html");

/** Agents that appear as cards on site/index.html (coachk has no Model field there). */
const AGENTS_ON_SITE = ["bird", "mj", "shaq", "kobe", "pippen", "magic"] as const;

const checkOnly = process.argv.includes("--check");

function readAgentModel(agent: string): string {
  const fp = path.join(AGENTS_DIR, `${agent}.md`);
  const content = fs.readFileSync(fp, "utf-8");
  const match = content.match(/^model:\s*(.+)$/m);
  if (!match) {
    throw new Error(`No 'model:' field found in ${fp}`);
  }
  return match[1].trim();
}

function rewriteModelForAgent(html: string, agent: string, model: string): { html: string; changed: boolean; current: string } {
  // Match the agent's <h3 class="codename">agent</h3> then the next <dt>Model</dt><dd>...</dd>.
  // Lazy match with [\s\S] so we can span multiple lines but stop at the FIRST dd after the h3.
  const re = new RegExp(
    `(<h3 class="codename">${agent}</h3>[\\s\\S]*?<dt>Model</dt><dd>)([^<]*)(</dd>)`,
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

  const changedCount = results.filter((r) => r.changed).length;

  console.log("Site model sync:");
  for (const r of results) {
    if (r.changed) {
      console.log(`  ~ ${r.agent.padEnd(8)} ${r.previous} -> ${r.model}`);
    } else {
      console.log(`  = ${r.agent.padEnd(8)} ${r.model}`);
    }
  }

  if (checkOnly) {
    if (changedCount > 0) {
      console.error(`\nsite/index.html is out of sync with agents/*.md (${changedCount} agent(s) differ).`);
      console.error("Run: bun scripts/build-site.ts");
      process.exit(1);
    }
    console.log("\nsite/index.html is in sync with agents/*.md.");
    return;
  }

  if (changedCount === 0) {
    console.log("\nsite/index.html already in sync. No changes written.");
    return;
  }

  fs.writeFileSync(SITE_HTML, html, "utf-8");
  console.log(`\nUpdated site/index.html (${changedCount} agent(s)).`);
}

main();
