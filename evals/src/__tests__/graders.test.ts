import { test, expect, describe } from "bun:test";
import { runGrader, runAllGraders } from "../graders.ts";
import type { GraderDef } from "../types.ts";

// ── json_valid ────────────────────────────────────────────────────────────────

describe("json_valid grader", () => {
  const g: GraderDef = { type: "json_valid" };

  test("passes for valid JSON object", () => {
    expect(runGrader(g, '{"key": "value"}').passed).toBe(true);
  });

  test("passes for JSON embedded in prose", () => {
    expect(runGrader(g, 'Some text {"key": "val"} more text').passed).toBe(true);
  });

  test("passes for JSON in fences", () => {
    expect(runGrader(g, '```json\n{"score": "pass"}\n```').passed).toBe(true);
  });

  test("fails for plain text", () => {
    const result = runGrader(g, "No JSON here");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("no valid JSON");
  });

  test("fails for empty string", () => {
    expect(runGrader(g, "").passed).toBe(false);
  });
});

// ── contains ──────────────────────────────────────────────────────────────────

describe("contains grader", () => {
  test("passes when all values present (case insensitive)", () => {
    const g: GraderDef = { type: "contains", values: ["hello", "world"] };
    expect(runGrader(g, "Hello World").passed).toBe(true);
  });

  test("passes for business_rules normalization (the key acceptance criterion)", () => {
    const g: GraderDef = { type: "contains", values: ["business rules"], case_sensitive: false };
    expect(runGrader(g, "Business_Rules are important").passed).toBe(true);
  });

  test("normalizes hyphens to spaces", () => {
    const g: GraderDef = { type: "contains", values: ["some value"] };
    expect(runGrader(g, "some-value here").passed).toBe(true);
  });

  test("collapses multiple separators to single space", () => {
    const g: GraderDef = { type: "contains", values: ["hello world"] };
    expect(runGrader(g, "hello   world").passed).toBe(true);
    expect(runGrader(g, "hello___world").passed).toBe(true);
    expect(runGrader(g, "hello---world").passed).toBe(true);
  });

  test("fails when value missing", () => {
    const g: GraderDef = { type: "contains", values: ["missing"] };
    const result = runGrader(g, "this text does not have it");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("missing values");
  });

  test("case sensitive mode works", () => {
    const g: GraderDef = { type: "contains", values: ["Hello"], case_sensitive: true };
    expect(runGrader(g, "hello").passed).toBe(false);
    expect(runGrader(g, "Hello").passed).toBe(true);
  });

  test("handles string values (not array)", () => {
    const g: GraderDef = { type: "contains", values: "hello" };
    expect(runGrader(g, "hello world").passed).toBe(true);
  });
});

// ── not_contains ──────────────────────────────────────────────────────────────

describe("not_contains grader", () => {
  test("passes when forbidden value absent", () => {
    const g: GraderDef = { type: "not_contains", values: ["forbidden"] };
    expect(runGrader(g, "this is clean output").passed).toBe(true);
  });

  test("fails when forbidden value present", () => {
    const g: GraderDef = { type: "not_contains", values: ["forbidden"] };
    const result = runGrader(g, "this has forbidden content");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("forbidden values found");
  });

  test("normalizes underscores/hyphens like contains", () => {
    const g: GraderDef = { type: "not_contains", values: ["bad value"] };
    expect(runGrader(g, "bad_value here").passed).toBe(false);
  });

  test("case sensitive mode works", () => {
    const g: GraderDef = { type: "not_contains", values: ["Bad"], case_sensitive: true };
    expect(runGrader(g, "bad").passed).toBe(true);
    expect(runGrader(g, "Bad").passed).toBe(false);
  });
});

// ── regex ─────────────────────────────────────────────────────────────────────

describe("regex grader", () => {
  test("passes when pattern matches", () => {
    const g: GraderDef = { type: "regex", pattern: "\\d{3}-\\d{4}" };
    expect(runGrader(g, "Call 555-1234 for info").passed).toBe(true);
  });

  test("fails when pattern does not match", () => {
    const g: GraderDef = { type: "regex", pattern: "^pass$" };
    const result = runGrader(g, "fail");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("pattern not found");
  });

  test("fails gracefully for invalid regex", () => {
    const g: GraderDef = { type: "regex", pattern: "[invalid" };
    const result = runGrader(g, "anything");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("invalid regex");
  });
});

// ── section_present ───────────────────────────────────────────────────────────

describe("section_present grader", () => {
  test("passes when all sections present", () => {
    const g: GraderDef = { type: "section_present", sections: ["## Summary", "## Conclusion"] };
    expect(runGrader(g, "## Summary\nText\n## Conclusion\nDone").passed).toBe(true);
  });

  test("fails when section missing", () => {
    const g: GraderDef = { type: "section_present", sections: ["## Missing"] };
    const result = runGrader(g, "## Present\nContent");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("missing sections");
  });

  test("normalizes separators like contains", () => {
    const g: GraderDef = { type: "section_present", sections: ["my section"] };
    expect(runGrader(g, "my_section content").passed).toBe(true);
  });

  test("handles string sections (not array)", () => {
    const g: GraderDef = { type: "section_present", sections: "hello" };
    expect(runGrader(g, "hello world").passed).toBe(true);
  });
});

