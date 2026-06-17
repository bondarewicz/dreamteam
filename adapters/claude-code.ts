/**
 * claude-code.ts — Claude Code HarnessAdapter.
 *
 * Encapsulates exactly what scripts/install.ts did before Phase 1: back up
 * existing agents/commands, remove renamed-away files, copy agents + commands,
 * symlink scripts, and merge MCP servers (~/.claude.json) + hooks
 * (~/.claude/settings.json) add-if-missing. Behavior is unchanged; it now lives
 * behind the HarnessAdapter interface so the CLI can drive multiple harnesses.
 */

import path from "path";
import fs from "fs";
import { contentSha } from "../scripts/paths.ts";
import { readModelSpec, setModelBlock } from "../scripts/frontmatter.ts";
import { resolveModel } from "../scripts/model-tiers.ts";
import { withAgentDefense } from "../scripts/prompt-defense.ts";
import type { HarnessAdapter, InstallOptions, InstalledFile } from "./types.ts";

const HARNESS = "claude-code";
const CLAUDE_DIR = path.join(process.env.HOME ?? "~", ".claude");
const AGENTS_DST = path.join(CLAUDE_DIR, "agents");
const COMMANDS_DST = path.join(CLAUDE_DIR, "commands");
const SCRIPTS_DST = path.join(CLAUDE_DIR, "scripts");

// Files from earlier roster names that must be removed on install.
const OLD_FILES = ["penny.md", "guardian.md", "architect.md", "analyst.md", "frontend.md"];

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Render an agent's harness-neutral `model:` spec (tier + per-provider pins)
 * into the flat `model: <claude-id>` that Claude Code expects. Claude Code can't
 * use a tier word or a provider-prefixed id (`ollama/…`) interactively — its
 * `--model` wants a bare Claude model name. resolveModel() picks the agent's
 * explicit claude pin if set, else the tier's claude default. The repo file (the
 * cross-provider source of truth) is never modified — only the installed copy.
 */
