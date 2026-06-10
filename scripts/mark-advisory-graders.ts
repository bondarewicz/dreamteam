#!/usr/bin/env bun
/**
 * mark-advisory-graders.ts
 *
 * One-off migration for the grader gating inversion. Under the new model every
 * grader hard-gates by default; soft/heuristic graders must opt out with
 * `advisory: true`. This walks every agent scenario's `graders:` block and adds
 * `advisory: true` to graders matching the soft-grader policy below.
 *
 * Policy — a grader is ADVISORY (non-gating) when it is:
 *   - a prose/format check (contains, not_contains, regex, field_count,
 *     length_bounds, section_present), OR
 *   - a confidence FLOOR (path matches /confidence/ and has `min`), OR
 *   - a supporting-evidence COUNT (json_field with min_items/max_items or bare
 *     min/max) that is NOT a verdict, schema, restraint, or must-escalate check.
 *
 * Stays GATING (left untouched):
 *   - json_valid (structural)
 *   - verdicts: `equals`, `one_of`
 *   - schema: `type_check`
 *   - restraint: `exists: false`, `max_items: 0`
 *   - confidence CEILINGS (path matches /confidence/ with `max` and no `min`)
 *   - must-escalate presence: path == "escalations" with min_items
 *
 * Usage:
 *   bun scripts/mark-advisory-graders.ts            # dry run (prints plan)
 *   bun scripts/mark-advisory-graders.ts --apply    # write changes
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..", "evals");
const AGENTS = ["bird", "coachk", "drexler", "kobe", "magic", "mj", "pippen", "shaq"];
const APPLY = process.argv.includes("--apply");

const PROSE = new Set([
  "contains",
  "not_contains",
  "regex",
  "field_count",
  "length_bounds",
  "section_present",
]);

type Grader = Record<string, string | number | boolean>;

/** Parse the config lines of a single grader entry into a loose key→value map. */
function parseEntry(configLines: string[], type: string): Grader {
  const g: Grader = { type };
  for (const line of configLines) {
    const m = /^\s*([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw === "") {
      g[key] = "";
    } else if (raw === "true" || raw === "false") {
      g[key] = raw === "true";
    } else if (/^-?\d+$/.test(raw)) {
      g[key] = parseInt(raw, 10);
    } else {
      // strip surrounding quotes; we only test presence/path text
      g[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return g;
}

// Which tiers to actually mark advisory (set via --tiers=...). Default: the
// engineering-safe set (confidence floors + prose) that avoids false-fails on
// correct output while keeping presence/verdict/restraint gates intact.
const TIERS = new Set(
  (process.argv.find((a) => a.startsWith("--tiers="))?.split("=")[1] ?? "confidence_floor,prose")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

/** Returns the advisory CATEGORY for a grader, or null if it should gate. */
function category(g: Grader): string | null {
  const t = String(g.type);
  if (PROSE.has(t)) return "prose";
  if (t !== "json_field") return null; // json_valid & friends gate

  if ("equals" in g || "one_of" in g) return null; // verdict
  if ("type_check" in g) return null; // schema
  if (g.exists === false) return null; // restraint
  if (g.max_items === 0) return null; // restraint (must produce none)

  const p = String(g.path ?? "");
  if (/confidence/i.test(p)) {
    return "min" in g ? "confidence_floor" : null; // ceiling (max only) → gating
  }
  if (p === "escalations" && "min_items" in g) return null; // must-escalate presence

  // remaining supporting-evidence counts / bare numeric bounds
  if ("min_items" in g || "max_items" in g || "min" in g || "max" in g) {
    return "supporting_count";
  }
  return null;
}

function isAdvisory(g: Grader): boolean {
  const c = category(g);
  return c !== null && TIERS.has(c);
}

const census: Record<string, number> = {
  prose: 0,
  confidence_floor: 0,
  supporting_count: 0,
};

function processFile(file: string): { changed: boolean; marks: string[] } {
  const src = fs.readFileSync(file, "utf-8");
  const lines = src.split("\n");

  const start = lines.findIndex((l) => /^graders:\s*$/.test(l));
  if (start === -1) return { changed: false, marks: [] };

  // Find block end: first non-indented line that starts a new top-level field.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l && !/^\s/.test(l) && /^[A-Za-z_][\w]*:/.test(l)) {
      end = i;
      break;
    }
  }

  const out: string[] = lines.slice(0, start + 1);
  const marks: string[] = [];

  // Walk grader entries within [start+1, end)
  let i = start + 1;
  while (i < end) {
    const line = lines[i];
    const typeMatch = /^\s*-\s*type:\s*(\S+)/.exec(line);
    if (!typeMatch) {
      out.push(line);
      i++;
      continue;
    }
    const type = typeMatch[1];
    // collect this entry's config lines (until next "- type:" or block end)
    const entry: string[] = [line];
    let j = i + 1;
    while (j < end && !/^\s*-\s*type:/.test(lines[j])) {
      entry.push(lines[j]);
      j++;
    }
    const g = parseEntry(entry.slice(1), type);
    const cat = category(g);
    if (cat) census[cat] = (census[cat] ?? 0) + 1;
    const already = entry.some((l) => /^\s*advisory:/.test(l));
    if (isAdvisory(g) && !already) {
      // insert "    advisory: true" after the last non-empty config line
      let lastContent = entry.length - 1;
      while (lastContent > 0 && entry[lastContent].trim() === "") lastContent--;
      const insertAt = lastContent + 1;
      entry.splice(insertAt, 0, "    advisory: true");
      marks.push(`${type} ${g.path ?? ""}`.trim());
    }
    out.push(...entry);
    i = j;
  }

  out.push(...lines.slice(end));
  const result = out.join("\n");
  const changed = result !== src;
  if (changed && APPLY) fs.writeFileSync(file, result, "utf-8");
  return { changed, marks };
}

let totalMarks = 0;
let totalFiles = 0;
for (const agent of AGENTS) {
  const dir = path.join(ROOT, agent);
  if (!fs.existsSync(dir)) continue;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^scenario-.*\.md$/.test(f))
    .sort();
  const agentMarks: string[] = [];
  for (const f of files) {
    const { changed, marks } = processFile(path.join(dir, f));
    if (marks.length > 0) {
      agentMarks.push(`  ${f}: ${marks.join(" | ")}`);
      totalMarks += marks.length;
      if (changed) totalFiles++;
    }
  }
  if (agentMarks.length > 0) {
    console.log(`\n### ${agent} (${agentMarks.length} scenarios)`);
    console.log(agentMarks.join("\n"));
  }
}

console.log(`\n--- CENSUS (all advisory-eligible graders, by tier) ---`);
for (const [k, v] of Object.entries(census)) console.log(`  ${k}: ${v}`);
console.log(`  selected tiers: ${[...TIERS].join(", ") || "(none)"}`);

console.log(
  `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${totalMarks} graders marked advisory across ${totalFiles} files.`
);
if (!APPLY) console.log("Re-run with --apply to write changes. Adjust scope with --tiers=confidence_floor,prose,supporting_count");
