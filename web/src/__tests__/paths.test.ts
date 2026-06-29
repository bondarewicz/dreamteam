/**
 * paths.test.ts — Tests for scripts/paths.ts: canonicalProjectId() and harnessMemoryDir().
 *
 * TEST A: Real cwd→slug derivation — the gap that hid Defect 2.
 *
 * These tests exercise the ACTUAL encoding transform, not injected values.
 * Defect 2 was hidden because prior tests always passed --project explicitly and
 * never exercised the default path, so the basename≠canonical-slug mismatch went unnoticed.
 *
 * Verified against real ~/.claude/projects/ dir names on the developer machine.
 */

import { test, expect, describe } from "bun:test";
import path from "path";
import os from "os";
import { canonicalProjectId, harnessMemoryDir } from "../../../scripts/paths.ts";

// ---------------------------------------------------------------------------
// canonicalProjectId — encoding table (verified against real harness dirs)
// ---------------------------------------------------------------------------

describe("canonicalProjectId — exact encoding transform", () => {
  // Table verified against real ~/.claude/projects/ entries on 2026-06-26:
  // The harness encodes EVERY non-alphanumeric character as '-', 1:1, no collapsing.

  test("standard project dir → leading dash + path separators become single dashes", () => {
    // /Users/lb/Github/Bondarewicz/dreamteam → -Users-lb-Github-Bondarewicz-dreamteam
    const result = canonicalProjectId("/Users/lb/Github/Bondarewicz/dreamteam");
    expect(result).toBe("-Users-lb-Github-Bondarewicz-dreamteam");
  });

  test("path with dot-dir and dash → double-dash (no collapsing, no lowercasing)", () => {
    // /Users/lb/Github/Bondarewicz/dreamteam/.claude-worktrees/tutorial-upgrades
    //   → -Users-lb-Github-Bondarewicz-dreamteam--claude-worktrees-tutorial-upgrades
    // Note: '/.c' → '-' + '-' = '--' (slash→dash, dot→dash; NO collapsing)
    const result = canonicalProjectId(
      "/Users/lb/Github/Bondarewicz/dreamteam/.claude-worktrees/tutorial-upgrades"
    );
    expect(result).toBe(
      "-Users-lb-Github-Bondarewicz-dreamteam--claude-worktrees-tutorial-upgrades"
    );
  });

  test("path with @, underscore → all non-alphanum replaced 1:1 (no collapse)", () => {
    // /Users/lb/.bun/install/global/node_modules/@bondarewicz/dreamteam
    //   → -Users-lb--bun-install-global-node-modules--bondarewicz-dreamteam
    // Note: '._' in node_modules → '-' for underscore; '@' → '-', '/' → '-' → '--'
    const result = canonicalProjectId(
      "/Users/lb/.bun/install/global/node_modules/@bondarewicz/dreamteam"
    );
    expect(result).toBe(
      "-Users-lb--bun-install-global-node-modules--bondarewicz-dreamteam"
    );
  });

  test("path with mixed case → no lowercasing (case is preserved verbatim)", () => {
    const result = canonicalProjectId("/Users/Alice/MyProject");
    expect(result).toBe("-Users-Alice-MyProject");
  });

  test("alphanumeric chars are preserved unchanged", () => {
    const result = canonicalProjectId("/a1b2c3/D4E5F6");
    expect(result).toBe("-a1b2c3-D4E5F6");
  });

  test("no dash collapsing — consecutive non-alphanum chars produce consecutive dashes", () => {
    // '/.' → '--', not '-'
    const result = canonicalProjectId("/x/.y");
    expect(result).toBe("-x--y");
  });

  test("canonicalProjectId() with no argument uses process.cwd() — real default exercised", () => {
    // This is the test that WOULD have caught Defect 2 if it existed before.
    // path.basename(process.cwd()) ≠ canonicalProjectId() when cwd contains '/' or non-alphanum.
    const noArgResult = canonicalProjectId();
    const expectedFromCwd = path.resolve(process.cwd()).replace(/[^A-Za-z0-9]/g, "-");
    expect(noArgResult).toBe(expectedFromCwd);
    // The result should start with '-' (since cwd is absolute and starts with '/')
    expect(noArgResult.startsWith("-")).toBe(true);
    // It must NOT equal the basename (which was the bug: the basename is the last segment only)
    const basename = path.basename(process.cwd());
    // The canonical ID is longer (includes the full path) unless cwd is at root (edge case)
    // and must contain at least one more '-' than just the prefix
    if (process.cwd().includes("/")) {
      // Has path separators → canonical ID must differ from bare basename
      expect(noArgResult).not.toBe(basename);
    }
  });

  test("relative path is resolved to absolute before encoding", () => {
    // path.resolve('foo') = cwd/foo
    const resolved = path.resolve("foo");
    const expected = resolved.replace(/[^A-Za-z0-9]/g, "-");
    expect(canonicalProjectId("foo")).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// harnessMemoryDir — path construction
// ---------------------------------------------------------------------------

describe("harnessMemoryDir — harness memory dir path", () => {
  test("constructs <home>/.claude/projects/<projectId>/memory", () => {
    const home = "/Users/testuser";
    const projectId = "-Users-testuser-Projects-myapp";
    const result = harnessMemoryDir(home, projectId);
    expect(result).toBe("/Users/testuser/.claude/projects/-Users-testuser-Projects-myapp/memory");
  });

  test("round-trip: harnessMemoryDir(home, canonicalProjectId(cwd)) produces expected path", () => {
    const home = "/home/lb";
    const cwd = "/home/lb/repos/myproject";
    const projectId = canonicalProjectId(cwd); // = "-home-lb-repos-myproject"
    const memDir = harnessMemoryDir(home, projectId);
    expect(memDir).toBe("/home/lb/.claude/projects/-home-lb-repos-myproject/memory");
  });

  test("harnessMemoryDir with real home + real cwd canonical id resolves to harness form", () => {
    const home = os.homedir();
    const projectId = canonicalProjectId(); // real cwd
    const memDir = harnessMemoryDir(home, projectId);
    // Must be under ~/.claude/projects/ and end with /memory
    expect(memDir).toContain(path.join(home, ".claude", "projects"));
    expect(memDir.endsWith("/memory")).toBe(true);
    // The projectId segment in the path must equal canonicalProjectId()
    expect(path.basename(path.dirname(memDir))).toBe(projectId);
  });
});

// ---------------------------------------------------------------------------
// Slug alignment — migrated + learned data share the same scope key
// ---------------------------------------------------------------------------

describe("canonicalProjectId alignment — single scope key for all axes", () => {
  test("the harness dir segment equals canonicalProjectId of the same cwd", () => {
    // If we cd to cwd and call canonicalProjectId(), the result must exactly
    // equal the harness dir name. This verifies the alignment guarantee.
    const cwd = "/Users/lb/Github/Bondarewicz/dreamteam";
    const id = canonicalProjectId(cwd);
    const harnessDirName = path.basename(harnessMemoryDir("/fakeHome", id).replace(/\/memory$/, ""));
    expect(harnessDirName).toBe(id);
  });
});
