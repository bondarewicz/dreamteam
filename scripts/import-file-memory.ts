#!/usr/bin/env bun
/**
 * import-file-memory.ts — One-time, idempotent migration from file-memory (*.md) to DB.
 *
 * Slice 8 of the Session Learning Loop cutover.
 *
 * CRITICAL SAFETY: --source is REQUIRED with NO default. This script can NEVER
 * accidentally operate on ~/.claude. The caller (scripts/cutover.ts in Slice 9)
 * passes --source explicitly. Tests always inject a fixture dir.
 *
 * Usage:
 *   bun scripts/import-file-memory.ts \
 *     --source <dir>         REQUIRED — source memory dir; NO DEFAULT
 *     --dry-run              Report only; write NOTHING to DB, archive, or worklist
 *     --db <path>            SQLite DB path (default: dbPath() from paths.ts)
 *     --archive <dir>        Archive destination (default: <source>/archive)
 *     --project <name>       Project name for scoped facts (default: basename of cwd)
 *
 * Tier mapping (BR-MIG-1..11):
 *   user / project / reference → scoped_facts via upsertFact (VERBATIM, NEVER scrubbed)
 *   feedback                   → scrub() gate → importMigrated (PASS) | worklist (FAIL)
 *   missing / unknown type     → skip + log (NEVER guess a tier)
 *
 * Idempotency:
 *   Facts:    upsertFact is supersede-on-upsert by (tenant,user,project,kind,content_key).
 *   Instincts: importMigrated is supersede-on-upsert by (tenant,identity_key,scope,project).
 *   Archive:  file copy is overwrite-safe.
 *   Re-runs:  produce identical row counts.
 *
 * Archive: COPY (never move/delete) processed files into <archive>/. Sources are preserved.
 *
 * Worklist + report are HUMAN-ONLY (BR-MIG-11): never read by memory-projection or
 * session-analyzer. Written to plain files only.
 */

import path from "path";
import fs from "fs";
import os from "os";
import { createDriver } from "../web/src/db-driver.ts";
import { createInstinctsDb, DOMAINS, isDomain } from "../web/src/instincts-db.ts";
import type { InstinctCtx } from "../web/src/instincts-db.ts";
import { createFactStore } from "../web/src/fact-store.ts";
import type { TenantCtx } from "../web/src/fact-store.ts";
import { scrub } from "../web/src/instinct-scrub.ts";
import type { InstinctCandidate, ScrubOpts } from "../web/src/instinct-scrub.ts";
import { dbPath as defaultDbPath, DEFAULT_TENANT, DEFAULT_USER, reportsDir, canonicalProjectId } from "./paths.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** REQUIRED — source dir containing *.md files. NO DEFAULT. */
  sourceDir: string;
  /** When true: no DB writes, no archive, no worklist file written. */
  dryRun: boolean;
  /** SQLite DB path. Defaults to dbPath() from paths.ts. */
  dbPath: string;
  /** Archive destination. Defaults to <sourceDir>/archive. */
  archiveDir: string;
  /** Project name for project-scoped facts / instinct ctx. */
  project: string;
  /** Worklist output file path. Defaults to <workspace>/reports/migration-worklist.md. */
  worklistPath: string;
  /** Report output file path. Defaults to <workspace>/reports/migration-report.md. */
  reportPath: string;
}

export interface WorklistEntry {
  sourceFile: string;
  matchedRule: string;
  reason: string;
  excerpt: string; // masked/partial excerpt of the offending content
}

export interface MismatchEntry {
  filename: string;
  filenamePrefix: string;
  resolvedType: string;
}

