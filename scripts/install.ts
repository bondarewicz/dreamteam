#!/usr/bin/env bun
/**
 * install.ts — Dream Team Installer (Bun TypeScript)
 *
 * Replicates all functionality of install.sh.
 * Usage: bun scripts/install.ts
 */

import path from "path";
import fs from "fs";
import {
  dataDir,
  workspaceDir,
  backupsDir,
  writeConfig,
  contentSha,
  resolveVersion,
  type InstalledFile,
} from "./paths.ts";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_DIR = path.resolve(SCRIPT_DIR, "..");
const CLAUDE_DIR = path.join(process.env.HOME ?? "~", ".claude");
const AGENTS_SRC = path.join(REPO_DIR, "agents");
const COMMANDS_SRC = path.join(REPO_DIR, "commands");
const AGENTS_DST = path.join(CLAUDE_DIR, "agents");
const COMMANDS_DST = path.join(CLAUDE_DIR, "commands");
const SCRIPTS_DST = path.join(CLAUDE_DIR, "scripts");

// Phase 0 (distribution): manifest of every file this install writes, recorded
// into ~/.dreamteam/config.json for exact uninstall + drift detection.
const INSTALLED: InstalledFile[] = [];

const timestamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 15)
  .replace(/(\d{8})(\d{6})/, "$1-$2");
// Backups moved from ~/.claude/backup-* to the writable data dir (~/.dreamteam/backups).
const BACKUP_DIR = path.join(backupsDir(), `backup-${timestamp}`);

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
  const src = path.join(AGENTS_SRC, filename);
  const dst = path.join(AGENTS_DST, filename);
  fs.cpSync(src, dst);
  INSTALLED.push({ path: dst, sha: contentSha(fs.readFileSync(src, "utf-8")), harness: "claude-code" });
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
  const src = path.join(COMMANDS_SRC, filename);
  const dst = path.join(COMMANDS_DST, filename);
  fs.cpSync(src, dst);
  INSTALLED.push({ path: dst, sha: contentSha(fs.readFileSync(src, "utf-8")), harness: "claude-code" });
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

// --- Step 6b: Record dreamteam repo root for runtime resolution ---
// /team is installed globally but runs in arbitrary repos. It needs to know
// where this dreamteam checkout lives so it can read eval templates and write
// draft evals back here (not into the working repo). team.md reads this file.
// Kept for back-compat alongside the new ~/.dreamteam/config.json manifest.
const DREAMTEAM_DIR = path.join(CLAUDE_DIR, "dreamteam");
fs.mkdirSync(DREAMTEAM_DIR, { recursive: true });
fs.writeFileSync(path.join(DREAMTEAM_DIR, "repo-root"), REPO_DIR, "utf-8");
console.log(`Recorded dreamteam repo root: ${REPO_DIR}`);
console.log("");

// --- Step 6c: Write ~/.dreamteam/config.json manifest (Phase 0 of distribution) ---
// Splits the old repo-root into resolved assetsDir (read-only) + dataDir (writable),
// and records every file we installed so a future `dreamteam uninstall`/`update` is exact.
fs.mkdirSync(workspaceDir(), { recursive: true });
fs.mkdirSync(backupsDir(), { recursive: true });
writeConfig({
  configVersion: 1,
  version: resolveVersion(),
  assetsDir: REPO_DIR,
  dataDir: dataDir(),
  harnesses: ["claude-code"],
  installed: INSTALLED,
  installedAt: new Date().toISOString(),
});
console.log(`Wrote manifest: ${path.join(dataDir(), "config.json")} (${INSTALLED.length} files)`);
console.log("");

// --- Step 7: Ensure output directories exist ---
// NOTE (Phase 0): eval results/reports still live in the repo so the web app keeps
// reading them unchanged. Relocating these to dataDir/workspace is a later step,
// gated on updating the web reader. workspaceDir() above is created ahead of that.
fs.mkdirSync(path.join(REPO_DIR, "reports", "retros"), { recursive: true });
fs.mkdirSync(path.join(REPO_DIR, "reports", "evals"), { recursive: true });
fs.mkdirSync(path.join(REPO_DIR, "evals", "results"), { recursive: true });

// --- Step 8: Ensure MCP servers are registered in ~/.claude.json ---
// Tracked source of truth: scripts/mcp-servers.json. We merge (add-if-missing)
// into the user-scope config; we never overwrite existing entries or remove
// anything we don't own.
const mcpSpecPath = path.join(SCRIPT_DIR, "mcp-servers.json");
const userConfigPath = path.join(process.env.HOME ?? "~", ".claude.json");

if (fs.existsSync(mcpSpecPath) && fs.existsSync(userConfigPath)) {
  console.log("Ensuring MCP servers...");
  const spec = JSON.parse(fs.readFileSync(mcpSpecPath, "utf-8"));
  const desired: Record<string, unknown> = spec.mcpServers ?? {};

  const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf-8"));
  userConfig.mcpServers ??= {};

  let added = 0;
  let existing = 0;
  for (const [name, entry] of Object.entries(desired)) {
    if (userConfig.mcpServers[name]) {
      console.log(`  = ${name} (already registered)`);
      existing++;
    } else {
      userConfig.mcpServers[name] = entry;
      console.log(`  + ${name}`);
      added++;
    }
  }

  if (added > 0) {
    fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
    console.log(`  ${added} added, ${existing} already present.`);
  } else {
    console.log(`  ${existing} already present, nothing to add.`);
  }
  console.log("");
}

// --- Step 9: Merge hooks into ~/.claude/settings.json ---
// Tracked source of truth: scripts/hooks.json. We merge (add-if-missing) into
// the user-scope settings; we never overwrite or remove entries we don't own.
const hooksSpecPath = path.join(SCRIPT_DIR, "hooks.json");
const userSettingsPath = path.join(CLAUDE_DIR, "settings.json");

if (fs.existsSync(hooksSpecPath)) {
  console.log("Ensuring hooks...");
  const hooksSpec = JSON.parse(fs.readFileSync(hooksSpecPath, "utf-8"));
  const desiredHooks: Record<string, unknown[]> = hooksSpec.hooks ?? {};

  const userSettings = fs.existsSync(userSettingsPath)
    ? JSON.parse(fs.readFileSync(userSettingsPath, "utf-8"))
    : {};
  userSettings.hooks ??= {};

  let hookChanges = 0;
  for (const [event, entries] of Object.entries(desiredHooks)) {
    userSettings.hooks[event] ??= [];
    const existing = userSettings.hooks[event] as unknown[];
    for (const entry of entries as unknown[]) {
      const entryStr = JSON.stringify(entry);
      const alreadyPresent = existing.some((e) => JSON.stringify(e) === entryStr);
      if (!alreadyPresent) {
        existing.push(entry);
        console.log(`  + ${event} hook: ${(entry as Record<string, unknown>).matcher ?? "(no matcher)"}`);
        hookChanges++;
      } else {
        console.log(`  = ${event} hook already present`);
      }
    }
  }

  if (hookChanges > 0) {
    fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2));
    console.log(`  ${hookChanges} hook(s) added.`);
  } else {
    console.log("  All hooks already present.");
  }
  console.log("");
}

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
console.log("  drexler — Deletion-Bias Enforcer (scope & maintenance cost)");
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
