/**
 * discovery.ts — Discover and filter scenarios with glob
 *
 * Matches Python implementation: sorts agent dirs, excludes 'results',
 * supports comma-separated agent names and qualified agent/scenario-id patterns.
 */

import path from "path";
import fs from "fs";
import type { DiscoveredScenario } from "./types.ts";

function fnmatch(basename: string, pattern: string): boolean {
  // Convert fnmatch glob pattern to JS regex
  // Support: *, ?, [seq], [!seq]
  let reStr = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") reStr += ".*";
    else if (ch === "?") reStr += ".";
    else if (ch === "[") {
      let j = i + 1;
      let negated = false;
      if (j < pattern.length && pattern[j] === "!") {
        negated = true;
        j++;
      }
      while (j < pattern.length && pattern[j] !== "]") j++;
      const inner = pattern.slice(i + 1, j).replace(/^!/, "");
      reStr += negated ? `[^${inner}]` : `[${inner}]`;
      i = j;
    } else {
      reStr += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  reStr += "$";
  return new RegExp(reStr).test(basename);
}

export interface DiscoveryResult {
  scenarios: DiscoveredScenario[];
  allScenariosTotal: number;
}

/**
 * Discover all scenarios in evalsDir, applying optional filters.
 *
 * @param evalsDir  - Path to the evals/ directory
 * @param agentFilter - Comma-separated agent names, or empty string for all
 * @param scenarioFilter - fnmatch pattern or comma-separated "agent/scenario-id" values
 */
export function discoverScenarios(
  evalsDir: string,
  agentFilter: string,
  scenarioFilter: string
): DiscoveryResult {
  const scenarios: DiscoveredScenario[] = [];
  let allScenariosTotal = 0;

  // Get sorted agent directories
  let entries: string[];
  try {
    entries = fs.readdirSync(evalsDir).sort();
  } catch {
    return { scenarios, allScenariosTotal };
  }

  const allowedAgents = agentFilter
    ? new Set(agentFilter.split(",").map((a) => a.trim()).filter(Boolean))
    : null;

  // Check if scenarioFilter contains comma or slash (qualified mode)
  const isQualifiedFilter =
    scenarioFilter && (scenarioFilter.includes(",") || scenarioFilter.includes("/"));
  const allowedQualified = isQualifiedFilter
    ? new Set(scenarioFilter.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  for (const entry of entries) {
    if (entry === "results" || entry.startsWith("README") || entry.startsWith(".")) continue;

    const agentDir = path.join(evalsDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(agentDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const agent = entry;

    // Count all scenario files before filtering
    const allFiles = fs.readdirSync(agentDir).filter(
      (f) => f.startsWith("scenario-") && f.endsWith(".md")
    );
    allScenariosTotal += allFiles.length;

    // Apply agent filter
    if (allowedAgents && !allowedAgents.has(agent)) continue;

    const scenarioFiles = allFiles.sort();

    for (const fname of scenarioFiles) {
      const scenarioFile = path.join(agentDir, fname);

      let fstat: fs.Stats;
      try {
        fstat = fs.statSync(scenarioFile);
      } catch {
        continue;
      }
      if (!fstat.isFile()) continue;

      const scenarioId = path.basename(fname, ".md");

      if (scenarioFilter) {
        if (isQualifiedFilter) {
          const qualified = `${agent}/${scenarioId}`;
          if (!allowedQualified!.has(qualified)) continue;
        } else {
          if (!fnmatch(scenarioId, scenarioFilter)) continue;
        }
      }

      scenarios.push({ scenarioFile, agent, scenarioId });
    }
  }

  return { scenarios, allScenariosTotal };
}