// ── field_count ───────────────────────────────────────────────────────────────

describe("field_count grader", () => {
  test("passes when count within bounds", () => {
    const g: GraderDef = { type: "field_count", pattern: "item", min: 2, max: 5 };
    expect(runGrader(g, "item one item two item three").passed).toBe(true);
  });

  test("fails when count below min", () => {
    const g: GraderDef = { type: "field_count", pattern: "item", min: 3 };
    const result = runGrader(g, "only one item here");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("below minimum");
  });

  test("fails when count above max", () => {
    const g: GraderDef = { type: "field_count", pattern: "x", max: 2 };
    const result = runGrader(g, "x x x x x");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("above maximum");
  });

  test("fails for invalid regex", () => {
    const g: GraderDef = { type: "field_count", pattern: "[invalid" };
    expect(runGrader(g, "text").passed).toBe(false);
  });
});

// ── length_bounds ─────────────────────────────────────────────────────────────

describe("length_bounds grader", () => {
  test("passes within bounds", () => {
    const g: GraderDef = { type: "length_bounds", min: 5, max: 100 };
    expect(runGrader(g, "hello world").passed).toBe(true);
  });

  test("fails when too short", () => {
    const g: GraderDef = { type: "length_bounds", min: 100 };
    const result = runGrader(g, "short");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("below minimum");
  });

  test("fails when too long", () => {
    const g: GraderDef = { type: "length_bounds", max: 5 };
    const result = runGrader(g, "this is way too long");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("above maximum");
  });

  test("passes with only min", () => {
    const g: GraderDef = { type: "length_bounds", min: 3 };
    expect(runGrader(g, "hello").passed).toBe(true);
  });
});

// ── json_field ────────────────────────────────────────────────────────────────

