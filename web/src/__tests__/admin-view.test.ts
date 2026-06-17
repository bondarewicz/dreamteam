import { test, expect } from "bun:test";
import { AdminModelsPage, type AgentModelRow } from "../views/Admin.ts";
import type { ModelsResult } from "../models-api.ts";

const models: ModelsResult = {
  fetchedAt: Date.now(),
  source: "fallback",
  providerNotes: [],
  models: [
    { id: "claude-opus-4-8", displayName: "claude-opus-4-8", provider: "claude", createdAt: "" },
    { id: "ollama/qwen3.6", displayName: "qwen3.6", provider: "ollama", createdAt: "" },
    { id: "ollama/gemma4", displayName: "gemma4", provider: "ollama", createdAt: "" },
    { id: "gemini/gemini-2.5-pro", displayName: "gemini-2.5-pro", provider: "gemini", createdAt: "" },
    { id: "codex/gpt-5.5", displayName: "gpt-5.5", provider: "codex", createdAt: "" },
  ],
};

const rows: AgentModelRow[] = [
  { agent: "bird", spec: { tier: "deep", pin: {} } },
  { agent: "drexler", spec: { tier: "mid", pin: { ollama: "gemma4" } } },
];

test("renders a tier select + 4 pin selects per agent", () => {
  const html = AdminModelsPage(rows, models);
  expect((html.match(/name="tier__/g) ?? []).length).toBe(2);
  expect((html.match(/name="pin__/g) ?? []).length).toBe(8); // 4 providers × 2 agents
  expect(html).toContain('name="tier__bird"');
  expect(html).toContain('name="pin__drexler__ollama"');
});

test("current tier is preselected", () => {
  const html = AdminModelsPage([rows[0]], models);
  expect(html).toMatch(/<option value="deep" selected>deep<\/option>/);
});

test("a set pin is preselected; unset pins show the tier-default option", () => {
  const html = AdminModelsPage([rows[1]], models); // drexler mid, ollama=gemma4
  expect(html).toContain('<option value="gemma4" selected>gemma4</option>');
  // claude has no pin → tier-default option present (empty value), labels the default
  expect(html).toContain("default for mid → claude-sonnet-4-6");
});

test("resolved 'runs as' line reflects tier + pin, highlighting overrides", () => {
  const html = AdminModelsPage([rows[1]], models); // mid + ollama gemma4
  expect(html).toContain("runs as");
  expect(html).toContain("Claude <b>claude-sonnet-4-6</b>"); // mid claude default
  expect(html).toContain('Ollama <b>gemma4</b>');            // pinned
  expect(html).toContain("Gemini <b>gemini-2.5-flash</b>");  // mid gemini default
  expect(html).toContain("rz-pin");                          // the pinned provider is marked
});

test("pin options use bare ids (no provider/ prefix)", () => {
  const html = AdminModelsPage([rows[0]], models);
  expect(html).toContain('<option value="qwen3.6"');
  expect(html).not.toContain('value="ollama/qwen3.6"');
});
