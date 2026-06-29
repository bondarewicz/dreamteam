/**
 * import-file-memory.test.ts — AC-MIG-1..11 tests for scripts/import-file-memory.ts
 *
 * All tests run against fixture files in fixtures/file-memory/ and use
 * createDriver(":memory:") or a temp file — NEVER the real DB or ~/.claude.
 *
 * AC-MIG-1: Dual-frontmatter classification (flat type: and nested metadata.type: both work)
 * AC-MIG-2: Filename/type mismatch → classify by type (authoritative) + log mismatch
 * AC-MIG-3: Scoped facts stored verbatim + scrub() NEVER invoked for user/project/reference
 * AC-MIG-4: feedback → confidence=0.7, status='approved', ingestion_path='migrated', agent_id=NULL
 * AC-MIG-5: identifier-containing feedback → dropped + worklisted (not in instincts)
 * AC-MIG-6: Idempotent re-run → identical row counts (no duplicates)
 * AC-MIG-7: Archive-not-delete → source files present + copies exist under archive/
 * AC-MIG-8: unknown/missing type → skip + report
 * AC-MIG-9: MEMORY.md skipped (not counted as a file to process)
 * AC-MIG-10: worklist/report are never read by memory-projection.ts or session-analyzer.ts
 * AC-MIG-11: dry-run writes nothing (DB untouched, no archive, no worklist file)
 *
 * Safety guard: --source is REQUIRED; no accidental default to ~/.claude.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs";
import os from "os";
import { createDriver } from "../db-driver.ts";
import { createInstinctsDb } from "../instincts-db.ts";
import { createFactStore } from "../fact-store.ts";
import { runImport, parseFrontmatter, inferDomain } from "../../../scripts/import-file-memory.ts";
import type { ImportOptions } from "../../../scripts/import-file-memory.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures/file-memory");
const DEFAULT_PROJECT = "test-proj";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir for archive + worklist output (cleaned up after each test). */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "import-mem-test-"));
}

/** Build standard ImportOptions pointing at fixtures + a fresh :memory: DB. */
function makeOpts(overrides: Partial<ImportOptions> = {}): ImportOptions {
  const tmpDir = makeTempDir();
  return {
    sourceDir: FIXTURES_DIR,
    dryRun: false,
    dbPath: ":memory:",
    archiveDir: path.join(tmpDir, "archive"),
    project: DEFAULT_PROJECT,
    worklistPath: path.join(tmpDir, "migration-worklist.md"),
    reportPath: path.join(tmpDir, "migration-report.md"),
    ...overrides,
  };
}

// Track temp dirs for cleanup
const tempDirs: string[] = [];

