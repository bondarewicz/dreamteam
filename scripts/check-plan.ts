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
    // docs/spec-*.md (Coach K writes these in STEP 1b)
    const docsDir = path.join(dir, "docs");
    if (fs.existsSync(docsDir)) {
      if (fs.readdirSync(docsDir).some((f) => f.startsWith("spec-") && f.endsWith(".md")))
        return true;
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
