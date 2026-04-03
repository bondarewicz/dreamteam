import { test, expect, describe } from "bun:test";
import { computeAgentSummaries, isCompleteBaseline } from "../assembler.ts";
import type { ScoredResult } from "../types.ts";

// ── isCompleteBaseline ────────────────────────────────────────────────────────

describe("isCompleteBaseline", () => {
  test("returns true when >=100 scenarios and >=80% of total", () => {
    expect(isCompleteBaseline(100, 120)).toBe(true);
    expect(isCompleteBaseline(120, 120)).toBe(true);
    expect(isCompleteBaseline(100, 100)).toBe(true);
  });

  test("returns false when fewer than 100 scenarios", () => {
    expect(isCompleteBaseline(99, 99)).toBe(false);
    expect(isCompleteBaseline(15, 120)).toBe(false);
  });

  test("returns false when < 80% of total", () => {
    // 100 scenarios, 130 total => 100/130 = 77% < 80%
    expect(isCompleteBaseline(100, 130)).toBe(false);
  });

  test("edge: exactly 80% of 125 = 100 scenarios", () => {
    expect(isCompleteBaseline(100, 125)).toBe(true);
  });

  test("given from handoff brief: 15 of 120 -> false", () => {
    expect(isCompleteBaseline(15, 120)).toBe(false);
  });
});

// ── computeAgentSummaries ─────────────────────────────────────────────────────

describe("computeAgentSummaries", () => {
  function makeResult(agent: string, score: "pass" | "partial" | "fail", confidence: number): ScoredResult {
    return {
      agent,
      scenario_id: "scenario-01",
      scenario_type: "happy-path",
      scenario_name: "Test",
      score,
      confidence_stated: confidence,
      justification: "",
      observations: [],
      agent_output_excerpt: "",
      duration_ms: 100,
      tokens_used: 50,
      input_tokens: 25,
      output_tokens: 25,
      cost_usd: 0.01,
      timestamp: "2026-01-01T00:00:00Z",
    };
  }

  test("computes pass_rate correctly", () => {
    const results = [
      makeResult("shaq", "pass", 80),
      makeResult("shaq", "pass", 90),
      makeResult("shaq", "fail", 70),
    ];
    const summaries = computeAgentSummaries(results);
    expect(summaries.shaq.pass).toBe(2);
    expect(summaries.shaq.partial).toBe(0);
    expect(summaries.shaq.fail).toBe(1);
    expect(summaries.shaq.pass_rate).toBeCloseTo(0.6667, 3);
  });

  test("computes avg_confidence_stated correctly", () => {
    const results = [
      makeResult("bird", "pass", 80),
      makeResult("bird", "pass", 90),
      makeResult("bird", "fail", 70),
    ];
    const summaries = computeAgentSummaries(results);
    expect(summaries.bird.avg_confidence_stated).toBe(80);
  });

  test("calibration_gap calculation from handoff brief", () => {
    // Given 2 pass (confidence 80, 90) and 1 fail (confidence 70):
    // avg_confidence = (80+90+70)/3 = 80
    // weighted_score = (2*100 + 0*50 + 1*0) / 3 = 200/3 = 66.67
    // calibration_gap = 80 - 66.67 = 13.3
    const results = [
      makeResult("mj", "pass", 80),
      makeResult("mj", "pass", 90),
      makeResult("mj", "fail", 70),
    ];
    const summaries = computeAgentSummaries(results);
    expect(summaries.mj.calibration_gap).toBeCloseTo(13.3, 0);
  });

  test("calibration_gap is null when no confidence data", () => {
    const result = makeResult("pippen", "pass", 0);
    result.confidence_stated = undefined as unknown as number;
    const summaries = computeAgentSummaries([result]);
    expect(summaries.pippen.calibration_gap).toBeNull();
    expect(summaries.pippen.avg_confidence_stated).toBeNull();
  });

  test("handles multiple agents", () => {
    const results = [
      makeResult("shaq", "pass", 85),
      makeResult("bird", "fail", 60),
      makeResult("shaq", "fail", 70),
    ];
    const summaries = computeAgentSummaries(results);
    expect(Object.keys(summaries)).toContain("shaq");
    expect(Object.keys(summaries)).toContain("bird");
    expect(summaries.shaq.pass).toBe(1);
    expect(summaries.shaq.fail).toBe(1);
    expect(summaries.bird.fail).toBe(1);
  });

  test("handles empty results", () => {
    const summaries = computeAgentSummaries([]);
    expect(Object.keys(summaries).length).toBe(0);
  });

  test("partial score weighted at 50", () => {
    // 1 partial (confidence 60), 0 pass, 0 fail
    // avg_confidence = 60
    // weighted_score = (0*100 + 1*50 + 0*0) / 1 = 50
    // calibration_gap = 60 - 50 = 10
    const results = [makeResult("magic", "partial", 60)];
    const summaries = computeAgentSummaries(results);
    expect(summaries.magic.calibration_gap).toBe(10);
  });
});
