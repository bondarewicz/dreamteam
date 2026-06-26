#!/usr/bin/env bun
/**
 * eval-gate-scope.ts — decide what the eval gate must cover for a changeset (s24).
 *
 * dreamteam's rule (commands/team.md): any agent/command spec change must clear the
 * `--trials 3` eval gate before shipping. This computes that scope deterministically
 * from a list of changed paths so CI can post the exact commands — and so the
 * "did we run the gate?" question stops depending on anyone remembering.
 *
 * Scope rules:
 *   - a change to ANY commands/*.md  → full run (commands drive every agent)
 *   - else each changed agents/<name>.md → a per-agent run
 *   - changes to neither            → gate not required
 *
 * Usage: print newline-separated changed paths on stdin (e.g. `git diff --name-only
 * base...head`), or pass them as argv. Emits a JSON plan to stdout.
 */

export type EvalGateScope = {
  required: boolean;
  commandsChanged: boolean;
  agents: string[];
  /** Concrete commands to run, in order. */
  commands: string[];
  reason: string;
};

/** Pure: map a changed-file list to the eval-gate scope. */
export function computeScope(changedPaths: string[]): EvalGateScope {
  const norm = changedPaths.map((p) => p.trim().replace(/\\/g, "/")).filter(Boolean);

  const commandsChanged = norm.some((p) => /(^|\/)commands\/[^/]+\.md$/.test(p));
  const agents = Array.from(
    new Set(
      norm
        .map((p) => p.match(/(^|\/)agents\/([^/]+)\.md$/)?.[2])
        .filter((a): a is string => Boolean(a))
    )
  ).sort();

  if (commandsChanged) {
    return {
      required: true,
      commandsChanged: true,
      agents,
      commands: ["bun evals/src/cli.ts --trials 3"],
      reason: "A command spec changed — commands affect every agent, so the full suite must pass.",
    };
  }
  if (agents.length) {
    return {
      required: true,
      commandsChanged: false,
      agents,
      commands: agents.map((a) => `bun evals/src/cli.ts --agent ${a} --trials 3`),
      reason: `Agent spec(s) changed: ${agents.join(", ")}.`,
    };
  }
  return {
    required: false,
    commandsChanged: false,
    agents: [],
    commands: [],
    reason: "No agent or command specs changed — eval gate not required.",
  };
}

/** Render a GitHub-flavoured Markdown summary for the PR / step summary. */
export function renderSummary(scope: EvalGateScope): string {
  if (!scope.required) {
    return `### ✅ Eval gate not required\n\n${scope.reason}\n`;
  }
  const lines = [
    "### ⚠️ Eval gate required before merge",
    "",
    scope.reason,
    "",
    "Agent/command spec changes shift behavior (not just format). Run the gate **locally on your Max subscription** (no API tokens — the harness shells out to `claude -p`):",
    "",
    "```bash",
    ...scope.commands,
    "```",
    "",
    "Gate verdict: **PASS** = pass@1 ≥ 80% AND 0 flaky · **CONDITIONAL** = pass@3 ≥ 80% but pass@1 < 80% (needs human sign-off) · **BLOCK** = pass@3 < 80%.",
    "",
    "Then review the run in the web app (`dreamteam web`) and add the **`evals-cleared`** label to this PR to unblock it. CI spends zero tokens.",
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const argvPaths = process.argv.slice(2);
  let paths = argvPaths;
  if (paths.length === 0) {
    let raw = "";
    try {
      raw = await Bun.stdin.text();
    } catch {
      /* no stdin */
    }
    paths = raw.split("\n");
  }
  const scope = computeScope(paths);
  // Emit both: JSON on stdout (machine), Markdown to GITHUB_STEP_SUMMARY if present.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      await Bun.write(summaryPath, renderSummary(scope) + "\n", { createPath: false });
    } catch {
      /* not on GitHub or unwritable — ignore */
    }
  }
  console.log(JSON.stringify(scope, null, 2));
}
