import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  resolveInside, executeTool, READ_TOOL_NAMES, WRITE_TOOL_NAMES, type ToolCtx,
} from "../ollama-agent.ts";

let worktree: string, sandbox: string;
beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), "olw-"));
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ols-"));
  fs.writeFileSync(path.join(worktree, "exists.ts"), "export const x = 1;\n");
});
afterEach(() => { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(sandbox, { recursive: true, force: true }); });

const ctx = (writeAllowed: boolean): ToolCtx => ({ worktree, sandbox, writeAllowed, written: new Set() });

// ── the constructive gate ────────────────────────────────────────────────────
test("plan-phase registry has READ tools, no write/bash", () => {
  expect(READ_TOOL_NAMES).toEqual(["read_file", "list_dir", "grep"]);
  expect(WRITE_TOOL_NAMES).toEqual(["write_file", "run_bash"]);
  expect(READ_TOOL_NAMES).not.toContain("write_file");
  expect(READ_TOOL_NAMES).not.toContain("run_bash");
});

test("write_file is REFUSED in plan mode (writeAllowed=false) and flags a gate violation", async () => {
  const r = await executeTool("write_file", { path: "a.ts", content: "x" }, ctx(false));
  expect(r.gateViolation).toBe(true);
  expect(r.result).toContain("not available in plan mode");
  expect(fs.existsSync(path.join(sandbox, "a.ts"))).toBe(false); // nothing written
});

test("run_bash is REFUSED in plan mode", async () => {
  const r = await executeTool("run_bash", { cmd: "touch hacked" }, ctx(false));
  expect(r.gateViolation).toBe(true);
  expect(fs.existsSync(path.join(sandbox, "hacked"))).toBe(false);
});

test("write_file WORKS in implement mode, confined to the sandbox", async () => {
  const r = await executeTool("write_file", { path: "out/a.ts", content: "hi" }, ctx(true));
  expect(r.result).toContain("wrote");
  expect(fs.readFileSync(path.join(sandbox, "out/a.ts"), "utf-8")).toBe("hi");
});

// ── path confinement (BR-10) ─────────────────────────────────────────────────
test("resolveInside rejects traversal + absolute escapes, allows in-tree paths", () => {
  expect(() => resolveInside(sandbox, "../escape.ts")).toThrow(/escapes/);
  expect(() => resolveInside(sandbox, "/etc/passwd")).toThrow(/escapes/);
  expect(resolveInside(sandbox, "ok/a.ts")).toBe(path.join(sandbox, "ok/a.ts"));
});

test("write_file with a traversal path is rejected (no escape)", async () => {
  const r = await executeTool("write_file", { path: "../escaped.ts", content: "x" }, ctx(true));
  expect(r.result).toContain("ERROR");
  expect(fs.existsSync(path.join(path.dirname(sandbox), "escaped.ts"))).toBe(false);
});

// ── read tools hit the worktree read-only ────────────────────────────────────
test("read_file reads the worktree; traversal rejected", async () => {
  expect((await executeTool("read_file", { path: "exists.ts" }, ctx(false))).result).toContain("export const x");
  expect((await executeTool("read_file", { path: "../../etc/hosts" }, ctx(false))).result).toContain("ERROR");
});
