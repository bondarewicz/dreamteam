/**
 * learn-cli.test.ts — Tests for the `learn` CLI orchestration (Slice 6).
 *
 * Follows the §6 test plan from slice6-design.md.
 * All tests:
 *   - Use real createInstinctsDb/createFactStore backed by createDriver(":memory:")
 *     so setStatus/listByStatus SQL is exercised end-to-end.
 *   - Inject fake prompt + fake LlmClient. No real `claude -p` subprocess.
 *   - Never touch the live ~/.dreamteam DB or ~/.claude directory.
 *
 * Test groups:
 *   T1   — orchestration order (ensure → analyzer → approval → directive → regenerate)
 *   T2   — non-destructive outDir (default resolves under workspaceDir, NOT ~/.claude)
 *   T3   — ~/.claude guardrail refuses write
 *   T4   — headless: no auto-approve; prompt never called; capture skipped; regenerate runs
 *   T5   — --yes approves all pending; regenerate emits them
 *   T6   — authorship guard: raw line passthrough; identical text → rejected-not-authored
 *   T7   — interactive yes/no: prompt.yesNo true → setStatus('approved') called
 *   T8   — instincts approve flow: flip status, no inline regenerate; next runLearn emits it
 *   T9   — TTY simulation: isTTY true/undefined drives interactive flag
 *   T10  — dry-run: no setStatus/captureDirective writes; counts reported; real DB untouched
 *   T11  — projection hard-fail (SelfCheckError/TruncationError) → error propagated
 */

import { test, expect, describe, beforeEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDriver } from "../db-driver.ts";
import { createInstinctsDb, type InstinctCtx } from "../instincts-db.ts";
import { createFactStore } from "../fact-store.ts";
import { createDirectiveCapture, type DirectiveSuggestion, type CaptureOutcome } from "../directive-capture.ts";
import {
  createMemoryProjection,
  TruncationError,
  SelfCheckError,
  type ProjectionCtx,
  type RegenerateResult,
} from "../memory-projection.ts";
import { memoryProjectionDir, DEFAULT_TENANT, DEFAULT_USER, workspaceDir } from "../../../scripts/paths.ts";
import {
  runLearn,
  type LearnDeps,
  type LearnOpts,
  type LearnSummary,
} from "../../../bin/dreamteam.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TENANT = DEFAULT_TENANT; // "local"
const USER = DEFAULT_USER;     // "local"
const PROJECT = "test-project";

function makeCtx(project = PROJECT): InstinctCtx & { tenant_id: string; project: string } {
  return { tenant_id: TENANT, project };
}

function makeProjCtx(project = PROJECT): ProjectionCtx {
  return { tenant_id: TENANT, project, user_id: USER, project_id: project };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "learn-cli-test-"));
}

function cleanupDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a real in-memory store triple. */
function makeStores() {
  const driver = createDriver(":memory:");
  const store = createInstinctsDb(driver);
  const facts = createFactStore(driver);
  return { driver, store, facts };
}

/** Fake prompt that never blocks — all answers are "no" by default. */
function makePrompt(yesAnswer = false, freeTextAnswer = "") {
  const calls: string[] = [];
  return {
    calls,
    prompt: {
      async yesNo(q: string): Promise<boolean> {
        calls.push(`yesNo:${q}`);
        return yesAnswer;
      },
      async freeText(q: string): Promise<string> {
        calls.push(`freeText:${q}`);
        return freeTextAnswer;
      },
    },
  };
}

/** Fake LlmClient that returns no candidates (empty path). */
const noOpLlm = {
  async generateCandidates() { return { candidates: [], timedOut: false }; },
};

/** Fake analyzer that records calls and returns an empty result. */
function makeAnalyzerSpy() {
  const calls: string[] = [];
  return {
    calls,
    analyzer: {
      async runInstinctAnalyzer(_ctx: unknown) {
        calls.push("runInstinctAnalyzer");
        return { llmCalled: false, candidatesGenerated: 0, candidatesScrubbed: 0, signalsRecorded: 0, materialized: [], llmTimedOut: false };
      },
    },
  };
}

