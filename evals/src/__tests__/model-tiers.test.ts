import { test, expect } from "bun:test";
import {
  parseModelSpec, resolveModel, renderModelSpecYaml, inferTier, TIER_DEFAULTS,
} from "../../../scripts/model-tiers.ts";
import { readModelSpec, setModelBlock } from "../../../scripts/frontmatter.ts";

// ── model-tiers ────────────────────────────────────────────────────────────
test("legacy flat claude id → claude pin + inferred tier", () => {
  expect(parseModelSpec("claude-opus-4-8")).toEqual({ tier: "deep", pin: { claude: "claude-opus-4-8" } });
  expect(parseModelSpec("claude-sonnet-4-6")).toEqual({ tier: "mid", pin: { claude: "claude-sonnet-4-6" } });
  expect(parseModelSpec("claude-haiku-4-5")).toEqual({ tier: "fast", pin: { claude: "claude-haiku-4-5" } });
});

test("bare tier word → tier, no pins", () => {
  expect(parseModelSpec("deep")).toEqual({ tier: "deep", pin: {} });
  expect(parseModelSpec("fast")).toEqual({ tier: "fast", pin: {} });
});

test("nested object → normalized spec (only known providers kept)", () => {
  const spec = parseModelSpec({ tier: "fast", pin: { claude: "x", ollama: "y", bogus: "z" } });
  expect(spec).toEqual({ tier: "fast", pin: { claude: "x", ollama: "y" } });
});

test("missing/garbage → deep, no pins", () => {
  expect(parseModelSpec(undefined)).toEqual({ tier: "deep", pin: {} });
  expect(parseModelSpec(42)).toEqual({ tier: "deep", pin: {} });
});

test("resolveModel: pin wins, else tier default per provider", () => {
  const spec = parseModelSpec({ tier: "deep", pin: { ollama: "qwen-custom" } });
  expect(resolveModel(spec, "ollama")).toBe("qwen-custom");           // pin
  expect(resolveModel(spec, "claude")).toBe(TIER_DEFAULTS.claude.deep); // tier default
  expect(resolveModel(spec, "gemini")).toBe(TIER_DEFAULTS.gemini.deep); // tier default
});

test("every provider × tier has a non-empty default", () => {
  for (const p of ["claude", "ollama", "gemini", "codex"] as const)
    for (const t of ["deep", "mid", "fast"] as const)
      expect(TIER_DEFAULTS[p][t].length).toBeGreaterThan(0);
});

test("inferTier (3 tiers): opus=deep, sonnet=mid, haiku=fast", () => {
  expect(inferTier("claude-opus-4-8")).toBe("deep");
  expect(inferTier("claude-sonnet-4-6")).toBe("mid");
  expect(inferTier("claude-haiku-4-5")).toBe("fast");
  expect(inferTier("something-unknown")).toBe("mid");
});

test("renderModelSpecYaml round-trips through parse", () => {
  const spec = { tier: "deep" as const, pin: { claude: "claude-opus-4-8", ollama: "qwen3.6" } };
  const yaml = renderModelSpecYaml(spec);
  expect(yaml).toContain("tier: deep");
  expect(yaml).toContain("    claude: claude-opus-4-8");
  // re-parse via YAML to confirm it's valid + equal
  const reparsed = parseModelSpec((Bun.YAML.parse(yaml) as any).model);
  expect(reparsed).toEqual(spec);
});

test("renderModelSpecYaml omits pin block when no pins", () => {
  expect(renderModelSpecYaml({ tier: "fast", pin: {} })).toBe("model:\n  tier: fast");
});

// ── frontmatter ────────────────────────────────────────────────────────────
const NESTED = `---
name: bird
model:
  tier: deep
  pin:
    claude: claude-opus-4-8
    ollama: qwen3.6
description: domain authority
---

Body.
`;

test("readModelSpec survives a non-YAML description (real agent shape)", () => {
  // single-quoted description with embedded apostrophes — Bun.YAML can't parse
  // the whole block, but the surgical model reader must still work.
  const gnarly = `---\nname: shaq\ndescription: '"Build it." — he'll turn specs into code. It's great.'\nmodel: claude-sonnet-4-6\ncolor: purple\n---\nBody.\n`;
  expect(readModelSpec(gnarly)).toEqual({ tier: "mid", pin: { claude: "claude-sonnet-4-6" } });
});

test("readModelSpec on nested + legacy", () => {
  expect(readModelSpec(NESTED)).toEqual({ tier: "deep", pin: { claude: "claude-opus-4-8", ollama: "qwen3.6" } });
  const legacy = `---\nname: x\nmodel: claude-sonnet-4-6\n---\nBody.\n`;
  expect(readModelSpec(legacy)).toEqual({ tier: "mid", pin: { claude: "claude-sonnet-4-6" } });
});

test("setModelBlock replaces a nested block, preserves siblings", () => {
  const out = setModelBlock(NESTED, "model: claude-opus-4-8");
  expect(out).toContain("name: bird");
  expect(out).toContain("model: claude-opus-4-8");
  expect(out).toContain("description: domain authority");
  expect(out).not.toContain("tier:");
  expect(out).not.toContain("qwen3.6");
  expect(out).toContain("\nBody.\n");
});

test("setModelBlock replaces a flat model line with a nested block", () => {
  const legacy = `---\nname: x\nmodel: claude-opus-4-8\ndescription: y\n---\nBody.\n`;
  const out = setModelBlock(legacy, "model:\n  tier: deep\n  pin:\n    claude: claude-opus-4-8");
  expect(readModelSpec(out).tier).toBe("deep");
  expect(out).toContain("description: y");
});

test("setModelBlock inserts when no model line exists", () => {
  const noModel = `---\nname: x\ndescription: y\n---\nBody.\n`;
  const out = setModelBlock(noModel, "model:\n  tier: fast");
  expect(readModelSpec(out).tier).toBe("fast");
  expect(out).toContain("name: x");
});

test("setModelBlock leaves a no-frontmatter file untouched", () => {
  const plain = "# Just markdown\n";
  expect(setModelBlock(plain, "model: x")).toBe(plain);
});
