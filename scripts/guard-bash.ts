#!/usr/bin/env bun
/**
 * guard-bash.ts — Blocking PreToolUse hook for Bash (s15 deterministic policy).
 *
 * Turns hard-won, prose-only rules into an enforced gate the model cannot bypass.
 * Each pattern below traces to a real incident logged in dreamteam's memory:
 *   - bare `lsof -ti:<port> | xargs kill` once matched + killed the user's Firefox
 *     → require -sTCP:LISTEN scoping before a port-targeted kill.
 *   - public/outward actions (push --force, npm publish, gh pr/issue create) must
 *     never run without explicit human permission.
 *   - `rm -rf` against $HOME / / / absolute roots is unrecoverable.
 *
 * Hook contract (Claude Code PreToolUse): reads tool JSON on stdin; exit 2 BLOCKS
 * the call and feeds stderr back to the model; exit 0 allows. Anything else is a
 * hook error (fail-open) — so on any internal failure we exit 0, never wedging the
 * session. Advisory-only nudges go to stderr with exit 0.
 */

/** A pure, unit-testable screen of a single Bash command string. */
export function screenCommand(command: string): { action: "allow" | "block"; reason?: string } {
  const cmd = command.trim();
  if (!cmd) return { action: "allow" };

  // 1. Port-targeted kill without LISTEN scoping. `lsof -ti:3000 | xargs kill`
  //    matches every process with that port *open* (clients included) — scope to
  //    listeners only. The real incident: a bare match killed the user's browser.
  const portKill = /lsof\s+[^|]*-t[^|]*\b-?i\s*:?\s*\d/i.test(cmd) || /lsof\s+-ti\s*:?\d/i.test(cmd);
  const killsSomething = /\|\s*(xargs\s+)?kill\b/i.test(cmd) || /\bkill\s+-/i.test(cmd);
  if (portKill && killsSomething && !/-sTCP:LISTEN/i.test(cmd)) {
    return {
      action: "block",
      reason:
        "Refusing a port-targeted kill that is not scoped to listeners. `lsof -ti:<port>` " +
        "matches every process with that port open (clients too) and has killed unrelated " +
        "apps before. Re-run with `lsof -ti:<port> -sTCP:LISTEN` and confirm the PID is the " +
        "intended (e.g. bun) process before killing.",
    };
  }

  // 2. Force-push — rewrites published history. Outward + destructive; needs the human.
  if (/\bgit\s+push\b/i.test(cmd) && /(--force\b|--force-with-lease\b|(^|\s)-f(\s|$))/i.test(cmd)) {
    return {
      action: "block",
      reason:
        "`git push --force` rewrites published history — an outward, hard-to-reverse action. " +
        "Ask the user for explicit permission and prefer pushing a fresh branch instead.",
    };
  }

  // 3. Public/outward publishing actions — never without explicit human permission.
  const outward = [
    { re: /\bnpm\s+publish\b/i, what: "npm publish" },
    { re: /\bgh\s+pr\s+create\b/i, what: "gh pr create" },
    { re: /\bgh\s+issue\s+create\b/i, what: "gh issue create" },
    { re: /\bgh\s+release\s+create\b/i, what: "gh release create" },
    { re: /\bgh\s+repo\s+(create|edit)\b/i, what: "gh repo create/edit (visibility)" },
  ];
  for (const { re, what } of outward) {
    if (re.test(cmd)) {
      return {
        action: "block",
        reason:
          `\`${what}\` is a public/outward action. Per project policy it must not run without ` +
          "explicit human permission — surface the intent and ask the user to confirm or run it themselves.",
      };
    }
  }

  // 4. rm -rf against home, root, or an absolute path — unrecoverable.
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)\b/i.test(cmd)) {
    if (/\brm\s+-[rf]*\s+(\/(\s|$)|~(\/|\s|$)|\$HOME|\/\*)/i.test(cmd) || /\brm\s+-[rf]*\s+\/[A-Za-z]/.test(cmd)) {
      return {
        action: "block",
        reason:
          "Refusing `rm -rf` against an absolute path, $HOME, or root. Delete with a relative " +
          "path inside the working directory, or have the user run it if a wider scope is truly intended.",
      };
    }
  }

  return { action: "allow" };
}

// ── Hook entry point ───────────────────────────────────────────────────────────
// Guarded so importing this module for tests does not consume stdin / exit.
if (import.meta.main) {
  let raw = "";
  try {
    raw = await Bun.stdin.text();
  } catch {
    process.exit(0); // no stdin → nothing to screen
  }
  let hook: Record<string, any> = {};
  try {
    hook = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not JSON → fail open
  }
  const command = hook?.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) process.exit(0);

  const verdict = screenCommand(command);
  if (verdict.action === "block") {
    process.stderr.write(`[dreamteam guard-bash] BLOCKED: ${verdict.reason}\n`);
    process.exit(2); // blocks the tool call; stderr is shown to the model
  }
  process.exit(0);
}
