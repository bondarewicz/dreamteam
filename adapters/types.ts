/**
 * types.ts — HarnessAdapter interface (distribution.md §6).
 *
 * A HarnessAdapter knows how to provision the Dream Team roster into one harness
 * (Claude Code today; opencode/others later) and to remove exactly what it wrote.
 * The CLI (bin/dreamteam.ts) orchestrates one or more adapters; each adapter owns
 * the target file format + locations for its harness.
 *
 * Phase 1: only the claude-code adapter exists, implementing today's install
 * behavior unchanged. The interface is intentionally coarse (install/uninstall);
 * per-agent render granularity (§6.2) lands in Phase 3 when a second harness needs
 * a different render of the same canonical spec.
 */

import type { InstalledFile } from "../scripts/paths.ts";

export type { InstalledFile };

/** Neutral capability verbs (canonical spec); adapters map these to harness tool names. */
export type Capability = "read" | "search" | "shell" | "edit" | "write" | "web";

export interface InstallOptions {
  /** Read-only assets root (repo today, package later). */
  assetsDir: string;
  /** Directory to write pre-install backups into (under dataDir). */
  backupDir: string;
  /** When true, report what would change without writing. */
  dryRun: boolean;
}

export interface HarnessAdapter {
  /** Stable id recorded in the manifest, e.g. "claude-code". */
  id: string;
  /** Human label for CLI output. */
  label: string;
  /** Is this harness installed on the current machine? */
  detect(): Promise<boolean>;
  /**
   * Provision the full roster into this harness. Returns the manifest of files
   * written (path + content sha) so uninstall/update can be exact. In dryRun,
   * returns what *would* be written without touching disk.
   */
  install(opts: InstallOptions): Promise<InstalledFile[]>;
  /** Remove exactly the files in the manifest (never user files). */
  uninstall(installed: InstalledFile[]): Promise<void>;
}
