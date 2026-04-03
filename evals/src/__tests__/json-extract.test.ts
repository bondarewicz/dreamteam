import { test, expect, describe } from "bun:test";
import { extractJson, hasJson } from "../json-extract.ts";

describe("extractJson", () => {
  describe("Strategy 1: direct parse", () => {
    test("parses a clean JSON object", () => {
      const result = extractJson('{"score": "pass", "confidence": 90}');
      expect(result).toEqual({ score: "pass", confidence: 90 });
    });

    test("parses a clean JSON array", () => {
      const result = extractJson('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    test("parses JSON with surrounding whitespace", () => {
      const result = extractJson('  {"key": "value"}  ');
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("Strategy 2: fence stripping", () => {
    test("extracts JSON from ```json fences", () => {
      const output = 'Here is my output:\n```json\n{"score": "pass"}\n```\nDone.';
      const result = extractJson(output);
      expect(result).toEqual({ score: "pass" });
    });

    test("extracts JSON from plain ``` fences", () => {
      const output = 'Result:\n```\n{"score": "fail"}\n```';
      const result = extractJson(output);
      expect(result).toEqual({ score: "fail" });
    });

    test("handles multiline JSON in fences", () => {
      const output = '```json\n{\n  "score": "partial",\n  "confidence": 70\n}\n```';
      const result = extractJson(output);
      expect(result).toEqual({ score: "partial", confidence: 70 });
    });
  });

  describe("Strategy 3: brace-depth scan", () => {
    test("extracts JSON object embedded in prose", () => {
      const output = 'Here is my analysis: {"score": "pass", "confidence": 85} And that is all.';
      const result = extractJson(output);
      expect(result).toEqual({ score: "pass", confidence: 85 });
    });

    test("extracts JSON array embedded in prose", () => {
      const output = 'The results are: [1, 2, 3] finished.';
      const result = extractJson(output);
      expect(result).toEqual([1, 2, 3]);
    });

    test("handles nested JSON objects", () => {
      const output = 'Output: {"outer": {"inner": "value"}}';
      const result = extractJson(output);
      expect(result).toEqual({ outer: { inner: "value" } });
    });

    test("handles braces inside JSON string values (string boundary fix)", () => {
      // Without string tracking, the '}' inside the string value would close depth early
      const output = 'Here: {"key": "value with } brace inside", "other": 42}';
      const result = extractJson(output);
      expect(result).toEqual({ key: "value with } brace inside", other: 42 });
    });

    test("handles escaped quotes inside JSON strings", () => {
      const output = 'Here: {"msg": "say \\"hello\\" world", "score": "pass"}';
      const result = extractJson(output);
      expect(result).toEqual({ msg: 'say "hello" world', score: "pass" });
    });

    test("extracts first valid JSON when multiple exist", () => {
      const output = 'First: {"a": 1} Second: {"b": 2}';
      const result = extractJson(output);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("failure cases", () => {
    test("returns null for empty string", () => {
      expect(extractJson("")).toBeNull();
    });

    test("returns null for plain text", () => {
      expect(extractJson("This is just some text with no JSON")).toBeNull();
    });

    test("returns null for malformed JSON", () => {
      expect(extractJson("{invalid json}")).toBeNull();
    });
  });
});

describe("hasJson", () => {
  test("returns true for valid JSON object", () => {
    expect(hasJson('{"key": "value"}')).toBe(true);
  });

  test("returns true for JSON embedded in prose", () => {
    expect(hasJson('Some text {"key": "val"} more text')).toBe(true);
  });

  test("returns false for plain text", () => {
    expect(hasJson("No JSON here")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasJson("")).toBe(false);
  });
});
