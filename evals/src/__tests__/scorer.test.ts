import { test, expect, describe } from "bun:test";
import { parseScoreJson } from "../scorer.ts";

// ── parseScoreJson ────────────────────────────────────────────────────────────

describe("parseScoreJson", () => {
  test("parses clean JSON object", () => {
    const raw = '{"score": "pass", "confidence_stated": 90, "justification": "Good"}';
    const result = parseScoreJson(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBe("pass");
    expect(result!.confidence_stated).toBe(90);
  });

  test("extracts JSON from prose", () => {
    const raw = 'Here is my analysis:\n{"score": "partial", "confidence_stated": 70, "justification": "Mostly good"}';
    const result = parseScoreJson(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBe("partial");
  });

  test("extracts JSON from markdown fences", () => {
    const raw = 'My scoring:\n```json\n{"score": "fail", "confidence_stated": 30, "justification": "Missing"}\n```';
    const result = parseScoreJson(raw);
    expect(result).not.toBeNull();
    expect(result!.score).toBe("fail");
  });

  test("returns null for completely invalid input", () => {
    expect(parseScoreJson("totally not json")).toBeNull();
    expect(parseScoreJson("")).toBeNull();
  });

  test("returns null for JSON array (not an object)", () => {
    expect(parseScoreJson("[1, 2, 3]")).toBeNull();
  });

  test("Score enum: 'Pass' (capitalized) is NOT normalized to 'pass'", () => {
    // The spec says: 'Pass' is invalid, not silently lowercased
    // parseScoreJson still parses the object, but the score value remains 'Pass'
    // The caller (scoreSingleTrial) is responsible for checking VALID_SCORES
    const result = parseScoreJson('{"score": "Pass", "confidence_stated": 80}');
    expect(result).not.toBeNull();
    expect(result!.score).toBe("Pass"); // unchanged, not 'pass'
  });
});