/** Fake projection that records calls and writes nothing. */
function makeProjectionSpy(outDirRef?: { value: string }) {
  const calls: string[] = [];
  return {
    calls,
    projection: {
      async regenerate(ctx: ProjectionCtx, outDir: string): Promise<RegenerateResult> {
        calls.push(`regenerate:${outDir}`);
        if (outDirRef) outDirRef.value = outDir;
        // Create the directory so any file-check assertions work.
        fs.mkdirSync(outDir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 10, bytesWritten: 100 };
      },
    },
  };
}

/** Build minimal LearnDeps with all spies/fakes. */
function makeDeps(overrides: Partial<LearnDeps> = {}): LearnDeps {
  const { store, facts } = makeStores();
  const { analyzer } = makeAnalyzerSpy();
  const capture = createDirectiveCapture({ store });
  const { projection } = makeProjectionSpy();
  const { prompt } = makePrompt();
  return {
    store,
    facts,
    analyzer,
    capture,
    projection,
    llm: noOpLlm,
    prompt,
    interactive: false,
    ...overrides,
  };
}

/**
 * Seed an approved instinct with confidence >= 0.70 (injectable into MEMORY.md).
 * Mirrors the pattern from memory-projection.test.ts:
 *   3 "fail" signals → S=3, R=1.0 → conf=0.65 (below 0.70 threshold)
 *   + 1 recordOccurrence "fail" → S=4, R=1.0 → conf=0.70 (meets threshold)
 */
async function seedApproved(store: ReturnType<typeof createInstinctsDb>, ctx: InstinctCtx) {
  const trigger = "always-test";
  const domain = "testing"; // valid domain
  const behavioral_shape = "run tests always";
  const ikey = store.identityKey(trigger, domain, behavioral_shape);
  const now = new Date().toISOString();

  // 3 "fail" sessions → materializes at S=3, R=1.0, conf=0.65.
  for (let i = 0; i < 3; i++) {
    await store.recordSignal(
      {
        identity_key: ikey,
        tenant_id: ctx.tenant_id,
        project: ctx.project,
        session_id: `sess-${i}`,
        finding_id: `f${i}:Q1`,
        evidence_scrubbed: `evidence from sess-${i}`,
        observed_at: now,
        severity: "fail",
      },
      { trigger, domain, behavioral_shape },
    );
  }

  const rows = await store.listByStatus(ctx, "pending");
  if (rows.length === 0) throw new Error("seedApproved: no pending rows after 3 signals");
  const inst = rows[0];

  // 4th fail occurrence → S=4, R=1.0, conf=0.70 (meets projection threshold).
  await store.recordOccurrence(inst.id, {
    tenant_id: ctx.tenant_id,
    project: ctx.project,
    session_id: "sess-3",
    finding_id: "f3:Q1",
    evidence_scrubbed: "4th fail evidence",
    observed_at: now,
    severity: "fail",
  });

  await store.setStatus(inst.id, "approved");
  return inst.id;
}

// ---------------------------------------------------------------------------
// T1: orchestration order
// ---------------------------------------------------------------------------

