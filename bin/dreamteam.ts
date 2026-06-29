#!/usr/bin/env bun
/**
 * dreamteam — Dream Team CLI (Phase 1 of distribution).
 *
 *   dreamteam install   [--harness claude-code|all] [--dry-run]
 *   dreamteam uninstall
 *   dreamteam status                 what's installed, versions, drift
 *   dreamteam doctor                 are Claude / Codex / Gemini / Ollama reachable?
 *   dreamteam list                   roster + commands
 *   dreamteam eval [...]             thin passthrough to evals/src/cli.ts
 *   dreamteam learn [...]            in-session learning loop step (analyze → approve → project)
 *   dreamteam instincts <sub>        review/curate captured instincts
 */

import path from "path";
import fs from "fs";
import os from "os";
import {
  assetsDir,
  readConfig,
  contentSha,
  dataDir,
  workspaceDir,
  memoryProjectionDir,
  canonicalProjectId,
  harnessMemoryDir,
  DEFAULT_TENANT,
  DEFAULT_USER,
} from "../scripts/paths.ts";
import { provision, unprovision, knownHarnesses } from "../adapters/provision.ts";
import { checkProviders, checkMemoryHealth } from "../scripts/doctor.ts";
import { runCutover } from "../scripts/cutover.ts";
import { createInstinctsDb, type InstinctsDb, type InstinctCtx, type Instinct } from "../web/src/instincts-db.ts";
import { createFactStore, type FactStore } from "../web/src/fact-store.ts";
import {
  createSessionAnalyzer,
  makeClaudeLlmClient,
  makeSessionEvalsReader,
  type LlmClient,
  type AnalyzerCtx,
  type AnalyzerResult,
} from "../web/src/session-analyzer.ts";
import {
  createDirectiveCapture,
  type DirectiveSuggestion,
  type DirectiveDecision,
  type CaptureOutcome,
} from "../web/src/directive-capture.ts";
import {
  createMemoryProjection,
  TruncationError,
  SelfCheckError,
  type ProjectionCtx,
  type RegenerateResult,
} from "../web/src/memory-projection.ts";
import { createDriver, getDriver } from "../web/src/db-driver.ts";

// ---------------------------------------------------------------------------
// Shared arg-parsing helpers (unchanged)
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// `learn` — exported injectable core (Humble Object pattern)
// ---------------------------------------------------------------------------

export interface LearnSummary {
  /** Number of LLM-generated candidates in this run. */
  candidatesGenerated: number;
  /** Candidates dropped by the scrub gate. */
  candidatesScrubbed: number;
  /** Instinct ids newly materialized (occurrence_count reached threshold). */
  materializedCount: number;
  /** Pending instincts approved in this run (step 3 + directive step 4). */
  approvedCount: number;
  /** Instincts that remain pending after this run. */
  pendingCount: number;
  /** Directive submissions rejected (not-authored or scrub). */
  rejectedCount: number;
  /** Approved instincts written into MEMORY.md (from projection). */
  instinctsInIndex: number;
  /** Facts written into MEMORY.md (from projection). */
  factsInIndex: number;
  /** Total lines in MEMORY.md. */
  linesWritten: number;
  /** Directory MEMORY.md was written to. */
  outDir: string;
  dryRun: boolean;
}

export interface LearnOpts {
  /** Combined analyzer + instincts context (tenant_id, project). */
  ctx: AnalyzerCtx & InstinctCtx;
  /** Projection context (tenant_id, project, user_id, project_id). */
  projCtx: ProjectionCtx;
  /** Resolved output directory for MEMORY.md. Must NOT be under ~/.claude unless installerPhase. */
  outDir: string;
  /** Dry-run: skip write steps (setStatus, captureDirective); regenerate goes to outDir as given. */
  dryRun: boolean;
  /** Auto-approve all pending auto-inferred instincts without prompting (CI/scripted mode). */
  autoYes: boolean;
  /**
   * Bypasses the ~/.claude guardrail — reserved for the installer slice.
   * Never set this in tests unless you are explicitly testing installer-phase behavior.
   */
  installerPhase?: boolean;
}

