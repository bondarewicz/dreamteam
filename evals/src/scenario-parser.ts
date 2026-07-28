/**
 * scenario-parser.ts — Parse scenario .md files (pure, no I/O)
 *
 * Scenario files are YAML-like markdown with top-level fields.
 * Fields may be multiline (block scalar with | or bare newlines).
 */

import type { GraderDef, ScenarioMeta, ScenarioFields } from "./types.ts";

/**
 * Extract a top-level YAML-like multiline field from scenario content.
 * Stops at the next top-level field (no leading whitespace + identifier).
 */
export function extractField(name: string, content: string): string {
  // Terminate at the next TOP-LEVEL key (column 0) or the absolute end of input.
  //
  // `$` must NOT be used as the end-of-input alternative here: with the `m` flag it
  // matches at every line ending, so the lazy `[\s\S]*?` stops at the end of the
  // FIRST line and every multi-line field silently collapses to one line. Use
  // `(?![\s\S])` — a true end-of-input assertion, unaffected by `m`.
  //
  // The header is matched with `[ \t]*` (not `\s*`), since `\s` includes newlines
  // and would let the header swallow the first content line.
  const re = new RegExp(
    "^" + escapeRegex(name) + ":[ \\t]*\\|?[ \\t]*\\n([\\s\\S]*?)(?=\\n[a-zA-Z_][a-zA-Z0-9_]*:|(?![\\s\\S]))",
    "m"
  );
  const match = re.exec(content);
  return match ? match[1].trimEnd() : "";
}

/**
 * Extract the prompt field, stopping at known next fields.
 */
export function extractPrompt(content: string): string {
  const re = /^prompt:\s*\|?\s*\n([\s\S]*?)(?=\n(?:expected_behavior|failure_modes|scoring_rubric|graders|category|reference_output):)/m;
  const match = re.exec(content);
  return match ? match[1].trim() : "";
}

/**
 * Parse (scenario_name, scenario_type, category) from scenario content.
 * Title format: # Eval: Agent — Name (Type)
 */
export function parseScenarioMeta(content: string): { scenarioName: string; scenarioType: string; category: string } {
  const titleRe = /^#\s+Eval:.*?—\s+(.+?)(?:\s+\((.+?)\))?\s*$/m;
  const titleMatch = titleRe.exec(content);

  let scenarioName = "";
  let scenarioType = "happy-path";

  if (titleMatch) {
    scenarioName = titleMatch[1].trim();
    if (titleMatch[2]) {
      const rawType = titleMatch[2].trim().toLowerCase();
      if (rawType.includes("edge")) {
        scenarioType = "edge-case";
      } else if (rawType.includes("adversarial") || rawType.includes("attack")) {
        scenarioType = "adversarial";
      } else if (rawType.includes("regression")) {
        scenarioType = "regression";
      } else {
        scenarioType = rawType;
      }
    }
  }

  const catMatch = /^category:\s*(\S+)/m.exec(content);
  const category = catMatch ? catMatch[1].trim() : "";

  return { scenarioName, scenarioType, category };
}

/**
 * Parse the graders: block from a scenario file.
 * Only matches top-level 'graders:' line (no leading whitespace).
 * Returns null if no graders field.
 */
export function extractGraders(content: string): GraderDef[] | null {
  const lines = content.split("\n");

  // Find the graders: line — no leading whitespace (per Python behavior)
  let gradersStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^graders:\s*$/.test(lines[i])) {
      gradersStart = i;
      break;
    }
  }

  if (gradersStart === -1) return null;

  const topLevelField = /^[a-zA-Z_][a-zA-Z0-9_]*:\s/;

  // Collect grader block lines until next top-level field
  const graderLines: string[] = [];
  for (let i = gradersStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && !line.startsWith(" ") && !line.startsWith("\t")) {
      if (topLevelField.test(line) || line.trim().endsWith(":")) {
        break;
      }
    }
    graderLines.push(line);
  }

  // Parse individual graders from the collected block
  const graders: GraderDef[] = [];
  let current: Record<string, unknown> | null = null;

  function flush(g: Record<string, unknown> | null) {
    if (g) graders.push(g as unknown as GraderDef);
  }

  for (const line of graderLines) {
    const stripped = line.trim();
    if (!stripped) continue;

    // New grader entry starts with "- type:"
    const typeMatch = /^-\s+type:\s+(.+)$/.exec(stripped);
    if (typeMatch) {
      flush(current);
      current = { type: typeMatch[1].trim() };
      continue;
    }

    if (current === null) continue;

    // Key: value pairs inside a grader entry
    const kv = /^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(stripped);
    if (!kv) continue;

    const key = kv[1];
    const valRaw = kv[2].trim();

    let val: unknown;

    if (valRaw.startsWith("[")) {
      try {
        val = JSON.parse(valRaw);
      } catch {
        // Try to parse as list of quoted strings
        const items = [...valRaw.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
        val = items.length > 0 ? items : [valRaw];
      }
    } else if (valRaw.startsWith('"') && valRaw.endsWith('"')) {
      // Unescape: scenario files store regex patterns with \\s meaning \s
      val = valRaw.slice(1, -1).replace(/\\\\/g, "\\");
    } else {
      // Try int, float, boolean, then string
      const asInt = parseInt(valRaw, 10);
      if (!isNaN(asInt) && String(asInt) === valRaw) {
        val = asInt;
      } else {
        const asFloat = parseFloat(valRaw);
        if (!isNaN(asFloat) && String(asFloat) === valRaw) {
          val = asFloat;
        } else if (valRaw.toLowerCase() === "true") {
          val = true;
        } else if (valRaw.toLowerCase() === "false") {
          val = false;
        } else {
          val = valRaw;
        }
      }
    }

    current[key] = val;
  }

  flush(current);
  return graders;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