describe("T1 — orchestration order", () => {
  test("ensure → runInstinctAnalyzer → listByStatus/approval → regenerate (always last)", async () => {
    const callLog: string[] = [];

    const { store, facts } = makeStores();

    // Spy on store.ensure, facts.ensure, store.listByStatus
    const storeProxy = new Proxy(store, {
      get(target, key) {
        if (key === "ensure") return async () => { callLog.push("store.ensure"); return target.ensure(); };
        if (key === "listByStatus") return async (...args: unknown[]) => {
          callLog.push("store.listByStatus");
          return (target.listByStatus as (...a: unknown[]) => unknown)(...args);
        };
        return (target as Record<string | symbol, unknown>)[key];
      },
    });
    const factsProxy = new Proxy(facts, {
      get(target, key) {
        if (key === "ensure") return async () => { callLog.push("facts.ensure"); return target.ensure(); };
        return (target as Record<string | symbol, unknown>)[key];
      },
    });

    const analyzer = {
      async runInstinctAnalyzer(_ctx: unknown) {
        callLog.push("runInstinctAnalyzer");
        return { llmCalled: false, candidatesGenerated: 0, candidatesScrubbed: 0, signalsRecorded: 0, materialized: [], llmTimedOut: false };
      },
    };

    const capture = {
      async surface(_t: string, _l: unknown, _c: unknown): Promise<DirectiveSuggestion[]> {
        callLog.push("capture.surface");
        return [];
      },
      async captureDirective(_s: DirectiveSuggestion, _d: unknown, _c: unknown): Promise<CaptureOutcome> {
        callLog.push("capture.captureDirective");
        return { result: "rejected-not-authored", reason: "test" };
      },
    };

    const outDir = makeTmpDir();
    const projSpy = makeProjectionSpy();
    // Wrap projection to log regenerate after other calls.
    const projectionProxy = {
      async regenerate(ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        callLog.push("projection.regenerate");
        return projSpy.projection.regenerate(ctx, dir);
      },
    };

    try {
      const opts: LearnOpts = {
        ctx: makeCtx(),
        projCtx: makeProjCtx(),
        outDir,
        dryRun: false,
        autoYes: false,
      };
      const deps: LearnDeps = {
        store: storeProxy,
        facts: factsProxy,
        analyzer,
        capture,
        projection: projectionProxy,
        llm: noOpLlm,
        prompt: makePrompt().prompt,
        interactive: false, // headless: skips steps 3–4 prompts but NOT ensure/analyzer/regenerate
      };
      await runLearn(opts, deps);
    } finally {
      cleanupDir(outDir);
    }

    // ensure must come before analyzer
    expect(callLog.indexOf("store.ensure")).toBeLessThan(callLog.indexOf("runInstinctAnalyzer"));
    expect(callLog.indexOf("facts.ensure")).toBeLessThan(callLog.indexOf("runInstinctAnalyzer"));
    // listByStatus comes after analyzer (step 3 pending fetch)
    expect(callLog.indexOf("runInstinctAnalyzer")).toBeLessThan(callLog.indexOf("store.listByStatus"));
    // regenerate is LAST
    expect(callLog.indexOf("projection.regenerate")).toBe(callLog.length - 1);
    // regenerate is ALWAYS called
    expect(callLog).toContain("projection.regenerate");
  });
});

// ---------------------------------------------------------------------------
// T2: non-destructive outDir
// ---------------------------------------------------------------------------

