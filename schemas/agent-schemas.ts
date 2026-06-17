/**
 * schemas/agent-schemas.ts — Zod schema registry for Dream Team agents.
 *
 * SINGLE SOURCE OF TRUTH: one Zod schema per agent, exported as both:
 *   - The Zod schema object (for safeParse / runtime validation)
 *   - z.infer<typeof Schema> (for TypeScript types)
 *   - z.toJSONSchema(Schema) helper (for --json-schema CLI flag)
 *
 * Design principles (per architecture.md):
 *   - FLAT — singleton wrapper objects hoisted to top-level prefixed keys
 *     (domain_analysis.bounded_context → bounded_context, etc.)
 *   - STRICT on structure (field names/types present when populated)
 *   - LENIENT on completeness (deep/optional fields use .optional())
 *   - Arrays allowed to be empty — avoids --json-schema retry-exhaustion
 *   - Every field checked by a grader (json_field path) is present in schema
 *
 * Grader-checked flat paths (enumerated from evals/bird/scenario-*.md):
 *   bounded_context                 (was domain_analysis.bounded_context)
 *   ubiquitous_language             (was domain_analysis.ubiquitous_language)
 *   business_rules                  (array, min_items checked)
 *   business_rules[*].invariant
 *   business_rules[*].invariant_justification
 *   acceptance_criteria             (array, min/max_items checked)
 *   acceptance_criteria[*].given
 *   acceptance_criteria[*].when
 *   acceptance_criteria[*].then
 *   edge_cases                      (array of strings)
 *   business_impact_financial       (was business_impact.financial)
 *   business_impact_operational     (was business_impact.operational)
 *   business_impact_user            (was business_impact.user)
 *   business_impact_risk            (was business_impact.risk)
 *   stakeholders_affected           (was business_impact.stakeholders_affected)
 *   confidence_level                (was confidence.level)
 *   confidence_low_areas            (was confidence.low_confidence_areas)
 *   confidence_assumptions          (was confidence.assumptions)
 *   escalations                     (array, min_items checked)
 *   escalations[*].type             (equals checked)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Bird — Domain Authority output schema (FLATTENED — all wrapper objects hoisted)
// ---------------------------------------------------------------------------

const BirdBusinessRule = z.object({
  id: z.string().optional(),
  rule: z.string(),
  invariant: z.boolean(),
  invariant_justification: z.string(),
  testable_assertion: z.string().optional(),
});

const BirdAcceptanceCriteria = z.object({
  id: z.string().optional(),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});

const BirdStakeholder = z.object({
  group: z.string(),
  impact: z.string(),
});

const BirdEscalation = z.object({
  // Grader checks escalations[*].type equals specific values
  type: z.enum(["contradiction", "ambiguity", "missing_context", "out_of_scope"]),
  description: z.string().optional(),
  affected_stakeholders: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
  recommendation: z.string().optional(),
});

// The canonical BirdOut schema — FLAT, all singleton wrapper objects hoisted.
// Array-of-objects stay as arrays (one array→object level is fine per architecture.md).
// Note: ubiquitous_language and stakeholders_affected use string arrays to match
// the compact JSON Schema shape proven to populate structured_output reliably.
export const BirdOut = z.object({
  // ── Hoisted from domain_analysis ──────────────────────────────────────────
  bounded_context: z.string(),
  // ubiquitous_language: flat string array in compact schema (proven to work)
  ubiquitous_language: z.array(z.string()).optional(),
  business_context: z.string().optional(),

  // ── Arrays-of-objects (kept as-is — single array→object depth is proven OK) ──
  business_rules: z.array(BirdBusinessRule),

  acceptance_criteria: z.array(BirdAcceptanceCriteria),

  // edge_cases: flat array of strings (proven in /tmp/birdflat.json fixture)
  edge_cases: z.array(z.string()).optional(),

  // ── Hoisted from business_impact ──────────────────────────────────────────
  business_impact_financial: z.string().optional(),
  business_impact_operational: z.string().optional(),
  business_impact_user: z.string().optional(),
  business_impact_risk: z.string().optional(),
  // stakeholders_affected: flat string array in compact schema (proven to work)
  stakeholders_affected: z.array(z.string()).optional(),

  // ── Hoisted from confidence ────────────────────────────────────────────────
  confidence_level: z.number().int().min(0).max(100),
  confidence_low_areas: z.array(z.string()).optional(),
  confidence_assumptions: z.array(z.string()).optional(),
  confidence_reasoning: z.string().optional(),
  confidence_high_areas: z.array(z.string()).optional(),

  // ── Escalations (array — unchanged) ───────────────────────────────────────
  escalations: z.array(BirdEscalation),

  // ── Optional rejection reasons ─────────────────────────────────────────────
  rejection_reasons: z
    .array(
      z.object({
        violation: z.string(),
        business_rule_broken: z.string(),
      })
    )
    .optional(),
});

export type BirdOutput = z.infer<typeof BirdOut>;

// ---------------------------------------------------------------------------
// Registry — keyed by agent name. Add agents here as schemas are built.
// ---------------------------------------------------------------------------

export const AgentSchemaRegistry = {
  bird: BirdOut,
  // mj: MJOut,       // TODO: add when MJ schema is built
  // shaq: ShaqOut,   // TODO: add when Shaq schema is built
  // kobe: KobeOut,   // etc.
} as const;

export type AgentName = keyof typeof AgentSchemaRegistry;

/**
 * Get the Zod schema for a named agent.
 * Returns undefined if the agent has no registered schema yet.
 */
