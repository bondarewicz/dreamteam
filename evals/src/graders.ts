/**
 * graders.ts — All 8 grader types with registry pattern (pure, no I/O)
 *
 * Grader types: json_valid, contains, not_contains, regex, section_present,
 *               field_count, length_bounds, json_field (with [*] wildcard)
 */

import type { GraderDef, GraderResult } from "./types.ts";
import { extractJson, hasJson } from "./json-extract.ts";

type GraderFn = (grader: GraderDef, output: string) => { passed: boolean; detail: string };

// ── Normalization helper ──────────────────────────────────────────────────────

/** Normalize text for case-insensitive contains/not_contains/section_present checks.
 * Matches Python: re.sub(r'[-_\s]+', ' ', text.lower())
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_\s]+/g, " ");
}

// ── Individual grader implementations ────────────────────────────────────────

function graderJsonValid(_grader: GraderDef, output: string): { passed: boolean; detail: string } {
  if (hasJson(output)) {
    return { passed: true, detail: "passed" };
  }
  return { passed: false, detail: "no valid JSON found in output" };
}

function graderContains(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  let values = grader.values ?? [];
  if (typeof values === "string") values = [values];
  const caseSensitive = grader.case_sensitive ?? false;

  let missing: string[];
  if (caseSensitive) {
    missing = values.filter((v) => !output.includes(v));
  } else {
    const normOut = normalize(output);
    missing = values.filter((v) => !normOut.includes(normalize(v)));
  }

  if (missing.length > 0) {
    return { passed: false, detail: `missing values: ${missing.join(", ")}` };
  }
  return { passed: true, detail: "passed" };
}

function graderNotContains(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  let values = grader.values ?? [];
  if (typeof values === "string") values = [values];
  const caseSensitive = grader.case_sensitive ?? false;

  let found: string[];
  if (caseSensitive) {
    found = values.filter((v) => output.includes(v));
  } else {
    const normOut = normalize(output);
    found = values.filter((v) => normOut.includes(normalize(v)));
  }

  if (found.length > 0) {
    return { passed: false, detail: `forbidden values found: ${found.join(", ")}` };
  }
  return { passed: true, detail: "passed" };
}

function graderRegex(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  const pattern = grader.pattern ?? "";
  try {
    const re = new RegExp(pattern);
    if (re.test(output)) {
      return { passed: true, detail: "passed" };
    }
    return { passed: false, detail: `pattern not found: ${pattern}` };
  } catch (e) {
    return { passed: false, detail: `invalid regex pattern "${pattern}": ${e}` };
  }
}

function graderSectionPresent(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  let sections = grader.sections ?? [];
  if (typeof sections === "string") sections = [sections];
  const caseSensitive = grader.case_sensitive ?? false;

  let missing: string[];
  if (caseSensitive) {
    missing = sections.filter((s) => !output.includes(s));
  } else {
    const normOut = normalize(output);
    missing = sections.filter((s) => !normOut.includes(normalize(s)));
  }

  if (missing.length > 0) {
    return { passed: false, detail: `missing sections: ${missing.join(", ")}` };
  }
  return { passed: true, detail: "passed" };
}

function graderFieldCount(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  const pattern = grader.pattern ?? "";
  const minCount = grader.min ?? null;
  const maxCount = grader.max ?? null;

  let matches: RegExpMatchArray | null;
  try {
    matches = output.match(new RegExp(pattern, "g"));
  } catch (e) {
    return { passed: false, detail: `invalid regex pattern "${pattern}": ${e}` };
  }

  const count = matches ? matches.length : 0;

  if (minCount !== null && count < minCount) {
    return { passed: false, detail: `field count ${count} below minimum ${minCount} for pattern "${pattern}"` };
  }
  if (maxCount !== null && count > maxCount) {
    return { passed: false, detail: `field count ${count} above maximum ${maxCount} for pattern "${pattern}"` };
  }
  return { passed: true, detail: "passed" };
}

function graderLengthBounds(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  const length = output.length;
  const minLen = grader.min ?? null;
  const maxLen = grader.max ?? null;

  if (minLen !== null && length < minLen) {
    return { passed: false, detail: `output length ${length} below minimum ${minLen}` };
  }
  if (maxLen !== null && length > maxLen) {
    return { passed: false, detail: `output length ${length} above maximum ${maxLen}` };
  }
  return { passed: true, detail: "passed" };
}

function graderJsonField(grader: GraderDef, output: string): { passed: boolean; detail: string } {
  const path = grader.path ?? "";
  const minVal = grader.min ?? null;
  const maxVal = grader.max ?? null;
  const minItems = grader.min_items ?? null;
  const maxItems = grader.max_items ?? null;
  const typeCheck = grader.type_check ?? null;
  const existsCheck = grader.exists ?? true;
  const hasEquals = "equals" in grader;
  const equalsVal = grader.equals;
  const hasContains = "contains" in grader;
  const containsVal = grader.contains;

  const parsed = extractJson(output);

  if (parsed === null) {
    return { passed: false, detail: `no valid JSON found in output (needed for json_field path: ${path})` };
  }

  // Parse path: split on dots not inside brackets, then split on [*]
  const rawParts = path.split(/\.(?![^\[]*\])/);
  const parts: string[] = [];
  for (const rp of rawParts) {
    const sub = rp.split(/(\[\*\])/);
    for (const s of sub) {
      if (s === "[*]") parts.push("[*]");
      else if (s) parts.push(s);
    }
  }

  const isWildcard = parts.includes("[*]");

  // Resolve dot-path with optional wildcard [*]
  function resolvePath(obj: unknown, pathParts: string[]): unknown[] | null {
    let results: unknown[] = [obj];
    for (const part of pathParts) {
      const nextResults: unknown[] = [];
      for (const r of results) {
        if (part === "[*]") {
          if (Array.isArray(r)) {
            nextResults.push(...r);
          } else {
            return null; // wildcard on non-array
          }
        } else if (r !== null && typeof r === "object" && !Array.isArray(r)) {
          const record = r as Record<string, unknown>;
          if (part in record) {
            nextResults.push(record[part]);
          } else {
            return null; // key missing
          }
        } else if (Array.isArray(r)) {
          // numeric index
          const idx = parseInt(part, 10);
          if (!isNaN(idx) && idx >= 0 && idx < r.length) {
            nextResults.push(r[idx]);
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
      results = nextResults;
      if (results.length === 0) return null;
    }
    return results;
  }

  const resolved = resolvePath(parsed, parts);

  // exists check
  if (!existsCheck) {
    if (resolved === null) {
      return { passed: true, detail: `field ${path} correctly absent` };
    }
    return { passed: false, detail: `field ${path} exists but should not` };
  }

  if (resolved === null) {
    return { passed: false, detail: `field ${path} not found in JSON` };
  }

  const valuesToCheck = resolved;

  // min/max (numeric, on single resolved value for non-wildcard)
  if (minVal !== null || maxVal !== null) {
    if (isWildcard) {
      return { passed: false, detail: "min/max not supported on wildcard paths (use min_items/max_items)" };
    }
    const val = valuesToCheck.length > 0 ? valuesToCheck[0] : null;
    if (val === null || val === undefined) {
      return { passed: false, detail: `field ${path} is null, cannot apply min/max` };
    }
    if (typeof val === "boolean" || (typeof val !== "number")) {
      return { passed: false, detail: `field ${path} is not a number (got ${typeof val})` };
    }
    if (minVal !== null && val < minVal) {
      return { passed: false, detail: `field ${path} value ${val} is below min ${minVal}` };
    }
    if (maxVal !== null && val > maxVal) {
      return { passed: false, detail: `field ${path} value ${val} is above max ${maxVal}` };
    }
  }

  // min_items/max_items (array length)
  if (minItems !== null || maxItems !== null) {
    if (isWildcard) {
      return { passed: false, detail: "min_items/max_items not supported on wildcard paths" };
    }
    const val = valuesToCheck.length > 0 ? valuesToCheck[0] : null;
    if (!Array.isArray(val)) {
      return { passed: false, detail: `field ${path} is not an array (got ${typeof val})` };
    }
    const count = val.length;
    if (minItems !== null && count < minItems) {
      return { passed: false, detail: `field ${path} has ${count} items, below min_items ${minItems}` };
    }
    if (maxItems !== null && count > maxItems) {
      return { passed: false, detail: `field ${path} has ${count} items, above max_items ${maxItems}` };
    }
  }

  // type_check
  if (typeCheck !== null) {
    function checkType(v: unknown, tc: string): boolean {
      if (tc === "boolean") return typeof v === "boolean";
      if (tc === "number") return typeof v === "number" && typeof v !== "boolean";
      if (tc === "string") return typeof v === "string";
      if (tc === "array") return Array.isArray(v);
      if (tc === "object") return v !== null && typeof v === "object" && !Array.isArray(v);
      return false;
    }

    const failedItems = valuesToCheck.filter((v) => !checkType(v, typeCheck));
    if (failedItems.length > 0) {
      const repr = failedItems.slice(0, 5).map((v) => JSON.stringify(v)).join(", ");
      return {
        passed: false,
        detail: `field ${path} type_check "${typeCheck}" failed for values: ${repr}`,
      };
    }
  }

  // equals
  if (hasEquals) {
    if (isWildcard) {
      const failedItems = valuesToCheck.filter((v) => v !== equalsVal);
      if (failedItems.length > 0) {
        const repr = failedItems.slice(0, 5).map((v) => JSON.stringify(v)).join(", ");
        return {
          passed: false,
          detail: `field ${path} equals check failed: expected ${JSON.stringify(equalsVal)}, got values: ${repr}`,
        };
      }
    } else {
      const val = valuesToCheck.length > 0 ? valuesToCheck[0] : undefined;
      if (val !== equalsVal) {
        return {
          passed: false,
          detail: `field ${path} equals check failed: expected ${JSON.stringify(equalsVal)}, got ${JSON.stringify(val)}`,
        };
      }
    }
  }

  // contains — at least one value matches
  if (hasContains) {
    if (isWildcard) {
      if (!valuesToCheck.some((v) => v === containsVal)) {
        const repr = valuesToCheck.slice(0, 5).map((v) => JSON.stringify(v)).join(", ");
        return {
          passed: false,
          detail: `field ${path} contains check failed: expected at least one ${JSON.stringify(containsVal)}, got values: ${repr}`,
        };
      }
    } else {
      const val = valuesToCheck.length > 0 ? valuesToCheck[0] : undefined;
      if (val !== containsVal) {
        return {
          passed: false,
          detail: `field ${path} contains check failed: expected ${JSON.stringify(containsVal)}, got ${JSON.stringify(val)}`,
        };
      }
    }
  }

  return { passed: true, detail: "passed" };
}

// ── Registry ──────────────────────────────────────────────────────────────────

const graderRegistry = new Map<string, GraderFn>([
  ["json_valid", graderJsonValid],
  ["contains", graderContains],
  ["not_contains", graderNotContains],
  ["regex", graderRegex],
  ["section_present", graderSectionPresent],
  ["field_count", graderFieldCount],
  ["length_bounds", graderLengthBounds],
  ["json_field", graderJsonField],
]);

/**
 * Run a single grader against output.
 * Returns a GraderResult with type, config, passed, and detail.
 */
export function runGrader(grader: GraderDef, output: string): GraderResult {
  const gtype = grader.type;
  const fn = graderRegistry.get(gtype);
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(grader)) {
    if (k !== "type") config[k] = v;
  }

  if (!fn) {
    return { type: gtype, config, passed: false, detail: `unknown grader type: ${gtype}` };
  }

  const { passed, detail } = fn(grader, output);
  return { type: gtype, config, passed, detail };
}

/**
 * Run all graders for a scenario against its agent output.
 * Returns { results, graderOverride }
 */
export function runAllGraders(
  graders: GraderDef[],
  output: string
): { results: GraderResult[]; graderOverride: boolean } {
  const results = graders.map((g) => runGrader(g, output));
  const graderOverride = results.some((r) => !r.passed);
  return { results, graderOverride };
}
