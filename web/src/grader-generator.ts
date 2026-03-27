/**
 * Grader auto-generation from expected_behavior and scoring_rubric text.
 * Pure function — no side effects, no I/O.
 *
 * Schema-aware: only emits json_field graders for paths that exist in the
 * target agent's known output schema. Domain terms in scenario prose are
 * never treated as JSON paths.
 */

import type { Grader } from "./views/Scenarios.ts";

export type GeneratedGrader = {
  grader: Grader;
  sourceText: string;  // the text this was derived from
  confidence: "high" | "medium" | "low";
};

export type AgentSchemaField = {
  path: string;
  type: "array" | "object" | "string" | "number" | "boolean";
  description?: string;
};

// Per-agent output schema registry. Only paths listed here are valid for
// json_field graders. Domain terms that happen to appear in scenario prose
// are never promoted to JSON paths.
export const AGENT_SCHEMAS: Record<string, AgentSchemaField[]> = {
  bird: [
    { path: "domain_analysis", type: "object" },
    { path: "domain_analysis.business_context", type: "string" },
    { path: "domain_analysis.bounded_context", type: "string" },
    { path: "domain_analysis.ubiquitous_language", type: "array", description: "domain terms" },
    { path: "business_rules", type: "array", description: "business rules with invariants" },
    { path: "acceptance_criteria", type: "array", description: "acceptance criteria" },
    { path: "edge_cases", type: "array", description: "edge cases" },
    { path: "business_impact", type: "object" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
    { path: "rejection_reasons", type: "array" },
  ],
  mj: [
    { path: "executive_summary", type: "string" },
    { path: "architecture", type: "object" },
    { path: "architecture.components", type: "array", description: "system components" },
    { path: "architecture.interfaces", type: "array", description: "interfaces" },
    { path: "architecture.patterns_used", type: "array", description: "patterns" },
    { path: "trade_offs", type: "array", description: "trade-off decisions" },
    { path: "risks", type: "array", description: "risks" },
    { path: "implementation_guidance", type: "object" },
    { path: "implementation_guidance.recommended_approach", type: "string" },
    { path: "implementation_guidance.files_to_create_or_modify", type: "array", description: "files" },
    { path: "implementation_guidance.pitfalls_to_avoid", type: "array", description: "pitfalls" },
    { path: "flexibility_points", type: "array", description: "flexibility points" },
    { path: "rigidity_points", type: "array", description: "rigidity points" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
  ],
  shaq: [
    { path: "implementation_summary", type: "object" },
    { path: "implementation_summary.what_was_built", type: "string" },
    { path: "implementation_summary.approach", type: "string" },
    { path: "implementation_summary.files_changed", type: "array", description: "files changed" },
    { path: "acceptance_criteria_coverage", type: "array", description: "AC coverage" },
    { path: "tests", type: "array", description: "tests" },
    { path: "deviations", type: "array", description: "deviations from spec" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
  ],
  kobe: [
    { path: "summary", type: "object" },
    { path: "summary.verdict", type: "string" },
    { path: "summary.one_liner", type: "string" },
    { path: "critical_findings", type: "array", description: "critical findings" },
    { path: "important_issues", type: "array", description: "important issues" },
    { path: "suggestions", type: "array", description: "suggestions" },
    { path: "production_readiness", type: "object" },
    { path: "production_readiness.safe_to_deploy", type: "boolean" },
    { path: "production_readiness.rollback_plan", type: "string" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
  ],
  pippen: [
    { path: "integration_assessment", type: "object" },
    { path: "integration_assessment.component_interactions", type: "array", description: "component interactions" },
    { path: "integration_assessment.contract_compliance", type: "array", description: "contracts" },
    { path: "observability_review", type: "object" },
    { path: "resilience_assessment", type: "object" },
    { path: "resilience_assessment.failure_modes", type: "array", description: "failure modes" },
    { path: "operational_readiness", type: "object" },
    { path: "operational_readiness.verdict", type: "string" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
  ],
  magic: [
    { path: "handoff_brief", type: "object" },
    { path: "handoff_brief.recipient", type: "string" },
    { path: "handoff_brief.task_context", type: "string" },
    { path: "handoff_brief.domain_rules", type: "array", description: "domain rules" },
    { path: "handoff_brief.acceptance_criteria", type: "array", description: "acceptance criteria" },
    { path: "handoff_brief.terminology_alignment", type: "array", description: "terms" },
    { path: "handoff_brief.contradictions_resolved", type: "array", description: "contradictions" },
    { path: "handoff_brief.open_questions", type: "array", description: "open questions" },
    { path: "confidence", type: "object" },
    { path: "confidence.level", type: "number" },
    { path: "escalations", type: "array" },
  ],
};

// Agents that output JSON — derived from AGENT_SCHEMAS to stay in sync automatically.
const JSON_AGENTS = new Set(Object.keys(AGENT_SCHEMAS));

/**
 * Return the schema fields for a given agent, or empty array if unknown.
 */
function getSchema(agent: string): AgentSchemaField[] {
  return AGENT_SCHEMAS[agent.toLowerCase()] ?? [];
}

/**
 * Build a Set of valid paths for fast lookup.
 */
function buildPathSet(schema: AgentSchemaField[]): Set<string> {
  return new Set(schema.map(f => f.path));
}

/**
 * Find a schema field by exact path match.
 */
function findField(schema: AgentSchemaField[], path: string): AgentSchemaField | undefined {
  return schema.find(f => f.path === path);
}

/**
 * Parse a number from a string, returning undefined if not valid.
 */
function parseNum(s: string): number | undefined {
  const n = Number(s.trim());
  return isNaN(n) ? undefined : n;
}

/**
 * Scan text for explicit numeric hints about a specific schema field.
 *
 * Recognises patterns like:
 *   "at least 3 business rules"
 *   "minimum 5 acceptance criteria"
 *   "business_rules at minimum 2"
 *   "3 or more edge cases"
 *   "includes at least 4 acceptance criteria"
 *
 * The field is matched by its path leaf (last segment) or its description.
 * Returns the lowest number found across all matches for the field, or
 * undefined if no explicit count is present.
 */
function extractExplicitCount(text: string, field: AgentSchemaField): number | undefined {
  const leaf = field.path.split(".").pop()!;
  const aliases: string[] = [leaf];
  if (field.description) {
    // e.g. "business rules with invariants" — also try "business rules"
    aliases.push(field.description);
    // add the first two words of the description as a shorter alias
    const shortDesc = field.description.split(/\s+/).slice(0, 2).join(" ");
    if (shortDesc !== field.description) aliases.push(shortDesc);
  }

  let found: number | undefined;

  for (const alias of aliases) {
    // Escape the alias for use in a regex
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
      // "at least N <alias>" / "minimum N <alias>" / "at minimum N <alias>"
      new RegExp(`(?:at\\s+)?(?:minimum|least)\\s+(\\d+)\\s+${esc}`, "i"),
      // "N or more <alias>"
      new RegExp(`(\\d+)\\s+or\\s+more\\s+${esc}`, "i"),
      // "<alias> at minimum N" / "<alias> at least N" / "<alias> contains at least N"
      new RegExp(`${esc}\\s+(?:contains?\\s+)?at\\s+(?:minimum|least)\\s+(\\d+)`, "i"),
      // "<alias> list at minimum N"
      new RegExp(`${esc}\\s+lists?\\s+at\\s+(?:minimum|least)\\s+(\\d+)`, "i"),
    ];

    for (const pattern of patterns) {
      const m = pattern.exec(text);
      if (m) {
        const n = parseNum(m[1]);
        if (n !== undefined) {
          found = found === undefined ? n : Math.min(found, n);
        }
      }
    }
  }

  return found;
}

/**
 * Scan text for an explicit confidence threshold.
 *
 * Recognises patterns like:
 *   "confidence.level >= 85"
 *   "confidence >= 80"
 *   "confidence level at least 75"
 *   "confidence between 70 and 90"
 */
function extractConfidenceThreshold(text: string): number | undefined {
  const patterns = [
    // "confidence.level >= N" / "confidence >= N"
    /confidence(?:\.level)?\s+(?:is\s+)?>=?\s*(\d+)/i,
    // "confidence.level at least N" / "confidence at least N"
    /confidence(?:\.level)?\s+at\s+least\s+(\d+)/i,
    // "confidence between N and M" — take lower bound
    /confidence(?:\.level)?\s+between\s+(\d+)\s*(?:and|-|to)\s*\d+/i,
  ];

  let found: number | undefined;
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) {
      const n = parseNum(m[1]);
      if (n !== undefined) {
        found = found === undefined ? n : Math.min(found, n);
      }
    }
  }
  return found;
}

/**
 * Determine which array fields from the agent schema are mentioned or implied
 * by the scenario text. A field is "implied" if its path leaf, path, or
 * description keyword appears in the text (case-insensitive).
 */
function impliedArrayFields(text: string, schema: AgentSchemaField[]): AgentSchemaField[] {
  const lower = text.toLowerCase();
  return schema.filter(field => {
    if (field.type !== "array") return false;
    const leaf = field.path.split(".").pop()!.toLowerCase().replace(/_/g, " ");
    if (lower.includes(leaf)) return true;
    if (lower.includes(field.path.toLowerCase())) return true;
    if (field.description && lower.includes(field.description.toLowerCase())) return true;
    return false;
  });
}

/**
 * Extract contains/not_contains graders from prose text patterns:
 *   "does NOT include X" / "must not contain X"
 * These check string content in the output, NOT JSON paths.
 */
function extractProsePatterns(text: string): Array<{ type: "contains" | "not_contains"; value: string; source: string }> {
  const results: Array<{ type: "contains" | "not_contains"; value: string; source: string }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    const pNot = /(?:does?\s+not|must\s+not)\s+(?:include|contain)\s+"?([^"]+)"?/i.exec(line);
    if (pNot) {
      results.push({ type: "not_contains", value: pNot[1].trim(), source: line.trim() });
    }
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
 * Generate graders from expected_behavior and scoring_rubric text.
 * Returns a list of GeneratedGrader objects with confidence levels.
 *
 * For JSON agents, graders are schema-aware: only paths that exist in the
 * agent's known output schema are emitted. Domain terms in prose are never
 * treated as JSON paths.
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
    const schema = getSchema(agent);
    const validPaths = buildPathSet(schema);

    // 1. Always include json_valid first (high confidence)
    results.push({
      grader: { type: "json_valid" },
      sourceText: "JSON agent — output must always be valid JSON",
      confidence: "high",
    });

    // 2. Schema-aware array field graders.
    // Find array fields that are mentioned/implied by the scenario text,
    // then determine min_items from explicit numeric hints or a sensible default.
    const implied = impliedArrayFields(combined, schema);

    for (const field of implied) {
      const explicitCount = extractExplicitCount(combined, field);
      const min_items = explicitCount ?? 1;  // default: at least 1 item
      const confidence: "high" | "medium" = explicitCount !== undefined ? "high" : "medium";

      // Build a human-readable source label
      const source = explicitCount !== undefined
        ? `Explicit count for ${field.path} derived from scenario text`
        : `${field.path} array implied by scenario text (default min_items=1)`;

      results.push({
        grader: { type: "json_field", path: field.path, min_items },
        sourceText: source,
        confidence,
      });
    }

    // 3. Confidence level grader — only if rubric or expected_behavior mentions a threshold.
    if (validPaths.has("confidence.level")) {
      const threshold = extractConfidenceThreshold(combined);
      if (threshold !== undefined) {
        results.push({
          grader: { type: "json_field", path: "confidence.level", min: threshold },
          sourceText: `confidence.level threshold extracted from scenario text`,
          confidence: "high",
        });
      }
    }

    // 4. Text-based not_contains graders from rubric (string content checks only,
    //    never used to infer JSON paths).
    const prose = extractProsePatterns(scoringRubric);
    for (const item of prose) {
      results.push({
        grader: { type: "not_contains", value: item.value },
        sourceText: item.source,
        confidence: "medium",
      });
    }

  } else {
    // Prose agent — extract not_contains graders from combined text
    const prose = extractProsePatterns(combined);
    for (const item of prose) {
      results.push({
        grader: { type: "not_contains", value: item.value },
        sourceText: item.source,
        confidence: "medium",
      });
    }
  }

  return dedupGraders(results);
}
