import { test, expect } from "bun:test";
import { renderAgentForClaude } from "../../../adapters/claude-code.ts";
import { readModelSpec } from "../../../scripts/frontmatter.ts";

const nested = (body: string) => `---\nname: bird\nmodel:\n${body}\ndescription: x\n---\n\nBody text.\n`;

test("tier-only block renders to the tier's flat claude id", () => {
  const deep = renderAgentForClaude(nested("  tier: deep"));
  expect(deep.model).toBe("claude-opus-5");
  expect(deep.content).toContain("model: claude-opus-5");
  expect(deep.content).not.toContain("tier:");

  const mid = renderAgentForClaude(nested("  tier: mid"));
  expect(mid.model).toBe("claude-sonnet-5");
  expect(mid.content).toContain("model: claude-sonnet-5");
});

test("explicit claude pin overrides the tier default", () => {
  const r = renderAgentForClaude(nested("  tier: deep\n  pin:\n    claude: claude-opus-4-7"));
  expect(r.model).toBe("claude-opus-4-7");
  expect(r.content).toContain("model: claude-opus-4-7");
});

test("a non-Claude-only pin still yields a valid flat claude model (tier default)", () => {
  // agent pinned to ollama for evals, no claude pin → Claude install gets the tier default
  const r = renderAgentForClaude(nested("  tier: deep\n  pin:\n    ollama: qwen3.6"));
  expect(r.model).toBe("claude-opus-5");
  expect(r.content).toContain("model: claude-opus-5");
  expect(r.content).not.toContain("ollama");
  expect(r.content).not.toContain("qwen3.6");
});

test("legacy flat claude id passes through unchanged", () => {
  const legacy = `---\nname: bird\nmodel: claude-opus-4-8\ndescription: x\n---\nBody.\n`;
  const r = renderAgentForClaude(legacy);
  expect(r.model).toBe("claude-opus-4-8");
  expect(r.content).toContain("model: claude-opus-4-8");
});

test("rendered output is flat (no nested keys) and Claude-readable", () => {
  const r = renderAgentForClaude(nested("  tier: mid\n  pin:\n    codex: gpt-5.5"));
  // installed file must be a single flat model line (mid → sonnet)
  expect(readModelSpec(r.content)).toEqual({ tier: "mid", pin: { claude: "claude-sonnet-5" } });
  expect(r.content).toContain("description: x");
  expect(r.content).toContain("Body text.");
});
