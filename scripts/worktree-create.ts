#!/usr/bin/env bun
/**
 * worktree-create.ts — Idempotent git worktree creation
 *
 * Usage: bun worktree-create.ts <repo-root> <branch-name> [base-ref]
 *
 * Creates a worktree at <repo-root>/.worktrees/<branch-name>/
 * Returns absolute worktree path on stdout.
 * Exit 0 = success, exit 1 = failure (stderr has message).
 */

import path from "path";
import fs from "fs";

function run(cmd: string, args: string[], cwd?: string): { stdout: string; stderr: string; ok: boolean } {
  const result = Bun.spawnSync([cmd, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    ok: result.exitCode === 0,
  };
}

function fail(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    fail("Usage: worktree-create.ts <repo-root> <branch-name> [base-ref]");
  }

  const repoRoot = path.resolve(args[0]);
  const branchName = args[1];
  const baseRef = args[2] ?? "HEAD";

  // Validate repo root exists
  if (!fs.existsSync(repoRoot)) {
    fail(`repo-root does not exist: ${repoRoot}`);
  }

  // Validate branch name
  if (!branchName || branchName === "main" || branchName === "master") {
    fail(`Invalid branch name: "${branchName}". Cannot use main or master.`);
  }
  if (branchName.includes("..")) {
    fail(`Invalid branch name: "${branchName}". Branch name cannot contain '..'.`);
  }
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branchName)) {
    fail(`Invalid branch name: "${branchName}". Use only alphanumeric, slash, dash, dot, underscore.`);
  }

  // Detect if already inside a worktree
  const commonDir = run("git", ["rev-parse", "--git-common-dir"], repoRoot);
  const gitDir = run("git", ["rev-parse", "--git-dir"], repoRoot);
  if (commonDir.ok && gitDir.ok && commonDir.stdout !== gitDir.stdout) {
    process.stderr.write(`Warning: already inside a worktree at ${repoRoot}\n`);
  }

  // Prune orphaned worktrees
  run("git", ["worktree", "prune"], repoRoot);

  // Compute worktree path
  const worktreePath = path.join(repoRoot, ".worktrees", branchName);

  // Idempotency check: if worktree already exists at this path, return it
  const worktreeList = run("git", ["worktree", "list", "--porcelain"], repoRoot);
  if (worktreeList.ok) {
    const lines = worktreeList.stdout.split("\n");
    for (const line of lines) {
      if (line.startsWith("worktree ") && line.slice("worktree ".length) === worktreePath) {
        // Already exists — idempotent success
        process.stdout.write(worktreePath + "\n");
        process.exit(0);
      }
    }
  }

  // Check if branch already exists (would conflict with a new worktree)
  const branchCheck = run("git", ["branch", "--list", branchName], repoRoot);
  if (branchCheck.ok && branchCheck.stdout !== "") {
    fail(`Branch "${branchName}" already exists. Choose a unique branch name.`);
  }

  // Create .worktrees directory if needed
  fs.mkdirSync(path.join(repoRoot, ".worktrees"), { recursive: true });

  // Create the worktree
  const createResult = run(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, baseRef],
    repoRoot
  );
  if (!createResult.ok) {
    fail(`Failed to create worktree: ${createResult.stderr}`);
  }

  // Run submodule update (no-op if no submodules)
  run("git", ["submodule", "update", "--init", "--recursive"], worktreePath);

  process.stdout.write(worktreePath + "\n");
  process.exit(0);
}

main();
