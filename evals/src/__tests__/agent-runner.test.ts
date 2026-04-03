import { test, expect, describe } from "bun:test";
import { parseNdjson } from "../agent-runner.ts";

// ── parseNdjson ───────────────────────────────────────────────────────────────

describe("parseNdjson", () => {
  test("extracts agent_output from result event", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", content: "thinking..." }),
      JSON.stringify({ type: "result", result: "The answer is 42", usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01 }),
    ].join("\n");

    const result = parseNdjson(ndjson);
    expect(result.agentOutput).toBe("The answer is 42");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.tokensUsed).toBe(150);
    expect(result.costUsd).toBe(0.01);
  });

  test("extracts from LAST result event when multiple exist", () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: "first result", usage: { input_tokens: 10, output_tokens: 5 } }),
      JSON.stringify({ type: "result", result: "final result", usage: { input_tokens: 20, output_tokens: 10 }, total_cost_usd: 0.02 }),
    ].join("\n");

    const result = parseNdjson(ndjson);
    expect(result.agentOutput).toBe("final result");
    expect(result.inputTokens).toBe(20);
  });

  test("skips blank lines", () => {
    const ndjson = "\n\n" + JSON.stringify({ type: "result", result: "output", usage: {} }) + "\n\n";
    const result = parseNdjson(ndjson);
    expect(result.agentOutput).toBe("output");
  });

  test("skips non-JSON lines", () => {
    const ndjson = [
      "not json at all",
      "also not json",
      JSON.stringify({ type: "result", result: "real output", usage: {} }),
    ].join("\n");

    const result = parseNdjson(ndjson);
    expect(result.agentOutput).toBe("real output");
  });

  test("falls back to raw stdout when no result event", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", content: "something" }),
    ].join("\n");

    const result = parseNdjson(ndjson);
    // Falls back to raw stdout
    expect(result.agentOutput).toBe(ndjson);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  test("handles result event with object result (JSON-stringified)", () => {
    const resultObj = { score: "pass", confidence: 90 };
    const ndjson = JSON.stringify({
      type: "result",
      result: resultObj,
      usage: { input_tokens: 50, output_tokens: 25 },
    });

    const result = parseNdjson(ndjson);
    expect(result.agentOutput).toBe(JSON.stringify(resultObj));
  });

  test("populates trace with all parseable events", () => {
    const events = [
      { type: "system", subtype: "init" },
      { type: "assistant", content: "text" },
      { type: "result", result: "done", usage: {} },
    ];
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n");

    const result = parseNdjson(ndjson);
    expect(result.trace.length).toBe(3);
  });

  test("handles empty string", () => {
    const result = parseNdjson("");
    expect(result.agentOutput).toBe("");
    expect(result.inputTokens).toBe(0);
    expect(result.trace).toEqual([]);
  });

  test("handles NDJSON with missing usage fields (defaults to 0)", () => {
    const ndjson = JSON.stringify({ type: "result", result: "output" });
    const result = parseNdjson(ndjson);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.costUsd).toBe(0);
  });
});
