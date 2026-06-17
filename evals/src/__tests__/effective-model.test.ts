import { test, expect } from "bun:test";
import { resolveEffectiveModel } from "../agent-runner.ts";

// These read the real repo agents/*.md specs (bird=deep, shaq=mid).

test("default (no model/provider) → agent tier resolved for claude, bare id", () => {
  expect(resolveEffectiveModel("bird")).toBe("claude-opus-4-8");   // deep
  expect(resolveEffectiveModel("shaq")).toBe("claude-sonnet-4-6"); // mid
});

test("--provider resolves the agent's tier for that provider, prefixed", () => {
  expect(resolveEffectiveModel("shaq", undefined, "ollama")).toBe("ollama/qwen3.6"); // mid → ollama
  expect(resolveEffectiveModel("bird", undefined, "codex")).toBe("codex/gpt-5.5");   // deep → codex
  expect(resolveEffectiveModel("shaq", undefined, "gemini")).toBe("gemini/gemini-2.5-flash"); // mid → gemini
});

test("--provider claude stays bare (no prefix → claude dispatch)", () => {
  expect(resolveEffectiveModel("bird", undefined, "claude")).toBe("claude-opus-4-8");
});

test("explicit --model always wins over provider resolution", () => {
  expect(resolveEffectiveModel("bird", "ollama/qwen3.6", "codex")).toBe("ollama/qwen3.6");
  expect(resolveEffectiveModel("shaq", "claude-opus-4-6")).toBe("claude-opus-4-6");
});

test("unknown provider falls back to claude", () => {
  expect(resolveEffectiveModel("bird", undefined, "bogus")).toBe("claude-opus-4-8");
});

test("unknown agent (no spec file) → empty (claude path uses installed default)", () => {
  expect(resolveEffectiveModel("does-not-exist")).toBe("");
});
