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
    { id: "codex/gpt-5.5", displayName: "gpt-5.5", provider: "codex", createdAt: "" },
  ],
};

const rows: AgentModelRow[] = [
  { agent: "bird", spec: { tier: "deep", pin: {} } },
  { agent: "drexler", spec: { tier: "mid", pin: { ollama: "gemma4" }, provider: "ollama" } },
];

test("provider selector present per agent; active provider preselected", () => {
  const html = AdminModelsPage(rows, models);
  expect((html.match(/name="provider__/g) ?? []).length).toBe(2);
  expect(html).toContain('name="provider__bird"');
  // bird defaults to claude
  expect(html).toMatch(/name="provider__bird"[\s\S]*?<option value="claude" selected>/);
  // drexler runs on ollama → highlighted active in the runs-as line
  expect(html).toContain("rz-active");
  expect(html).toContain("▶ Ollama");
});

test("renders a tier select + 3 pin selects per agent", () => {
  const html = AdminModelsPage(rows, models);
  expect((html.match(/name="tier__/g) ?? []).length).toBe(2);
  expect((html.match(/name="pin__/g) ?? []).length).toBe(6); // 3 providers × 2 agents
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
  expect(html).toContain("default for mid → claude-sonnet-5");
});

test("resolved 'runs as' line reflects tier + pin, highlighting overrides", () => {
  const html = AdminModelsPage([rows[1]], models); // mid + ollama gemma4
  expect(html).toContain("runs as");
  expect(html).toContain("Claude <b>claude-sonnet-5</b>"); // mid claude default
  expect(html).toContain('Ollama <b>gemma4</b>');            // pinned
  expect(html).toContain("Codex <b>gpt-5.5</b>");            // mid codex default
  expect(html).toContain("rz-pin");                          // the pinned provider is marked
});

test("pin options use bare ids (no provider/ prefix)", () => {
  const html = AdminModelsPage([rows[0]], models);
  expect(html).toContain('<option value="qwen3.6"');
  expect(html).not.toContain('value="ollama/qwen3.6"');
});