describe("json_field grader", () => {
  test("passes when field exists", () => {
    const g: GraderDef = { type: "json_field", path: "score" };
    expect(runGrader(g, '{"score": "pass"}').passed).toBe(true);
  });

  test("fails when field missing", () => {
    const g: GraderDef = { type: "json_field", path: "missing_field" };
    const result = runGrader(g, '{"other": "value"}');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("not found");
  });

  test("fails when no JSON in output", () => {
    const g: GraderDef = { type: "json_field", path: "score" };
    const result = runGrader(g, "not json");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("no valid JSON");
  });

  test("min check passes", () => {
    const g: GraderDef = { type: "json_field", path: "confidence", min: 85 };
    expect(runGrader(g, '{"confidence": 90}').passed).toBe(true);
  });

  test("min check fails", () => {
    const g: GraderDef = { type: "json_field", path: "confidence", min: 85 };
    const result = runGrader(g, '{"confidence": 80}');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("below min");
  });

  test("max check", () => {
    const g: GraderDef = { type: "json_field", path: "score_val", max: 10 };
    expect(runGrader(g, '{"score_val": 5}').passed).toBe(true);
    expect(runGrader(g, '{"score_val": 15}').passed).toBe(false);
  });

  test("min_items check", () => {
    const g: GraderDef = { type: "json_field", path: "items", min_items: 2 };
    expect(runGrader(g, '{"items": [1, 2, 3]}').passed).toBe(true);
    const result = runGrader(g, '{"items": [1]}');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("below min_items");
  });

  test("max_items check", () => {
    const g: GraderDef = { type: "json_field", path: "items", max_items: 2 };
    expect(runGrader(g, '{"items": [1, 2]}').passed).toBe(true);
    const result = runGrader(g, '{"items": [1, 2, 3, 4]}');
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("above max_items");
  });

  test("type_check: boolean", () => {
    const g: GraderDef = { type: "json_field", path: "flag", type_check: "boolean" };
    expect(runGrader(g, '{"flag": true}').passed).toBe(true);
    expect(runGrader(g, '{"flag": false}').passed).toBe(true);
    expect(runGrader(g, '{"flag": 1}').passed).toBe(false);
    expect(runGrader(g, '{"flag": "true"}').passed).toBe(false);
  });

  test("type_check: number (excludes boolean)", () => {
    const g: GraderDef = { type: "json_field", path: "val", type_check: "number" };
    expect(runGrader(g, '{"val": 42}').passed).toBe(true);
    expect(runGrader(g, '{"val": 3.14}').passed).toBe(true);
    expect(runGrader(g, '{"val": true}').passed).toBe(false); // boolean excluded
    expect(runGrader(g, '{"val": "42"}').passed).toBe(false);
  });

  test("type_check: string", () => {
    const g: GraderDef = { type: "json_field", path: "name", type_check: "string" };
    expect(runGrader(g, '{"name": "hello"}').passed).toBe(true);
    expect(runGrader(g, '{"name": 123}').passed).toBe(false);
  });

  test("type_check: array", () => {
    const g: GraderDef = { type: "json_field", path: "list", type_check: "array" };
    expect(runGrader(g, '{"list": [1, 2]}').passed).toBe(true);
    expect(runGrader(g, '{"list": {}}').passed).toBe(false);
  });

  test("type_check: object", () => {
    const g: GraderDef = { type: "json_field", path: "obj", type_check: "object" };
    expect(runGrader(g, '{"obj": {"key": "val"}}').passed).toBe(true);
    expect(runGrader(g, '{"obj": []}').passed).toBe(false);
    expect(runGrader(g, '{"obj": null}').passed).toBe(false);
  });

  test("equals check", () => {
    const g: GraderDef = { type: "json_field", path: "status", equals: "active" };
    expect(runGrader(g, '{"status": "active"}').passed).toBe(true);
    expect(runGrader(g, '{"status": "inactive"}').passed).toBe(false);
  });

  test("equals: null asserts field value is null (not skipped)", () => {
    // Before fix: equals: null was indistinguishable from 'no equals check'
    // After fix: hasOwnProperty sentinel means equals: null asserts the field IS null
    const g: GraderDef = { type: "json_field", path: "val", equals: null };
    expect(runGrader(g, '{"val": null}').passed).toBe(true);
    expect(runGrader(g, '{"val": "something"}').passed).toBe(false);
  });

  test("contains: null asserts field value is null (not skipped)", () => {
    const g: GraderDef = { type: "json_field", path: "val", contains: null };
    expect(runGrader(g, '{"val": null}').passed).toBe(true);
    expect(runGrader(g, '{"val": "something"}').passed).toBe(false);
  });

  test("contains check on non-wildcard path", () => {
    const g: GraderDef = { type: "json_field", path: "status", contains: "active" };
    expect(runGrader(g, '{"status": "active"}').passed).toBe(true);
    expect(runGrader(g, '{"status": "inactive"}').passed).toBe(false);
  });

  test("dot-path navigation", () => {
    const g: GraderDef = { type: "json_field", path: "outer.inner" };
    expect(runGrader(g, '{"outer": {"inner": "value"}}').passed).toBe(true);
  });

  test("deep dot-path navigation", () => {
    const g: GraderDef = { type: "json_field", path: "a.b.c", type_check: "number" };
    expect(runGrader(g, '{"a": {"b": {"c": 42}}}').passed).toBe(true);
  });

  test("[*] wildcard type_check on array elements", () => {
    const g: GraderDef = {
      type: "json_field",
      path: "business_rules.[*].invariant",
      type_check: "boolean",
    };
    const output = JSON.stringify({
      business_rules: [
        { invariant: true, name: "rule1" },
        { invariant: false, name: "rule2" },
      ],
    });
    expect(runGrader(g, output).passed).toBe(true);
  });

  test("[*] wildcard fails when element has wrong type", () => {
    const g: GraderDef = {
      type: "json_field",
      path: "rules.[*].flag",
      type_check: "boolean",
    };
    const output = JSON.stringify({
      rules: [{ flag: true }, { flag: "not-a-boolean" }],
    });
    const result = runGrader(g, output);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('type_check "boolean" failed');
  });

  test("[*] wildcard on non-array returns null/fail", () => {
    const g: GraderDef = { type: "json_field", path: "obj.[*].field" };
    const output = JSON.stringify({ obj: { field: "value" } }); // obj is not array
    const result = runGrader(g, output);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("not found");
  });

  test("exists: false check — field correctly absent", () => {
    const g: GraderDef = { type: "json_field", path: "secret_field", exists: false };
    expect(runGrader(g, '{"other": "value"}').passed).toBe(true);
    expect(runGrader(g, '{"secret_field": "oops"}').passed).toBe(false);
  });

  test("unknown grader type returns fail", () => {
    const g: GraderDef = { type: "unknown_grader_type" };
    const result = runGrader(g, "output");
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("unknown grader type");
  });
});

// ── runAllGraders ─────────────────────────────────────────────────────────────

describe("runAllGraders", () => {
  test("returns grader_override=false when all pass", () => {
    const graders: GraderDef[] = [
      { type: "json_valid" },
      { type: "contains", values: ["pass"] },
    ];
    const { results, graderOverride } = runAllGraders(graders, '{"pass": true}');
    expect(graderOverride).toBe(false);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("returns grader_override=true when any grader fails", () => {
    const graders: GraderDef[] = [
      { type: "json_valid" },
      { type: "contains", values: ["missing_value"] },
    ];
    const { graderOverride } = runAllGraders(graders, '{"key": "value"}');
    expect(graderOverride).toBe(true);
  });

  test("grader override result includes both results", () => {
    const graders: GraderDef[] = [
      { type: "json_valid" },
      { type: "contains", values: ["nope"] },
    ];
    const { results } = runAllGraders(graders, '{"key": "value"}');
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});