export interface ImportResult {
  facts: { user: number; project: number; reference: number };
  instincts: { imported: number; dropped: number };
  skipped: {
    memoryMd: number;
    unknownType: number;
    missingType: number;
    /** Files with no recognizable --- frontmatter structure (structural parse failure). */
    parseFailed: number;
  };
  mismatches: MismatchEntry[];
  worklist: WorklistEntry[];
  processed: string[]; // all files attempted (for archive)
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Frontmatter parser — dual shape support (BR-MIG-1)
// Handles BOTH flat top-level `type: value` AND nested `metadata:\n  type: value`.
// Type is AUTHORITATIVE over the filename prefix.
// ---------------------------------------------------------------------------

export interface ParsedFile {
  name?: string;
  description?: string;
  type?: string; // raw value from frontmatter; may be unknown
  body: string;  // everything after the closing ---
  rawContent: string; // full file content (for verbatim fact storage) — ORIGINAL bytes, no CRLF mangling
  /** True if the file had a recognizable --- frontmatter block (even if all fields are absent). */
  hasFrontmatter: boolean;
}

/**
 * Parse a memory file's frontmatter. Handles:
 *   - Flat: `type: user` at top level
 *   - Nested: `metadata:\n  type: reference` (indented under metadata:)
 * If both forms are present, flat top-level `type:` wins (only one form expected per file).
 * Strips surrounding quotes from values (single or double).
 */
export function parseFrontmatter(content: string): ParsedFile {
  const rawContent = content;

  // Normalize line endings to LF for parsing ONLY — rawContent preserves original bytes
  // so verbatim fact storage is unaffected. CRLF files previously had \r left on line-ends
  // which caused every field regex to silently fail (matched nothing), producing parseFailed.
  const text = content.replace(/\r\n?/g, "\n");

  // Must start with ---
  if (!text.startsWith("---")) {
    return { body: text.trim(), rawContent, hasFrontmatter: false };
  }

  const endFm = text.indexOf("\n---", 3);
  if (endFm === -1) {
    return { body: text.trim(), rawContent, hasFrontmatter: false };
  }

  const fmText = text.slice(3, endFm); // between opening --- and closing ---
  const bodyText = text.slice(endFm + 4).trimStart(); // after closing ---\n

  const lines = fmText.split("\n");

  let name: string | undefined;
  let description: string | undefined;
  let type: string | undefined;
  let metadataType: string | undefined;
  let inMetadata = false;
  let inDescription = false;
  let descLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Top-level key detection (not indented)
    if (!/^\s/.test(line) || line.trim() === "") {
      // If we were collecting multi-line description, finalize it
      if (inDescription) {
        description = descLines.join("\n").trim();
        inDescription = false;
        descLines = [];
      }
      inMetadata = false;
    }

    // top-level `type: <value>`
    const typeMatch = line.match(/^type:\s*(.*)$/);
    if (typeMatch && !/^\s/.test(line)) {
      type = stripQuotes(typeMatch[1].trim());
      inMetadata = false;
      continue;
    }

    // top-level `name: <value>`
    const nameMatch = line.match(/^name:\s*(.*)$/);
    if (nameMatch && !/^\s/.test(line)) {
      name = stripQuotes(nameMatch[1].trim());
      inMetadata = false;
      inDescription = false;
      continue;
    }

    // top-level `description:` (may be multi-line)
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (descMatch && !/^\s/.test(line)) {
      const inline = stripQuotes(descMatch[1].trim());
      if (inline) {
        description = inline;
        inDescription = false;
      } else {
        // Multi-line: collect following indented lines
        inDescription = true;
        descLines = [];
      }
      inMetadata = false;
      continue;
    }

    // top-level `metadata:` section start
    if (/^metadata:\s*$/.test(line) && !/^\s/.test(line)) {
      inMetadata = true;
      inDescription = false;
      continue;
    }

    // Indented lines inside `metadata:` block
    if (inMetadata && /^\s+/.test(line)) {
      const nestedType = line.match(/^\s+type:\s*(.*)$/);
      if (nestedType) {
        metadataType = stripQuotes(nestedType[1].trim());
      }
      continue;
    }

    // Indented continuation of description (multi-line description block)
    if (inDescription && /^\s+/.test(line)) {
      descLines.push(line.trim());
      continue;
    }
  }

  // Finalize multi-line description if still open
  if (inDescription && descLines.length > 0) {
    description = descLines.join(" ").trim();
  }

  // Resolve type: flat top-level wins; fall back to nested metadata.type
  const resolvedType = type ?? metadataType;

  return { name, description, type: resolvedType, body: bodyText, rawContent, hasFrontmatter: true };
}

