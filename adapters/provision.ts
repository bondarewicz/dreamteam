/**
 * provision.ts — orchestrate install/uninstall across harness adapters.
 *
 * Shared by both `bin/dreamteam.ts` and the legacy `scripts/install.ts` shim, so
 * there is one source of truth for the install flow. Writes the ~/.dreamteam
 * manifest and keeps the legacy ~/.claude/dreamteam/repo-root for back-compat.
 */

import path from "path";
import fs from "fs";
import {
  assetsDir,
  dataDir,
  workspaceDir,
  backupsDir,
  resultsDir,
  reportsDir,
  writeConfig,
  readConfig,
  resolveVersion,
  type InstalledFile,
} from "../scripts/paths.ts";
import { ClaudeCodeAdapter } from "./claude-code.ts";
import type { HarnessAdapter } from "./types.ts";

export const ADAPTERS: Record<string, HarnessAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
};

export function knownHarnesses(): string[] {
  return Object.keys(ADAPTERS);
}

/** Resolve a --harness selector ("claude-code" | "all" | comma list) to adapter ids. */
export function selectHarnesses(selector: string): string[] {
  const sel = (selector || "claude-code").trim();
  if (sel === "all") return knownHarnesses();
  return sel.split(",").map((s) => s.trim()).filter((s) => s in ADAPTERS);
}

export interface ProvisionResult {
  harnesses: string[];
  installed: InstalledFile[];
  backupDir: string;
  dryRun: boolean;
}

export async function provision(opts: { harnesses?: string; dryRun?: boolean } = {}): Promise<ProvisionResult> {
  const dryRun = opts.dryRun ?? false;
  const harnesses = selectHarnesses(opts.harnesses ?? "claude-code");
  if (harnesses.length === 0) throw new Error(`No known harness in selector "${opts.harnesses}". Known: ${knownHarnesses().join(", ")}`);

  const assets = assetsDir();
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6})/, "$1-$2");
  const backupDir = path.join(backupsDir(), `backup-${ts}`);

  const installed: InstalledFile[] = [];
  for (const id of harnesses) {
    const adapter = ADAPTERS[id];
    console.log(`\n=== ${adapter.label} (${id})${dryRun ? " [dry-run]" : ""} ===`);
    const files = await adapter.install({ assetsDir: assets, backupDir, dryRun });
    installed.push(...files);
    console.log(`  ${files.length} files ${dryRun ? "would be" : ""} installed.`);
  }

  if (!dryRun) {
    // Workspace + manifest (Phase 0 structure).
    fs.mkdirSync(workspaceDir(), { recursive: true });
    fs.mkdirSync(backupsDir(), { recursive: true });
    writeConfig({
      configVersion: 1,
      version: resolveVersion(),
      assetsDir: assets,
      dataDir: dataDir(),
      harnesses,
      installed,
      installedAt: new Date().toISOString(),
    });

    // Back-compat: legacy repo-root file that team.md reads.
    const legacyDir = path.join(process.env.HOME ?? "~", ".claude", "dreamteam");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "repo-root"), assets, "utf-8");

    // Writable workspace dirs (results + reports now live under ~/.dreamteam/workspace,
    // not the repo — so the shipped web reads them). One-time history preservation: if the
    // workspace results dir is empty and the repo/assets has legacy results, copy them over.
    fs.mkdirSync(resultsDir(), { recursive: true });
    fs.mkdirSync(reportsDir(), { recursive: true });
    const legacyResults = path.join(assets, "evals", "results");
    const isEmpty = !fs.existsSync(resultsDir()) || fs.readdirSync(resultsDir()).filter((f) => f.endsWith(".json")).length === 0;
    if (isEmpty && fs.existsSync(legacyResults)) {
      for (const f of fs.readdirSync(legacyResults)) {
        const src = path.join(legacyResults, f);
        try {
          if (fs.statSync(src).isFile() && f.endsWith(".json")) fs.cpSync(src, path.join(resultsDir(), f));
          else if (f === "raw") fs.cpSync(src, path.join(resultsDir(), "raw"), { recursive: true });
        } catch { /* best-effort */ }
      }
      console.log(`  migrated legacy eval results → ${resultsDir()}`);
    }
  }

  return { harnesses, installed, backupDir, dryRun };
}

export async function unprovision(): Promise<{ removed: number; harnesses: string[] }> {
  const cfg = readConfig();
  if (!cfg) throw new Error(`No ~/.dreamteam/config.json — nothing to uninstall.`);
  for (const id of cfg.harnesses) {
    const adapter = ADAPTERS[id];
    if (!adapter) continue;
    console.log(`\n=== uninstall ${adapter.label} (${id}) ===`);
    await adapter.uninstall(cfg.installed);
  }
  return { removed: cfg.installed.length, harnesses: cfg.harnesses };
}
