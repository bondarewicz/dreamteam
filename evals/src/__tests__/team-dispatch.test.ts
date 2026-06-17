import { test, expect } from "bun:test";
import {
  validateContract, scrubMeteredEnv, assertSubscriptionAuth, extractJson,
  ANALYSIS_ROLES, IMPL_ROLES, INTERACTIVE_SINGLE_SHOT_APPEND, runDelegatedTurn,
} from "../team-dispatch.ts";

// ── extractJson: models without a registered schema often fence/preamble ─────
test("extractJson strips ```json fences", () => {
  expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
});
test("extractJson takes from the first brace when there's a preamble", () => {
  expect(extractJson('Here is the result:\n{"a":1}')).toBe('{"a":1}');
});
test("extractJson leaves clean JSON untouched", () => {
  expect(extractJson('{"a":1}')).toBe('{"a":1}');
});
test("fenced JSON passes the contract gate after extraction", () => {
  expect(validateContract("magic", extractJson('```json\n{"summary":"x"}\n```')).ok).toBe(true);
});

// ── contract gate (BR-4) ────────────────────────────────────────────────────
test("validateContract: valid non-empty JSON object passes", () => {
  expect(validateContract("magic", '{"summary":"did the thing","decisions":["a"]}').ok).toBe(true);
});
test("validateContract: invalid JSON fails", () => {
  expect(validateContract("magic", "not json").ok).toBe(false);
  expect(validateContract("magic", "not json").reason).toContain("not valid JSON");
});
test("validateContract: array / primitive is not a JSON object", () => {
  expect(validateContract("magic", "[1,2]").ok).toBe(false);
  expect(validateContract("magic", '"hi"').ok).toBe(false);
});
test("validateContract: schema-valid-but-empty is rejected", () => {
  expect(validateContract("magic", "{}").ok).toBe(false);
  expect(validateContract("magic", '{"a":"","b":[],"c":null,"d":{}}').ok).toBe(false);
});
test("validateContract: bird (registered schema) — valid passes, garbage fails", () => {
  const validBird = JSON.stringify({
    bounded_context: "x",
    business_rules: [{ rule: "r", invariant: true, invariant_justification: "because" }],
    acceptance_criteria: [{ given: "g", when: "w", then: "t" }],
    escalations: [], confidence_level: 80,
  });
  expect(validateContract("bird", validBird).ok).toBe(true);
  // non-empty but wrong shape for bird's schema
  expect(validateContract("bird", '{"unrelated":"value"}').ok).toBe(false);
});
test("validateContract: high confidence with open escalations is rejected (confidence cap)", () => {
  const r = validateContract("mj", JSON.stringify({ analysis: "x", escalations: [{ type: "ambiguity" }], confidence_level: 90 }));
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("confidence");
});
test("validateContract: nested confidence.level form also capped", () => {
  const r = validateContract("mj", JSON.stringify({ analysis: "x", escalations: [{ type: "a" }], confidence: { level: 95 } }));
  expect(r.ok).toBe(false);
});

// ── env scrub (BR-1/BR-2) ───────────────────────────────────────────────────
test("scrubMeteredEnv strips metered keys + base_url, reports them", () => {
  const saved = { ...process.env };
  process.env.OPENAI_API_KEY = "sk-x";
  process.env.GEMINI_API_KEY = "g-x";
  process.env.ANTHROPIC_BASE_URL = "http://proxy:4000";
  const removed = scrubMeteredEnv();
  expect(removed).toContain("OPENAI_API_KEY");
  expect(removed).toContain("GEMINI_API_KEY");
  expect(removed).toContain("ANTHROPIC_BASE_URL");
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
  process.env = saved; // restore
});

// ── auth pre-flight (BR-1) ──────────────────────────────────────────────────
test("assertSubscriptionAuth: ollama is always local-ok; unknown provider refused", () => {
  expect(assertSubscriptionAuth("ollama")).toEqual({ ok: true, mode: "local" });
  const u = assertSubscriptionAuth("bogus");
  expect(u.ok).toBe(false);
});

// ── role classification + append ────────────────────────────────────────────
test("role sets: analysis roles delegable, shaq is impl", () => {
  for (const a of ["bird", "mj", "kobe", "pippen", "drexler", "magic"]) expect(ANALYSIS_ROLES.has(a)).toBe(true);
  expect(IMPL_ROLES.has("shaq")).toBe(true);
  expect(ANALYSIS_ROLES.has("shaq")).toBe(false);
});
test("interactive append forbids plan mode + demands inline + honesty about blind spots", () => {
  expect(INTERACTIVE_SINGLE_SHOT_APPEND).toContain("no plan mode");
  expect(INTERACTIVE_SINGLE_SHOT_APPEND).toContain("INLINE");
  expect(INTERACTIVE_SINGLE_SHOT_APPEND.toLowerCase()).toContain("limitation");
});

// ── dispatch guards (agents resolve to claude by default → run native) ───────
test("runDelegatedTurn refuses a claude-resolved agent (must run native)", async () => {
  const r = await runDelegatedTurn("bird", "analyze this");
  expect(r.ok).toBe(false);
  expect(r.error).toContain("run as a native subagent");
});