/** Strip surrounding single or double quotes from a YAML value. */
function stripQuotes(val: string): string {
  if ((val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Domain keyword map — deterministic (NO LLM), 'process' catch-all (BR-MIG-3)
// Maps file content to the bounded DOMAINS vocab.
// ---------------------------------------------------------------------------

type Domain = (typeof DOMAINS)[number];

const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  code_quality:  ["quality", "style", "lint", "format", "readability", "clean", "refactor", "maintainability"],
  code_review:   ["review", "pull request", "pr ", "diff", "approve", "reviewer"],
  testing:       ["test", "spec", "coverage", "unit", "integration", "assertion", "assert", "mock", "fixture"],
  debugging:     ["debug", "fix", "bug", "error", "trace", "diagnose", "investigate", "breakpoint"],
  architecture:  ["architecture", "design", "pattern", "abstraction", "module", "interface", "structure", "layer"],
  communication: ["communicate", "ask", "clarify", "confirm", "message", "notify", "escalate", "handoff"],
  git:           ["git", "commit", "push", "branch", "merge", "rebase", "stash", "tag", "checkout"],
  tooling:       ["tool", "script", "cli", "command", "install", "setup", "build", "pipeline"],
  performance:   ["performance", "speed", "latency", "optimize", "cache", "slow", "fast", "throughput"],
  security:      ["security", "auth", "credential", "secret", "token", "permission", "access", "rotate", "encrypt"],
  process:       ["process", "workflow", "procedure", "step", "checklist", "convention", "policy"],
  documentation: ["documentation", "document", "doc", "readme", "comment", "explain", "describe"],
};

/**
 * Infer domain from file content using keyword frequency. 'process' is the catch-all.
 * Deterministic: no LLM, no randomness — same input always yields the same domain.
 */
export function inferDomain(name: string, description: string, body: string): Domain {
  const text = `${name} ${description} ${body}`.toLowerCase();
  let bestDomain: Domain = "process"; // catch-all per BR-MIG-3
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      // Count occurrences of keyword in the full text
      let idx = 0;
      while ((idx = text.indexOf(kw, idx)) !== -1) {
        score++;
        idx += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain as Domain;
    }
  }

  return bestDomain;
}

// ---------------------------------------------------------------------------
// Filename-prefix type inference (for mismatch detection only — BR-MIG-1)
// ---------------------------------------------------------------------------

const FILENAME_PREFIX_MAP: Record<string, string> = {
  user_:      "user",
  project_:   "project",
  reference_: "reference",
  feedback_:  "feedback",
};

function inferTypeFromFilename(filename: string): string | undefined {
  for (const [prefix, type] of Object.entries(FILENAME_PREFIX_MAP)) {
    if (filename.startsWith(prefix)) return type;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Excerpt masking — for worklist entries (partial, not full content)
// BR-MIG-4: masked excerpt of the offending token is acceptable.
// Including full original text is also acceptable (user's local file).
// We mask by truncating to 120 chars and replacing middle of long tokens.
// ---------------------------------------------------------------------------

function maskExcerpt(text: string, maxLen = 120): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…";
}

// ---------------------------------------------------------------------------
// Core import function (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Run the file-memory import.
 *
 * Safety: sourceDir MUST be provided and non-empty. Hard error otherwise.
 * In dry-run mode: no DB writes, no archive copies, no worklist/report files written.
 */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  // CRITICAL: --source REQUIRED with NO default (never ~/.claude by accident).
  if (!opts.sourceDir || opts.sourceDir.trim() === "") {
    throw new Error(
      "import-file-memory: --source is REQUIRED. No default is provided to prevent " +
      "accidental operation against ~/.claude. Pass an explicit source directory."
    );
  }

  const sourceDir = path.resolve(opts.sourceDir);
  const archiveDir = path.resolve(opts.archiveDir || path.join(sourceDir, "archive"));

  // Guard: archive dir must not be the same as source dir (would self-overwrite on re-run)
  if (archiveDir === sourceDir) {
    throw new Error(
      `import-file-memory: --archive and --source cannot be the same directory (${sourceDir}). ` +
      `Archive copies would overwrite source files. Use a distinct archive path.`
    );
  }

  // In dry-run, use :memory: DB — never opens a real file (zero writes).
  const dbPathToUse = opts.dryRun ? ":memory:" : opts.dbPath;

  const driver = createDriver(dbPathToUse);

  // try/finally ensures driver.close() is called even on unexpected throws.
  try {
  const idb = createInstinctsDb(driver);
  const factStore = createFactStore(driver);

  // Always ensure schema (in dry-run the in-memory DB is still used for validation).
  await factStore.ensure();
  await idb.ensure();

  const instinctCtx: InstinctCtx = {
    tenant_id: DEFAULT_TENANT,
    project: opts.project,
  };

  const result: ImportResult = {
    facts: { user: 0, project: 0, reference: 0 },
    instincts: { imported: 0, dropped: 0 },
    skipped: { memoryMd: 0, unknownType: 0, missingType: 0, parseFailed: 0 },
    mismatches: [],
    worklist: [],
    processed: [],
    dryRun: opts.dryRun,
  };

  // List *.md files in sourceDir
  let allFiles: string[];
  try {
    allFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith(".md"));
  } catch (e) {
    throw new Error(`import-file-memory: cannot read source dir "${sourceDir}": ${e}`);
  }

  for (const filename of allFiles) {
    const filePath = path.join(sourceDir, filename);

    // Skip files under the archive sub-directory
    if (filePath.startsWith(archiveDir + path.sep) || filePath === archiveDir) {
      continue;
    }

    // BR-MIG-8: skip MEMORY.md
    if (filename === "MEMORY.md") {
      result.skipped.memoryMd++;
      continue;
    }

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      console.warn(`[import] cannot read ${filename}: ${e}`);
      continue;
    }

    const parsed = parseFrontmatter(rawContent);

    // BR-MIG-7: no recognizable frontmatter structure → parseFailed (never guess a tier)
    if (!parsed.hasFrontmatter) {
      result.skipped.parseFailed++;
      console.warn(`[import] SKIP (no frontmatter): ${filename}`);
      continue;
    }

    // BR-MIG-7: has frontmatter but type field absent → missingType
    if (!parsed.type) {
      result.skipped.missingType++;
      console.warn(`[import] SKIP (missing type): ${filename}`);
      continue;
    }

    // BR-MIG-7: unknown type → skip + log
    const VALID_TYPES = ["user", "project", "reference", "feedback"] as const;
    type MemoryType = typeof VALID_TYPES[number];
    if (!(VALID_TYPES as readonly string[]).includes(parsed.type)) {
      result.skipped.unknownType++;
      console.warn(`[import] SKIP (unknown type "${parsed.type}"): ${filename}`);
      continue;
    }

    const resolvedType = parsed.type as MemoryType;

    // BR-MIG-1: detect filename/type mismatch; type is authoritative, log it
    const filenamePrefix = inferTypeFromFilename(filename);
    if (filenamePrefix && filenamePrefix !== resolvedType) {
      console.warn(
        `[import] MISMATCH: ${filename} has prefix suggesting "${filenamePrefix}" ` +
        `but type is "${resolvedType}" — using type (authoritative)`
      );
      result.mismatches.push({
        filename,
        filenamePrefix,
        resolvedType,
      });
    }

    result.processed.push(filename);

    // Route by type
    if (resolvedType === "user" || resolvedType === "project" || resolvedType === "reference") {
      // BR-MIG-2: scoped_facts — VERBATIM, NEVER scrubbed
      const kind = resolvedType; // 'user' | 'project' | 'reference'
      const contentKey = path.basename(filename, ".md"); // filename stem

      if (!opts.dryRun) {
        const factCtx: TenantCtx = {
          tenant_id: DEFAULT_TENANT,
          user_id: DEFAULT_USER,
          project_id: kind === "project" ? opts.project : null,
        };
        await factStore.upsertFact(factCtx, {
          kind,
          content_key: contentKey,
          content: rawContent, // verbatim — includes frontmatter + body
          source: filename,
        });
      }
      result.facts[kind]++;
    } else if (resolvedType === "feedback") {
      // BR-MIG-3a: run scrub() first before importing as instinct
      const name = parsed.name ?? "";
      const description = parsed.description ?? "";
      const body = parsed.body ?? "";

      // Skip if both name and description are empty (BR-MIG-3)
      if (!name.trim() && !description.trim()) {
        console.warn(`[import] SKIP (feedback with empty name and description): ${filename}`);
        result.worklist.push({
          sourceFile: filename,
          matchedRule: "empty-trigger-and-shape",
          reason: "Both name and description are empty; cannot derive trigger and behavioral_shape",
          excerpt: maskExcerpt(body, 80),
        });
        result.instincts.dropped++;
        continue;
      }

      // BR-MIG-3: derive fields
      const trigger = name.trim() || description.trim(); // fallback: name → description
      const behavioral_shape = description.trim() || name.trim(); // fallback: description → name
      // Candidate scope: ONLY trigger (name) + behavioral_shape (description).
      // The body (evidence) is excluded from the scrub candidate — it contains
      // frontmatter metadata (originSessionId, node_type, type) and body prose that
      // belongs to the user's own notes, not to the shareable instinct shape.
      // Scanning the body causes false positives (e.g. session UUIDs → secret-token).
      // The body is retained in `suggested_content` for provenance; BR-S3 (promotion
      // boundary full-strict re-scrub) is the backstop for any identifying body content.
      const migScrubOpts: ScrubOpts = { mode: 'migration' };
      const candidate: InstinctCandidate = { trigger, behavioral_shape, evidence: [] };
      const scrubResult = scrub(candidate, migScrubOpts);

      if (scrubResult.ok) {
        // Pass → importMigrated
        // BR-MIG-3: deterministic domain keyword map, NO LLM
        const domain = inferDomain(name, description, body);
        const identity_key = idb.identityKey(trigger, domain, behavioral_shape);

        if (!opts.dryRun) {
          await idb.importMigrated({
            ctx: instinctCtx,
            identity_key,
            trigger,
            domain,
            behavioral_shape,
            suggested_content: rawContent, // original file content as provenance
          });
        }
        result.instincts.imported++;
      } else {
        // Fail → worklist (BR-MIG-4), never imported
        const failResult = scrubResult as { ok: false; reason: string; matchedRule: string };
        console.warn(
          `[import] DROP (feedback → worklist): ${filename} — ` +
          `rule=${failResult.matchedRule}: ${failResult.reason}`
        );

        // Excerpt: use the first field that failed (trigger or behavioral_shape)
        // For safety the excerpt is the failing candidate field, masked
        const offendingText = [trigger, behavioral_shape]
          .find(t => {
            const r = scrub({ trigger: t, behavioral_shape: t, evidence: [] }, migScrubOpts);
            return !r.ok;
          }) ?? trigger;

        result.worklist.push({
          sourceFile: filename,
          matchedRule: failResult.matchedRule,
          reason: failResult.reason,
          excerpt: maskExcerpt(offendingText, 120),
        });
        result.instincts.dropped++;
      }
    }
  }

  // Archive: copy every processed source file (not MEMORY.md, not skipped)
  // BR-MIG-6: copy never move/delete; sources are preserved.
  if (!opts.dryRun && result.processed.length > 0) {
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const filename of result.processed) {
      const src = path.join(sourceDir, filename);
      const dst = path.join(archiveDir, filename);
      fs.copyFileSync(src, dst);
    }
  }

  // Write worklist file (BR-MIG-4) — HUMAN-ONLY, never read by projection/analyzer
  if (!opts.dryRun && result.worklist.length > 0) {
    const worklistPath = opts.worklistPath;
    fs.mkdirSync(path.dirname(worklistPath), { recursive: true });
    const lines = [
      "# Migration Worklist — Feedback Files Requiring Re-authoring",
      "",
      "> Generated by import-file-memory.ts. HUMAN-ONLY — do not import this file",
      "> into any automated system. May contain identifiers from source files.",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      ...result.worklist.map((e, i) =>
        [
          `## ${i + 1}. ${e.sourceFile}`,
          `- **Rule**: ${e.matchedRule}`,
          `- **Reason**: ${e.reason}`,
          `- **Excerpt**: \`${e.excerpt}\``,
          "",
        ].join("\n")
      ),
    ];
    fs.writeFileSync(worklistPath, lines.join("\n"), "utf-8");
  }

  // Write migration report — HUMAN-ONLY
  if (!opts.dryRun) {
    const reportPath = opts.reportPath;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const report = buildReport(result, opts);
    fs.writeFileSync(reportPath, report, "utf-8");
  }

  // Stdout summary (always printed)
  printSummary(result, opts);

  return result;

  } finally {
    // Release WAL lock for file-based DBs. For :memory: this is a no-op but harmless.
    driver.close();
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildReport(result: ImportResult, opts: ImportOptions): string {
  const lines = [
    "# Migration Report — import-file-memory",
    "",
    "> HUMAN-ONLY. Do not import this file into any automated system.",
    "> May contain identifiers from source files.",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${opts.sourceDir}`,
    `Project: ${opts.project}`,
    `Dry-run: ${result.dryRun}`,
    "",
    "## Tier Landings",
    "",
    `- scoped_facts/user:      ${result.facts.user}`,
    `- scoped_facts/project:   ${result.facts.project}`,
    `- scoped_facts/reference: ${result.facts.reference}`,
    `- instincts/imported:     ${result.instincts.imported}`,
    `- instincts/dropped:      ${result.instincts.dropped}`,
    "",
    "## Skipped",
    "",
    `- MEMORY.md:    ${result.skipped.memoryMd}`,
    `- missing type: ${result.skipped.missingType}`,
    `- unknown type: ${result.skipped.unknownType}`,
    "",
  ];

  if (result.mismatches.length > 0) {
    lines.push("## Filename/Type Mismatches (type was authoritative)", "");
    for (const m of result.mismatches) {
      lines.push(`- \`${m.filename}\`: prefix="${m.filenamePrefix}" → type="${m.resolvedType}"`);
    }
    lines.push("");
  }

  if (result.worklist.length > 0) {
    lines.push(`## Dropped Feedback (see worklist for details)`, "");
    for (const e of result.worklist) {
      lines.push(`- \`${e.sourceFile}\`: ${e.matchedRule} — ${e.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function printSummary(result: ImportResult, opts: ImportOptions): void {
  const prefix = result.dryRun ? "[DRY-RUN] " : "";
  console.log(`\n${prefix}=== import-file-memory summary ===`);
  console.log(`${prefix}source:    ${opts.sourceDir}`);
  console.log(`${prefix}project:   ${opts.project}`);
  console.log(`${prefix}facts:     user=${result.facts.user} project=${result.facts.project} reference=${result.facts.reference}`);
  console.log(`${prefix}instincts: imported=${result.instincts.imported} dropped=${result.instincts.dropped}`);
  console.log(`${prefix}skipped:   memoryMd=${result.skipped.memoryMd} missingType=${result.skipped.missingType} unknownType=${result.skipped.unknownType}`);
  console.log(`${prefix}mismatches: ${result.mismatches.length}`);
  console.log(`${prefix}worklist:   ${result.worklist.length} entries`);
  if (result.dryRun) {
    console.log(`${prefix}[NO WRITES PERFORMED — dry-run mode]`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  }

  function hasFlag(flag: string): boolean {
    return argv.includes(flag);
  }

  const sourceDir = getArg("--source");
  if (!sourceDir) {
    console.error(
      "ERROR: --source <dir> is REQUIRED. No default is provided to prevent\n" +
      "accidental operation against ~/.claude.\n\n" +
      "Usage:\n" +
      "  bun scripts/import-file-memory.ts --source <dir> [--dry-run] [--db <path>] " +
      "[--archive <dir>] [--project <name>]"
    );
    process.exit(1);
  }

  const dryRun = hasFlag("--dry-run");
  const dbPath = getArg("--db") ?? defaultDbPath();
  const archiveDir = getArg("--archive") ?? path.join(sourceDir, "archive");
  const project = getArg("--project") ?? canonicalProjectId();
  const worklistPath = getArg("--worklist") ?? path.join(reportsDir(), "migration-worklist.md");
  const reportPath = getArg("--report") ?? path.join(reportsDir(), "migration-report.md");

  const opts: ImportOptions = {
    sourceDir,
    dryRun,
    dbPath,
    archiveDir,
    project,
    worklistPath,
    reportPath,
  };

  runImport(opts)
    .then((result) => {
      process.exit(result.instincts.dropped > 0 || result.skipped.unknownType > 0 ? 0 : 0);
    })
    .catch((e) => {
      console.error("ERROR:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
