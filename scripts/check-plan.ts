#!/usr/bin/env bun
/**
 * check-plan.ts — Advisory PreToolUse hook.
 *
 * Fires before Edit/Write calls. Warns if no plan spec exists in the current
 * project, nudging the user toward /team or a spec doc before implementing.
 * Always exits 0 — advisory only, never blocking.
 */

import fs from "fs";
import path from "path";

function hasSpec(dir: string): boolean {
  try {
    const docsDir = path.join(dir, "docs");
    if (fs.existsSync(docsDir)) {
      for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
        // SDD final spec — Magic writes docs/spec-<topic>.md at Phase 5
        if (entry.isFile() && entry.name.startsWith("spec-") && entry.name.endsWith(".md"))
          return true;
        // SDD intake — Coach K writes docs/spec-<topic>/intake.md at STEP 1b
        if (entry.isDirectory() && entry.name.startsWith("spec-")) {
          const intake = path.join(docsDir, entry.name, "intake.md");
          if (fs.existsSync(intake)) return true;
        }
      }
    }
    // Root-level spec-*.md fallback
    if (fs.readdirSync(dir).some((f) => f.startsWith("spec-") && f.endsWith(".md")))
      return true;
  } catch {
    // Unreadable directory — don't block
  }
  return false;
}

if (!hasSpec(process.cwd())) {
  process.stderr.write(
    "[dreamteam] No plan spec found. Use /team to have Coach K plan before implementing, " +
      "or create docs/spec-<topic>.md first.\n"
  );
}

process.exit(0);