export interface LearnDeps {
  store: InstinctsDb;
  facts: FactStore;
  analyzer: { runInstinctAnalyzer(ctx: AnalyzerCtx): Promise<AnalyzerResult> };
  capture: {
    surface(transcript: string, llm: LlmClient, ctx: InstinctCtx): Promise<DirectiveSuggestion[]>;
    captureDirective(s: DirectiveSuggestion, d: DirectiveDecision, ctx: InstinctCtx): Promise<CaptureOutcome>;
  };
  projection: { regenerate(ctx: ProjectionCtx, outDir: string): Promise<RegenerateResult> };
  /** LlmClient passed to capture.surface() in interactive mode. */
  llm: LlmClient;
  prompt: {
    yesNo(q: string): Promise<boolean>;
    freeText(q: string): Promise<string>;
  };
  /** True when stdin is a TTY and --no-input is NOT set. */
  interactive: boolean;
}

/**
 * Resolve a path to its real (symlink-dereferenced) form by realpathSync-ing
 * the longest EXISTING ancestor, then re-appending any non-existing suffix.
 * This closes the symlink-hole: a `--out` that traverses a symlink INTO ~/.claude
 * will have its real target resolved before the prefix check.
 */
function resolveToReal(p: string): string {
  const resolved = path.resolve(p);
  let current = resolved;
  const suffix: string[] = [];
  while (true) {
    try {
      // fs.existsSync follows symlinks — existsSync(symlink) is true if the target exists.
      if (fs.existsSync(current)) {
        const realCurrent = fs.realpathSync(current);
        return suffix.length > 0
          ? path.join(realCurrent, ...suffix.slice().reverse())
          : realCurrent;
      }
    } catch {
      // realpathSync can throw on permission errors — fall through to parent.
    }
    const parent = path.dirname(current);
    if (parent === current) return resolved; // filesystem root
    suffix.push(path.basename(current));
    current = parent;
  }
}

/**
 * Returns true if the real (symlink-resolved) path falls inside the real ~/.claude directory.
 * Both sides are resolved so a symlinked outDir that points into ~/.claude is still caught.
 */
function isUnderClaudeDir(outDir: string): boolean {
  const home = process.env.HOME ?? os.homedir();
  const claudeDir = resolveToReal(path.join(home, ".claude"));
  const resolvedOut = resolveToReal(outDir);
  return resolvedOut === claudeDir || resolvedOut.startsWith(claudeDir + path.sep);
}

/**
 * Pure injectable orchestration function — the Humble Object pattern.
 * All CLI-specific concerns (argv, TTY, readline, real DB) are resolved in `cmdLearn`
 * and passed in through `opts` + `deps`. Tests inject fakes for prompt/projection/analyzer.
 *
 * Sequence (§2 of slice6-design.md):
 *   1. ensure stores (idempotent DDL)
 *   2. run analyzer (auto-inferred candidates)
 *   3. present pending for human approval (interactive only, unless headless/dryRun)
 *   4. directive capture from transcript (interactive only, v1: empty transcript)
 *   5. regenerate projection — ALWAYS, never gated (Fix-3/AC-6)
 *   6. return LearnSummary
 */
