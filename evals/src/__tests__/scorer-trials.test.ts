/**
 * scorer-trials.test.ts
 *
 * Tests for scoreSingleTrial and scoreScenarioAllTrials covering:
 *  - No raw output file → returns null (skip path)
 *  - Grader hard gate: graderOverride=true forces score to "fail"
 *  - No parsed score from LLM → forces score to "fail"
 *  - Retry: first LLM call returns unparseable output, second returns valid JSON
 *  - Multi-trial aggregation: flaky and pass_hat_k flags
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { ClaudeAdapter, GraderResult, RawOutput } from "../types.ts";
import { scoreSingleTrial, scoreScenarioAllTrials } from "../scorer.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRawOutput(overrides: Partial<RawOutput> = {}): RawOutput {
  return {
    agent: "shaq",
    scenario_id: "scenario-01",
    agent_output: '{"answer": "done"}',
    agent_output_excerpt: '{"answer": "done"}',
    duration_ms: 100,
    tokens_used: 50,
    input_tokens: 25,
    output_tokens: 25,
    cost_usd: 0.01,
    timestamp: "2026-01-01T00:00:00Z",
    trace: [],
    ...overrides,
  };
}

function makeScoreResponse(score: "pass" | "partial" | "fail", confidence = 80): string {
  return JSON.stringify({
    score,
    confidence_stated: confidence,
    justification: "Looks good",
    observations: [],
  });
}

function makeScoreFields() {
  return {
    expectedBehavior: "Agent should return correct answer",
    failureModes: "Agent hallucinates",
    scoringRubric: "Pass if correct, fail otherwise",
    scenarioName: "Test Scenario",
    scenarioType: "happy-path",
    category: "core",
  };
}

class MockAdapter implements ClaudeAdapter {
  private responses: string[];
  private callCount = 0;
  public calls: Array<{ args: string[]; stdin: string }> = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async run(args: string[], stdin: string): Promise<{ stdout: string; exitCode: number }> {
    this.calls.push({ args, stdin });
    const response = this.responses[this.callCount] ?? makeScoreResponse("fail");
    this.callCount++;
    return { stdout: response, exitCode: 0 };
  }
}

// ── scoreSingleTrial ──────────────────────────────────────────────────────────

describe("scoreSingleTrial", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null when raw output file does not exist", async () => {
    const adapter = new MockAdapter([makeScoreResponse("pass")]);
    const missingPath = path.join(tmpDir, "shaq-scenario-missing.json");

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-missing",
      missingPath,
      makeScoreFields(),
      [],
      false,
      adapter,
      5000,
      0,
      1
    );

    expect(result).toBeNull();
    expect(adapter.calls).toHaveLength(0); // no LLM call made
  });

  test("returns scored result when raw output exists and LLM returns pass", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    fs.writeFileSync(rawPath, JSON.stringify(makeRawOutput()));

    const adapter = new MockAdapter([makeScoreResponse("pass", 90)]);

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      [],
      false,
      adapter,
      5000,
      0,
      1
    );

    expect(result).not.toBeNull();
    expect(result!.score).toBe("pass");
    expect(result!.confidence_stated).toBe(90);
    expect(adapter.calls).toHaveLength(1);
  });

  test("grader hard gate: graderOverride=true forces score to 'fail' even if LLM says 'pass'", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    fs.writeFileSync(rawPath, JSON.stringify(makeRawOutput()));

    const adapter = new MockAdapter([makeScoreResponse("pass", 95)]);
    const graderResults: GraderResult[] = [
      { type: "json_valid", config: {}, passed: false, detail: "no valid JSON found" },
    ];

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      graderResults,
      true, // graderOverride
      adapter,
      5000,
      0,
      1
    );

    expect(result).not.toBeNull();
    expect(result!.score).toBe("fail"); // hard gate overrides LLM "pass"
    expect(result!.grader_override).toBe(true);
    expect(result!.grader_results).toEqual(graderResults);
  });

  test("score forced to 'fail' when LLM returns unparseable output (after retry)", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    fs.writeFileSync(rawPath, JSON.stringify(makeRawOutput()));

    // Both attempts return unparseable output
    const adapter = new MockAdapter(["not json at all", "still not json"]);

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      [],
      false,
      adapter,
      5000,
      0,
      1
    );

    expect(result).not.toBeNull();
    expect(result!.score).toBe("fail");
    expect(result!.confidence_stated).toBe(0);
    expect(adapter.calls).toHaveLength(2); // one retry was made
  });

  test("retry succeeds: first LLM call returns garbage, second returns valid JSON", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    fs.writeFileSync(rawPath, JSON.stringify(makeRawOutput()));

    const adapter = new MockAdapter([
      "not parseable garbage",    // first attempt fails
      makeScoreResponse("partial", 70), // retry succeeds
    ]);

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      [],
      false,
      adapter,
      5000,
      0,
      1
    );

    expect(result).not.toBeNull();
    expect(result!.score).toBe("partial");
    expect(result!.confidence_stated).toBe(70);
    expect(adapter.calls).toHaveLength(2); // retry fired
  });

  test("attaches grader_results to result when graders are present", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    fs.writeFileSync(rawPath, JSON.stringify(makeRawOutput()));

    const graderResults: GraderResult[] = [
      { type: "json_valid", config: {}, passed: true, detail: "valid JSON" },
      { type: "contains", config: { values: ["answer"] }, passed: true, detail: "found" },
    ];

    const adapter = new MockAdapter([makeScoreResponse("pass")]);

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      graderResults,
      false, // no override
      adapter,
      5000,
      0,
      1
    );

    expect(result).not.toBeNull();
    expect(result!.grader_results).toEqual(graderResults);
    expect(result!.grader_override).toBeUndefined(); // not set when no override
  });

  test("preserves raw output metadata (duration, tokens, cost) in result", async () => {
    const rawPath = path.join(tmpDir, "shaq-scenario-01.json");
    const raw = makeRawOutput({
      duration_ms: 4200,
      tokens_used: 300,
      input_tokens: 200,
      output_tokens: 100,
      cost_usd: 0.05,
      timestamp: "2026-05-26T12:00:00Z",
    });
    fs.writeFileSync(rawPath, JSON.stringify(raw));

    const adapter = new MockAdapter([makeScoreResponse("pass")]);

    const result = await scoreSingleTrial(
      "shaq",
      "scenario-01",
      rawPath,
      makeScoreFields(),
      [],
      false,
      adapter,
      5000,
      0,
      1
    );

    expect(result!.duration_ms).toBe(4200);
    expect(result!.tokens_used).toBe(300);
    expect(result!.input_tokens).toBe(200);
    expect(result!.output_tokens).toBe(100);
    expect(result!.cost_usd).toBe(0.05);
    expect(result!.timestamp).toBe("2026-05-26T12:00:00Z");
  });
});

// ── scoreScenarioAllTrials — flaky / pass_hat_k ───────────────────────────────

describe("scoreScenarioAllTrials — multi-trial flaky/pass_hat_k detection", () => {
  let tmpDir: string;
  let rawDir: string;
  let scoredDir: string;
  let scenarioFile: string;

  const SCENARIO_CONTENT = `---
scenario_id: scenario-01
scenario_type: happy-path
scenario_name: Test Scenario
category: core
---

prompt:
  Do something useful.

expected_behavior:
  Returns correct output.

failure_modes:
  Returns wrong output.

scoring_rubric:
  Pass if correct.
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorer-trials-test-"));
    rawDir = path.join(tmpDir, "raw");
    scoredDir = path.join(tmpDir, "scored");
    fs.mkdirSync(rawDir);
    fs.mkdirSync(scoredDir);
    scenarioFile = path.join(tmpDir, "scenario-01.md");
    fs.writeFileSync(scenarioFile, SCENARIO_CONTENT);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRaw(filename: string, overrides: Partial<RawOutput> = {}) {
    fs.writeFileSync(path.join(rawDir, filename), JSON.stringify(makeRawOutput(overrides)));
  }

  test("single trial: no flaky/pass_hat_k fields set", async () => {
    writeRaw("shaq-scenario-01.json");
    const adapter = new MockAdapter([makeScoreResponse("pass")]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 1
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));
    expect(scored.flaky).toBeUndefined();
    expect(scored.pass_hat_k).toBeUndefined();
    expect(scored.trials).toBeUndefined();
  });

  test("trials=2, both pass → flaky=false, pass_hat_k=true", async () => {
    writeRaw("shaq-scenario-01.json");
    writeRaw("shaq-scenario-01-t1.json");

    const adapter = new MockAdapter([
      makeScoreResponse("pass"),
      makeScoreResponse("pass"),
    ]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 2
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));
    expect(scored.flaky).toBe(false);
    expect(scored.pass_hat_k).toBe(true);
    expect(scored.trials).toHaveLength(2);
  });

  test("trials=2, pass then fail → flaky=true, pass_hat_k=true", async () => {
    writeRaw("shaq-scenario-01.json");
    writeRaw("shaq-scenario-01-t1.json");

    const adapter = new MockAdapter([
      makeScoreResponse("pass"),
      makeScoreResponse("fail"),
    ]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 2
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));
    expect(scored.flaky).toBe(true);
    expect(scored.pass_hat_k).toBe(true);
  });

  test("trials=2, both fail → flaky=false, pass_hat_k=false", async () => {
    writeRaw("shaq-scenario-01.json");
    writeRaw("shaq-scenario-01-t1.json");

    const adapter = new MockAdapter([
      makeScoreResponse("fail"),
      makeScoreResponse("fail"),
    ]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 2
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));
    expect(scored.flaky).toBe(false);
    expect(scored.pass_hat_k).toBe(false);
  });

  test("trials=3, mixed → pass_hat_k=true when at least one trial passes", async () => {
    writeRaw("shaq-scenario-01.json");
    writeRaw("shaq-scenario-01-t1.json");
    writeRaw("shaq-scenario-01-t2.json");

    const adapter = new MockAdapter([
      makeScoreResponse("fail"),
      makeScoreResponse("fail"),
      makeScoreResponse("pass"),
    ]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 3
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));
    expect(scored.pass_hat_k).toBe(true);
    expect(scored.flaky).toBe(true);
    expect(scored.trials).toHaveLength(3);
  });

  test("returns null when no raw output files exist for any trial", async () => {
    // No raw output written — nothing to score
    const adapter = new MockAdapter([]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 2
    );

    expect(scoredPath).toBeNull();
  });

  test("writes valid JSON to scored file with expected top-level fields", async () => {
    writeRaw("shaq-scenario-01.json");
    const adapter = new MockAdapter([makeScoreResponse("partial", 72)]);

    const scoredPath = await scoreScenarioAllTrials(
      scenarioFile, rawDir, scoredDir,
      "shaq", "scenario-01",
      new Map(), new Map(),
      adapter, 5000, 1
    );

    expect(scoredPath).not.toBeNull();
    const scored = JSON.parse(fs.readFileSync(scoredPath!, "utf-8"));

    expect(scored.agent).toBe("shaq");
    expect(scored.scenario_id).toBe("scenario-01");
    expect(scored.score).toBe("partial");
    expect(scored.confidence_stated).toBe(72);
    expect(typeof scored.justification).toBe("string");
    expect(Array.isArray(scored.observations)).toBe(true);
  });
});
