/**
 * Grader auto-generation from expected_behavior and scoring_rubric text.
 * Pure function — no side effects, no I/O.
 */

import type { Grader } from "./views/Scenarios.ts";

export type GeneratedGrader = {
  grader: Grader;
  sourceText: string;  // the text this was derived from
  confidence: "high" | "medium" | "low";
};

// Agents that output JSON (default)
const JSON_AGENTS = new Set(["bird", "kobe", "mj", "pippen", "shaq"]);

/**
 * Extract the lower of two numbers, handling undefined.
 * Used to pick the more conservative min_items value.
 */
function minOf(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Parse a number from a string, returning undefined if not valid.
 */
function parseNum(s: string): number | undefined {
  const n = Number(s.trim());
  return isNaN(n) ? undefined : n;
}

/**
 * Check if a path token looks like a reasonable JSON path (no spaces, reasonable chars).
 */
function looksLikePath(s: string): boolean {
  return /^[a-zA-Z0-9_[\]*./]+$/.test(s.trim());
}

/**
 * Extract min_items graders from patterns like:
 * - "at least N X" / "minimum N X" / "X lists at minimum N"
 * - "at minimum N" / "N or more X"
 * Returns {path, min_items, sourceText} tuples.
 */
function extractMinItemsPatterns(text: string): Array<{ path: string; min_items: number; source: string }> {
  const results: Array<{ path: string; min_items: number; source: string }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    // Pattern: "X lists at minimum N" / "X at minimum N items"
    const p1 = /(\w[\w_[\]*.]*)\s+(?:list[s]?\s+)?at\s+(?:minimum|least)\s+(\d+)/i.exec(line);
    if (p1 && looksLikePath(p1[1])) {
      const n = parseNum(p1[2]);
      if (n !== undefined) results.push({ path: p1[1], min_items: n, source: line.trim() });
      continue;
    }

    // Pattern: "at least N X" / "minimum N X" / "at minimum N X"
    const p2 = /(?:at\s+)?(?:minimum|least)\s+(\d+)\s+([\w_[\]*./]+)/i.exec(line);
    if (p2 && looksLikePath(p2[2])) {
      const n = parseNum(p2[1]);
      if (n !== undefined) results.push({ path: p2[2], min_items: n, source: line.trim() });
      continue;
    }

    // Pattern: "N or more X"
    const p3 = /(\d+)\s+or\s+more\s+([\w_[\]*./]+)/i.exec(line);
    if (p3 && looksLikePath(p3[2])) {
      const n = parseNum(p3[1]);
      if (n !== undefined) results.push({ path: p3[2], min_items: n, source: line.trim() });
      continue;
    }

    // Pattern: "includes at least N items" / "contains at least N"
    const p4 = /(\w[\w_[\]*.]*)\s+(?:contains?|includes?)\s+at\s+least\s+(\d+)/i.exec(line);
    if (p4 && looksLikePath(p4[1])) {
      const n = parseNum(p4[2]);
      if (n !== undefined) results.push({ path: p4[1], min_items: n, source: line.trim() });
    }
  }

  return results;
}

/**
 * Extract numeric bound graders from patterns like:
 * - "X is >= N" / "X >= N"
 * - "X at least N" / "X no more than M"
 * - "X between N and M"
 * - "confidence.level >= 85"
 */
function extractNumericBoundPatterns(text: string): Array<{ path: string; min?: number; max?: number; source: string }> {
  const results: Array<{ path: string; min?: number; max?: number; source: string }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    // Pattern: "X >= N" or "X is >= N" or "X at least N"
    const pGte = /([\w.[\]*_]+)\s+(?:is\s+)?>=?\s+(\d+)/i.exec(line);
    if (pGte && looksLikePath(pGte[1])) {
      const n = parseNum(pGte[2]);
      if (n !== undefined) results.push({ path: pGte[1], min: n, source: line.trim() });
      continue;
    }

    // Pattern: "X <= N" or "X is <= N" or "X at most N" or "X no more than N"
    const pLte = /([\w.[\]*_]+)\s+(?:is\s+)?<=?\s+(\d+)/i.exec(line);
    if (pLte && looksLikePath(pLte[1])) {
      const n = parseNum(pLte[2]);
      if (n !== undefined) results.push({ path: pLte[1], max: n, source: line.trim() });
      continue;
    }

    // Pattern: "X between N and M" / "X between N-M" / "X between N to M"
    const pBetween = /([\w.[\]*_]+)\s+between\s+(\d+)\s*(?:and|-|to)\s*(\d+)/i.exec(line);
    if (pBetween && looksLikePath(pBetween[1])) {
      const lo = parseNum(pBetween[2]);
      const hi = parseNum(pBetween[3]);
      if (lo !== undefined && hi !== undefined) results.push({ path: pBetween[1], min: lo, max: hi, source: line.trim() });
      continue;
    }

    // Pattern: "X at least N" where X is a dotted path (e.g. confidence.level at least 85)
    const pAtLeast = /([\w.]+)\s+at\s+least\s+(\d+)/i.exec(line);
    if (pAtLeast && looksLikePath(pAtLeast[1]) && pAtLeast[1].includes(".")) {
      const n = parseNum(pAtLeast[2]);
      if (n !== undefined) results.push({ path: pAtLeast[1], min: n, source: line.trim() });
    }
  }

  return results;
}