export function getAgentSchema(agentName: string): z.ZodType | undefined {
  return (AgentSchemaRegistry as Record<string, z.ZodType>)[agentName];
}

// ---------------------------------------------------------------------------
// Compact JSON Schema registry (for --json-schema CLI flag)
//
// z.toJSONSchema() produces verbose output with $schema + additionalProperties
// everywhere (~2400 B). The CLI's structured_output extraction is sensitive to
// schema complexity (proven threshold: ~1400 B flat schemas work; >2000 B fail).
// So we maintain a compact hand-crafted JSON Schema per agent that matches the
// Zod shape but stays within the proven size budget.
//
// Proven fixture: /tmp/birdflat.json (1372 B) — all 14 grader fields populated.
// ---------------------------------------------------------------------------

/**
 * Compact JSON Schema for BirdOut — matches the proven /tmp/birdflat.json fixture.
 * All grader-checked fields covered. Size: ~1400 B (within structured_output threshold).
 */
const BIRD_JSON_SCHEMA: object = {
  type: "object",
  properties: {
    bounded_context: { type: "string" },
    ubiquitous_language: { type: "array", items: { type: "string" } },
    business_context: { type: "string" },
    business_rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          invariant: { type: "boolean" },
          invariant_justification: { type: "string" },
          id: { type: "string" },
          testable_assertion: { type: "string" },
        },
        required: ["rule", "invariant"],
        additionalProperties: false,
      },
    },
    acceptance_criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          given: { type: "string" },
          when: { type: "string" },
          then: { type: "string" },
          id: { type: "string" },
        },
        required: ["given", "when", "then"],
        additionalProperties: false,
      },
    },
    edge_cases: { type: "array", items: { type: "string" } },
    business_impact_financial: { type: "string" },
    business_impact_operational: { type: "string" },
    business_impact_user: { type: "string" },
    business_impact_risk: { type: "string" },
    stakeholders_affected: {
      type: "array",
      items: { type: "string" },
    },
    confidence_level: { type: "integer" },
    confidence_low_areas: { type: "array", items: { type: "string" } },
    confidence_assumptions: { type: "array", items: { type: "string" } },
    confidence_reasoning: { type: "string" },
    confidence_high_areas: { type: "array", items: { type: "string" } },
    escalations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          description: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    rejection_reasons: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["bounded_context", "business_rules", "acceptance_criteria", "confidence_level"],
  additionalProperties: false,
};

