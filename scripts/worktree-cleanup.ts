#!/usr/bin/env bun
/**
 * worktree-cleanup.ts — Git worktree removal with multiple modes
 *
 * Usage: bun worktree-cleanup.ts <worktree-path> <mode>
 * Modes: merge | discard | keep | pr
 *
 * merge:   merge branch to base, remove worktree, delete branch
 * discard: remove worktree, delete branch (no merge)
 * keep:    remove worktree only, keep branch for later
 * pr:      print branch name for PR creation, remove worktree
 *
 * Exit 0 = success, exit 1 = failure (stderr has message).
 */

import path from "path";
import fs from "fs";

type Mode = "merge" | "discard" | "keep" | "pr";
const VALID_MODES: Mode[] = ["merge", "discard", "keep", "pr"];

function run(cmd: string, args: string[], cwd?: string): { stdout: string; stderr: string; ok: boolean; exitCode: number } {
  const result = Bun.spawnSync([cmd, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    ok: result.exitCode === 0,
    exitCode: result.exitCode ?? 1,
  };
}

function fail(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    fail("Usage: worktree-cleanup.ts <worktree-path> <mode>\nModes: merge | discard | keep | pr");
  }

  const worktreePath = path.resolve(args[0]);
  const mode = args[1] as Mode;

  if (!VALID_MODES.includes(mode)) {
    fail(`Invalid mode: "${mode}". Must be one of: ${VALID_MODES.join(", ")}`);
  }

  // Idempotency: if worktree path is already gone, treat as already cleaned up
  if (!fs.existsSync(worktreePath)) {
    process.stderr.write("Worktree already removed.\n");
    process.exit(0);
  }

  // Get the repo root (common git dir) from within the worktree
  const commonDirResult = run("git", ["rev-parse", "--git-common-dir"], worktreePath);
  if (!commonDirResult.ok) {
    fail(`Not a git repository: ${worktreePath}`);
  }
  // --git-common-dir returns a path relative to the worktree, e.g. "../.git"
  const repoRoot = path.resolve(worktreePath, commonDirResult.stdout, "..");

  // Validate this is NOT the main worktree
  const mainWorktreeResult = run("git", ["rev-parse", "--show-toplevel"], repoRoot);
  if (mainWorktreeResult.ok) {
    const mainWorktree = path.resolve(mainWorktreeResult.stdout);
    if (path.resolve(worktreePath) === mainWorktree) {
      fail("SAFETY: Refusing to operate on the main worktree.");
    }
  }

  // Get the current branch in the worktree
  const branchResult = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
  if (!branchResult.ok) {
    fail(`Could not determine branch in worktree: ${branchResult.stderr}`);
  }
  const branchName = branchResult.stdout;

  // Refuse to operate on main or master branch
  if (branchName === "main" || branchName === "master") {
    fail(`SAFETY: Refusing to operate on protected branch "${branchName}".`);
  }

  // Check for uncommitted changes
  const statusResult = run("git", ["status", "--porcelain"], worktreePath);
  if (statusResult.ok && statusResult.stdout !== "") {
    fail(`Uncommitted changes exist in worktree:\n${statusResult.stdout}\nCommit or stash changes before cleanup.`);
  }

  // Get the base branch (what this branch was created from)
  // Try to find the upstream tracking branch, fall back to main
  const upstreamResult = run("git", ["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`], worktreePath);
  const baseBranch = upstreamResult.ok ? upstreamResult.stdout.replace(/^origin\//, "") : "main";

  // Execute mode-specific logic
  if (mode === "pr") {
    // Print branch name for PR creation
    process.stdout.write(`${branchName}\n`);
    // Remove worktree
    const removeResult = run("git", ["worktree", "remove", worktreePath], repoRoot);
    if (!removeResult.ok) {
      // Try force if clean (we already verified no uncommitted changes)
      const forceResult = run("git", ["worktree", "remove", "--force", worktreePath], repoRoot);
      if (!forceResult.ok) {
        fail(`Failed to remove worktree: ${forceResult.stderr}`);
      }
    }
    process.exit(0);
  }

  if (mode === "merge") {
    // Use git fetch . branchName:baseBranch — fast-forward ref update without checkout.
    // This avoids touching the main worktree's working tree, safe for concurrent sessions.
    const fetchResult = run("git", ["fetch", ".", `${branchName}:${baseBranch}`], repoRoot);
    if (!fetchResult.ok) {
      fail(
        `Cannot fast-forward "${baseBranch}" to "${branchName}".\n` +
        `The merge is not a fast-forward — resolve manually:\n` +
        `  git checkout ${baseBranch} && git merge ${branchName}\n` +
        `Then re-run cleanup with mode "discard" or "keep".`
      );
    }
  }

  // Remove the worktree (applies to merge, discard, keep)
  const removeResult = run("git", ["worktree", "remove", worktreePath], repoRoot);
  if (!removeResult.ok) {
    const forceResult = run("git", ["worktree", "remove", "--force", worktreePath], repoRoot);
    if (!forceResult.ok) {
      fail(`Failed to remove worktree: ${forceResult.stderr}`);
    }
  }

  // Delete branch for merge and discard modes
  if (mode === "merge" || mode === "discard") {
    // Use -d (safe delete — requires merged) for merge mode, -D for discard
    const deleteFlag = mode === "merge" ? "-d" : "-D";
    const deleteResult = run("git", ["branch", deleteFlag, branchName], repoRoot);
    if (!deleteResult.ok) {
      process.stderr.write(`Warning: could not delete branch "${branchName}": ${deleteResult.stderr}\n`);
    }
  }

  // Prune any leftover worktree references
  run("git", ["worktree", "prune"], repoRoot);

  process.exit(0);
}

main();