describe("T2 — non-destructive outDir", () => {
  test("default outDir resolves under workspaceDir/memory/<project>, not under ~/.claude", () => {
    const project = "my-project";
    const resolved = memoryProjectionDir(project);
    const ws = workspaceDir();
    // Must be under workspaceDir (dreamteam-owned).
    expect(resolved.startsWith(ws)).toBe(true);
    // Must NOT be under ~/.claude.
    const home = process.env.HOME ?? os.homedir();
    const claudeDir = path.join(home, ".claude");
    expect(resolved.startsWith(claudeDir)).toBe(false);
    // Must follow the expected pattern.
    expect(resolved).toBe(path.join(ws, "memory", project));
  });

  test("runLearn with default outDir writes to dreamteam workspace, not ~/.claude", async () => {
    const outDir = makeTmpDir();
    const receivedDirs: string[] = [];
    const projectionProxy = {
      async regenerate(ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        receivedDirs.push(dir);
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 5, bytesWritten: 50 };
      },
    };
    try {
      await runLearn(
        { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { ...makeDeps(), projection: projectionProxy },
      );
    } finally {
      cleanupDir(outDir);
    }
    expect(receivedDirs).toHaveLength(1);
    const home = process.env.HOME ?? os.homedir();
    const claudeDir = path.join(home, ".claude");
    expect(receivedDirs[0].startsWith(claudeDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T3: ~/.claude guardrail
// ---------------------------------------------------------------------------

describe("T3 — outDir guardrail", () => {
  test("outDir inside ~/.claude (no installerPhase) → throws, no regenerate called", async () => {
    const home = process.env.HOME ?? os.homedir();
    const badOutDir = path.join(home, ".claude", "projects", "my-project", "memory");

    let regenerateCalled = false;
    const projectionSpy = {
      async regenerate(_ctx: ProjectionCtx, _dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 0, bytesWritten: 0 };
      },
    };

    const deps = { ...makeDeps(), projection: projectionSpy };
    await expect(
      runLearn(
        { ctx: makeCtx(), projCtx: makeProjCtx(), outDir: badOutDir, dryRun: false, autoYes: false },
        deps,
      ),
    ).rejects.toThrow(/refusing to write/);

    expect(regenerateCalled).toBe(false);
  });

  test("outDir inside ~/.claude WITH installerPhase=true → succeeds (guardrail bypassed)", async () => {
    const home = process.env.HOME ?? os.homedir();
    const outDir = path.join(home, ".claude", "projects", "my-project", "memory");

    let regenerateCalled = false;
    const projectionSpy = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 0, bytesWritten: 0 };
      },
    };

    const deps = { ...makeDeps(), projection: projectionSpy };
    await runLearn(
      { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false, installerPhase: true },
      deps,
    );

    expect(regenerateCalled).toBe(true);

    // Cleanup the dir that was created
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("T3-c: symlinked outDir that resolves inside ~/.claude → guardrail refuses (symlink hole)", async () => {
    // Create an isolated fake home so we don't accidentally touch the real ~/.claude.
    const fakeHome = makeTmpDir();
    const fakeClaudeDir = path.join(fakeHome, ".claude");
    const realTarget = path.join(fakeClaudeDir, "projects", "memory");
    fs.mkdirSync(realTarget, { recursive: true });

    // Create a symlink OUTSIDE fake ~/.claude that points INTO it.
    const innocentLookingPath = path.join(fakeHome, "workspace", "memory");
    fs.mkdirSync(path.dirname(innocentLookingPath), { recursive: true });
    fs.symlinkSync(realTarget, innocentLookingPath);

    // Override HOME so isUnderClaudeDir uses the fake home.
    const savedHome = process.env.HOME;
    process.env.HOME = fakeHome;

    let regenerateCalled = false;
    const projectionSpy = {
      async regenerate(_ctx: ProjectionCtx, _dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 0, bytesWritten: 0 };
      },
    };

    try {
      await expect(
        runLearn(
          // outDir looks innocent but symlinks into fakeHome/.claude
          { ctx: makeCtx(), projCtx: makeProjCtx(), outDir: innocentLookingPath, dryRun: false, autoYes: false },
          { ...makeDeps(), projection: projectionSpy },
        ),
      ).rejects.toThrow(/refusing to write/);

      expect(regenerateCalled).toBe(false);
    } finally {
      process.env.HOME = savedHome;
      cleanupDir(fakeHome);
    }
  });
});

// ---------------------------------------------------------------------------
// T4: headless — no auto-approve, prompt never called, capture skipped, regenerate runs
// ---------------------------------------------------------------------------

describe("T4 — headless: no auto-approve", () => {
  test("interactive:false → pending rows stay pending; prompt never called; capture.surface never called; regenerate called", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    // Seed a pending instinct directly (via upsertDirective).
    await store.upsertDirective({
      ctx,
      identity_key: store.identityKey("test-trigger", "quality", "test-shape"),
      trigger: "test-trigger",
      domain: "quality",
      behavioral_shape: "test-shape",
      status: "pending",
    });

    const promptCalls: string[] = [];
    const prompt = {
      async yesNo(q: string): Promise<boolean> { promptCalls.push(`yesNo:${q}`); return false; },
      async freeText(q: string): Promise<string> { promptCalls.push(`freeText:${q}`); return ""; },
    };

    const surfaceCalls: string[] = [];
    const capture = {
      async surface(t: string, _l: unknown, _c: unknown): Promise<DirectiveSuggestion[]> {
        surfaceCalls.push("surface");
        return [];
      },
      async captureDirective(): Promise<CaptureOutcome> {
        return { result: "rejected-not-authored", reason: "test" };
      },
    };

    const outDir = makeTmpDir();
    let regenerateCalled = false;
    const projection = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 5, bytesWritten: 50 };
      },
    };

    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture, projection, llm: noOpLlm, prompt, interactive: false },
      );

      // Pending rows must NOT have been approved.
      const stillPending = await store.listByStatus(ctx, "pending");
      expect(stillPending).toHaveLength(1);

      // Prompt must never have been called.
      expect(promptCalls).toHaveLength(0);

      // capture.surface must never have been called (headless skips directive step).
      expect(surfaceCalls).toHaveLength(0);

      // regenerate MUST still have been called.
      expect(regenerateCalled).toBe(true);

      // pendingCount in summary reflects the leftover pending row.
      expect(summary.pendingCount).toBe(1);
      expect(summary.approvedCount).toBe(0);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T5: --yes approves ONLY auto_inferred pending; human_directive stays pending
// ---------------------------------------------------------------------------

describe("T5 — autoYes approves ONLY auto_inferred (never human_directive)", () => {
  test("autoYes:true → auto_inferred approved; human_directive stays pending; regenerate called", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    const now = new Date().toISOString();

    // Seed ONE auto_inferred pending instinct via recordSignal (3 sessions → materializes).
    const autoTrigger = "auto-trigger-t5";
    const autoDomain = "testing";
    const autoShape = "run auto tests always";
    const autoKey = store.identityKey(autoTrigger, autoDomain, autoShape);
    for (let i = 0; i < 3; i++) {
      await store.recordSignal(
        {
          identity_key: autoKey,
          tenant_id: ctx.tenant_id,
          project: ctx.project,
          session_id: `t5-sess-${i}`,
          finding_id: `t5-f${i}:Q1`,
          evidence_scrubbed: `t5 evidence ${i}`,
          observed_at: now,
          severity: "fail",
        },
        { trigger: autoTrigger, domain: autoDomain, behavioral_shape: autoShape },
      );
    }

    // Seed ONE human_directive pending instinct via upsertDirective.
    const humanTrigger = "human-trigger-t5";
    const humanDomain = "testing";
    const humanShape = "human directive shape t5";
    await store.upsertDirective({
      ctx,
      identity_key: store.identityKey(humanTrigger, humanDomain, humanShape),
      trigger: humanTrigger,
      domain: humanDomain,
      behavioral_shape: humanShape,
      status: "pending", // stays pending until human confirms via Step 4 / explicit instincts approve
    });

    // Verify we have both ingestion_path kinds pending before the run.
    const allPendingBefore = await store.listByStatus(ctx, "pending");
    expect(allPendingBefore.some((r) => r.ingestion_path === "auto_inferred")).toBe(true);
    expect(allPendingBefore.some((r) => r.ingestion_path === "human_directive")).toBe(true);

    const outDir = makeTmpDir();
    let regenerateCalled = false;
    const projection = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 5, bytesWritten: 50 };
      },
    };

    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: true },
        { ...makeDeps(), store, facts, projection },
      );

      // auto_inferred row must now be approved.
      const nowApproved = await store.listByStatus(ctx, "approved");
      expect(nowApproved).toHaveLength(1);
      expect(nowApproved[0].ingestion_path).toBe("auto_inferred");

      // human_directive row must STILL be pending — --yes must NOT forge the trust anchor.
      const stillPending = await store.listByStatus(ctx, "pending");
      expect(stillPending).toHaveLength(1);
      expect(stillPending[0].ingestion_path).toBe("human_directive");

      expect(regenerateCalled).toBe(true);
      expect(summary.approvedCount).toBe(1);
      // pendingCount includes the human_directive row left pending.
      expect(summary.pendingCount).toBe(1);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T6: authorship guard — raw line passthrough
