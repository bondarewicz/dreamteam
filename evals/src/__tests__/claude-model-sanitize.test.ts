import { test, expect } from "bun:test";
import { sanitizeAgentForClaude } from "../../../adapters/claude-code.ts";

const fm = (model: string) => `---\nname: bird\nmodel: ${model}\ndescription: x\n---\n\nBody text.\n`;

test("drops a provider-prefixed (ollama) model pin", () => {
  const { content, dropped } = sanitizeAgentForClaude(fm("ollama/qwen3.6"), "bird");
  expect(dropped).toBe("ollama/qwen3.6");
  expect(content).not.toContain("model:");
  expect(content).toContain("name: bird");
  expect(content).toContain("description: x");
  expect(content).toContain("Body text.");
});

test("drops gemini/ and codex/ pins too", () => {
  expect(sanitizeAgentForClaude(fm("gemini/gemini-2.5-flash")).dropped).toBe("gemini/gemini-2.5-flash");
  expect(sanitizeAgentForClaude(fm("codex/gpt-5.5")).dropped).toBe("codex/gpt-5.5");
});

test("keeps a bare Claude model id untouched", () => {
  const { content, dropped } = sanitizeAgentForClaude(fm("claude-opus-4-8"), "bird");
  expect(dropped).toBeUndefined();
  expect(content).toContain("model: claude-opus-4-8");
});

test("keeps a Claude Code alias (opus/sonnet/haiku) untouched", () => {
  for (const alias of ["opus", "sonnet", "haiku", "opusplan"]) {
    const { content, dropped } = sanitizeAgentForClaude(fm(alias));
    expect(dropped).toBeUndefined();
    expect(content).toContain(`model: ${alias}`);
  }
});

test("no model line → unchanged", () => {
  const src = `---\nname: bird\ndescription: x\n---\nBody.\n`;
  const { content, dropped } = sanitizeAgentForClaude(src);
  expect(dropped).toBeUndefined();
  expect(content).toBe(src);
});

test("only the model line is removed; surrounding frontmatter preserved", () => {
  const { content } = sanitizeAgentForClaude(fm("ollama/qwen3.6"));
  expect(content).toBe(`---\nname: bird\ndescription: x\n---\n\nBody text.\n`);
});
