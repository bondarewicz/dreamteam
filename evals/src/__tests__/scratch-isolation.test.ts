import { test, expect, describe } from "bun:test";
import fs from "fs";
import os from "os";
import { runSingleAgentCall } from "../agent-runner.ts";
import type { ClaudeAdapter } from "../types.ts";

/** Mock adapter that records the cwd it was handed and returns a minimal result. */
function captureAdapter() {
  const cwds: (string | undefined)[] = [];
  const adapter: ClaudeAdapter = {
    async run(_args, _stdin, _timeout, cwd) {
      cwds.push(cwd);
      // If a scratch cwd was provided, it must exist at call time (created before the run).
      if (cwd) expect(fs.existsSync(cwd)).toBe(true);
      return {
        stdout: JSON.stringify({ type: "result", result: "{}", usage: { input_tokens: 1, output_tokens: 1 } }),
        exitCode: 0,
      };
    },
  };
  return { adapter, cwds };
}

describe("scratch isolation per agent run", () => {
  test("shaq runs in an isolated tmp cwd that is cleaned up afterwards", async () => {
    const { adapter, cwds } = captureAdapter();
    await runSingleAgentCall("shaq", "scenario-14", "do work", adapter, 1000);
    expect(cwds.length).toBe(1);
    const cwd = cwds[0]!;
    expect(typeof cwd).toBe("string");
    expect(cwd.startsWith(os.tmpdir())).toBe(true);
    expect(cwd).toContain("dt-eval-shaq");
    // finally{} removed it
    expect(fs.existsSync(cwd)).toBe(false);
  });

  test("the 'developer' alias is isolated too", async () => {
    const { adapter, cwds } = captureAdapter();
    await runSingleAgentCall("developer", "scenario-01", "do work", adapter, 1000);
    expect(cwds[0]).toBeDefined();
    expect(cwds[0]).toContain("dt-eval-developer");
  });

  test("analysis/review agents inherit cwd (undefined) — they read the repo", async () => {
    const { adapter, cwds } = captureAdapter();
    await runSingleAgentCall("kobe", "scenario-03", "review", adapter, 1000);
    expect(cwds[0]).toBeUndefined();
  });

  test("two concurrent shaq runs get DIFFERENT isolated dirs (no collision)", async () => {
    const seen: string[] = [];
    const adapter: ClaudeAdapter = {
      async run(_a, _s, _t, cwd) {
        if (cwd) seen.push(cwd);
        return { stdout: JSON.stringify({ type: "result", result: "{}", usage: {} }), exitCode: 0 };
      },
    };
    await Promise.all([
      runSingleAgentCall("shaq", "scenario-14", "a", adapter, 1000),
      runSingleAgentCall("shaq", "scenario-14", "b", adapter, 1000),
    ]);
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]); // distinct dirs even for the same scenario id
  });
});