export function renderAgentForClaude(content: string): { content: string; model: string } {
  const model = resolveModel(readModelSpec(content), "claude");
  return { content: withAgentDefense(setModelBlock(content, `model: ${model}`)), model };
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  id = HARNESS;
  label = "Claude Code";

  async detect(): Promise<boolean> {
    // Present if the claude binary is on PATH OR the config dir already exists.
    if (fs.existsSync(CLAUDE_DIR)) return true;
    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "ignore", stderr: "ignore" });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }

  async install(opts: InstallOptions): Promise<InstalledFile[]> {
    const { assetsDir, backupDir, dryRun } = opts;
    const agentsSrc = path.join(assetsDir, "agents");
    const commandsSrc = path.join(assetsDir, "commands");
    const scriptsSrc = path.join(assetsDir, "scripts");
    const installed: InstalledFile[] = [];

    // 1. Back up existing agents/commands before overwriting.
    if (!dryRun && (fs.existsSync(AGENTS_DST) || fs.existsSync(COMMANDS_DST))) {
      fs.mkdirSync(backupDir, { recursive: true });
      if (fs.existsSync(AGENTS_DST)) fs.cpSync(AGENTS_DST, path.join(backupDir, "agents"), { recursive: true });
      if (fs.existsSync(COMMANDS_DST)) fs.cpSync(COMMANDS_DST, path.join(backupDir, "commands"), { recursive: true });
      console.log(`  backed up existing agents/commands → ${backupDir}`);
    }

    // 2. Remove renamed-away files from prior installs.
    for (const old of OLD_FILES) {
      for (const dst of [path.join(AGENTS_DST, old), path.join(COMMANDS_DST, old)]) {
        if (fs.existsSync(dst)) {
          console.log(`  - removing old file: ${path.basename(dst)}`);
          if (!dryRun) fs.rmSync(dst);
        }
      }
    }

    // 3. Directories.
    if (!dryRun) {
      fs.mkdirSync(AGENTS_DST, { recursive: true });
      fs.mkdirSync(COMMANDS_DST, { recursive: true });
      fs.mkdirSync(SCRIPTS_DST, { recursive: true });
    }

    // 4. Agents + 5. Commands (copy, record manifest).
    for (const [src, dst, kind] of [
      [agentsSrc, AGENTS_DST, "agent"],
      [commandsSrc, COMMANDS_DST, "command"],
    ] as const) {
      for (const filename of fs.readdirSync(src)) {
        if (!filename.endsWith(".md")) continue;
        const s = path.join(src, filename);
        const d = path.join(dst, filename);
        const name = filename.replace(/\.md$/, "");
        let body = fs.readFileSync(s, "utf-8");
        let note = "";
        if (kind === "agent") {
          const rendered = renderAgentForClaude(body);
          body = rendered.content;
          note = ` (model: ${rendered.model})`;
        }
        const sha = contentSha(body);
        if (!dryRun) fs.writeFileSync(d, body);
        installed.push({ path: d, sha, harness: HARNESS });
        console.log(`  + ${kind}: ${name}${note}`);
      }
    }

    // 6. Scripts (symlinks to the repo — always in sync; install.ts itself excluded).
    // Stale cast.sh symlink from old installs.
    const castShLink = path.join(SCRIPTS_DST, "cast.sh");
    if (!dryRun && (fs.existsSync(castShLink) || isSymlink(castShLink))) fs.rmSync(castShLink, { force: true });
    for (const filename of fs.readdirSync(scriptsSrc)) {
      if (!filename.endsWith(".ts") || filename === "install.ts") continue;
      const s = path.join(scriptsSrc, filename);
      const d = path.join(SCRIPTS_DST, filename);
      if (!dryRun) {
        if (fs.existsSync(d) || isSymlink(d)) fs.rmSync(d, { force: true });
        fs.symlinkSync(s, d);
      }
      installed.push({ path: d, sha: contentSha(fs.readFileSync(s, "utf-8")), harness: HARNESS });
    }

    // 7. MCP servers → ~/.claude.json (add-if-missing; never overwrite/remove).
    mergeMcp(path.join(scriptsSrc, "mcp-servers.json"), dryRun);

    // 8. Hooks → ~/.claude/settings.json (add-if-missing).
    mergeHooks(path.join(scriptsSrc, "hooks.json"), dryRun);

    return installed;
  }

  async uninstall(installed: InstalledFile[]): Promise<void> {
    for (const f of installed) {
      if (f.harness !== HARNESS) continue;
      try {
        if (fs.existsSync(f.path) || isSymlink(f.path)) {
          fs.rmSync(f.path, { force: true });
          console.log(`  - removed ${f.path}`);
        }
      } catch (e) {
        console.warn(`  ! could not remove ${f.path}: ${e}`);
      }
    }
    // MCP/hooks merges are add-if-missing and shared; we do not strip them on
    // uninstall (could remove entries the user relies on). Documented behavior.
  }
}

function mergeMcp(specPath: string, dryRun: boolean): void {
  const userConfigPath = path.join(process.env.HOME ?? "~", ".claude.json");
  if (!fs.existsSync(specPath) || !fs.existsSync(userConfigPath)) return;
  const desired: Record<string, unknown> = (JSON.parse(fs.readFileSync(specPath, "utf-8")).mcpServers) ?? {};
  const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf-8"));
  userConfig.mcpServers ??= {};
  let added = 0;
  for (const [name, entry] of Object.entries(desired)) {
    if (!userConfig.mcpServers[name]) {
      userConfig.mcpServers[name] = entry;
      added++;
      console.log(`  + mcp: ${name}`);
    }
  }
  if (added > 0 && !dryRun) fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
}

function mergeHooks(specPath: string, dryRun: boolean): void {
  const userSettingsPath = path.join(CLAUDE_DIR, "settings.json");
  if (!fs.existsSync(specPath)) return;
  const desiredHooks: Record<string, unknown[]> = (JSON.parse(fs.readFileSync(specPath, "utf-8")).hooks) ?? {};
  const userSettings = fs.existsSync(userSettingsPath)
    ? JSON.parse(fs.readFileSync(userSettingsPath, "utf-8"))
    : {};
  userSettings.hooks ??= {};
  let changes = 0;
  for (const [event, entries] of Object.entries(desiredHooks)) {
    userSettings.hooks[event] ??= [];
    const existing = userSettings.hooks[event] as unknown[];
    for (const entry of entries as unknown[]) {
      const entryStr = JSON.stringify(entry);
      if (!existing.some((e) => JSON.stringify(e) === entryStr)) {
        existing.push(entry);
        changes++;
        console.log(`  + hook: ${event}`);
      }
    }
  }
  if (changes > 0 && !dryRun) fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2));
}