const COMPACT_JSON_SCHEMAS: Record<string, object> = {
  bird: BIRD_JSON_SCHEMA,
};

/**
 * Emit a JSON Schema object for the given agent (for use with --json-schema flag).
 *
 * Returns a compact hand-crafted schema (size-optimized for CLI structured_output
 * reliability) when available, falling back to z.toJSONSchema() for agents without
 * a compact override.
 *
 * Returns undefined if no schema is registered for the agent.
 */
export function getAgentJsonSchema(agentName: string): object | undefined {
  // Use compact schema if available (size-optimized for CLI --json-schema)
  if (agentName in COMPACT_JSON_SCHEMAS) {
    return COMPACT_JSON_SCHEMAS[agentName];
  }
  const schema = getAgentSchema(agentName);
  if (!schema) return undefined;
  return z.toJSONSchema(schema);
}

// ---------------------------------------------------------------------------
// OpenAI strict structured-output transform (for codex --output-schema)
//
// OpenAI's strict mode imposes rules our compact schemas don't satisfy as-is:
//   1. every object must set additionalProperties:false
//   2. every object's `required` must list ALL of its properties
//      (no truly-optional fields)
// We express "optional" the strict-mode way: a field that was NOT in the
// original `required` becomes nullable (its type gains "null") but is still
// listed in `required`. The model may then emit null for an absent field.
//
// This is a PURE transform — fully unit-testable, no network. Codex output is
// null-stripped before Zod validation (Zod .optional() accepts undefined, not
// null), so the downstream contract is unchanged.
// ---------------------------------------------------------------------------

type JsonSchemaNode = Record<string, any>;

/** Make a property schema accept null (strict-mode "optional"). */
function makeNullable(node: JsonSchemaNode): JsonSchemaNode {
  if (Array.isArray(node.type)) {
    return node.type.includes("null") ? node : { ...node, type: [...node.type, "null"] };
  }
  if (typeof node.type === "string") {
    return { ...node, type: [node.type, "null"] };
  }
  // No concrete type (anyOf/oneOf/enum-only) — express null via anyOf.
  return { anyOf: [node, { type: "null" }] };
}

/**
 * Transform a JSON Schema into OpenAI strict structured-output form. Recurses
 * into object properties and array items. Non-mutating (returns a new tree).
 */
export function toOpenAIStrictSchema(schema: object): object {
  const walk = (node: JsonSchemaNode): JsonSchemaNode => {
    if (!node || typeof node !== "object") return node;

    // Array → recurse into items.
    if (node.type === "array" && node.items) {
      return { ...node, items: walk(node.items) };
    }

    // Object → all-required + additionalProperties:false; non-required → nullable.
    if (node.type === "object" && node.properties) {
      const originalRequired: string[] = Array.isArray(node.required) ? node.required : [];
      const props: JsonSchemaNode = {};
      for (const [key, child] of Object.entries(node.properties as JsonSchemaNode)) {
        const walked = walk(child);
        props[key] = originalRequired.includes(key) ? walked : makeNullable(walked);
      }
      return {
        ...node,
        properties: props,
        required: Object.keys(node.properties),
        additionalProperties: false,
      };
    }

    return node;
  };
  return walk(schema as JsonSchemaNode);
}

/** Strict-mode JSON Schema for codex --output-schema, or undefined if no schema. */
export function getAgentStrictJsonSchema(agentName: string): object | undefined {
  const base = getAgentJsonSchema(agentName);
  return base ? toOpenAIStrictSchema(base) : undefined;
}

/** Recursively drop null-valued keys so Zod .optional() (undefined, not null) validates. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripNulls(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Validate agent output against the registered Zod schema.
 * Returns a typed result object.
 */
export function validateAgentOutput(
  agentName: string,
  data: unknown
): { success: true; data: unknown } | { success: false; error: string } {
  const schema = getAgentSchema(agentName);
  if (!schema) {
    return { success: false, error: `No schema registered for agent: ${agentName}` };
  }
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
