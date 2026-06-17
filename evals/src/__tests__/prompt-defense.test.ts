import { test, expect } from "bun:test";
import { withAgentDefense, PROMPT_DEFENSE, JUDGE_DEFENSE } from "../../../scripts/prompt-defense.ts";
import { renderAgentForClaude } from "../../../adapters/claude-code.ts";
import { getJudgePrompt } from "../../../web/src/session-judge.ts";

test("withAgentDefense inserts the preamble after frontmatter, keeping it intact", () => {
  const md = "---\nname: bird\nmodel:\n  tier: deep\n---\n\nYou are Bird.\n";
  const out = withAgentDefense(md);
  expect(out.startsWith("---\nname: bird")).toBe(true);     // frontmatter still first (Claude Code parses it)
  expect(out).toContain(PROMPT_DEFENSE);
  expect(out).toContain("You are Bird.");
  expect(out.indexOf("Trust & safety")).toBeLessThan(out.indexOf("You are Bird."));
});

test("no frontmatter → preamble goes to the very top", () => {
  expect(withAgentDefense("just a body").startsWith(PROMPT_DEFENSE)).toBe(true);
});

test("renderAgentForClaude includes the defense in the body + a flat claude model", () => {
  const r = renderAgentForClaude("---\nname: bird\nmodel:\n  tier: deep\n---\n\nbody\n");
  expect(r.model).toBe("claude-opus-4-8");
  expect(r.content).toContain(PROMPT_DEFENSE);
  expect(r.content).toMatch(/^---\n/); // frontmatter preserved at top
});

test("the session judge prompt carries the judge defense", () => {
  expect(getJudgePrompt()).toContain(JUDGE_DEFENSE);
});
