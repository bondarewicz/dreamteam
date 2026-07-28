/**
 * schema-runner.test.ts — Unit tests for schema-runner and agent-schemas modules.
 *
 * Tests do NOT make live API calls — they test the schema shape, JSON Schema
 * generation, Zod validation, and frontmatter parsing logic.
 *
 * NOTE: BirdOut is now FLAT — all singleton wrapper objects hoisted to top-level
 * prefixed keys (bounded_context, confidence_level, business_impact_financial, etc.)
 * per architecture.md empirical finding that flat schemas reliably populate
 * structured_output while the deep-nested 2910-B version did not.
 */

import { test, expect, describe } from "bun:test";
import { z } from "zod";
import {
  BirdOut,
  type BirdOutput,
  getAgentSchema,
  getAgentJsonSchema,
  validateAgentOutput,
  AgentSchemaRegistry,
} from "../../../schemas/agent-schemas.ts";
import { parseAgentFrontmatter } from "../schema-runner.ts";
import path from "path";
import fs from "fs";
import os from "os";

// ---------------------------------------------------------------------------
// BirdOut schema — shape tests (FLAT schema)
// ---------------------------------------------------------------------------

describe("BirdOut schema (flat)", () => {
  const minimalValid: BirdOutput = {
    bounded_context: "shipment lifecycle",
    business_rules: [],
    acceptance_criteria: [],
    confidence_level: 70,
    escalations: [],
  };

  test("accepts minimal valid object (all optional fields absent)", () => {
    const result = BirdOut.safeParse(minimalValid);
    expect(result.success).toBe(true);
  });

  test("accepts fully populated object (all fields present)", () => {
    const full: BirdOutput = {
      bounded_context: "shipment lifecycle",
      ubiquitous_language: ["Shipment: A parcel delivery unit", "Route: Delivery path"],
      business_context: "logistics platform",

      business_rules: [
        {
          id: "BR-1",
          rule: "Weight must be > 0 and <= 1000 kg",
          invariant: true,
          invariant_justification: "Physical constraint — cannot deliver negative weight",
          testable_assertion: "given weight=0, creating shipment raises validation error",
        },
        {
          id: "BR-2",
          rule: "Weight bracket: standard < 10 kg",
          invariant: false,
          invariant_justification: "Pricing policy, not a physical constraint",
        },
      ],

      acceptance_criteria: [
        {
          id: "AC-1",
          given: "A shipment with weight 5 kg",
          when: "the shipment is classified",
          then: "the bracket is standard",
        },
      ],

      edge_cases: ["Weight exactly 10 kg — classified as heavy (inclusive boundary)"],

      business_impact_financial: "SLA penalties if contractual time windows are missed",
      business_impact_operational: "Reduces courier dispatch pressure",
      business_impact_user: "Customer satisfaction depends on ETA accuracy",
      business_impact_risk: "Contractual SLA risk for enterprise customers",
      stakeholders_affected: [
        "Customers: Degraded ETA precision",
        "Operations: Reduced time-window pressure",
        "Sales: SLA renegotiation required",
      ],

      confidence_level: 72,
      confidence_reasoning: "Domain is well-specified but contract details unknown",
      confidence_high_areas: ["State machine rules", "weight brackets"],
      confidence_low_areas: ["Contractual SLA obligations"],
      confidence_assumptions: ["No existing contracts require time-precise delivery guarantees"],

      escalations: [
        {
          type: "missing_context",
          description: "Customer contract SLA details not provided",
          affected_stakeholders: ["Sales", "Legal"],
          options: ["Assume no time-precise SLAs", "Request contract review"],
          recommendation: "Request contract review before proceeding",
        },
      ],

      rejection_reasons: [],
    };
    const result = BirdOut.safeParse(full);
    expect(result.success).toBe(true);
  });

  test("rejects object missing required bounded_context field", () => {
    const invalid = { ...minimalValid, bounded_context: undefined };
    const result = BirdOut.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects object missing required business_rules field", () => {
    const invalid = { ...minimalValid, business_rules: undefined };
    const result = BirdOut.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects object missing confidence_level", () => {
    const invalid = { ...minimalValid, confidence_level: undefined };
    const result = BirdOut.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects confidence_level outside 0-100", () => {
    const invalid = { ...minimalValid, confidence_level: 150 };
    const result = BirdOut.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects invalid escalation type", () => {
    const invalid = {
      ...minimalValid,
      escalations: [{ type: "unknown_type", description: "test" }],
    };
    const result = BirdOut.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("accepts all valid escalation types", () => {
    for (const type of ["contradiction", "ambiguity", "missing_context", "out_of_scope"] as const) {
      const data = {
        ...minimalValid,
        escalations: [{ type, description: "test escalation" }],
      };
      const result = BirdOut.safeParse(data);
      expect(result.success).toBe(true);
    }
  });

  test("business_rule requires invariant (boolean) and invariant_justification (string)", () => {
    const withRule = {
      ...minimalValid,
      business_rules: [{ rule: "test", invariant: true, invariant_justification: "because" }],
    };
    expect(BirdOut.safeParse(withRule).success).toBe(true);

    const missingJustification = {
      ...minimalValid,
      business_rules: [{ rule: "test", invariant: true }],
    };
    expect(BirdOut.safeParse(missingJustification).success).toBe(false);
  });

  test("acceptance_criteria requires given, when, then", () => {
    const withAc = {
      ...minimalValid,
      acceptance_criteria: [{ given: "g", when: "w", then: "t" }],
    };
    expect(BirdOut.safeParse(withAc).success).toBe(true);

    const missingThen = {
      ...minimalValid,
      acceptance_criteria: [{ given: "g", when: "w" }],
    };
    expect(BirdOut.safeParse(missingThen).success).toBe(false);
  });

  test("edge_cases is a flat array of strings", () => {
    const withEdgeCases = {
      ...minimalValid,
      edge_cases: ["Weight = 0 kg: reject at validation", "Weight = 1000 kg: allow (boundary)"],
    };
    expect(BirdOut.safeParse(withEdgeCases).success).toBe(true);
  });

  test("flat grader fields are top-level (no nested wrappers)", () => {
    // Verify the flat shape: confidence_level, bounded_context etc. are at top level
    const shape = BirdOut.shape;
    expect("confidence_level" in shape).toBe(true);
    expect("bounded_context" in shape).toBe(true);
    expect("business_impact_financial" in shape).toBe(true);
    expect("business_impact_risk" in shape).toBe(true);
    expect("stakeholders_affected" in shape).toBe(true);
    expect("confidence_low_areas" in shape).toBe(true);
    expect("confidence_assumptions" in shape).toBe(true);
    // Old nested wrappers must NOT exist
    expect("confidence" in shape).toBe(false);
    expect("domain_analysis" in shape).toBe(false);
    expect("business_impact" in shape).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON Schema generation
// ---------------------------------------------------------------------------

describe("getAgentJsonSchema", () => {
  test("returns a valid JSON Schema object for bird", () => {
    const schema = getAgentJsonSchema("bird");
    expect(schema).toBeDefined();
    expect(typeof schema).toBe("object");
    expect((schema as Record<string, unknown>).type).toBe("object");
  });

  test("returned JSON Schema has flat top-level properties (not nested wrappers)", () => {
    const schema = getAgentJsonSchema("bird") as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    // Flat keys
    expect(props!.bounded_context).toBeDefined();
    expect(props!.business_rules).toBeDefined();
    expect(props!.acceptance_criteria).toBeDefined();
    expect(props!.confidence_level).toBeDefined();
    expect(props!.escalations).toBeDefined();
    expect(props!.business_impact_financial).toBeDefined();
    expect(props!.business_impact_risk).toBeDefined();
    expect(props!.stakeholders_affected).toBeDefined();
    expect(props!.confidence_low_areas).toBeDefined();
    expect(props!.confidence_assumptions).toBeDefined();
    // Old nested wrappers must NOT exist at top level
    expect(props!.confidence).toBeUndefined();
    expect(props!.domain_analysis).toBeUndefined();
    expect(props!.business_impact).toBeUndefined();
  });

  test("returns undefined for unregistered agent", () => {
    const schema = getAgentJsonSchema("nonexistent_agent");
    expect(schema).toBeUndefined();
  });

  test("JSON Schema is serializable (for --json-schema flag)", () => {
    const schema = getAgentJsonSchema("bird")!;
    const serialized = JSON.stringify(schema);
    expect(() => JSON.parse(serialized)).not.toThrow();
    // Verify flat size is within proven working range (~1372 B)
    expect(serialized.length).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("AgentSchemaRegistry", () => {
  test("bird is in the registry", () => {
    expect("bird" in AgentSchemaRegistry).toBe(true);
  });

  test("getAgentSchema returns Zod schema for bird", () => {
    const schema = getAgentSchema("bird");
    expect(schema).toBeDefined();
    // Verify it behaves like a Zod schema
    expect(typeof schema!.safeParse).toBe("function");
  });

  test("getAgentSchema returns undefined for unknown agent", () => {
    expect(getAgentSchema("unknown")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateAgentOutput helper
// ---------------------------------------------------------------------------

describe("validateAgentOutput", () => {
  test("returns success for valid flat bird output", () => {
    const result = validateAgentOutput("bird", {
      bounded_context: "order management",
      business_rules: [],
      acceptance_criteria: [],
      confidence_level: 70,
      escalations: [],
    });
    expect(result.success).toBe(true);
  });

  test("returns failure for invalid bird output (missing confidence_level)", () => {
    const result = validateAgentOutput("bird", {
      bounded_context: "x",
      business_rules: [],
      acceptance_criteria: [],
      escalations: [],
    });
    expect(result.success).toBe(false);
    expect("error" in result && result.error).toBeTruthy();
  });

  test("returns failure for nested (old) shape — confidence.level not accepted", () => {
    // The old nested shape must be rejected; graders now look for confidence_level
    const result = validateAgentOutput("bird", {
      domain_analysis: { bounded_context: "x", ubiquitous_language: [] },
      business_rules: [],
      acceptance_criteria: [],
      confidence: { level: 70, low_confidence_areas: [], assumptions: [] },
      escalations: [],
    });
    expect(result.success).toBe(false);
  });

  test("returns failure for unregistered agent", () => {
    const result = validateAgentOutput("nobody", {});
    expect(result.success).toBe(false);
    expect("error" in result && result.error).toContain("nobody");
  });
});

// ---------------------------------------------------------------------------
// parseAgentFrontmatter
// ---------------------------------------------------------------------------

describe("parseAgentFrontmatter", () => {
  let tmpFile: string;

  function writeTmp(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shaq-test-"));
    const fp = path.join(dir, "agent.md");
    fs.writeFileSync(fp, content, "utf-8");
    tmpFile = fp;
    return fp;
  }

  test("parses model and tools from standard frontmatter", () => {
    const fp = writeTmp(`---
name: bird
model: claude-opus-4-6
tools: Read, Grep, Glob, Bash, Skill
---
## Instructions
`);
    const fm = parseAgentFrontmatter(fp);
    expect(fm.model).toBe("claude-opus-4-6");
    expect(fm.tools).toEqual(["Read", "Grep", "Glob", "Bash", "Skill"]);
  });

  test("returns default model when model field absent", () => {
    const fp = writeTmp(`---
name: mystery
tools: Read
---
`);
    const fm = parseAgentFrontmatter(fp);
    expect(fm.model).toBe("claude-opus-5");
  });

  test("returns empty tools when tools field absent", () => {
    const fp = writeTmp(`---
name: mystery
model: claude-sonnet-4-6
---
`);
    const fm = parseAgentFrontmatter(fp);
    expect(fm.tools).toEqual([]);
  });

  test("parses disallowedTools field", () => {
    const fp = writeTmp(`---
name: shaq
model: claude-sonnet-4-6
disallowedTools: Task
---
`);
    const fm = parseAgentFrontmatter(fp);
    expect(fm.disallowedTools).toEqual(["Task"]);
  });

  test("parses actual bird.md frontmatter from repo", () => {
    const birdMd = path.join(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../.."),
      "agents/bird.md"
    );
    if (!fs.existsSync(birdMd)) return; // skip if not in repo context
    const fm = parseAgentFrontmatter(birdMd);
    expect(fm.model).toBe("claude-opus-5");
    expect(fm.tools).toContain("Read");
    expect(fm.tools).toContain("Bash");
  });
});

// ---------------------------------------------------------------------------
// Model resolution precedence (mirrors runAgentWithSchema fix for empty-string override)
// ---------------------------------------------------------------------------

describe("model resolution precedence", () => {
  /**
   * Simulates the fixed model-resolution logic from runAgentWithSchema.
   * Precedence: explicit CLI override (non-empty) → frontmatter model → "".
   */
  function resolveModel(optsModel: string | undefined, frontmatterModel: string): string {
    return (optsModel && optsModel.trim()) || frontmatterModel || "";
  }

  test("uses frontmatter model when opts.model is undefined", () => {
    expect(resolveModel(undefined, "claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("uses frontmatter model when opts.model is empty string (cli.ts default)", () => {
    // This was the bug: empty string from --model default was passed, causing API 400
    expect(resolveModel("", "claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("uses frontmatter model when opts.model is whitespace-only", () => {
    expect(resolveModel("   ", "claude-opus-4-6")).toBe("claude-opus-4-6");
  });

  test("uses explicit CLI override when opts.model is non-empty", () => {
    expect(resolveModel("claude-sonnet-4-5", "claude-opus-4-6")).toBe("claude-sonnet-4-5");
  });

  test("returns empty string (omit flag) when both opts.model and frontmatter model are empty", () => {
    expect(resolveModel("", "")).toBe("");
  });

  test("explicit override takes precedence over frontmatter even when frontmatter is also set", () => {
    expect(resolveModel("claude-haiku-3-5", "claude-opus-4-6")).toBe("claude-haiku-3-5");
  });
});