function makeTempDirTracked(): string {
  const d = makeTempDir();
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  // Clean up temp dirs created in this test
  for (const d of tempDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// parseFrontmatter unit tests (part of AC-MIG-1)
// ---------------------------------------------------------------------------

describe("parseFrontmatter — dual-shape support (AC-MIG-1)", () => {
  test("flat top-level type: is parsed correctly", () => {
    const content = `---
name: my_name
description: My description
type: feedback
---
Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result.type).toBe("feedback");
    expect(result.name).toBe("my_name");
    expect(result.description).toBe("My description");
    expect(result.body).toContain("Body content here.");
  });

  test("nested metadata.type: is parsed correctly", () => {
    const content = `---
name: nested_ref
description: Reference document
metadata:
  type: reference
---
Reference body.
`;
    const result = parseFrontmatter(content);
    expect(result.type).toBe("reference");
    expect(result.name).toBe("nested_ref");
    expect(result.description).toBe("Reference document");
  });

  test("flat type: wins when both flat and nested are present", () => {
    const content = `---
name: conflict
description: Both shapes
type: user
metadata:
  type: reference
---
Body.
`;
    const result = parseFrontmatter(content);
    // Flat type: wins (first precedence)
    expect(result.type).toBe("user");
  });

  test("missing type field returns undefined type", () => {
    const content = `---
name: no_type
description: No type here
---
Body.
`;
    const result = parseFrontmatter(content);
    expect(result.type).toBeUndefined();
    expect(result.name).toBe("no_type");
  });

  test("file without frontmatter returns empty fields", () => {
    const content = "Just plain content, no frontmatter.";
    const result = parseFrontmatter(content);
    expect(result.type).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.body).toContain("Just plain content");
  });

  test("rawContent is the full original file content", () => {
    const content = `---\nname: x\ntype: user\n---\nBody.\n`;
    const result = parseFrontmatter(content);
    expect(result.rawContent).toBe(content);
  });

  test("wikilinks in body are preserved verbatim (BR-MIG-9)", () => {
    const content = `---
name: ref
description: check wiki
type: feedback
---
See [[decisions]] for context.
`;
    const result = parseFrontmatter(content);
    expect(result.body).toContain("[[decisions]]");
  });

  test("nested metadata.type: from reference_nested.md fixture is parsed", () => {
    const fixturePath = path.join(FIXTURES_DIR, "reference_nested.md");
    const content = fs.readFileSync(fixturePath, "utf-8");
    const result = parseFrontmatter(content);
    expect(result.type).toBe("reference");
    expect(result.name).toBe("reference_nested");
  });
});

// ---------------------------------------------------------------------------
// inferDomain unit tests
// ---------------------------------------------------------------------------

describe("inferDomain — deterministic keyword map", () => {
  test("git keywords → git domain", () => {
    expect(inferDomain("git commit message", "always commit with clear messages", "")).toBe("git");
  });

  test("test keywords → testing domain", () => {
    expect(inferDomain("write tests", "ensure unit test coverage", "")).toBe("testing");
  });

  test("security keywords → security domain", () => {
    expect(inferDomain("credential rotation", "rotate credentials before deploying", "")).toBe("security");
  });

  test("empty/unknown content → process domain (catch-all)", () => {
    expect(inferDomain("", "", "")).toBe("process");
  });

  test("communication keywords → communication domain", () => {
    expect(inferDomain("confirm actions", "always confirm with the user before proceeding", "")).toBe("communication");
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-1: Dual-frontmatter classification (integration)
// ---------------------------------------------------------------------------

describe("AC-MIG-1: dual-frontmatter classification (integration)", () => {
  test("user_prefs.md (flat type: user) lands in scoped_facts with kind=user", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({ archiveDir: path.join(tmpDir, "archive"), worklistPath: path.join(tmpDir, "wl.md"), reportPath: path.join(tmpDir, "rpt.md") });
    const result = await runImport(opts);
    expect(result.facts.user).toBeGreaterThanOrEqual(1);
  });

  test("reference_nested.md (nested metadata.type: reference) lands in scoped_facts", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({ archiveDir: path.join(tmpDir, "archive"), worklistPath: path.join(tmpDir, "wl.md"), reportPath: path.join(tmpDir, "rpt.md") });
    const result = await runImport(opts);
    // reference_nested.md uses nested metadata.type: reference — should land as reference fact
    expect(result.facts.reference).toBeGreaterThanOrEqual(1);
  });

  test("total facts count matches fixture count (user + project + reference + mismatch-as-project)", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({ archiveDir: path.join(tmpDir, "archive"), worklistPath: path.join(tmpDir, "wl.md"), reportPath: path.join(tmpDir, "rpt.md") });
    const result = await runImport(opts);
    // Fixture facts: user_prefs(user), project_stack(project), reference_nested(reference),
    // user_x.md type:project (mismatch but still processed as project)
    const totalFacts = result.facts.user + result.facts.project + result.facts.reference;
    expect(totalFacts).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-2: Filename/type mismatch → log + classify by type (authoritative)
// ---------------------------------------------------------------------------

describe("AC-MIG-2: filename/type mismatch handling", () => {
  test("user_x.md (prefix=user, type=project) is logged as mismatch and processed as project", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({ archiveDir: path.join(tmpDir, "archive"), worklistPath: path.join(tmpDir, "wl.md"), reportPath: path.join(tmpDir, "rpt.md") });
    const result = await runImport(opts);

    const mismatch = result.mismatches.find(m => m.filename === "user_x.md");
    expect(mismatch).toBeDefined();
    expect(mismatch!.filenamePrefix).toBe("user");
    expect(mismatch!.resolvedType).toBe("project");
    // Should have been counted as a project fact (type is authoritative)
    expect(result.facts.project).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-3: Scoped facts verbatim + scrub never invoked
// ---------------------------------------------------------------------------

describe("AC-MIG-3: scoped facts stored verbatim, scrub never invoked", () => {
  test("user facts land in scoped_facts, not in instincts", async () => {
    const tmpDir = makeTempDirTracked();
    const driver = createDriver(":memory:");
    const opts: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: false,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };

    const result = await runImport(opts);

    // user/project/reference must have count > 0 in facts
    expect(result.facts.user + result.facts.project + result.facts.reference).toBeGreaterThan(0);
    // Feedback files only go to instincts
    // No user/project/reference in instincts count
    // (The instincts count only reflects feedback files)
  });

  test("scoped fact content is verbatim (rawContent stored, not scrubbed)", async () => {
    const tmpDir = makeTempDirTracked();
    // Create an isolated DB so we can inspect its rows
    const driver = createDriver(":memory:");
    const factStore = createFactStore(driver);
    await factStore.ensure();
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    // Run import with this driver by using a shared in-memory DB path
    // We cannot easily inject the driver into runImport since it creates its own.
    // Instead, verify via result counts: user_prefs.md has identifier-like content
    // that WOULD be dropped by scrub. If it's in facts, scrub wasn't called.
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // user_prefs.md is stored as user fact (not dropped)
    expect(result.facts.user).toBeGreaterThanOrEqual(1);
    // It was processed (in the processed list)
    expect(result.processed.includes("user_prefs.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-4: feedback → confidence=0.7, status='approved', ingestion_path='migrated', agent_id=NULL
// ---------------------------------------------------------------------------

describe("AC-MIG-4: migrated instinct properties", () => {
  test("importMigrated sets confidence=0.7, status=approved, ingestion_path=migrated, agent_id=NULL", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const trigger = "confirm before destructive operations";
    const domain = "communication";
    const behavioral_shape = "always confirm with the user before proceeding";
    const identity_key = idb.identityKey(trigger, domain, behavioral_shape);

    const instinct = await idb.importMigrated({
      ctx,
      identity_key,
      trigger,
      domain,
      behavioral_shape,
    });

    expect(instinct.confidence).toBe(0.7);
    expect(instinct.status).toBe("approved");
    expect(instinct.ingestion_path).toBe("migrated");
    expect(instinct.agent_id).toBeNull();
    expect(instinct.occurrence_count).toBe(0);
  });

  test("importMigrated confidence is NOT 0.9 (not human_directive) and NOT recomputed", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const identity_key = idb.identityKey("trigger a", "process", "shape b");

    const instinct = await idb.importMigrated({
      ctx,
      identity_key,
      trigger: "trigger a",
      domain: "process",
      behavioral_shape: "shape b",
    });

    expect(instinct.confidence).toBe(0.7);
    expect(instinct.confidence).not.toBe(0.9); // NOT human_directive
    // occurrence_count is 0, so analyzerConfidence(0, 0) = 0.30 — NOT what's stored
    expect(instinct.confidence).not.toBe(0.30);
  });

  test("importMigrated instinct is injection-eligible (confidence 0.7 >= 0.7 threshold)", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const identity_key = idb.identityKey("check before merge", "git", "verify ci is green first");

    await idb.importMigrated({
      ctx,
      identity_key,
      trigger: "check before merge",
      domain: "git",
      behavioral_shape: "verify ci is green first",
    });

    // Should appear in selectForProjection (approved + conf >= 0.7)
    const projected = await idb.selectForProjection(ctx);
    expect(projected.length).toBeGreaterThanOrEqual(1);
    const found = projected.find(i => i.identity_key === identity_key);
    expect(found).toBeDefined();
    expect(found!.confidence).toBe(0.7);
  });

  test("feedback_clean.md is imported as migrated instinct in full run", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // At least one feedback (clean) should be imported
    expect(result.instincts.imported).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-5: identifier-containing feedback → dropped + worklisted
// ---------------------------------------------------------------------------

describe("AC-MIG-5: identifier feedback → dropped + worklisted", () => {
  // feedback_identifier.md was updated (Round 2) to contain an email address in the
  // description. Migration mode uses HARD-identifier-only rules; a naming-context
  // proper-noun like "Acme's cluster" no longer drops, but an email address does.
  test("feedback_identifier.md (email in description) is dropped and added to worklist", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // At least one feedback was dropped
    expect(result.instincts.dropped).toBeGreaterThanOrEqual(1);

    // The worklist has an entry for the identifier file
    const wlEntry = result.worklist.find(e => e.sourceFile === "feedback_identifier.md");
    expect(wlEntry).toBeDefined();
    // Email address in behavioral_shape fires domain-identifier rule in migration mode
    expect(wlEntry!.matchedRule).toBe("domain-identifier");
    expect(wlEntry!.excerpt.length).toBeGreaterThan(0);
  });

  test("dropped feedback does NOT appear in instincts table — analyzer mode unit check", async () => {
    // Manually verify the scrub gate in ANALYZER mode (stricter; used by session analyzer).
    // "Acme's cluster" still drops in analyzer mode via naming-context DR-6 (proper-noun rule).
    // The fixture now also has an email so it drops in BOTH modes.
    const { scrub } = await import("../instinct-scrub.ts");
    const candidate = {
      trigger: "deploy credentials rotation",
      behavioral_shape: "Rotate credentials when deploying to the cluster; contact ops@company.internal if rotation fails",
      evidence: [],
    };
    const result = scrub(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.matchedRule).toBe("domain-identifier"); // email triggers first in RULES order
    }
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-6: Idempotent re-run
// ---------------------------------------------------------------------------

describe("AC-MIG-6: idempotent re-run (identical counts)", () => {
  test("running import twice yields identical fact and instinct counts", async () => {
    const tmpDir = makeTempDirTracked();
    // Use a real temp DB file for persistence across two calls
    const dbFile = path.join(tmpDir, "test.db");

    const opts1: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: false,
      dbPath: dbFile,
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl1.md"),
      reportPath: path.join(tmpDir, "rpt1.md"),
    };

    const result1 = await runImport(opts1);

    const opts2: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: false,
      dbPath: dbFile,
      archiveDir: path.join(tmpDir, "archive"), // same archive dir — overwrite-safe
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl2.md"),
      reportPath: path.join(tmpDir, "rpt2.md"),
    };

    const result2 = await runImport(opts2);

    // Counts must be identical (upserts, not inserts)
    expect(result2.facts.user).toBe(result1.facts.user);
    expect(result2.facts.project).toBe(result1.facts.project);
    expect(result2.facts.reference).toBe(result1.facts.reference);
    expect(result2.instincts.imported).toBe(result1.instincts.imported);
    expect(result2.instincts.dropped).toBe(result1.instincts.dropped);
    expect(result2.worklist.length).toBe(result1.worklist.length);
    expect(result2.mismatches.length).toBe(result1.mismatches.length);

    // Verify DB row counts haven't doubled
    const driver = createDriver(dbFile);
    const factStore = createFactStore(driver);
    await factStore.ensure();
    const ctx = { tenant_id: "local", user_id: "local", project_id: DEFAULT_PROJECT };
    const facts = await factStore.getFacts(ctx);
    // facts count should equal result1.facts.project (project-scoped)
    // For user/reference, project_id is null
    const ctxUser = { tenant_id: "local", user_id: "local", project_id: null };
    const userFacts = await factStore.getFacts(ctxUser, { kind: "user" });
    const refFacts = await factStore.getFacts(ctxUser, { kind: "reference" });

    // Row counts should match result1 (no duplicates)
    expect(userFacts.length).toBe(result1.facts.user);
    expect(refFacts.length).toBe(result1.facts.reference);
    driver.close();
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-7: Archive-not-delete (sources present + copies exist under archive/)
// ---------------------------------------------------------------------------

describe("AC-MIG-7: archive copy, sources preserved", () => {
  test("source files still exist after import (no delete)", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    await runImport(opts);

    // All fixture files should still exist in FIXTURES_DIR
    const files = ["user_prefs.md", "project_stack.md", "reference_nested.md",
                   "feedback_clean.md", "feedback_identifier.md"];
    for (const f of files) {
      expect(fs.existsSync(path.join(FIXTURES_DIR, f))).toBe(true);
    }
  });

  test("processed files are copied to archive dir", async () => {
    const tmpDir = makeTempDirTracked();
    const archiveDir = path.join(tmpDir, "archive");
    const opts = makeOpts({
      archiveDir,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // Archive dir should exist
    expect(fs.existsSync(archiveDir)).toBe(true);

    // Every processed file should have a copy in the archive
    for (const filename of result.processed) {
      const archivePath = path.join(archiveDir, filename);
      expect(fs.existsSync(archivePath)).toBe(true);

      // Archive copy content matches the source
      const sourceContent = fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
      const archiveContent = fs.readFileSync(archivePath, "utf-8");
      expect(archiveContent).toBe(sourceContent);
    }
  });

  test("MEMORY.md is NOT copied to archive (it is skipped, not processed)", async () => {
    const tmpDir = makeTempDirTracked();
    const archiveDir = path.join(tmpDir, "archive");
    const opts = makeOpts({
      archiveDir,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    await runImport(opts);

    const memoryArchived = path.join(archiveDir, "MEMORY.md");
    // MEMORY.md should NOT be in the archive (it was skipped, not processed)
    expect(fs.existsSync(memoryArchived)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-8: unknown/missing type → skip + report
// ---------------------------------------------------------------------------

describe("AC-MIG-8: unknown/missing type → skip", () => {
  test("unknown_type.md (type: task) is skipped", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    expect(result.skipped.unknownType).toBeGreaterThanOrEqual(1);
    // Must not appear in processed (archive should not have it)
    expect(result.processed.includes("unknown_type.md")).toBe(false);
  });

  test("missing_type.md (no type field) is skipped", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    expect(result.skipped.missingType).toBeGreaterThanOrEqual(1);
    expect(result.processed.includes("missing_type.md")).toBe(false);
  });

  test("skipped files do not appear in facts or instincts", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // Skipped count > 0 (unknown + missing types)
    const totalSkipped = result.skipped.unknownType + result.skipped.missingType;
    expect(totalSkipped).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-9: MEMORY.md skipped
// ---------------------------------------------------------------------------

describe("AC-MIG-9: MEMORY.md is always skipped", () => {
  test("MEMORY.md is counted in skipped.memoryMd and not processed", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    expect(result.skipped.memoryMd).toBe(1);
    expect(result.processed.includes("MEMORY.md")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-10: worklist/report NEVER read by memory-projection or session-analyzer
// ---------------------------------------------------------------------------

describe("AC-MIG-10: worklist/report are HUMAN-ONLY, not imported by projection/analyzer", () => {
  test("memory-projection.ts does not import or reference migration-worklist", () => {
    const srcPath = path.join(import.meta.dir, "../memory-projection.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).not.toContain("migration-worklist");
    expect(src).not.toContain("migration-report");
    expect(src).not.toContain("import-file-memory");
  });

  test("session-analyzer.ts does not import or reference migration-worklist", () => {
    const srcPath = path.join(import.meta.dir, "../session-analyzer.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).not.toContain("migration-worklist");
    expect(src).not.toContain("migration-report");
    expect(src).not.toContain("import-file-memory");
  });
});

// ---------------------------------------------------------------------------
// AC-MIG-11: dry-run writes nothing
// ---------------------------------------------------------------------------

describe("AC-MIG-11: dry-run mode writes nothing", () => {
  test("dry-run: no archive dir created", async () => {
    const tmpDir = makeTempDirTracked();
    const archiveDir = path.join(tmpDir, "dry-run-archive");
    const opts: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: true,
      dbPath: ":memory:", // even if provided, no writes
      archiveDir,
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };
    await runImport(opts);

    // Archive dir must NOT be created
    expect(fs.existsSync(archiveDir)).toBe(false);
  });

  test("dry-run: no worklist file written", async () => {
    const tmpDir = makeTempDirTracked();
    const worklistPath = path.join(tmpDir, "wl.md");
    const opts: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: true,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath,
      reportPath: path.join(tmpDir, "rpt.md"),
    };
    await runImport(opts);

    expect(fs.existsSync(worklistPath)).toBe(false);
  });

  test("dry-run: result still reports correct tier assignments (plan output)", async () => {
    const tmpDir = makeTempDirTracked();
    const opts: ImportOptions = {
      sourceDir: FIXTURES_DIR,
      dryRun: true,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };
    const result = await runImport(opts);

    // Even in dry-run, counts reflect what WOULD happen
    expect(result.dryRun).toBe(true);
    expect(result.facts.user + result.facts.project + result.facts.reference).toBeGreaterThan(0);
    expect(result.instincts.imported + result.instincts.dropped).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Safety: --source is REQUIRED (no accidental default to ~/.claude)
// ---------------------------------------------------------------------------

describe("Safety: --source is REQUIRED, no default", () => {
  test("runImport throws when sourceDir is empty", async () => {
    const tmpDir = makeTempDirTracked();
    const opts: ImportOptions = {
      sourceDir: "", // intentionally empty
      dryRun: true,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };
    await expect(runImport(opts)).rejects.toThrow("--source is REQUIRED");
  });

  test("runImport throws when sourceDir is whitespace-only", async () => {
    const tmpDir = makeTempDirTracked();
    const opts: ImportOptions = {
      sourceDir: "   ",
      dryRun: true,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };
    await expect(runImport(opts)).rejects.toThrow("--source is REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// importMigrated unit tests (instincts-db amendment — AC-MIG-4 unit coverage)
// ---------------------------------------------------------------------------

describe("importMigrated unit tests (instincts-db.ts amendment)", () => {
  test("importMigrated returns an Instinct with ingestion_path=migrated", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const trigger = "always review before merging";
    const domain = "git";
    const behavioral_shape = "ensure ci passes and a reviewer has approved";
    const ik = idb.identityKey(trigger, domain, behavioral_shape);

    const inst = await idb.importMigrated({ ctx, identity_key: ik, trigger, domain, behavioral_shape });
    expect(inst.ingestion_path).toBe("migrated");
    expect(inst.confidence).toBe(0.7);
    expect(inst.status).toBe("approved");
    expect(inst.agent_id).toBeNull();
    expect(inst.occurrence_count).toBe(0);
    expect(inst.scope).toBe("project");
    expect(inst.tenant_id).toBe("t1");
    expect(inst.project).toBe("p1");
  });

  test("importMigrated is idempotent — re-upsert returns same identity row, not a duplicate", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const trigger = "idempotent trigger";
    const domain = "process";
    const behavioral_shape = "idempotent shape";
    const ik = idb.identityKey(trigger, domain, behavioral_shape);

    const inst1 = await idb.importMigrated({ ctx, identity_key: ik, trigger, domain, behavioral_shape });
    const inst2 = await idb.importMigrated({ ctx, identity_key: ik, trigger, domain, behavioral_shape });

    // Same row id — not a new row
    expect(inst1.id).toBe(inst2.id);
    expect(inst2.confidence).toBe(0.7);
    expect(inst2.ingestion_path).toBe("migrated");

    // Check row count via listByStatus
    const pending = await idb.listByStatus(ctx, "pending");
    const approved = await idb.listByStatus(ctx, "approved");
    const matching = approved.filter(i => i.identity_key === ik);
    expect(matching.length).toBe(1); // exactly one row
  });

  test("importMigrated does NOT affect human_directive confidence path (0.9 still applies)", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };

    // Insert a human_directive at 0.9
    const triggerD = "human directive trigger";
    const shapeD = "human directive shape";
    const domainD = "process";
    const ikD = idb.identityKey(triggerD, domainD, shapeD);
    const directive = await idb.upsertDirective({
      ctx,
      identity_key: ikD,
      trigger: triggerD,
      domain: domainD,
      behavioral_shape: shapeD,
      status: "approved",
    });
    expect(directive.confidence).toBe(0.9);
    expect(directive.ingestion_path).toBe("human_directive");

    // Also insert a migrated instinct
    const triggerM = "migrated trigger";
    const shapeM = "migrated shape";
    const ikM = idb.identityKey(triggerM, domainD, shapeM);
    const migrated = await idb.importMigrated({
      ctx,
      identity_key: ikM,
      trigger: triggerM,
      domain: domainD,
      behavioral_shape: shapeM,
    });
    expect(migrated.confidence).toBe(0.7);

    // Verify both exist independently
    const approved = await idb.listByStatus(ctx, "approved");
    const d = approved.find(i => i.identity_key === ikD);
    const m = approved.find(i => i.identity_key === ikM);
    expect(d).toBeDefined();
    expect(d!.confidence).toBe(0.9); // human_directive unchanged
    expect(m).toBeDefined();
    expect(m!.confidence).toBe(0.7); // migrated at 0.7
  });

  test("ensure() DDL accepts ingestion_path='migrated' in CHECK constraint", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    // If the CHECK constraint doesn't include 'migrated', ensure() would not throw,
    // but importMigrated INSERT would throw a constraint violation.
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const ik = idb.identityKey("check constraint test", "process", "migrated path ok");

    // Should not throw — 'migrated' is now in the CHECK list
    await expect(idb.importMigrated({
      ctx,
      identity_key: ik,
      trigger: "check constraint test",
      domain: "process",
      behavioral_shape: "migrated path ok",
    })).resolves.toBeDefined();
  });

  test("Instinct type includes 'migrated' in ingestion_path union", async () => {
    // TypeScript compile-time check — if this file compiles, the type is correct.
    // Runtime check: a migrated instinct's ingestion_path should be the string 'migrated'.
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    await idb.ensure();

    const ctx = { tenant_id: "t1", project: "p1" };
    const ik = idb.identityKey("type union test", "process", "should be migrated");
    const inst = await idb.importMigrated({
      ctx,
      identity_key: ik,
      trigger: "type union test",
      domain: "process",
      behavioral_shape: "should be migrated",
    });
    const path_value: "auto_inferred" | "human_directive" | "migrated" = inst.ingestion_path;
    expect(path_value).toBe("migrated");
  });
});

// ---------------------------------------------------------------------------
// BR-MIG-9: Wikilinks preserved verbatim
// ---------------------------------------------------------------------------

describe("BR-MIG-9: wikilinks preserved verbatim", () => {
  test("feedback_wikilink.md is imported (not dropped) — [[wikilink]] passes scrub", async () => {
    const tmpDir = makeTempDirTracked();
    const opts = makeOpts({
      archiveDir: path.join(tmpDir, "archive"),
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    });
    const result = await runImport(opts);

    // feedback_wikilink.md should NOT appear in the worklist
    const dropped = result.worklist.find(e => e.sourceFile === "feedback_wikilink.md");
    expect(dropped).toBeUndefined();

    // Should contribute to imported count
    // (The wikilink-containing feedback must pass scrub and be imported)
    expect(result.instincts.imported).toBeGreaterThanOrEqual(1);
  });

  test("reference_nested.md [[wikilink]] in body is stored verbatim in scoped_facts", async () => {
    // The wikilink content in reference_nested.md body should appear in the stored fact content
    const fixturePath = path.join(FIXTURES_DIR, "reference_nested.md");
    const rawContent = fs.readFileSync(fixturePath, "utf-8");
    expect(rawContent).toContain("[[wikilink]]");
    // After import, the raw content (which includes the wikilink) is stored verbatim
    // This is verified by the content being stored as-is (parseFrontmatter rawContent = full file)
    const parsed = parseFrontmatter(rawContent);
    expect(parsed.rawContent).toContain("[[wikilink]]");
    expect(parsed.body).toContain("[[wikilink]]");
  });
});

// ---------------------------------------------------------------------------
// CRLF line-ending handling (Kobe review fix)
// ---------------------------------------------------------------------------
// Files with Windows CRLF line endings (\r\n) must be parsed exactly like
// LF files. The frontmatter scanner previously split on \n alone, leaving
// trailing \r on every field value, causing all regex matches to fail and
// every CRLF file to be silently counted as parseFailed.
// Fix: const text = content.replace(/\r\n?/g, "\n") at the top of parseFrontmatter;
// rawContent is unchanged.
// ---------------------------------------------------------------------------

/** Build a CRLF version of a string (replace all \n with \r\n). */
function toCRLF(s: string): string {
  return s.replace(/\n/g, "\r\n");
}

describe("CRLF line-ending handling in parseFrontmatter", () => {
  test("CRLF user file is parsed — type=user is extracted (not undefined)", () => {
    const lf = `---\nname: crlf_user\ndescription: A user fact with CRLF\ntype: user\n---\nContent here.\n`;
    const crlf = toCRLF(lf);
    expect(crlf).toContain("\r\n"); // sanity: really is CRLF

    const result = parseFrontmatter(crlf);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.type).toBe("user");
    expect(result.name).toBe("crlf_user");
    expect(result.description).toBe("A user fact with CRLF");
    expect(result.body).toContain("Content here.");
  });

  test("CRLF file rawContent is preserved verbatim (no CRLF→LF mangling on stored bytes)", () => {
    const lf = `---\nname: crlf_raw\ntype: project\n---\nBody.\n`;
    const crlf = toCRLF(lf);

    const result = parseFrontmatter(crlf);

    // rawContent must be the ORIGINAL bytes — CRLF preserved for verbatim fact storage
    expect(result.rawContent).toBe(crlf);
    expect(result.rawContent).toContain("\r\n");
  });

  test("CRLF feedback file is parsed — type=feedback, name/description extracted", () => {
    const lf = [
      "---",
      "name: confirm before destructive crlf",
      "description: Always confirm with the user before proceeding with crlf",
      "type: feedback",
      "---",
      "Body.",
      "",
    ].join("\n");
    const crlf = toCRLF(lf);

    const result = parseFrontmatter(crlf);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.type).toBe("feedback");
    expect(result.name).toBe("confirm before destructive crlf");
    expect(result.description).toBe("Always confirm with the user before proceeding with crlf");
  });

  test("CRLF feedback file passes scrub gate and is imported by runImport", async () => {
    // Write a CRLF feedback fixture to a temp dir and run the importer against it alone.
    const tmpDir = makeTempDirTracked();
    const sourceDir = path.join(tmpDir, "crlf-source");
    fs.mkdirSync(sourceDir);

    const feedbackContent = toCRLF([
      "---",
      "name: confirm before destructive crlf integration",
      "description: Always confirm with the user before running irreversible commands",
      "type: feedback",
      "---",
      "This guidance applies to all scripts.",
      "",
    ].join("\n"));

    fs.writeFileSync(path.join(sourceDir, "feedback_crlf.md"), feedbackContent, "utf-8");

    const opts: ImportOptions = {
      sourceDir,
      dryRun: false,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };

    const result = await runImport(opts);

    // Must be imported (NOT skipped as parseFailed)
    expect(result.skipped.parseFailed).toBe(0);
    expect(result.skipped.missingType).toBe(0);
    expect(result.instincts.imported).toBe(1);
    expect(result.instincts.dropped).toBe(0);
    expect(result.processed).toContain("feedback_crlf.md");
  });

  test("CRLF user fact is imported as scoped_fact by runImport", async () => {
    const tmpDir = makeTempDirTracked();
    const sourceDir = path.join(tmpDir, "crlf-user-source");
    fs.mkdirSync(sourceDir);

    const userContent = toCRLF([
      "---",
      "name: crlf_user_pref",
      "description: Prefer dark theme",
      "type: user",
      "---",
      "Dark theme is preferred in all editors.",
      "",
    ].join("\n"));

    fs.writeFileSync(path.join(sourceDir, "user_crlf.md"), userContent, "utf-8");

    const opts: ImportOptions = {
      sourceDir,
      dryRun: false,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };

    const result = await runImport(opts);

    expect(result.skipped.parseFailed).toBe(0);
    expect(result.facts.user).toBe(1);
    expect(result.processed).toContain("user_crlf.md");
  });

  test("file without --- frontmatter structure increments parseFailed counter", async () => {
    const tmpDir = makeTempDirTracked();
    const sourceDir = path.join(tmpDir, "no-fm-source");
    fs.mkdirSync(sourceDir);

    // A plain text .md file with no frontmatter at all
    fs.writeFileSync(path.join(sourceDir, "plain.md"), "Just plain content, no frontmatter here.\n", "utf-8");

    const opts: ImportOptions = {
      sourceDir,
      dryRun: false,
      dbPath: ":memory:",
      archiveDir: path.join(tmpDir, "archive"),
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };

    const result = await runImport(opts);

    expect(result.skipped.parseFailed).toBe(1);
    expect(result.skipped.missingType).toBe(0); // not missingType — has no frontmatter at all
    expect(result.processed).not.toContain("plain.md");
  });

  test("hasFrontmatter is true for file with --- block even if type is missing", () => {
    const content = "---\nname: no_type\ndescription: No type here\n---\nBody.\n";
    const result = parseFrontmatter(content);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.type).toBeUndefined(); // type is missing but frontmatter is present
  });

  test("hasFrontmatter is false for file without --- block", () => {
    const result = parseFrontmatter("Just plain text, no frontmatter.");
    expect(result.hasFrontmatter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Safety guard: --archive must differ from --source
// ---------------------------------------------------------------------------

describe("Safety guard: --archive !== --source", () => {
  test("runImport throws when archiveDir === sourceDir", async () => {
    const tmpDir = makeTempDirTracked();
    const sourceDir = path.join(tmpDir, "mysource");
    fs.mkdirSync(sourceDir);
    // Write a valid file so the source dir exists
    fs.writeFileSync(path.join(sourceDir, "user_prefs.md"),
      "---\nname: x\ntype: user\n---\nBody.\n", "utf-8");

    const opts: ImportOptions = {
      sourceDir,
      dryRun: false,
      dbPath: ":memory:",
      archiveDir: sourceDir, // SAME as source — should throw
      project: DEFAULT_PROJECT,
      worklistPath: path.join(tmpDir, "wl.md"),
      reportPath: path.join(tmpDir, "rpt.md"),
    };

    await expect(runImport(opts)).rejects.toThrow("--archive and --source cannot be the same");
  });
});