export async function runLearn(opts: LearnOpts, deps: LearnDeps): Promise<LearnSummary> {
  const { ctx, projCtx, outDir, dryRun, autoYes, installerPhase } = opts;
  const { store, facts, analyzer, capture, projection, llm, prompt, interactive } = deps;

  // Guardrail: refuse outDir under ~/.claude unless explicit installer flag.
  if (!installerPhase && isUnderClaudeDir(outDir)) {
    throw new Error(
      `learn: refusing to write to '${outDir}' — that path is inside ~/.claude. ` +
        `Switching the projection target to ~/.claude is the installer slice. ` +
        `Pass --installer-phase (or set installerPhase:true in LearnOpts) to override.`,
    );
  }

  // Step 1: ensure stores (idempotent DDL).
  await store.ensure();
  await facts.ensure();

  // Steps 2–4 are wrapped in try/catch so Step 5 (regenerate) ALWAYS runs,
  // even if the analyzer, approval loop, or directive capture throws unexpectedly (AC-6).
  let analyzerResult = {
    llmCalled: false,
    candidatesGenerated: 0,
    candidatesScrubbed: 0,
    signalsRecorded: 0,
    materialized: [] as number[],
  };
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let stepError: Error | null = null;

  try {
    // Step 2: run analyzer (auto-inferred candidates). Module owns empty short-circuit + timeout.
    analyzerResult = await analyzer.runInstinctAnalyzer(ctx);

    if (!dryRun) {
      // Step 3: present AUTO-INFERRED pending instincts for approval.
      // CRITICAL: NEVER approve human_directive rows here — their trust anchor is the
      // free-text authorship act (Step 4 / BR-13a). Approving them via --yes or a one-tap
      // select would forge consent and bypass the authorship gate.
      const allPending = await store.listByStatus(ctx, "pending");
      const autoInferredPending = allPending.filter((r) => r.ingestion_path === "auto_inferred");

      if (autoYes) {
        // --yes: approve auto-inferred pending rows without prompting.
        for (const inst of autoInferredPending) {
          await store.setStatus(inst.id, "approved");
          approvedCount++;
        }
        // Human-directive rows stay pending — they require the authorship act (Step 4).
        const humanDirectivePending = allPending.filter((r) => r.ingestion_path === "human_directive");
        pendingCount += humanDirectivePending.length;
      } else if (interactive) {
        // Interactive: yes/no select for auto-inferred only (never human-authored).
        for (const inst of autoInferredPending) {
          const yes = await prompt.yesNo(
            `Approve instinct #${inst.id} [${inst.domain}]: "${inst.trigger}" (conf ${inst.confidence})? [y/N] `,
          );
          if (yes) {
            await store.setStatus(inst.id, "approved");
            approvedCount++;
          } else {
            pendingCount++;
          }
        }
        // Human-directive rows stay pending — they require the authorship act (Step 4).
        const humanDirectivePending = allPending.filter((r) => r.ingestion_path === "human_directive");
        pendingCount += humanDirectivePending.length;
      } else {
        // Headless: leave all pending — never auto-approve anything (would forge consent).
        pendingCount += allPending.length;
      }

      // Step 4: directive capture from transcript (interactive only).
      // v1: no in-process transcript source available (Slice 7 / R3). We call surface("")
      // and handle whatever suggestions come back (likely empty with no real transcript).
      if (interactive) {
        let suggestions: DirectiveSuggestion[] = [];
        try {
          suggestions = await capture.surface("", llm, ctx);
        } catch {
          // surface() is best-effort; failure does NOT block projection (R3).
          console.log("[learn] directive surface skipped (no transcript available)");
        }

        for (const sugg of suggestions) {
          // Get the RAW typed line — no trim here. The module's authorship guard
          // (isHumanAuthored) is the single normalizer/gate (BR-13a).
          const rawTyped = await prompt.freeText(
            `Edit/restate the directive (empty to skip):\n  Suggestion: "${sugg.suggestionText}"\n> `,
          );
          // Confirmed = non-whitespace content was provided; computed on a trimmed copy
          // so that whitespace-only submissions are treated as "skip" without altering
          // the raw text passed to captureDirective.
          const confirmed = rawTyped.trim().length > 0;
          const outcome = await capture.captureDirective(sugg, { typedText: rawTyped, confirmed }, ctx);
          if (outcome.result === "approved") {
            approvedCount++;
          } else if (outcome.result === "pending") {
            pendingCount++;
          } else {
            // "rejected-not-authored" or "rejected-scrub"
            rejectedCount++;
          }
          console.log(`[learn] directive: ${outcome.result}`);
        }
      }
      // Headless: directive capture is SKIPPED — free-text authorship is structurally
      // impossible without a human typing. Directives are an interactive-only path.
    }
  } catch (err) {
    stepError = err instanceof Error ? err : new Error(String(err));
    console.error(`[learn] steps 2–4 error (regenerate will still run): ${stepError.message}`);
  }

  // Step 5: ALWAYS regenerate projection, even when steps 2–4 threw or were skipped.
  // Fix-3/AC-6: the read-side projection must never be gated by the write-side.
  const regenResult = await projection.regenerate(projCtx, outDir);

  // Re-throw any step 2–4 error AFTER regenerate completes, so callers see it.
  if (stepError) throw stepError;

  // Step 6: return summary.
  return {
    candidatesGenerated: analyzerResult.candidatesGenerated,
    candidatesScrubbed: analyzerResult.candidatesScrubbed,
    materializedCount: analyzerResult.materialized.length,
    approvedCount,
    pendingCount,
    rejectedCount,
    instinctsInIndex: regenResult.instinctsInIndex,
    factsInIndex: regenResult.factsInIndex,
    linesWritten: regenResult.linesWritten,
    outDir,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// `learn` — thin argv-parsing shell
// ---------------------------------------------------------------------------

async function cmdLearn(rest: string[]): Promise<number> {
  const project = flag(rest, "--project") ?? canonicalProjectId();
  const dryRun = has(rest, "--dry-run");
  const autoYes = has(rest, "--yes");
  const noInput = has(rest, "--no-input");
  const windowArg = flag(rest, "--window");
  const modelArg = flag(rest, "--model"); // advisory in v1 — not yet wired
  if (modelArg) {
    console.log(`[learn] note: --model is advisory in v1 and not yet wired to the LLM client`);
  }
  const windowLimit = windowArg ? parseInt(windowArg, 10) : undefined;

  // Resolve outDir (§3 of slice6-design.md).
  const flagOut = flag(rest, "--out");
  let outDir: string;
  let dryRunTmpDir: string | null = null;
  if (flagOut) {
    outDir = flagOut;
  } else if (dryRun) {
    dryRunTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dreamteam-learn-"));
    outDir = dryRunTmpDir;
  } else {
    outDir = memoryProjectionDir(project);
  }

  // Guardrail: refuse ~/.claude unless --installer-phase is explicitly set.
  const installerPhase = has(rest, "--installer-phase");

  // TTY detection: headless if stdin is not a TTY or --no-input is set.
  const interactive = process.stdin.isTTY === true && !noInput;

  // Build shared driver (dry-run: :memory: so nothing touches real DB).
  const driver = dryRun ? createDriver(":memory:") : getDriver();
  const store = createInstinctsDb(driver);
  const facts = createFactStore(driver);

  const ctx: AnalyzerCtx & InstinctCtx = {
    tenant_id: DEFAULT_TENANT,
    project,
    ...(windowLimit != null ? { windowLimit } : {}),
  };

  const projCtx: ProjectionCtx = {
    tenant_id: DEFAULT_TENANT,
    project,
    user_id: DEFAULT_USER,
    project_id: project, // MUST equal `project` (consistency guard in regenerate())
  };

  // Dry-run: stub the LlmClient so we never spawn a real `claude -p` subprocess.
  // This keeps dry-run cheap and fully offline (preview counts only).
  const llm: LlmClient = dryRun
    ? { async generateCandidates() { return { candidates: [], timedOut: false }; } }
    : makeClaudeLlmClient();
  const analyzer = createSessionAnalyzer({ store, llm, findings: makeSessionEvalsReader() });
  const capture = createDirectiveCapture({ store });
  const projection = createMemoryProjection({ instincts: store, facts });

  // readline-backed prompt (real CLI).
  // Uses ESM dynamic import (not require) for portability across Bun/Node ESM contexts.
  const promptImpl = (() => {
    // Lazy-init readline so we don't open stdin unless we actually need it.
    let rl: import("node:readline/promises").Interface | null = null;
    async function getRl(): Promise<import("node:readline/promises").Interface> {
      if (!rl) {
        const readline = await import("node:readline/promises");
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      }
      return rl;
    }
    return {
      async yesNo(q: string): Promise<boolean> {
        const iface = await getRl();
        const ans = (await iface.question(q)).trim().toLowerCase();
        return ans === "y" || ans === "yes";
      },
      async freeText(q: string): Promise<string> {
        const iface = await getRl();
        // Return the RAW typed line — no trim. runLearn computes `confirmed` separately
        // from rawTyped.trim() so whitespace-only is treated as skip without altering the
        // text that reaches captureDirective (BR-13a raw-passthrough invariant).
        return await iface.question(q);
      },
      close() {
        if (rl) { rl.close(); rl = null; }
      },
    };
  })();

  const opts: LearnOpts = { ctx, projCtx, outDir, dryRun, autoYes, installerPhase };
  const deps: LearnDeps = { store, facts, analyzer, capture, projection, llm, prompt: promptImpl, interactive };

  let summary: LearnSummary;
  try {
    summary = await runLearn(opts, deps);
  } catch (err) {
    if (err instanceof TruncationError || err instanceof SelfCheckError) {
      console.error(`[learn] hard failure: ${(err as Error).message}`);
      return 1;
    }
    if (err instanceof Error && err.message.startsWith("learn: refusing to write")) {
      console.error(err.message);
      return 1;
    }
    throw err;
  } finally {
    (promptImpl as { close(): void }).close();
    // Cleanup dry-run temp dir.
    if (dryRunTmpDir) {
      try { fs.rmSync(dryRunTmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  const pre = dryRun ? "[dry-run] " : "";
  console.log(`\n${pre}learn summary:`);
  console.log(`${pre}  analyzer     : ${summary.candidatesGenerated} generated, ${summary.candidatesScrubbed} scrubbed, ${summary.materializedCount} materialized`);
  console.log(`${pre}  directives   : ${summary.approvedCount} approved, ${summary.pendingCount} pending, ${summary.rejectedCount} rejected`);
  console.log(`${pre}  projection   : ${summary.instinctsInIndex} instincts, ${summary.factsInIndex} facts, ${summary.linesWritten} lines → ${summary.outDir}`);
  return 0;
}

// ---------------------------------------------------------------------------
// `instincts` — review/curation surface
// ---------------------------------------------------------------------------

async function cmdInstincts(rest: string[]): Promise<number> {
  const sub = rest[0];

  if (!sub || sub === "help" || sub === "--help") {
    console.log(`Usage: dreamteam instincts <list|review|approve|reject> [args]
  list [--status pending|approved|rejected]   print one instinct per line
  review                                      multi-line pending view for human curation
  approve <id>                                flip status to approved
  reject  <id>                                flip status to rejected`);
    return 0;
  }

  const project = flag(rest, "--project") ?? canonicalProjectId();
  const driver = getDriver();
  const store = createInstinctsDb(driver);
  const ctx: InstinctCtx = { tenant_id: DEFAULT_TENANT, project };

  // Ensure schema exists before any subcommand queries it (idempotent DDL).
  await store.ensure();

  switch (sub) {
    case "list": {
      const rawStatus = flag(rest, "--status") ?? "pending";
      if (rawStatus !== "pending" && rawStatus !== "approved" && rawStatus !== "rejected") {
        console.error(`instincts list: invalid --status '${rawStatus}' (must be pending|approved|rejected)`);
        return 1;
      }
      const status = rawStatus as Instinct["status"];
      const rows = await store.listByStatus(ctx, status);
      if (rows.length === 0) {
        console.log(`No instincts with status '${status}'.`);
      } else {
        for (const r of rows) {
          console.log(`${r.id} · ${r.status} · ${r.confidence} · ${r.domain} · ${r.trigger}`);
        }
      }
      return 0;
    }

    case "review": {
      const rows = await store.listByStatus(ctx, "pending");
      if (rows.length === 0) {
        console.log("No pending instincts to review.");
        return 0;
      }
      for (const r of rows) {
        console.log(`\n--- Instinct #${r.id} ---`);
        console.log(`  domain     : ${r.domain}`);
        console.log(`  status     : ${r.status}`);
        console.log(`  confidence : ${r.confidence}`);
        console.log(`  occurrences: ${r.occurrence_count}`);
        console.log(`  trigger    : ${r.trigger}`);
        console.log(`  behavior   : ${r.behavioral_shape}`);
        if (r.suggested_content) {
          console.log(`  content    : ${r.suggested_content}`);
        }
      }
      return 0;
    }

    case "approve":
    case "reject": {
      const idArg = rest[1];
      const id = idArg ? Number(idArg) : NaN;
      if (!idArg || isNaN(id) || !Number.isInteger(id) || id <= 0) {
        console.error(`instincts ${sub}: missing or invalid id — usage: dreamteam instincts ${sub} <id>`);
        return 1;
      }
      // TODO(turso): pass TenantCtx to getById for cross-tenant safety (R2/BR-S4)
      const inst = await store.getById(id);
      if (!inst) {
        console.error(`instincts ${sub}: instinct #${id} not found`);
        return 1;
      }
      const newStatus: "approved" | "rejected" = sub === "approve" ? "approved" : "rejected";
      // TODO(turso): pass TenantCtx to setStatus for cross-tenant safety (R2/BR-S4)
      await store.setStatus(id, newStatus);
      console.log(`Instinct #${id} [${inst.domain}]: "${inst.trigger}" → ${newStatus}.`);
      console.log(`Run 'dreamteam learn' to refresh MEMORY.md.`);
      return 0;
    }

    default:
      console.error(`instincts: unknown subcommand '${sub}'\n`);
      console.error(`  Usage: dreamteam instincts <list|review|approve|reject> [args]`);
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Existing commands (unchanged)
// ---------------------------------------------------------------------------

async function cmdInstall(args: string[]): Promise<number> {
  const harnesses = flag(args, "--harness") ?? "claude-code";
  const dryRun = has(args, "--dry-run");
  const res = await provision({ harnesses, dryRun });
  console.log(`\n${dryRun ? "Dry run complete" : "Installation complete"} — harnesses: ${res.harnesses.join(", ")}, ${res.installed.length} files.`);
  if (!dryRun) console.log("Start a new Claude Code session to use the agents.");
  return 0;
}

async function cmdUninstall(): Promise<number> {
  const res = await unprovision();
  console.log(`\nUninstalled ${res.removed} files across: ${res.harnesses.join(", ")}.`);
  return 0;
}

const PKG = "@bondarewicz/dreamteam";

/**
 * Upgrade the GLOBAL package, then re-sync assets — the step `install` can't do.
 *
 * `install` copies from assetsDir (= this binary's own package dir), so it can
 * never pull a newer version than the binary you ran it from. `upgrade` updates
 * the global package first, then invokes the FRESH binary's `install` so ~/.claude
 * picks up the new agents/commands/hooks.
 *
 *   dreamteam upgrade            # → @latest
 *   dreamteam upgrade beta       # a dist-tag
 *   dreamteam upgrade 1.1.0      # an exact version
 *   dreamteam upgrade --dry-run  # show what would run
 */
async function cmdUpgrade(args: string[]): Promise<number> {
  const tag = flag(args, "--tag") ?? args.find((a) => !a.startsWith("-")) ?? "latest";
  const spec = `${PKG}@${tag}`;
  const before = readConfig()?.version ?? "unknown";

  if (has(args, "--dry-run")) {
    console.log(`Dry run — would run:\n  bun add -g ${spec}\n  dreamteam install`);
    return 0;
  }

  console.log(`Upgrading ${PKG}: ${before} → ${spec}\n`);
  // Bun-only project; the binary lives under ~/.bun. Update the global package.
  const add = Bun.spawnSync(["bun", "add", "-g", spec], { stdout: "inherit", stderr: "inherit" });
  if ((add.exitCode ?? 1) !== 0) {
    console.error(`\n'bun add -g ${spec}' failed. Run it manually, then 'dreamteam install'.`);
    return add.exitCode ?? 1;
  }

  // Re-sync via the FRESH binary (not this old process): the shim now points at
  // the new package, so its install resolves assetsDir to the new version.
  console.log(`\nRe-syncing agents/commands/scripts into ~/.claude …`);
  const inst = Bun.spawnSync(["dreamteam", "install"], { stdout: "inherit", stderr: "inherit" });
  if ((inst.exitCode ?? 1) !== 0) {
    console.error(`\nPackage updated, but 'dreamteam install' failed — run it manually.`);
    return inst.exitCode ?? 1;
  }

  const after = readConfig()?.version ?? "unknown";
  console.log(`\n✓ Upgraded ${before} → ${after}. Start a new Claude Code session to pick up the changes.`);
  return 0;
}

function cmdStatus(): number {
  const cfg = readConfig();
  if (!cfg) {
    console.log("Not installed (no ~/.dreamteam/config.json). Run: dreamteam install");
    return 1;
  }
  console.log(`Dream Team ${cfg.version}`);
  console.log(`  assetsDir : ${cfg.assetsDir}`);
  console.log(`  dataDir   : ${cfg.dataDir}`);
  console.log(`  harnesses : ${cfg.harnesses.join(", ")}`);
  console.log(`  installed : ${cfg.installed.length} files (${cfg.installedAt})`);

  // Drift: installed file edited since install (current content sha != manifest sha).
  let drift = 0, missing = 0;
  for (const f of cfg.installed) {
    try {
      const cur = contentSha(fs.readFileSync(f.path, "utf-8"));
      if (cur !== f.sha) { drift++; console.log(`  ~ drift: ${f.path}`); }
    } catch {
      missing++; console.log(`  ! missing: ${f.path}`);
    }
  }
  console.log(drift || missing ? `  ${drift} drifted, ${missing} missing.` : "  all installed files match manifest.");
  return 0;
}

async function cmdRepair(): Promise<number> {
  const cfg = readConfig();
  if (!cfg) {
    console.log("Not installed (no ~/.dreamteam/config.json). Run: dreamteam install");
    return 1;
  }
  // Detect drift/missing against the manifest (same check as status).
  let drift = 0, missing = 0;
  for (const f of cfg.installed) {
    try {
      if (contentSha(fs.readFileSync(f.path, "utf-8")) !== f.sha) { drift++; console.log(`  ~ drift: ${f.path}`); }
    } catch { missing++; console.log(`  ! missing: ${f.path}`); }
  }
  if (!drift && !missing) {
    console.log("Nothing to repair — all installed files match the manifest.");
    return 0;
  }
  console.log(`\nRepairing ${drift} drifted + ${missing} missing file(s) — re-syncing from source…`);
  const res = await provision({ harnesses: cfg.harnesses.join(","), dryRun: false });
  console.log(`\nRepair complete — re-synced ${res.installed.length} files across: ${res.harnesses.join(", ")}.`);
  console.log("Start a new Claude Code session to pick up the repaired agents.");
  return 0;
}

async function cmdDoctor(rest: string[] = []): Promise<number> {
  console.log("Dream Team doctor — provider reachability\n");
  const checks = await checkProviders();
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.label.padEnd(28)} ${c.detail}`);
  }
  const cfg = readConfig();
  console.log(`\n  install manifest: ${cfg ? `present (${cfg.installed.length} files)` : "missing — run dreamteam install"}`);
  const requiredOk = checks.filter((c) => c.required).every((c) => c.ok);
  console.log(requiredOk
    ? "\nClaude Code present — interactive /team and the judge will work."
    : "\nClaude Code missing — install it (interactive /team and the eval judge run on Claude).");
  console.log("Optional providers (Ollama/Gemini/Codex) only need to pass if you eval on them.");

  // Memory health check (Slice 9 / Option A).
  const project = flag(rest, "--project") ?? canonicalProjectId();
  const home = flag(rest, "--home") ?? (process.env.HOME ?? os.homedir());
  console.log(`\nDream Team doctor — memory health (project: ${project})\n`);
  console.log(`  resolved memory dir: ${harnessMemoryDir(home, project)}`);
  const mh = checkMemoryHealth(home, project);
  console.log(`  ${mh.ok ? "✓" : "✗"} ${mh.label.padEnd(28)} ${mh.ok ? "OK" : "FAIL"}`);
  console.log(`    ${mh.detail}`);
  for (const w of mh.warnings) {
    console.log(`    WARN: ${w}`);
  }
  for (const i of mh.info) {
    console.log(`    ${i}`);
  }

  return 0; // non-fatal for doctor: report problems, don't block
}

function cmdList(): number {
  const assets = assetsDir();
  for (const [dir, label] of [["agents", "Agents"], ["commands", "Commands"]] as const) {
    const p = path.join(assets, dir);
    if (!fs.existsSync(p)) continue;
    const names = fs.readdirSync(p).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
    console.log(`${label} (${names.length}):`);
    for (const n of names) console.log(`  ${dir === "commands" ? "/" : ""}${n}`);
    console.log("");
  }
  return 0;
}

async function cmdCutover(rest: string[]): Promise<number> {
  const project = flag(rest, "--project") ?? canonicalProjectId();
  const homeArg = flag(rest, "--home") ?? (process.env.HOME ?? os.homedir());
  const execute = has(rest, "--execute");
  const source = flag(rest, "--source");
  const dbArg = flag(rest, "--db");
  const backupBaseDir = flag(rest, "--backup-dir");

  if (!execute) {
    console.log("[cutover] Running in PLAN/VERIFY mode (no --execute).");
    console.log("  Steps 1-4 will run (backup, migrate, project, verify).");
    console.log("  Step 5 (activate: settings flip + lock + team.md copy) will NOT run.");
    console.log("  Re-run with --execute after reviewing the output to go live.\n");
  }

  const result = await runCutover({
    project,
    home: homeArg,
    execute,
    source,
    dbPath: dbArg,
    backupBaseDir,
  });

  if (!result.success) {
    console.error("\n[cutover] FAILED. See rollback log above.");
    return 1;
  }

  if (result.verifyResult) {
    const v = result.verifyResult;
    console.log(`\n[cutover] VERIFY result:`);
    console.log(`  memoryMdNonEmpty:          ${v.memoryMdNonEmpty}`);
    console.log(`  bothSectionHeadersPresent: ${v.bothSectionHeadersPresent}`);
    console.log(`  deterministic:             ${v.deterministic}`);
    console.log(`  dirConsistent:             ${v.dirConsistent}`);
    if (v.errors.length > 0) {
      for (const e of v.errors) console.log(`  ERROR: ${e}`);
    }
  }

  return 0;
}

async function cmdEval(args: string[]): Promise<number> {
  const cli = path.join(assetsDir(), "evals", "src", "cli.ts");
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return (await proc.exited) ?? 0;
}

async function cmdWeb(args: string[]): Promise<number> {
  const port = flag(args, "--port") ?? process.env.PORT ?? "3000";
  const entry = path.join(assetsDir(), "web", "index.ts");
  if (!fs.existsSync(entry)) {
    console.error(`Web app not found at ${entry}. (Is web/ part of this install?)`);
    return 1;
  }
  console.log(`Starting Dream Team web → http://localhost:${port}  (reads ${dataDir()}/workspace)`);
  const proc = Bun.spawn(["bun", entry], {
    env: { ...process.env, PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return (await proc.exited) ?? 0;
}

function usage(): void {
  console.log(`dreamteam — Dream Team CLI

  install [--harness ${knownHarnesses().join("|")}|all] [--dry-run]
  upgrade [tag|version] [--dry-run]   update the global package, then re-sync
  uninstall
  status            installed files, versions, drift vs manifest
  repair            re-sync drifted/missing installed files from source
  doctor [--project <slug>] [--home <dir>]    provider reachability + memory health
  list              roster + commands
  eval [...]        passthrough to evals/src/cli.ts
  web [--port N]    serve the web app (eval report, /admin/models, sessions)
  learn [--project <slug>] [--out <dir>] [--dry-run] [--yes] [--no-input] [--window <n>] [--model <m>]
  instincts <list|approve|reject|review> [--status pending|approved|rejected]
  cutover [--project <slug>] [--home <dir>] [--execute] [--source <dir>] [--db <path>]
          Without --execute: backup + migrate + project + verify only (plan/review mode).
          With    --execute: full go-live (activate settings + lock memory dir + copy team.md).
          --home <dir>: override HOME (required in tests; defaults to real HOME).
`);
}

// ---------------------------------------------------------------------------
// CLI entry point — guarded so the module is safe to import in tests.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  let code = 0;
  switch (cmd) {
    case "install": code = await cmdInstall(rest); break;
    case "upgrade": code = await cmdUpgrade(rest); break;
    case "uninstall": code = await cmdUninstall(); break;
    case "status": code = cmdStatus(); break;
    case "repair": code = await cmdRepair(); break;
    case "doctor": code = await cmdDoctor(rest); break;
    case "list": code = cmdList(); break;
    case "eval": code = await cmdEval(rest); break;
    case "web": code = await cmdWeb(rest); break;
    case "learn": code = await cmdLearn(rest); break;
    case "instincts": code = await cmdInstincts(rest); break;
    case "cutover": code = await cmdCutover(rest); break;
    case undefined:
    case "help":
    case "--help":
    case "-h": usage(); break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
      code = 1;
  }
  process.exit(code);
}
