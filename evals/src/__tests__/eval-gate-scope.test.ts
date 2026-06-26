import { test, expect, describe } from "bun:test";
import { computeScope, renderSummary } from "../../../scripts/eval-gate-scope.ts";

describe("computeScope", () => {
  test("no spec changes → not required", () => {
    const s = computeScope(["scripts/model-tiers.ts", "web/src/db.ts", "README.md"]);
    expect(s.required).toBe(false);
    expect(s.commands).toEqual([]);
  });

  test("single agent change → per-agent run", () => {
    const s = computeScope(["agents/shaq.md", "evals/shaq/scenario-01.md"]);
    expect(s.required).toBe(true);
    expect(s.commandsChanged).toBe(false);
    expect(s.agents).toEqual(["shaq"]);
    expect(s.commands).toEqual(["bun evals/src/cli.ts --agent shaq --trials 3"]);
  });

  test("multiple agent changes → sorted, deduped, one command each", () => {
    const s = computeScope(["agents/kobe.md", "agents/bird.md", "agents/kobe.md"]);
    expect(s.agents).toEqual(["bird", "kobe"]);
    expect(s.commands).toEqual([
      "bun evals/src/cli.ts --agent bird --trials 3",
      "bun evals/src/cli.ts --agent kobe --trials 3",
    ]);
  });

  test("command change → full run (overrides per-agent)", () => {
    const s = computeScope(["commands/team.md", "agents/shaq.md"]);
    expect(s.required).toBe(true);
    expect(s.commandsChanged).toBe(true);
    expect(s.commands).toEqual(["bun evals/src/cli.ts --trials 3"]);
    expect(s.agents).toEqual(["shaq"]); // still reported for context
  });

  test("handles absolute-ish and backslash paths", () => {
    const s = computeScope(["/repo/agents/mj.md", "repo\\commands\\eval.md"]);
    expect(s.commandsChanged).toBe(true);
    expect(s.agents).toContain("mj");
  });

  test("ignores non-spec markdown (docs, scenarios, nested agents dirs)", () => {
    const s = computeScope(["docs/spec-x/intake.md", "evals/bird/scenario-02.md"]);
    expect(s.required).toBe(false);
  });
});

describe("renderSummary", () => {
  test("not-required summary", () => {
    expect(renderSummary(computeScope(["README.md"]))).toContain("not required");
  });
  test("required summary lists the commands in a code block", () => {
    const md = renderSummary(computeScope(["agents/shaq.md"]));
    expect(md).toContain("required before merge");
    expect(md).toContain("bun evals/src/cli.ts --agent shaq --trials 3");
    expect(md).toContain("PASS");
  });
});
