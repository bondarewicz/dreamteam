#!/usr/bin/env bun
/**
 * guard-agent-edits.ts — Advisory PreToolUse hook for Edit/Write (s15 + s24).
 *
 * dreamteam's rule "every agent/command spec change must clear the --trials 3
 * eval gate before shipping" lives in prose, so it is only as reliable as the
 * model's memory. This hook fires that reminder DETERMINISTICALLY at the moment
 * an agents/*.md or commands/*.md file is edited — the one point where the rule
 * is about to be violated.
 *
 * Advisory only: always exits 0 (never blocks a legitimate edit). It just writes
 * a reminder to stderr so it surfaces in the model's next turn. The companion
 * blocking gate is the CI eval-gate workflow (.github/workflows/eval-gate.yml).
 */

/** Does this edited path require the eval gate before merge? Pure + testable. */
export function requiresEvalGate(filePath: string): { gated: boolean; kind?: "agent" | "command" } {
  const p = filePath.replace(/\\/g, "/");
  if (/(^|\/)agents\/[^/]+\.md$/.test(p)) return { gated: true, kind: "agent" };
  if (/(^|\/)commands\/[^/]+\.md$/.test(p)) return { gated: true, kind: "command" };
  return { gated: false };
}

if (import.meta.main) {
  let raw = "";
  try {
    raw = await Bun.stdin.text();
  } catch {
    process.exit(0);
  }
  let hook: Record<string, any> = {};
  try {
    hook = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }
  const filePath = hook?.tool_input?.file_path;
  if (typeof filePath !== "string") process.exit(0);

  const { gated, kind } = requiresEvalGate(filePath);
  if (gated) {
    const cmd =
      kind === "command"
        ? "bun evals/src/cli.ts --trials 3   # command change → affects all agents"
        : `bun evals/src/cli.ts --agent ${
            filePath.replace(/\\/g, "/").match(/agents\/([^/]+)\.md$/)?.[1] ?? "<name>"
          } --trials 3`;
    process.stderr.write(
      `[dreamteam guard-agent-edits] Editing ${kind === "agent" ? "an agent" : "a command"} spec — behavior may shift, not just format. ` +
        `Before shipping this change, clear the eval gate (pass@1 >= 80%, 0 flaky):\n  ${cmd}\n`
    );
  }
  process.exit(0);
}
