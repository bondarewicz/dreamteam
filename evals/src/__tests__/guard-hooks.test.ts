import { test, expect, describe } from "bun:test";
import { screenCommand } from "../../../scripts/guard-bash.ts";
import { requiresEvalGate } from "../../../scripts/guard-agent-edits.ts";

// ── guard-bash: screenCommand ──────────────────────────────────────────────────

describe("screenCommand — port-targeted kill", () => {
  test("blocks bare lsof -ti:<port> | xargs kill (the Firefox incident)", () => {
    const v = screenCommand("lsof -ti:3000 | xargs kill -9");
    expect(v.action).toBe("block");
    expect(v.reason).toContain("LISTEN");
  });

  test("blocks lsof -ti :8080 | kill without LISTEN scope", () => {
    expect(screenCommand("lsof -ti :8080 | xargs kill").action).toBe("block");
  });

  test("allows the LISTEN-scoped form", () => {
    expect(screenCommand("lsof -ti:3000 -sTCP:LISTEN | xargs kill").action).toBe("allow");
  });

  test("allows lsof used only to inspect (no kill)", () => {
    expect(screenCommand("lsof -ti:3000").action).toBe("allow");
  });
});

describe("screenCommand — outward / destructive actions", () => {
  test("blocks git push --force", () => {
    expect(screenCommand("git push --force origin main").action).toBe("block");
  });

  test("blocks git push -f", () => {
    expect(screenCommand("git push -f").action).toBe("block");
  });

  test("blocks --force-with-lease too", () => {
    expect(screenCommand("git push --force-with-lease").action).toBe("block");
  });

  test("allows a normal git push", () => {
    expect(screenCommand("git push origin my-branch").action).toBe("allow");
  });

  test("blocks npm publish", () => {
    expect(screenCommand("npm publish --access public").action).toBe("block");
  });

  test("blocks gh pr create", () => {
    expect(screenCommand("gh pr create --fill").action).toBe("block");
  });

  test("blocks gh issue create", () => {
    expect(screenCommand("gh issue create -t bug").action).toBe("block");
  });
});

describe("screenCommand — rm -rf scope", () => {
  test("blocks rm -rf $HOME", () => {
    expect(screenCommand("rm -rf $HOME/stuff").action).toBe("block");
  });

  test("blocks rm -rf on an absolute path", () => {
    expect(screenCommand("rm -rf /usr/local/lib/foo").action).toBe("block");
  });

  test("blocks rm -rf ~", () => {
    expect(screenCommand("rm -rf ~/").action).toBe("block");
  });

  test("allows rm -rf on a relative path inside the workdir", () => {
    expect(screenCommand("rm -rf .tmp/scratch").action).toBe("allow");
  });

  test("allows rm -rf node_modules", () => {
    expect(screenCommand("rm -rf node_modules").action).toBe("allow");
  });
});

describe("screenCommand — benign commands pass", () => {
  for (const cmd of ["bun test", "git status", "ls -la", "grep -r foo .", "echo hi", ""]) {
    test(`allows: ${JSON.stringify(cmd)}`, () => {
      expect(screenCommand(cmd).action).toBe("allow");
    });
  }
});

// ── guard-agent-edits: requiresEvalGate ────────────────────────────────────────

describe("requiresEvalGate", () => {
  test("flags agent specs", () => {
    const r = requiresEvalGate("/repo/agents/shaq.md");
    expect(r.gated).toBe(true);
    expect(r.kind).toBe("agent");
  });

  test("flags command specs", () => {
    const r = requiresEvalGate("commands/team.md");
    expect(r.gated).toBe(true);
    expect(r.kind).toBe("command");
  });

  test("ignores non-spec files", () => {
    expect(requiresEvalGate("scripts/model-tiers.ts").gated).toBe(false);
    expect(requiresEvalGate("docs/spec-foo/intake.md").gated).toBe(false);
    expect(requiresEvalGate("evals/shaq/scenario-01.md").gated).toBe(false);
  });
});
