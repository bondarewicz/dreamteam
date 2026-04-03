#!/usr/bin/env bun
/**
 * install.ts — Dream Team Installer (Bun TypeScript)
 *
 * Replicates all functionality of install.sh.
 * Usage: bun scripts/install.ts
 */

import path from "path";
import fs from "fs";

const SCRIPT_DIR = path.dirname(path.resolve(import.meta.path));
const REPO_DIR = path.resolve(SCRIPT_DIR, "..");
const CLAUDE_DIR = path.join(process.env.HOME ?? "~", ".claude");
const AGENTS_SRC = path.join(REPO_DIR, "agents");
const COMMANDS_SRC = path.join(REPO_DIR, "commands");
const AGENTS_DST = path.join(CLAUDE_DIR, "agents");
const COMMANDS_DST = path.join(CLAUDE_DIR, "commands");
const SCRIPTS_DST = path.join(CLAUDE_DIR, "scripts");

const timestamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 15)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
const BACKUP_DIR = path.join(CLAUDE_DIR, `backup-${timestamp}`);

console.log("=== Dream Team Installer ===");
console.log("");

// --- Step 1: Backup existing files ---
if (fs.existsSync(AGENTS_DST) || fs.existsSync(COMMANDS_DST)) {
  console.log(`Backing up existing files to ${BACKUP_DIR}...`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(AGENTS_DST)) {
    fs.cpSync(AGENTS_DST, path.join(BACKUP_DIR, "agents"), { recursive: true });
  }
  if (fs.existsSync(COMMANDS_DST)) {
    fs.cpSync(COMMANDS_DST, path.join(BACKUP_DIR, "commands"), { recursive: true });
  }
  console.log("  Backup complete.");
  console.log("");
}

// --- Step 2: Remove old files from previous installations ---
const OLD_FILES = ["penny.md", "guardian.md", "architect.md", "analyst.md", "frontend.md"];
for (const old of OLD_FILES) {
  const agentPath = path.join(AGENTS_DST, old);
  const cmdPath = path.join(COMMANDS_DST, old);
  if (fs.existsSync(agentPath)) {
    console.log(`Removing old agent: ${old}`);
    fs.rmSync(agentPath);
  }
  if (fs.existsSync(cmdPath)) {
    console.log(`Removing old command: ${old}`);
    fs.rmSync(cmdPath);
  }
}
console.log("");

// --- Step 3: Create directories ---
fs.mkdirSync(AGENTS_DST, { recursive: true });
fs.mkdirSync(COMMANDS_DST, { recursive: true });
fs.mkdirSync(SCRIPTS_DST, { recursive: true });

// --- Step 4: Install agents ---
console.log("Installing agents...");
let agentCount = 0;
for (const filename of fs.readdirSync(AGENTS_SRC)) {
  if (!filename.endsWith(".md")) continue;
  fs.cpSync(path.join(AGENTS_SRC, filename), path.join(AGENTS_DST, filename));
  const agentName = filename.replace(/\.md$/, "");
  console.log(`  + ${agentName}`);
  agentCount++;
}
console.log(`  ${agentCount} agents installed.`);
console.log("");

// --- Step 5: Install commands ---
console.log("Installing commands...");
let cmdCount = 0;
for (const filename of fs.readdirSync(COMMANDS_SRC)) {
  if (!filename.endsWith(".md")) continue;
  fs.cpSync(path.join(COMMANDS_SRC, filename), path.join(COMMANDS_DST, filename));
  const cmdName = filename.replace(/\.md$/, "");
  console.log(`  + /${cmdName}`);
  cmdCount++;
}
console.log(`  ${cmdCount} commands installed.`);
console.log("");

// --- Step 6: Install scripts (symlinks — always in sync, never stale) ---
// Remove dangling symlink from prior installations that included cast.sh
const castShLink = path.join(SCRIPTS_DST, "cast.sh");
if (fs.existsSync(castShLink) || isSymlink(castShLink)) {
  fs.rmSync(castShLink, { force: true });
}

console.log("Installing scripts (symlinks)...");
let scriptCount = 0;
for (const filename of fs.readdirSync(SCRIPT_DIR)) {
  // Only .ts files (install.ts skipped — it's the installer itself)
  if (!filename.endsWith(".ts")) continue;
  if (filename === "install.ts") continue;

  const srcPath = path.join(SCRIPT_DIR, filename);
  const dstPath = path.join(SCRIPTS_DST, filename);

  // Remove old copy/symlink and create fresh symlink to repo
  if (fs.existsSync(dstPath) || isSymlink(dstPath)) {
    fs.rmSync(dstPath, { force: true });
  }
  fs.symlinkSync(srcPath, dstPath);
  console.log(`  + ${filename} -> ${filename} (symlink)`);
  scriptCount++;
}
console.log(`  ${scriptCount} scripts installed.`);
console.log("");

// --- Step 7: Ensure output directories exist ---
fs.mkdirSync(path.join(REPO_DIR, "reports", "retros"), { recursive: true });
fs.mkdirSync(path.join(REPO_DIR, "reports", "evals"), { recursive: true });
fs.mkdirSync(path.join(REPO_DIR, "evals", "results"), { recursive: true });

// --- Summary ---
console.log("=== Installation Complete ===");
console.log("");
console.log("Dream Team agents:");
console.log("  mj      — Strategic Systems Architect");
console.log("  bird    — Domain Authority & Final Arbiter");
console.log("  shaq    — Primary Code Executor");
console.log("  kobe    — Quality & Risk Enforcer");
console.log("  pippen  — Stability, Integration & Defense");
console.log("  magic   — Context Synthesizer & Team Glue");
console.log("");
console.log("Commands:");
console.log("  /mj           — Architecture design & health diagnostics");
console.log("  /bird         — Domain analysis & business impact");
console.log("  /shaq         — Code implementation");
console.log("  /kobe         — Quality review & production readiness");
console.log("  /pippen       — Stability & integration review");
console.log("  /magic        — Synthesis & documentation");
console.log("  /team         — Full Dream Team orchestration (Coach K)");
console.log("  /code-review  — Automated PR code review (local only)");
console.log("");
console.log("Start a new Claude Code session to use the agents.");

function isSymlink(p: string): boolean {
  try {
    fs.lstatSync(p);
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