/**
 * Extract type check graders from patterns like:
 * - "X[*].Y is a boolean/string/number"
 * - "each X.Y is a TYPE"
 */
function extractTypeCheckPatterns(text: string): Array<{ path: string; type_check: string; source: string }> {
  const results: Array<{ path: string; type_check: string; source: string }> = [];
  const typeWords = ["boolean", "string", "number", "array", "object"];

  const lines = text.split("\n");
  for (const line of lines) {
    for (const t of typeWords) {
      const re = new RegExp(`(\\w[\\w_[\\]*.]*)\\.?(\\w+)\\s+is\\s+a\\s+${t}`, "i");
      const m = re.exec(line);
      if (m) {
        const path = m[1].includes("[") || m[1].includes(".") ? `${m[1]}.${m[2]}` : `${m[1]}[*].${m[2]}`;
        if (looksLikePath(path)) results.push({ path, type_check: t, source: line.trim() });
        break;
      }

      const re2 = new RegExp(`each\\s+(\\w[\\w_[\\]*.]*)\\.?(\\w+)\\s+is\\s+(?:a\\s+)?${t}`, "i");
      const m2 = re2.exec(line);
      if (m2) {
        const path = `${m2[1]}[*].${m2[2]}`;
        if (looksLikePath(path)) results.push({ path, type_check: t, source: line.trim() });
        break;
      }
    }
  }

  return results;
}

/**
 * Extract field-presence graders from patterns like:
 * - "X must be present" / "includes X field" / "X field is present"
 */
function extractFieldPresencePatterns(text: string): Array<{ path: string; source: string }> {
  const results: Array<{ path: string; source: string }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    // Pattern: "X must be present" / "X is present"
    const p1 = /([\w_[\]*.]+)\s+(?:must\s+be|is)\s+present/i.exec(line);
    if (p1 && looksLikePath(p1[1])) {
      results.push({ path: p1[1], source: line.trim() });
      continue;
    }

    // Pattern: "includes X field" / "include X field"
    const p2 = /includes?\s+([\w_[\]*.]+)\s+field/i.exec(line);
    if (p2 && looksLikePath(p2[1])) {
      results.push({ path: p2[1], source: line.trim() });
      continue;
    }

    // Pattern: "X field is present" / "X field exists"
    const p3 = /([\w_[\]*.]+)\s+field\s+(?:is\s+present|exists)/i.exec(line);
    if (p3 && looksLikePath(p3[1])) {
      results.push({ path: p3[1], source: line.trim() });
    }
  }

  return results;
}

/**
 * Extract contains/not_contains graders from prose text patterns:
 * - "does NOT include X" / "must not contain X"
 * - "X section present" / "includes X section"
 */
function extractProsePatterns(text: string): Array<{ type: "contains" | "not_contains" | "section_present"; value: string; source: string }> {
  const results: Array<{ type: "contains" | "not_contains" | "section_present"; value: string; source: string }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    // Pattern: "does NOT include X" / "must not contain X" / "must not include X"
    const pNot = /(?:does?\s+not|must\s+not)\s+(?:include|contain)\s+"?([^"]+)"?/i.exec(line);
    if (pNot) {
      results.push({ type: "not_contains", value: pNot[1].trim(), source: line.trim() });
      continue;
    }

    // Pattern: "X section present" / "includes X section" / "X section is present"
    const pSection = /(?:([\w ]+)\s+section\s+(?:present|exists|is\s+present)|includes?\s+([\w ]+)\s+section)/i.exec(line);
    if (pSection) {
      const section = (pSection[1] || pSection[2]).trim();
      if (section.length > 0 && section.length < 60) {
        results.push({ type: "section_present", value: section, source: line.trim() });
        continue;
      }
    }

    // Pattern: "matches pattern X" / "matches regex X"
    // (regex patterns — skip, too fragile for auto-generation)
  }

  return results;
}

/**
 * De-duplicate generated graders to avoid repeating the same grader multiple times.
 * Uses type + key properties as the dedup key.
 */
