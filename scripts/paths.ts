/**
 * paths.ts — Dream Team path resolution (Phase 0 of distribution).
 *
 * Splits the two notions that `repo-root` used to conflate:
 *   - assetsDir : read-only distributed assets (agents/commands/eval templates).
 *                 Today this is the repo (git-clone install); once published it
 *                 will be the package's bundled `assets/` dir.
 *   - dataDir   : the user-owned, writable workspace (~/.dreamteam). Holds the
 *                 install manifest, backups, and (later) eval results / retros.
 *
 * Honors the XDG base-dir convention; falls back to ~/.dreamteam.
 * See docs/distribution-plan.md (Phase 0).
 */

import path from "path";
import os from "os";
import fs from "fs";

const HOME = process.env.HOME ?? os.homedir();

/** This file lives in <repo>/scripts/, so the repo root is one level up. */
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

/**
 * Read-only distributed assets root.
 * Clone install → the repo root. (Published package will override this to the
 * bundled assets/ dir; kept as a single function so that swap is one edit.)
 */
export function assetsDir(): string {
  return path.resolve(SCRIPT_DIR, "..");
}

/**
 * Writable user workspace. `$XDG_DATA_HOME/dreamteam` if set, else `~/.dreamteam`.
 */
export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return xdg ? path.join(xdg, "dreamteam") : path.join(HOME, ".dreamteam");
}

export function configPath(): string {
  return path.join(dataDir(), "config.json");
}

/** Workspace for generated artifacts (eval results, retros, specs) — created on install. */
export function workspaceDir(): string {
  return path.join(dataDir(), "workspace");
}

/** Pre-install backups live here (was: ~/.claude/backup-*). */
export function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

/** Eval result JSON + raw/ live here (was: <repo>/evals/results). Writable → dataDir. */
export function resultsDir(): string {
  return path.join(workspaceDir(), "evals", "results");
}

/** Generated reports (retros, eval summaries) (was: <repo>/reports). */
export function reportsDir(): string {
  return path.join(workspaceDir(), "reports");
}

/** The web app's SQLite DB, rebuilt from resultsDir (was: <repo>/data/dreamteam.db). */
export function dbPath(): string {
  return path.join(workspaceDir(), "dreamteam.db");
}

/** A file Dream Team wrote during install: its installed path + content hash. */
export interface InstalledFile {
  /** Absolute path of the installed file (in the harness's config dir). */
  path: string;
  /** Hash of the source content at install time — lets `update` detect drift. */
  sha: string;
  /** Which harness this file belongs to (claude-code, …). */
  harness: string;
}

export interface DreamteamConfig {
  /** Schema version of this config file. */
  configVersion: 1;
  /** Dream Team package/repo version at install time. */
  version: string;
  /** Resolved assets + data dirs at install time. */
  assetsDir: string;
  dataDir: string;
  /** Harnesses provisioned (claude-code, …). */
  harnesses: string[];
  /** Manifest of everything install wrote — for exact uninstall + drift detection. */
  installed: InstalledFile[];
  /** ISO timestamp of the install that wrote this config. */
  installedAt: string;
}

/** Stable content hash for manifest entries (drift detection). */
export function contentSha(content: string): string {
  return String(Bun.hash(content));
}

export function readConfig(): DreamteamConfig | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8")) as DreamteamConfig;
  } catch {
    return null;
  }
}

export function writeConfig(cfg: DreamteamConfig): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf-8");
}

/** Read the Dream Team version from the assets/repo package.json (fallback "0.0.0"). */
export function resolveVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(assetsDir(), "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
