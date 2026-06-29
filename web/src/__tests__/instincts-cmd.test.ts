/**
 * instincts-cmd.test.ts — Regression tests for `dreamteam instincts` subcommands.
 *
 * Regression: `dreamteam instincts list` (and review/approve/reject) crashed on a
 * fresh workspace DB with `DbDriverError: no such table: instincts` because cmdInstincts
 * queried the DB without calling store.ensure() first.
 *
 * Fix: store.ensure() is now called in cmdInstincts before the switch/subcommand.
 *
 * Test strategy:
 *   - Spawn `bun run bin/dreamteam.ts instincts <sub>` with HOME pointing at a fresh
 *     temp dir (so the workspace DB is guaranteed to be brand-new / schema-less).
 *   - Without the fix: exits non-zero with "no such table: instincts" in stderr.
 *   - With the fix: exits 0 and prints the correct empty-list message.
 *
 * This test FAILS without the fix (DbDriverError thrown) and PASSES with it.
 */

import { test, expect, describe } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Absolute path to the CLI entry point so the subprocess finds it regardless of cwd.
const CLI = path.resolve(import.meta.dir, "../../../bin/dreamteam.ts");

/** Spawn `bun run CLI ...args` with a fresh HOME directory and return { stdout, stderr, exitCode }. */
async function runInstincts(
  args: string[],
  tmpHome: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    ["bun", "run", CLI, "instincts", ...args],
    {
      env: { ...process.env, HOME: tmpHome },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dt-instincts-cmd-"));
}

// ---------------------------------------------------------------------------
// Regression: fresh-DB list must not throw "no such table: instincts"
// ---------------------------------------------------------------------------

describe("instincts list — fresh workspace DB (regression: no-such-table)", () => {
  test("exits 0 and prints empty-list message on a brand-new DB (no prior learn/cutover)", async () => {
    const tmpHome = makeTmpHome();
    try {
      const { stdout, stderr, exitCode } = await runInstincts(["list"], tmpHome);
      // Should succeed — previously crashed here with DbDriverError.
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No instincts with status 'pending'.");
      // No error output expected.
      expect(stderr).toBe("");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000 /* bun spawn can take a few seconds */);

  test("instincts list --status approved exits 0 on fresh DB", async () => {
    const tmpHome = makeTmpHome();
    try {
      const { stdout, exitCode } = await runInstincts(["list", "--status", "approved"], tmpHome);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No instincts with status 'approved'.");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);

  test("instincts review exits 0 on fresh DB", async () => {
    const tmpHome = makeTmpHome();
    try {
      const { stdout, exitCode } = await runInstincts(["review"], tmpHome);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No pending instincts to review.");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// DB-layer unit test: ensure() + listByStatus returns [] (documents fix pattern)
// ---------------------------------------------------------------------------

describe("instincts-db ensure() gate — DB layer", () => {
  // These tests run in-process and document why the fix was needed.
  // They use bun:test imports directly.

  test("listByStatus on schema-less driver throws (documents the pre-fix crash)", async () => {
    const { createDriver } = await import("../db-driver.ts");
    const { createInstinctsDb } = await import("../instincts-db.ts");
    const driver = createDriver(":memory:");
    const store = createInstinctsDb(driver);
    const ctx = { tenant_id: "local", project: "test-proj" };
    // Without ensure(), the instincts table does not exist.
    await expect(store.listByStatus(ctx, "pending")).rejects.toThrow(/no such table/);
  });

  test("ensure() + listByStatus on fresh DB returns [] (no crash)", async () => {
    const { createDriver } = await import("../db-driver.ts");
    const { createInstinctsDb } = await import("../instincts-db.ts");
    const driver = createDriver(":memory:");
    const store = createInstinctsDb(driver);
    const ctx = { tenant_id: "local", project: "test-proj" };
    // After ensure(), schema exists and query returns empty array.
    await store.ensure();
    const rows = await store.listByStatus(ctx, "pending");
    expect(rows).toEqual([]);
  });
});