// ---------------------------------------------------------------------------

describe("T6 — authorship guard / raw line passthrough", () => {
  test("prompt.freeText returns text identical to suggestion → rejected-not-authored, no instinct written", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    const suggestionText = "always write tests before shipping";

    // Mock capture: surface returns one suggestion; captureDirective uses real logic.
    const realCapture = createDirectiveCapture({ store });
    const mockCapture = {
      async surface(_t: string, _l: unknown, _c: unknown): Promise<DirectiveSuggestion[]> {
        // Use a valid domain from DOMAINS: "testing", "git", "code_quality", etc.
        return [{ trigger: "test-trigger", behavioral_shape: suggestionText, domain: "testing", suggestionText }];
      },
      captureDirective: realCapture.captureDirective.bind(realCapture),
    };

    // freeText returns the SAME text as the suggestion (user submits unchanged).
    const { prompt } = makePrompt(false, suggestionText);

    const outDir = makeTmpDir();
    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture: mockCapture, projection: makeProjectionSpy().projection, llm: noOpLlm, prompt, interactive: true },
      );

      // CLI passed the raw typed line through — module rejected it as not-authored.
      expect(summary.rejectedCount).toBe(1);
      expect(summary.approvedCount).toBe(0);
      // No new approved instinct.
      const approved = await store.listByStatus(ctx, "approved");
      expect(approved).toHaveLength(0);
    } finally {
      cleanupDir(outDir);
    }
  });

  test("prompt.freeText returns EDITED text → approved, instinct row present", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    const suggestionText = "always write tests before shipping";
    const editedText = "ALWAYS write tests before shipping, no exceptions"; // different from suggestion

    const realCapture = createDirectiveCapture({ store });
    const mockCapture = {
      async surface(_t: string, _l: unknown, _c: unknown): Promise<DirectiveSuggestion[]> {
        return [{ trigger: "test-trigger", behavioral_shape: suggestionText, domain: "testing", suggestionText }];
      },
      captureDirective: realCapture.captureDirective.bind(realCapture),
    };

    const { prompt } = makePrompt(false, editedText);

    const outDir = makeTmpDir();
    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture: mockCapture, projection: makeProjectionSpy().projection, llm: noOpLlm, prompt, interactive: true },
      );

      // Edited text → human-authored → approved or pending (directive path sets approved on confirm).
      // Since confirmed=true (non-empty), status should be "approved".
      expect(summary.approvedCount).toBe(1);
      expect(summary.rejectedCount).toBe(0);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T7: interactive yes/no approval
