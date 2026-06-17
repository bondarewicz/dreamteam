import { test, expect } from "bun:test";
import { buildTrace } from "../../../evals/src/provider-backends.ts";
import { TraceViewerPage } from "../views/TraceViewer.ts";
import type { EvalResult } from "../db.ts";

function resultWithTrace(trace: unknown[]): EvalResult {
  return {
    id: 1, run_id: "eval/run-x", agent: "bird", scenario_id: "s1", trial_index: 0,
    score: "pass", confidence_stated: 90, justification: "", observations: "",
    grader_results: "[]", grader_override: 0, duration_ms: 100, tokens_used: 10,
    input_tokens: 5, output_tokens: 5, cost_usd: 0, agent_output_excerpt: "",
    failure_reason: "", trace: JSON.stringify(trace), agent_output: "{}",
    scenario_name: "s1", scenario_type: null, category: null,
  } as unknown as EvalResult;
}

test("buildTrace yields system/user/assistant/result events", () => {
  const t = buildTrace({ provider: "ollama", model: "gemma4", userPrompt: "do x", responseText: "{}", inputTokens: 4, outputTokens: 6, durationMs: 1200 });
  expect(t.map((e: any) => e.type)).toEqual(["system", "user", "assistant", "result"]);
});

test("a provider trace renders in the viewer (not the empty state)", () => {
  const t = buildTrace({ provider: "codex", model: "gpt-5.5", userPrompt: "implement x", responseText: '{"ok":true}', inputTokens: 0, outputTokens: 0, durationMs: 3400, reasoning: "thought about it then wrote files" });
  const html = TraceViewerPage(resultWithTrace(t), "eval/run-x");
  expect(html).not.toContain("No trace data available");
  expect(html).toContain("codex backend");      // system event
  expect(html).toContain("implement x");          // user prompt
  expect(html).toContain("thought about it");     // codex reasoning → thinking block
  expect(html).toContain("Result");               // result event
});

test("error trace still renders (no crash, shows the error note)", () => {
  const t = buildTrace({ provider: "gemini", model: "gemini-2.5-flash", userPrompt: "p", responseText: "", inputTokens: 0, outputTokens: 0, durationMs: 50, error: "gemini exit 1" });
  const html = TraceViewerPage(resultWithTrace(t), "eval/run-x");
  expect(html).not.toContain("No trace data available");
  expect(html).toContain("gemini exit 1");
});