function dedupGraders(graders: GeneratedGrader[]): GeneratedGrader[] {
  const seen = new Set<string>();
  return graders.filter(g => {
    const key = JSON.stringify({ type: g.grader.type, path: g.grader.path, value: g.grader.value, section: g.grader.section });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge min_items from expected_behavior and scoring_rubric, taking the lower number
 * (graders are a hard gate — be conservative).
 */
function mergeMinItems(
  fromBehavior: Array<{ path: string; min_items: number; source: string }>,
  fromRubric: Array<{ path: string; min_items: number; source: string }>
): Array<{ path: string; min_items: number; source: string }> {
  const map = new Map<string, { path: string; min_items: number; source: string }>();

  for (const item of [...fromBehavior, ...fromRubric]) {
    const existing = map.get(item.path);
    if (!existing) {
      map.set(item.path, { ...item });
    } else {
      // Use the lower number (conservative)
      if (item.min_items < existing.min_items) {
        map.set(item.path, { ...item });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Merge numeric bound entries from expected_behavior and scoring_rubric.
 * When the same JSON path appears in both sources, take the conservative
 * (more lenient) value: lower min, higher max.
 */
function mergeNumericBounds(
  fromBehavior: Array<{ path: string; min?: number; max?: number; source: string }>,
  fromRubric: Array<{ path: string; min?: number; max?: number; source: string }>
): Array<{ path: string; min?: number; max?: number; source: string }> {
  const map = new Map<string, { path: string; min?: number; max?: number; source: string }>();

  for (const item of [...fromBehavior, ...fromRubric]) {
    const existing = map.get(item.path);
    if (!existing) {
      map.set(item.path, { ...item });
    } else {
      // Conservative merge: lower min (more lenient lower bound), higher max (more lenient upper bound)
      const newMin = (existing.min !== undefined && item.min !== undefined)
        ? Math.min(existing.min, item.min)
        : (existing.min ?? item.min);
      const newMax = (existing.max !== undefined && item.max !== undefined)
        ? Math.max(existing.max, item.max)
        : (existing.max ?? item.max);
      map.set(item.path, { ...existing, min: newMin, max: newMax });
    }
  }

  return Array.from(map.values());
}

/**
 * Generate graders from expected_behavior and scoring_rubric text.
 * Returns a list of GeneratedGrader objects with confidence levels.
 *
 * Only generates graders from EXPLICIT quantitative/structural assertions.
 * Qualitative criteria are skipped.
 */
export function generateGraders(
  expectedBehavior: string,
  scoringRubric: string,
  agent: string
): GeneratedGrader[] {
  const isJsonAgent = JSON_AGENTS.has(agent.toLowerCase());
  const combined = `${expectedBehavior}\n${scoringRubric}`;
  const results: GeneratedGrader[] = [];

  if (isJsonAgent) {
    // 1. Always include json_valid first (high confidence)
    results.push({
      grader: { type: "json_valid" },
      sourceText: "JSON agent — output must always be valid JSON",
      confidence: "high",
    });

    // 2. Extract min_items patterns from both sources, take lower
    const minItemsBehavior = extractMinItemsPatterns(expectedBehavior);
    const minItemsRubric = extractMinItemsPatterns(scoringRubric);
    const mergedMinItems = mergeMinItems(minItemsBehavior, minItemsRubric);

    for (const item of mergedMinItems) {
      results.push({
        grader: { type: "json_field", path: item.path, min_items: item.min_items },
        sourceText: item.source,
        confidence: "high",
      });
    }

    // 3. Extract numeric bound patterns (e.g. confidence.level >= 85, between 65-90)
    // Extract from each source separately, then merge conservatively (lower min, higher max)
    const numericBoundsBehavior = extractNumericBoundPatterns(expectedBehavior);
    const numericBoundsRubric = extractNumericBoundPatterns(scoringRubric);
    const numericBounds = mergeNumericBounds(numericBoundsBehavior, numericBoundsRubric);
    for (const item of numericBounds) {
      // Skip paths that were already handled as min_items
      const alreadyHandled = mergedMinItems.some(m => m.path === item.path);
      if (alreadyHandled) continue;

      const grader: Grader = { type: "json_field", path: item.path };
      if (item.min !== undefined) grader.min = item.min;
      if (item.max !== undefined) grader.max = item.max;

      results.push({
        grader,
        sourceText: item.source,
        confidence: "medium",
      });
    }

    // 4. Extract type check patterns
    const typeChecks = extractTypeCheckPatterns(combined);
    for (const item of typeChecks) {
      results.push({
        grader: { type: "json_field", path: item.path, type_check: item.type_check },
        sourceText: item.source,
        confidence: "medium",
      });
    }

    // 5. Extract field presence patterns (low confidence — often qualitative)
    const fieldPresence = extractFieldPresencePatterns(combined);
    for (const item of fieldPresence) {
      // Skip paths already handled above
      const alreadyHandled =
        mergedMinItems.some(m => m.path === item.path) ||
        numericBounds.some(n => n.path === item.path) ||
        typeChecks.some(t => t.path === item.path);
      if (alreadyHandled) continue;

      results.push({
        grader: { type: "json_field", path: item.path },
        sourceText: item.source,
        confidence: "low",
      });
    }
  } else {
    // Prose agent — extract contains/section_present/not_contains
    const proseMatches = extractProsePatterns(combined);
    for (const item of proseMatches) {
      if (item.type === "section_present") {
        results.push({
          grader: { type: "section_present", section: item.value },
          sourceText: item.source,
          confidence: "medium",
        });
      } else if (item.type === "not_contains") {
        results.push({
          grader: { type: "not_contains", value: item.value },
          sourceText: item.source,
          confidence: "medium",
        });
      } else {
        results.push({
          grader: { type: "contains", value: item.value },
          sourceText: item.source,
          confidence: "medium",
        });
      }
    }
  }

  return dedupGraders(results);
}