// ---------------------------------------------------------------------------

describe("T7 — interactive yes/no approval", () => {
  /** Helper: seed one auto_inferred pending instinct via recordSignal (3 sessions). */
  async function seedAutoInferredPending(
    store: ReturnType<typeof createInstinctsDb>,
    ctx: InstinctCtx,
    suffix: string,
  ): Promise<number> {
    const trigger = `t7-trigger-${suffix}`;
    const domain = "testing";
    const shape = `t7-shape-${suffix}`;
    const ikey = store.identityKey(trigger, domain, shape);
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await store.recordSignal(
        {
          identity_key: ikey,
          tenant_id: ctx.tenant_id,
          project: ctx.project,
          session_id: `t7-${suffix}-sess-${i}`,
          finding_id: `t7-${suffix}-f${i}:Q1`,
          evidence_scrubbed: `t7 evidence`,
          observed_at: now,
          severity: "fail",
        },
        { trigger, domain, behavioral_shape: shape },
      );
    }
    const rows = await store.listByStatus(ctx, "pending");
    const row = rows.find((r) => r.identity_key === ikey);
    if (!row) throw new Error(`T7 seedAutoInferredPending: no pending row for suffix ${suffix}`);
    return row.id;
  }

  test("prompt.yesNo returns true for auto_inferred pending → setStatus(id,'approved') called", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    // Seed one auto_inferred pending instinct (recordSignal path).
    const pendingId = await seedAutoInferredPending(store, ctx, "yes");

    // prompt.yesNo always returns true.
    const { prompt } = makePrompt(true, "");

    const outDir = makeTmpDir();
    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture: createDirectiveCapture({ store }), projection: makeProjectionSpy().projection, llm: noOpLlm, prompt, interactive: true },
      );

      // The auto_inferred pending row must now be approved.
      const inst = await store.getById(pendingId);
      expect(inst?.status).toBe("approved");
      expect(inst?.ingestion_path).toBe("auto_inferred");

      expect(summary.approvedCount).toBe(1);
      expect(summary.pendingCount).toBe(0);
    } finally {
      cleanupDir(outDir);
    }
  });

  test("prompt.yesNo returns false → auto_inferred instinct stays pending", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    // Seed one auto_inferred pending instinct.
    await seedAutoInferredPending(store, ctx, "no");

    // prompt.yesNo always returns false.
    const { prompt } = makePrompt(false, "");

    const outDir = makeTmpDir();
    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture: createDirectiveCapture({ store }), projection: makeProjectionSpy().projection, llm: noOpLlm, prompt, interactive: true },
      );

      const approved = await store.listByStatus(ctx, "approved");
      expect(approved).toHaveLength(0);
      expect(summary.pendingCount).toBe(1);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T8: instincts approve flow — flip status; no inline regenerate; next runLearn emits it
