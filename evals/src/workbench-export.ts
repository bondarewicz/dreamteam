/**
 * workbench-export.ts — CSV export logic for Anthropic Workbench import
 *
 * Exports scenario prompts (and optionally rubrics) to CSV.
 * Output: evals/{agent}/workbench-import.csv
 */

import path from "path";
import fs from "fs";
import { extractPrompt, extractField } from "./scenario-parser.ts";

/**
 * Escape a CSV field value (RFC 4180).
 */
function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * De-indent a multiline block: remove the common leading whitespace.
 */
function deindent(text: string): string {
  const lines = text.split("\n");
  // Strip trailing blank lines
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return text.trim();
  const minIndent = Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length));
  return lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l)).join("\n").trim();
}

/**
 * Export all scenarios for an agent to CSV.
 */
export function exportAgentToWorkbench(
  evalsDir: string,
  agent: string,
  withRubric: boolean
): string {
  const agentDir = path.join(evalsDir, agent);

  if (!fs.existsSync(agentDir)) {
    throw new Error(`Agent directory not found: ${agentDir}`);
  }

  const outFile = path.join(agentDir, "workbench-import.csv");
  const scenarioFiles = fs
    .readdirSync(agentDir)
    .filter((f) => f.startsWith("scenario-") && f.endsWith(".md"))
    .sort();

  const rows: string[][] = [];
  const headers = withRubric ? ["scenario_input", "scoring_rubric"] : ["scenario_input"];
  rows.push(headers);

  let skipped = 0;

  for (const fname of scenarioFiles) {
    const fpath = path.join(agentDir, fname);
    const content = fs.readFileSync(fpath, "utf-8");
    const prompt = extractPrompt(content);

    if (!prompt) {
      console.warn(`WARN: no extractable prompt in ${fname} -- skipping row`);
      skipped++;
      continue;
    }

    const deindentedPrompt = deindent(prompt);

    if (withRubric) {
      const rubric = extractField("scoring_rubric", content);
      if (!rubric) {
        console.warn(`WARN: no extractable scoring_rubric in ${fname} -- leaving column empty`);
      }
      rows.push([deindentedPrompt, rubric ? deindent(rubric) : ""]);
    } else {
      rows.push([deindentedPrompt]);
    }
  }

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
  fs.writeFileSync(outFile, csv, "utf-8");

  console.log(`Exported ${rows.length - 1} scenarios for ${agent} to: ${outFile}`);
  if (skipped > 0) console.log(`  (${skipped} skipped — no extractable prompt)`);

  return outFile;
}

/**
 * Export all agents to separate CSV files.
 */
export function exportAllAgentsToWorkbench(evalsDir: string, withRubric: boolean): void {
  const entries = fs.readdirSync(evalsDir).sort();

  for (const entry of entries) {
    if (entry === "results" || entry.startsWith("README") || entry.startsWith(".")) continue;
    const agentDir = path.join(evalsDir, entry);
    if (!fs.statSync(agentDir).isDirectory()) continue;

    try {
      exportAgentToWorkbench(evalsDir, entry, withRubric);
    } catch (e) {
      console.error(`ERROR exporting ${entry}: ${e}`);
    }
  }
}

/**
 * CLI entry point.
 *
 * Usage:
 *   bun evals/src/workbench-export.ts <agent>           Export a single agent
 *   bun evals/src/workbench-export.ts --all             Export all agents
 *   bun evals/src/workbench-export.ts <agent> --with-rubric
 *   bun evals/src/workbench-export.ts --all --with-rubric
 */
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const withRubric = argv.includes("--with-rubric");
  const exportAll = argv.includes("--all");
  const agentArg = argv.find((a) => !a.startsWith("--"));

  // evalsDir is two levels up from this file: evals/src/workbench-export.ts -> evals/
  const evalsDir = path.join(import.meta.dir, "..");

  if (exportAll) {
    exportAllAgentsToWorkbench(evalsDir, withRubric);
  } else if (agentArg) {
    try {
      exportAgentToWorkbench(evalsDir, agentArg, withRubric);
    } catch (e) {
      console.error(`Error: ${e}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: bun evals/src/workbench-export.ts <agent> [--with-rubric]");
    console.error("       bun evals/src/workbench-export.ts --all [--with-rubric]");
    process.exit(1);
  }
}