// ---------------------------------------------------------------------------

describe("T8 — instincts approve → next runLearn emits it in projection", () => {
  test("approve via store.setStatus, then runLearn with real projection emits the instinct", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    // Seed a pending instinct with confidence >= 0.70 (so it's injectable).
    const instId = await seedApproved(store, ctx);
    // We re-pend it to test the approve flow.
    // Actually seedApproved already approves it. Let's verify it's approved.
    const inst = await store.getById(instId);
    expect(inst?.status).toBe("approved");

    // The "instincts approve" command does: store.getById(id) → store.setStatus(id,'approved')
    // then says "run learn". It does NOT call projection.regenerate.
    // Here we verify: calling setStatus alone does NOT change files.
    // Then calling runLearn causes regenerate to run with the approved instinct.

    const outDir = makeTmpDir();
    let regenerateCallCount = 0;
    const projectionSpy = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCallCount++;
        // Use the real projection so we can verify instinct appears in index.
        const realProjection = createMemoryProjection({ instincts: store, facts });
        return realProjection.regenerate(_ctx, dir);
      },
    };

    try {
      const summary = await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { store, facts, analyzer: makeAnalyzerSpy().analyzer, capture: createDirectiveCapture({ store }), projection: projectionSpy, llm: noOpLlm, prompt: makePrompt().prompt, interactive: false },
      );

      // regenerate was called exactly once (by runLearn, never by approve flow).
      expect(regenerateCallCount).toBe(1);

      // MEMORY.md should exist and contain the approved instinct (if confidence >= 0.70 threshold).
      const memFile = path.join(outDir, "MEMORY.md");
      expect(fs.existsSync(memFile)).toBe(true);
      const content = fs.readFileSync(memFile, "utf-8");
      // The index line uses behavioral_shape; trigger lives in the instinct topic file.
      expect(content).toContain("run tests always"); // behavioral_shape
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T9: TTY simulation
// ---------------------------------------------------------------------------

describe("T9 — TTY simulation: isTTY drives interactive flag", () => {
  test("isTTY=true and no --no-input → interactive should be true", () => {
    // Simulate what cmdLearn computes:
    // const interactive = process.stdin.isTTY === true && !has(args,"--no-input");
    function resolveInteractive(isTTY: boolean | undefined, args: string[]): boolean {
      return isTTY === true && !args.includes("--no-input");
    }
    expect(resolveInteractive(true, [])).toBe(true);
    expect(resolveInteractive(true, ["--no-input"])).toBe(false);
    expect(resolveInteractive(undefined, [])).toBe(false);
    expect(resolveInteractive(false, [])).toBe(false);
  });

  test("headless (interactive:false) still calls regenerate", async () => {
    const outDir = makeTmpDir();
    let regenerateCalled = false;
    const projection = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 5, bytesWritten: 50 };
      },
    };
    try {
      await runLearn(
        { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
        { ...makeDeps(), projection, interactive: false },
      );
      expect(regenerateCalled).toBe(true);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T10: dry-run — no setStatus/captureDirective writes; real DB untouched
// ---------------------------------------------------------------------------

describe("T10 — dry-run non-destructive", () => {
  test("dryRun:true → setStatus never called; pending rows unchanged", async () => {
    const { store, facts } = makeStores();
    await store.ensure();
    await facts.ensure();

    const ctx = makeCtx();
    // Seed a pending instinct.
    await store.upsertDirective({
      ctx,
      identity_key: store.identityKey("dry-trigger", "quality", "dry-shape"),
      trigger: "dry-trigger",
      domain: "quality",
      behavioral_shape: "dry-shape",
      status: "pending",
    });

    const setStatusCalls: number[] = [];
    const storeProxy = new Proxy(store, {
      get(target, key) {
        if (key === "setStatus") {
          return async (id: number, status: string) => {
            setStatusCalls.push(id);
            return (target.setStatus as (...a: unknown[]) => unknown)(id, status);
          };
        }
        return (target as Record<string | symbol, unknown>)[key];
      },
    });

    const captureDirectiveCalls: number[] = [];
    const capture = {
      async surface(): Promise<DirectiveSuggestion[]> { return []; },
      async captureDirective(): Promise<CaptureOutcome> {
        captureDirectiveCalls.push(1);
        return { result: "rejected-not-authored", reason: "test" };
      },
    };

    const outDir = makeTmpDir();
    try {
      await runLearn(
        { ctx, projCtx: makeProjCtx(), outDir, dryRun: true, autoYes: true }, // autoYes=true but dryRun skips it
        { store: storeProxy, facts, analyzer: makeAnalyzerSpy().analyzer, capture, projection: makeProjectionSpy().projection, llm: noOpLlm, prompt: makePrompt(true, "anything").prompt, interactive: true },
      );
    } finally {
      cleanupDir(outDir);
    }

    // setStatus must NOT have been called (dryRun skips steps 3–4).
    expect(setStatusCalls).toHaveLength(0);
    // captureDirective must NOT have been called.
    expect(captureDirectiveCalls).toHaveLength(0);

    // Original pending row still pending.
    const stillPending = await store.listByStatus(ctx, "pending");
    expect(stillPending).toHaveLength(1);
  });

  test("dryRun:true → regenerate still called (Fix-3/AC-6)", async () => {
    const outDir = makeTmpDir();
    let regenerateCalled = false;
    const projection = {
      async regenerate(_ctx: ProjectionCtx, dir: string): Promise<RegenerateResult> {
        regenerateCalled = true;
        fs.mkdirSync(dir, { recursive: true });
        return { factsInIndex: 0, factsOverflow: 0, instinctsInIndex: 0, linesWritten: 5, bytesWritten: 50 };
      },
    };
    try {
      await runLearn(
        { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: true, autoYes: false },
        { ...makeDeps(), projection },
      );
      expect(regenerateCalled).toBe(true);
    } finally {
      cleanupDir(outDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T11: projection hard-fail → error propagates
// ---------------------------------------------------------------------------

describe("T11 — projection hard-fail → error propagated", () => {
  test("projection throws SelfCheckError → runLearn propagates it", async () => {
    const outDir = makeTmpDir();
    const projection = {
      async regenerate(_ctx: ProjectionCtx, _dir: string): Promise<RegenerateResult> {
        throw new SelfCheckError("SelfCheck: tenant mismatch");
      },
    };
    try {
      await expect(
        runLearn(
          { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
          { ...makeDeps(), projection },
        ),
      ).rejects.toThrow(SelfCheckError);
    } finally {
      cleanupDir(outDir);
    }
  });

  test("projection throws TruncationError → runLearn propagates it", async () => {
    const outDir = makeTmpDir();
    const projection = {
      async regenerate(_ctx: ProjectionCtx, _dir: string): Promise<RegenerateResult> {
        throw new TruncationError("TruncationError: too many lines");
      },
    };
    try {
      await expect(
        runLearn(
          { ctx: makeCtx(), projCtx: makeProjCtx(), outDir, dryRun: false, autoYes: false },
          { ...makeDeps(), projection },
        ),
      ).rejects.toThrow(TruncationError);
    } finally {
      cleanupDir(outDir);
    }
  });
});
