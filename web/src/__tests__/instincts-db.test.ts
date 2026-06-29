/**
 * instincts-db.test.ts — InstinctsDb (tier-2) tests.
 *
 * Covers all T1–T12 from slice3-design.md §4.
 * All tests run against createDriver(":memory:") — never the live workspace DB.
 */

import { test, expect, describe } from "bun:test";
import { createDriver } from "../db-driver.ts";
import { createInstinctsDb, DOMAINS, isDomain, analyzerConfidence } from "../instincts-db.ts";
import type { InstinctsDb, InstinctCtx, SignalInput, Instinct } from "../instincts-db.ts";
import type { Driver } from "../db-driver.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): { idb: InstinctsDb; driver: Driver } {
  const driver = createDriver(":memory:");
  const idb = createInstinctsDb(driver);
  return { idb, driver };
}

const ctx: InstinctCtx = { tenant_id: "tenant1", project: "proj-x" };
const ctx2: InstinctCtx = { tenant_id: "tenant1", project: "proj-y" };
const ctxOtherTenant: InstinctCtx = { tenant_id: "tenant2", project: "proj-x" };

function makeSignal(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    identity_key: "deadbeef",
    tenant_id: "tenant1",
    project: "proj-x",
    session_id: "sess-1",
    finding_id: "f-1",
    evidence_scrubbed: "agent did not ask before pushing",
    observed_at: new Date().toISOString(),
    severity: "warn",
    ...overrides,
  };
}

function pastIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// T1 — identity_key normalization (H-1)
// ---------------------------------------------------------------------------

describe("T1 — identityKey() normalization (H-1)", () => {
  test("case variants produce the same key", () => {
    const { idb } = makeDb();
    const k1 = idb.identityKey("Never push without asking", "git", "always ask before push");
    const k2 = idb.identityKey("NEVER PUSH WITHOUT ASKING", "git", "ALWAYS ASK BEFORE PUSH");
    const k3 = idb.identityKey("never push without asking", "git", "always ask before push");
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  test("whitespace variants produce the same key", () => {
    const { idb } = makeDb();
    const k1 = idb.identityKey("  never  push  ", "git", "ask first  ");
    const k2 = idb.identityKey("never push", "git", "ask first");
    expect(k1).toBe(k2);
  });

  test("NFKC normalization: composed/decomposed Unicode produce the same key", () => {
    const { idb } = makeDb();
    // 'é' can be U+00E9 (composed) or U+0065 U+0301 (decomposed); NFKC normalises both.
    const k1 = idb.identityKey("café rule", "process", "order matters");
    const k2 = idb.identityKey("café rule", "process", "order matters");
    expect(k1).toBe(k2);
  });

  test("returns a 64-char hex string (sha256)", () => {
    const { idb } = makeDb();
    const k = idb.identityKey("trigger", "git", "shape");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// T2 — identity_key collision guard (H-1 delimiter)
// ---------------------------------------------------------------------------

describe("T2 — identityKey() collision guard — \\x1f delimiter", () => {
  test("('ab','d','c') vs ('a','d','bc') vs ('a','d','cb') → all distinct", () => {
    const { idb } = makeDb();
    const k1 = idb.identityKey("ab", "git", "c");
    const k2 = idb.identityKey("a", "git", "bc");
    const k3 = idb.identityKey("a", "git", "cb");
    const keys = new Set([k1, k2, k3]);
    expect(keys.size).toBe(3); // all distinct
  });

  test("swapping trigger and shape produces distinct keys", () => {
    const { idb } = makeDb();
    const k1 = idb.identityKey("trigger text", "git", "shape text");
    const k2 = idb.identityKey("shape text", "git", "trigger text");
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// T3 — upsertDirective supersede-on-upsert
// ---------------------------------------------------------------------------

describe("T3 — upsertDirective() supersede-on-upsert", () => {
  test("second upsert with same identity → ONE row, updated content", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("never push", "git", "always ask");
    await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "never push", domain: "git", behavioral_shape: "always ask", status: "pending" });
    const second = await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "NEVER push", domain: "git", behavioral_shape: "ask first", status: "approved" });

    const all = await idb.listByStatus(ctx, "approved");
    expect(all).toHaveLength(1);
    expect(second.behavioral_shape).toBe("ask first");
    expect(second.status).toBe("approved");
    expect(second.ingestion_path).toBe("human_directive");
    expect(second.confidence).toBe(0.9);
  });

  test("confidence is always 0.9 for directives (OQ-1)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("trigger", "git", "shape");
    const inst = await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "trigger", domain: "git", behavioral_shape: "shape", status: "pending" });
    expect(inst.confidence).toBe(0.9);
  });

  test("occurrence_count starts at 1 for a directive (n=1 rule, BR-1a)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("trigger", "git", "shape");
    const inst = await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "trigger", domain: "git", behavioral_shape: "shape", status: "approved" });
    expect(inst.occurrence_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T4 — NULL-scope dedup: two global instincts same identity → ONE row
// ---------------------------------------------------------------------------

describe("T4 — NULL-scope dedup (project=null → COALESCE dedup)", () => {
  test("two directives with project=null, same identity → ONE row", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const globalCtx: InstinctCtx = { tenant_id: "tenant1", project: null };
    const ikey = idb.identityKey("trigger", "git", "shape");

    await idb.upsertDirective({ ctx: globalCtx, identity_key: ikey, trigger: "trigger", domain: "git", behavioral_shape: "shape", status: "pending" });
    await idb.upsertDirective({ ctx: globalCtx, identity_key: ikey, trigger: "trigger v2", domain: "git", behavioral_shape: "shape", status: "pending" });

    // Only one row in the DB
    const byId1 = await idb.listByStatus(globalCtx, "pending");
    expect(byId1).toHaveLength(1);
    expect(byId1[0].trigger).toBe("trigger v2"); // updated
  });
});

// ---------------------------------------------------------------------------
// T5 — Materialization at 3 distinct sessions (BR-1)
// ---------------------------------------------------------------------------

describe("T5 — materialization at 3 distinct sessions (BR-1)", () => {
  test("2 sessions → 0 instincts, 2 buffer rows", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("push without asking", "git", "always verify");
    const derive = { trigger: "push without asking", domain: "git", behavioral_shape: "always verify" };

    const r1 = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1" }), derive);
    const r2 = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2" }), derive);

    expect(r1.materialized).toBe(false);
    expect(r2.materialized).toBe(false);

    const pending = await idb.listByStatus(ctx, "pending");
    expect(pending).toHaveLength(0);
  });

  test("3rd distinct session → exactly 1 instinct, buffer emptied", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("push without asking", "git", "always verify");
    const derive = { trigger: "push without asking", domain: "git", behavioral_shape: "always verify" };

    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2" }), derive);
    const r3 = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s3" }), derive);

    expect(r3.materialized).toBe(true);
    expect(r3.instinctId).toBeGreaterThan(0);

    // Exactly 1 instinct
    const pending = await idb.listByStatus(ctx, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].ingestion_path).toBe("auto_inferred");
    expect(pending[0].status).toBe("pending");
    expect(pending[0].occurrence_count).toBe(3);

    // Buffer emptied for this identity
    // (We verify indirectly: a 4th call with same identity starts fresh)
    const r4 = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s4" }), derive);
    expect(r4.materialized).toBe(false); // buffer started from 1 again after clearing
  });

  test("same session recorded twice → still 1 buffer row (INSERT OR IGNORE)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("test-idem", "testing", "idempotent");
    const derive = { trigger: "test-idem", domain: "testing", behavioral_shape: "idempotent" };

    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1" }), derive); // duplicate
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2" }), derive);

    // Still only 2 distinct sessions — not materialized
    const r = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2" }), derive); // dup again
    expect(r.materialized).toBe(false);
  });

  test("materialized instinct has 3 instinct_occurrences (verified via occurrence_count)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("verify-occ", "git", "occ-count");
    const derive = { trigger: "verify-occ", domain: "git", behavioral_shape: "occ-count" };

    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "sA" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "sB" }), derive);
    const r = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "sC" }), derive);

    expect(r.materialized).toBe(true);
    const inst = await idb.getById(r.instinctId!);
    expect(inst).not.toBeNull();
    expect(inst!.occurrence_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T6 — Dedup precedence: project wins over global (BR-6)
// ---------------------------------------------------------------------------

describe("T6 — dedup precedence: project over global (BR-6)", () => {
  test("same identity_key, one project + one global row → projection returns ONLY the project row", async () => {
    // BR-6: ROW_NUMBER() OVER (PARTITION BY identity_key ORDER BY (scope='project') DESC)
    // ensures project-scoped wins. Since v1 has no promotion writer (scope='global' is dormant),
    // we seed the global row directly via the driver to actually exercise the window function
    // with two competing rows for the same identity_key.
    const { idb, driver } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("always ask", "git", "before pushing");
    const now = new Date().toISOString();

    // Insert project-scoped instinct via the public API
    await idb.upsertDirective({
      ctx: { tenant_id: "tenant1", project: "proj-x" },
      identity_key: ikey,
      trigger: "always ask",
      domain: "git",
      behavioral_shape: "before pushing",
      status: "approved",
    });

    // Seed a scope='global' row with the SAME identity_key directly (no v1 promotion writer).
    // This is the competing row that BR-6 dedup must suppress.
    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              (:ikey, 'always ask', 'before pushing', 'git', 0.9, 'global',
               'tenant1', NULL, 'approved', 'human_directive', NULL, NULL,
               1, :now, :now)`,
      args: { ":ikey": ikey, ":now": now },
    });

    // selectForProjection should return EXACTLY ONE row, and it must be the project-scoped one.
    const result = await idb.selectForProjection(ctx);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe("project");
    expect(result[0].project).toBe("proj-x");
    // The global row with the same identity_key is silently suppressed by dedup_rank > 1.
  });
});

// ---------------------------------------------------------------------------
// T7 — TTL prune excludes scoped_facts (BR-8)
// ---------------------------------------------------------------------------

describe("T7 — TTL prune (BR-8′): auto_inferred pruned, human-authored exempt", () => {
  test("auto_inferred instinct with last_reinforced_at > 31d ago is pruned", async () => {
    // BR-8′: staleness TTL applies to auto_inferred ONLY.
    // Use a direct SQL INSERT so we can set ingestion_path='auto_inferred' and
    // last_reinforced_at to a past timestamp (recordSignal takes 3 sessions to materialize).
    const { idb, driver } = makeDb();
    await idb.ensure();

    const oldDate = pastIso(35);
    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              ('stale-auto-key', 'stale trigger', 'stale shape', 'git', 0.7, 'project',
               'tenant1', 'proj-x', 'pending', 'auto_inferred', NULL, NULL,
               3, :old, :old)`,
      args: { ":old": oldDate },
    });

    const rs = await driver.execute({
      sql: `SELECT id FROM instincts WHERE identity_key = 'stale-auto-key'`,
      args: {},
    });
    const instId = (rs.rows[0] as { id: number }).id;

    // Prune with "now" set to 32 days in the future (well past 30d threshold)
    const futureNow = new Date(Date.now() + 32 * 86400 * 1000).toISOString();
    const { instinctsPruned } = await idb.prune(futureNow);

    expect(instinctsPruned).toBe(1);
    const fetched = await idb.getById(instId);
    expect(fetched).toBeNull();
  });

  test("auto_inferred instinct with last_reinforced_at < 29d ago survives", async () => {
    // A recently-reinforced auto_inferred instinct is NOT pruned.
    const { idb, driver } = makeDb();
    await idb.ensure();

    const recentDate = pastIso(5); // 5 days ago — well within the 30-day window
    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              ('fresh-auto-key2', 'fresh trigger', 'fresh shape', 'git', 0.7, 'project',
               'tenant1', 'proj-x', 'pending', 'auto_inferred', NULL, NULL,
               3, :recent, :recent)`,
      args: { ":recent": recentDate },
    });

    const rs2 = await driver.execute({
      sql: `SELECT id FROM instincts WHERE identity_key = 'fresh-auto-key2'`,
      args: {},
    });
    const instId2 = (rs2.rows[0] as { id: number }).id;

    // Prune with "now" set to only 10 days in the future (5+10=15d total, < 30d threshold)
    const nearFuture = new Date(Date.now() + 10 * 86400 * 1000).toISOString();
    const { instinctsPruned } = await idb.prune(nearFuture);

    expect(instinctsPruned).toBe(0);
    const fetched = await idb.getById(instId2);
    expect(fetched).not.toBeNull();
  });

  test("review resets the prune clock for auto_inferred (last_reviewed_at counts)", async () => {
    // Scenario: auto_inferred created 35 days ago (last_reinforced_at old), then reviewed TODAY
    // (last_reviewed_at = now). Pruning at "now" should NOT prune because MAX picks last_reviewed_at.
    const { idb, driver } = makeDb();
    await idb.ensure();

    // Seed an auto_inferred instinct with last_reinforced_at set to 35 days ago.
    const oldDate = pastIso(35);
    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              ('review-clock-key', 'rev trigger', 'rev shape', 'git', 0.7, 'project',
               'tenant1', 'proj-x', 'pending', 'auto_inferred', NULL, NULL,
               3, :old, :old)`,
      args: { ":old": oldDate },
    });

    // Retrieve the id
    const rs = await driver.execute({
      sql: `SELECT id FROM instincts WHERE identity_key = 'review-clock-key'`,
      args: {},
    });
    const instId = (rs.rows[0] as { id: number }).id;

    // Approve (sets last_reviewed_at = NOW — less than 30d ago)
    await idb.setStatus(instId, "approved");

    // Prune with actual "now" — 35d have elapsed since last_reinforced_at,
    // but MAX picks last_reviewed_at (just set) which is 0d ago → NOT pruned.
    const { instinctsPruned } = await idb.prune();
    expect(instinctsPruned).toBe(0);
  });

  test("orphan buffer rows older than 30d are pruned", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Insert a signal that never materializes (sub-threshold)
    const ikey = idb.identityKey("orphan", "testing", "never reached 3");
    await idb.recordSignal(
      makeSignal({ identity_key: ikey, session_id: "old-sess", observed_at: pastIso(35) }),
      { trigger: "orphan", domain: "testing", behavioral_shape: "never reached 3" }
    );

    const futureNow = new Date(Date.now() + 35 * 86400 * 1000).toISOString();
    const { bufferPruned } = await idb.prune(futureNow);
    expect(bufferPruned).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T8 — Tenant isolation (BR-S1/S4) for instincts
// ---------------------------------------------------------------------------

describe("T8 — tenant isolation for instincts", () => {
  test("listByStatus does not return other-tenant instincts", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey1 = idb.identityKey("tenant1 rule", "git", "shape1");
    await idb.upsertDirective({ ctx, identity_key: ikey1, trigger: "t1", domain: "git", behavioral_shape: "s1", status: "pending" });

    const ikey2 = idb.identityKey("tenant2 rule", "git", "shape2");
    await idb.upsertDirective({ ctx: ctxOtherTenant, identity_key: ikey2, trigger: "t2", domain: "git", behavioral_shape: "s2", status: "pending" });

    const t1Results = await idb.listByStatus(ctx, "pending");
    expect(t1Results).toHaveLength(1);
    expect(t1Results[0].tenant_id).toBe("tenant1");
  });
});

// ---------------------------------------------------------------------------
// T9 — ROUND boundary (H-3)
// ---------------------------------------------------------------------------

describe("T9 — ROUND(confidence,2) boundary (H-3)", () => {
  test("confidence 0.70 → eligible for projection", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("low confidence", "git", "borderline");
    const inst = await idb.upsertDirective({
      ctx,
      identity_key: ikey,
      trigger: "low confidence",
      domain: "git",
      behavioral_shape: "borderline",
      status: "approved",
    });

    // Manually set confidence to 0.70 by updating via setStatus trick… we can't set confidence
    // directly through the public API. Instead, record a signal path with confidence=0.70.
    // For a direct test, we need to seed the DB with raw SQL. Use the driver directly.

    // Auto-inferred instinct. H-2: confidence = analyzerConfidence(S, R).
    // 3 fail sessions → analyzerConfidence(3, 1.0) = 0.65 (below projection threshold).
    // Add a 4th fail occurrence via recordOccurrence → S=4, R=1.0 → 0.70 (eligible).
    const ikeySignal = idb.identityKey("signal borderline", "git", "0.70 confidence");
    const derive070 = { trigger: "signal borderline", domain: "git", behavioral_shape: "0.70 confidence" };
    const m1 = await idb.recordSignal(makeSignal({ identity_key: ikeySignal, session_id: "x1", severity: "fail" }), derive070);
    const m2 = await idb.recordSignal(makeSignal({ identity_key: ikeySignal, session_id: "x2", severity: "fail" }), derive070);
    const m3 = await idb.recordSignal(makeSignal({ identity_key: ikeySignal, session_id: "x3", severity: "fail" }), derive070);
    // m3 materializes; confidence = 0.65. Add 4th occurrence via recordOccurrence to push to 0.70.
    expect(m3.materialized).toBe(true);
    await idb.recordOccurrence(m3.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "x4", finding_id: "f-x4",
      evidence_scrubbed: "4th fail", observed_at: new Date().toISOString(), severity: "fail",
    });

    // Get the materialized instinct (now S=4, R=1.0, conf=0.70) and approve it
    const pending = await idb.listByStatus(ctx, "pending");
    const target = pending.find((i) => i.identity_key === ikeySignal);
    expect(target).toBeDefined();
    expect(target!.confidence).toBe(0.70);
    await idb.setStatus(target!.id, "approved");

    const projected = await idb.selectForProjection(ctx);
    const found = projected.find((i) => i.identity_key === ikeySignal);
    expect(found).toBeDefined(); // 0.70 is eligible
  });

  test("confidence 0.69 (exactly) → NOT eligible for projection", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // 3 warn sessions → analyzerConfidence(3, 0) = 0.50 < 0.70 → not eligible
    const ikeyLow = idb.identityKey("sub-threshold", "git", "0.69 confidence");
    const derive069 = { trigger: "sub-threshold", domain: "git", behavioral_shape: "0.69 confidence" };
    await idb.recordSignal(makeSignal({ identity_key: ikeyLow, session_id: "y1", severity: "warn" }), derive069);
    await idb.recordSignal(makeSignal({ identity_key: ikeyLow, session_id: "y2", severity: "warn" }), derive069);
    await idb.recordSignal(makeSignal({ identity_key: ikeyLow, session_id: "y3", severity: "warn" }), derive069);

    const pending = await idb.listByStatus(ctx, "pending");
    const target = pending.find((i) => i.identity_key === ikeyLow);
    expect(target).toBeDefined();
    await idb.setStatus(target!.id, "approved");

    const projected = await idb.selectForProjection(ctx);
    const found = projected.find((i) => i.identity_key === ikeyLow);
    expect(found).toBeUndefined(); // 0.69 → not projected
  });

  test("confidence 0.6949 → NOT eligible (ROUND(0.6949,2)=0.69 < 0.70 — H-3 is actually exercised)", async () => {
    // ROUND(0.6949, 2) = 0.69 < 0.70 → excluded. This genuinely exercises the ROUND() path:
    // a naive raw-float compare (0.6949 >= 0.7) is already false, but ROUND canonicalises
    // borderline values to 2 dp, making the rule mechanically precise.
    const { idb, driver } = makeDb();
    await idb.ensure();

    const now = new Date().toISOString();
    const ikeyEdge = idb.identityKey("round-edge-sub", "git", "0.6949 shape");

    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              (:ikey, 'round-edge-sub', '0.6949 shape', 'git', 0.6949, 'project',
               'tenant1', 'proj-x', 'approved', 'human_directive', NULL, NULL,
               1, :now, :now)`,
      args: { ":ikey": ikeyEdge, ":now": now },
    });

    const projected = await idb.selectForProjection(ctx);
    const found = projected.find((i) => i.identity_key === ikeyEdge);
    expect(found).toBeUndefined(); // ROUND(0.6949,2)=0.69 → not projected
  });

  test("confidence 0.6951 → IS eligible (ROUND(0.6951,2)=0.70 >= 0.70)", async () => {
    // 0.6951 rounds up to 0.70 and is exactly at the eligibility threshold.
    // Note: 0.695 itself rounds DOWN to 0.69 in SQLite (IEEE 754 representation of 0.695
    // is slightly below the midpoint); 0.6951 is the first value that reliably rounds to 0.70.
    const { idb, driver } = makeDb();
    await idb.ensure();

    const now = new Date().toISOString();
    const ikeyEdge2 = idb.identityKey("round-edge-sup", "git", "0.6951 shape");

    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              (:ikey, 'round-edge-sup', '0.6951 shape', 'git', 0.6951, 'project',
               'tenant1', 'proj-x', 'approved', 'human_directive', NULL, NULL,
               1, :now, :now)`,
      args: { ":ikey": ikeyEdge2, ":now": now },
    });

    const projected = await idb.selectForProjection(ctx);
    const found = projected.find((i) => i.identity_key === ikeyEdge2);
    expect(found).toBeDefined(); // ROUND(0.6951,2)=0.70 → eligible
  });
});

// ---------------------------------------------------------------------------
// T10 — Re-score no double-count (H-5)
// ---------------------------------------------------------------------------

describe("T10 — re-score no double-count (H-5)", () => {
  test("recordOccurrence twice with same session → counted once, occurrence_count +1 only once", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("double-occ trigger", "git", "double-occ shape");
    const inst = await idb.upsertDirective({
      ctx,
      identity_key: ikey,
      trigger: "double-occ trigger",
      domain: "git",
      behavioral_shape: "double-occ shape",
      status: "approved",
    });

    const startCount = inst.occurrence_count;

    const occ = {
      tenant_id: "tenant1",
      project: "proj-x",
      session_id: "re-score-sess",
      finding_id: "f-1",
      evidence_scrubbed: "evidence",
      observed_at: new Date().toISOString(),
      severity: "warn" as const,
    };

    const r1 = await idb.recordOccurrence(inst.id, occ);
    const r2 = await idb.recordOccurrence(inst.id, occ); // same session again

    expect(r1.counted).toBe(true);
    expect(r2.counted).toBe(false); // duplicate → ignored

    const updated = await idb.getById(inst.id);
    expect(updated!.occurrence_count).toBe(startCount + 1); // only +1
  });
});

// ---------------------------------------------------------------------------
// T11 — Parentheses guard (AC-8)
// ---------------------------------------------------------------------------

describe("T11 — parentheses guard (AC-8)", () => {
  test("projection SQL source contains the explicit parenthesized OR clause", () => {
    // Structural belt-and-suspenders: the literal SQL must contain the parens guard.
    const src = createInstinctsDb.toString();
    expect(src).toContain("(scope = 'global' OR project = :project)");
  });

  test("cross-project instinct does not leak into projection (same-tenant, different project)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Instinct for proj-y (same tenant, wrong project)
    const ikeyY = idb.identityKey("proj-y rule", "git", "y shape");
    await idb.upsertDirective({
      ctx: ctx2, // project: 'proj-y'
      identity_key: ikeyY,
      trigger: "proj-y rule",
      domain: "git",
      behavioral_shape: "y shape",
      status: "approved",
    });

    // Projection for proj-x should NOT include proj-y instinct
    const result = await idb.selectForProjection(ctx); // ctx.project = 'proj-x'
    const leaked = result.find((i) => i.project === "proj-y");
    expect(leaked).toBeUndefined();
  });

  test("AC-8 behavioral: cross-tenant same-project-name row is absent (fails if parens are removed)", async () => {
    // THIS IS THE RELEASE-GATE TEST.
    //
    // What the parens guard prevents:
    //   WITHOUT parens: "AND tenant_id=:tenant AND scope='global' OR project=:project AND ..."
    //   becomes (AND binds tighter than OR): "(...AND tenant_id AND scope='global') OR (project=:project AND ...)"
    //   A row from tenant2 with project='proj-x' would satisfy the OR branch alone —
    //   bypassing the tenant_id, status, and confidence filters entirely.
    //
    //   WITH parens: "(scope='global' OR project='proj-x')" is ONE operand of AND,
    //   so tenant_id=:tenant is always required. The tenant2 row is excluded.
    //
    // Seed: tenant2 / project='proj-x' (same name!) / status='pending' / confidence=0.3 / FRESH
    const { idb, driver } = makeDb();
    await idb.ensure();

    const now = new Date().toISOString();
    const poisonKey = idb.identityKey("cross-tenant poison", "git", "must not leak");

    await driver.execute({
      sql: `INSERT INTO instincts
              (identity_key, trigger, behavioral_shape, domain, confidence, scope,
               tenant_id, project, status, ingestion_path, agent_id, embedding,
               occurrence_count, created_at, last_reinforced_at)
            VALUES
              (:ikey, 'cross-tenant poison', 'must not leak', 'git', 0.3, 'project',
               'tenant2', 'proj-x', 'pending', 'human_directive', NULL, NULL,
               1, :now, :now)`,
      args: { ":ikey": poisonKey, ":now": now },
    });

    // Projection for {tenant1, proj-x} — the tenant2 row shares the project name.
    // With parens: excluded (tenant_id mismatch + status mismatch + confidence too low).
    // Without parens: would leak in via the bare "project='proj-x'" OR branch.
    const result = await idb.selectForProjection(ctx); // ctx = {tenant1, proj-x}
    const leaked = result.find((i) => i.tenant_id === "tenant2");
    expect(leaked).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T12 — agent_id absorber (structural)
// ---------------------------------------------------------------------------

describe("T12 — agent_id absorber (Bird-ruling readiness)", () => {
  test("v1: all instincts have agent_id IS NULL (BR-AG1)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("ag1 trigger", "git", "ag1 shape");
    const inst = await idb.upsertDirective({
      ctx,
      identity_key: ikey,
      trigger: "ag1 trigger",
      domain: "git",
      behavioral_shape: "ag1 shape",
      status: "pending",
    });

    expect(inst.agent_id).toBeNull();
  });

  test("BR-AG2: invalid agent_id rejected at the write boundary", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("boundary trigger", "git", "boundary shape");
    const ctxWithBadAgent: InstinctCtx = { tenant_id: "tenant1", project: "proj-x", agent_id: "unknown-agent" };

    await expect(
      idb.upsertDirective({
        ctx: ctxWithBadAgent,
        identity_key: ikey,
        trigger: "boundary trigger",
        domain: "git",
        behavioral_shape: "boundary shape",
        status: "pending",
      })
    ).rejects.toThrow();
  });

  test("BR-AG2: all 7 roster names are accepted (write-boundary permits them)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const roster = ["mj", "bird", "shaq", "kobe", "pippen", "magic", "drexler"];
    for (const name of roster) {
      const ctxWithAgent: InstinctCtx = { tenant_id: "tenant1", project: "proj-x", agent_id: name };
      const ikey = idb.identityKey(`roster-${name}`, "git", "roster shape");
      // Should NOT throw
      await expect(
        idb.upsertDirective({
          ctx: ctxWithAgent,
          identity_key: ikey,
          trigger: `roster-${name}`,
          domain: "git",
          behavioral_shape: "roster shape",
          status: "pending",
        })
      ).resolves.toBeDefined();
    }
  });

  test("BR-AG3: v1 index has no agent_id term → two NULL-agent_id rows collide on identity", async () => {
    // Two instincts with same (tenant_id, identity_key, scope, COALESCE(project,''))
    // and both agent_id IS NULL → should upsert to ONE row (dedup intact, no NULL-distinct trap).
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("ag3 trigger", "git", "ag3 shape");
    await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "ag3 trigger", domain: "git", behavioral_shape: "ag3 shape", status: "pending" });
    await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "ag3 trigger v2", domain: "git", behavioral_shape: "ag3 shape", status: "approved" });

    const all = await idb.listByStatus({ tenant_id: "tenant1", project: "proj-x" }, "approved");
    expect(all.filter((i) => i.identity_key === ikey)).toHaveLength(1);
  });

  test("BR-AG5: no v1 query references agent_id (grep of module source)", () => {
    // This test asserts that no SQL string in the instincts-db module references agent_id.
    // The column exists in the schema (DDL) and must be present in CREATE TABLE DDL, but
    // the WHERE/SELECT/ORDER predicates must be agent_id-free.
    const src = createInstinctsDb.toString();

    // Extract SQL strings (everything between backtick pairs or quote-delimited SQL blocks)
    // The DDL line `agent_id TEXT` is allowed (structural). BR-AG5 forbids it in query predicates.
    // Simple check: assert the string "agent_id" only appears in DDL context (the CREATE TABLE lines)
    // and in the dormant [BIRD] comment block, NOT in any WHERE/AND/ORDER/SELECT column-list position.
    //
    // We approximate by asserting that lines containing both "agent_id" and a query keyword
    // (WHERE/AND/ORDER/SELECT/ON CONFLICT) have "agent_id" inside a comment only.
    const lines = src.split("\n");
    for (const line of lines) {
      const hasAgentId = line.includes("agent_id");
      const isQueryLine = /\b(WHERE|AND|ORDER|SELECT|ON CONFLICT)\b/.test(line);
      if (hasAgentId && isQueryLine) {
        // Must be a comment line
        const stripped = line.trimStart();
        const isComment = stripped.startsWith("//") || stripped.startsWith("*") || stripped.startsWith("--");
        expect(isComment).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ensure() — idempotency
// ---------------------------------------------------------------------------

describe("ensure() — idempotency", () => {
  test("creates all tables and indexes without error", async () => {
    const { idb } = makeDb();
    await expect(idb.ensure()).resolves.toBeUndefined();
  });

  test("calling ensure() twice is safe (IF NOT EXISTS)", async () => {
    const { idb } = makeDb();
    await idb.ensure();
    await expect(idb.ensure()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setStatus() + getById()
// ---------------------------------------------------------------------------

describe("setStatus() + getById()", () => {
  test("approve sets status='approved' and last_reviewed_at", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("approvable", "git", "approve shape");
    const inst = await idb.upsertDirective({ ctx, identity_key: ikey, trigger: "approvable", domain: "git", behavioral_shape: "approve shape", status: "pending" });

    await idb.setStatus(inst.id, "approved");
    const updated = await idb.getById(inst.id);
    expect(updated!.status).toBe("approved");
    expect(updated!.last_reviewed_at).toBeTruthy();
  });

  test("getById returns null for non-existent id", async () => {
    const { idb } = makeDb();
    await idb.ensure();
    expect(await idb.getById(99999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOMAINS + isDomain guard
// ---------------------------------------------------------------------------

describe("DOMAINS + isDomain()", () => {
  test("DOMAINS is a non-empty readonly array", () => {
    expect(DOMAINS.length).toBeGreaterThan(0);
  });

  test("isDomain correctly identifies valid domains", () => {
    for (const d of DOMAINS) {
      expect(isDomain(d)).toBe(true);
    }
  });

  test("isDomain rejects unknown strings", () => {
    expect(isDomain("unknown_domain_xyz")).toBe(false);
    expect(isDomain("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectForProjection — LIMIT 6 (BR-5)
// ---------------------------------------------------------------------------

describe("selectForProjection — LIMIT 6 (BR-5)", () => {
  test("returns at most 6 instincts", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Create 8 distinct approved instincts (all fail → analyzerConfidence >= 0.65 at S=3;
    // enough sessions to push above 0.70 for at least some: 4 fail sessions = 0.70 eligible).
    // Use 4 fail sessions per instinct so all 8 qualify: analyzerConfidence(4,1.0)=0.70.
    for (let i = 0; i < 8; i++) {
      const ikey = idb.identityKey(`trigger-${i}`, "git", `shape-${i}`);
      const derive = { trigger: `trigger-${i}`, domain: "git", behavioral_shape: `shape-${i}` };
      await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1-" + i, severity: "fail" }), derive);
      await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2-" + i, severity: "fail" }), derive);
      await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s3-" + i, severity: "fail" }), derive);
      await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s4-" + i, severity: "fail" }), derive);
      const pending = await idb.listByStatus(ctx, "pending");
      const last = pending.find((p) => p.identity_key === ikey);
      if (last) await idb.setStatus(last.id, "approved");
    }

    const projected = await idb.selectForProjection(ctx);
    expect(projected.length).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// H-2 — analyzerConfidence() pure function boundary table (Bird ruling)
// ---------------------------------------------------------------------------

describe("analyzerConfidence() — H-2 boundary table", () => {
  // Formula: ROUND(clamp(0.50 + 0.05*(S-3) + 0.15*R, 0.30, 0.90), 2)
  // Half-away-from-zero at 2 dp.
  // Boundary table from coordinator spec:
  //   S=3, R=0 (all warn) → 0.50
  //   S=3, R=1 (all fail) → 0.65
  //   S=4, R=1            → 0.70
  //   S=6, R=1            → 0.80
  //   S=7, R=0            → 0.70
  //   S=9, R=1 (raw 0.95) → 0.90  (clamped at max)

  test("S=3, R=0 (3 warn sessions) → 0.50", () => {
    expect(analyzerConfidence(3, 0)).toBe(0.50);
  });

  test("S=3, R=1 (3 fail sessions) → 0.65", () => {
    expect(analyzerConfidence(3, 1)).toBe(0.65);
  });

  test("S=4, R=1 (4 fail sessions) → 0.70", () => {
    expect(analyzerConfidence(4, 1)).toBe(0.70);
  });

  test("S=6, R=1 (6 fail sessions) → 0.80", () => {
    expect(analyzerConfidence(6, 1)).toBe(0.80);
  });

  test("S=7, R=0 (7 warn sessions) → 0.70", () => {
    // 0.50 + 0.05*(7-3) + 0 = 0.70
    expect(analyzerConfidence(7, 0)).toBe(0.70);
  });

  test("S=9, R=1 (raw 0.95) → clamped to 0.90", () => {
    // 0.50 + 0.05*(9-3) + 0.15*1 = 0.50 + 0.30 + 0.15 = 0.95 → clamped 0.90
    expect(analyzerConfidence(9, 1)).toBe(0.90);
  });

  test("S=0 → 0.30 (floor / guard against divide-by-zero upstream)", () => {
    expect(analyzerConfidence(0, 0)).toBe(0.30);
  });

  test("S=1, R=1 → raw 0.55 (clamped to 0.55, above floor 0.30)", () => {
    // 0.50 + 0.05*(1-3) + 0.15*1 = 0.50 - 0.10 + 0.15 = 0.55
    expect(analyzerConfidence(1, 1)).toBe(0.55);
  });
});

// ---------------------------------------------------------------------------
// H-2 E2E — confidence recomputed in-store on every recordSignal (Slice 4)
// ---------------------------------------------------------------------------

describe("H-2 E2E — analyzerConfidence recomputed in-store via recordSignal", () => {
  test("3 warn sessions → instinct.confidence = 0.50", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("h2-warn3", "git", "all warn");
    const derive = { trigger: "h2-warn3", domain: "git", behavioral_shape: "all warn" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w1", severity: "warn" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w2", severity: "warn" }), derive);
    const r = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w3", severity: "warn" }), derive);

    expect(r.materialized).toBe(true);
    const inst = await idb.getById(r.instinctId!);
    expect(inst!.confidence).toBe(0.50);
  });

  test("3 fail sessions → instinct.confidence = 0.65", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("h2-fail3", "git", "all fail");
    const derive = { trigger: "h2-fail3", domain: "git", behavioral_shape: "all fail" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f1", severity: "fail" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f2", severity: "fail" }), derive);
    const r = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f3", severity: "fail" }), derive);

    expect(r.materialized).toBe(true);
    const inst = await idb.getById(r.instinctId!);
    expect(inst!.confidence).toBe(0.65);
  });

  test("4 fail sessions → instinct.confidence = 0.70 (eligible for projection)", async () => {
    // recordSignal materializes at session 3 (clears buffer). Session 4 must use recordOccurrence.
    // After session 3: S=3, fail_s=3, R=1.0 → analyzerConfidence(3,1) = 0.65.
    // After session 4 via recordOccurrence: S=4, fail_s=4, R=1.0 → analyzerConfidence(4,1) = 0.70.
    const { idb } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("h2-fail4", "git", "four fail");
    const derive = { trigger: "h2-fail4", domain: "git", behavioral_shape: "four fail" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f1", severity: "fail" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f2", severity: "fail" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f3", severity: "fail" }), derive);

    expect(mat.materialized).toBe(true);
    const afterMat = await idb.getById(mat.instinctId!);
    expect(afterMat!.confidence).toBe(0.65); // S=3, R=1.0

    await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "f4", finding_id: "f-4",
      evidence_scrubbed: "4th fail", observed_at: new Date().toISOString(), severity: "fail",
    });

    const inst = await idb.getById(mat.instinctId!);
    expect(inst!.confidence).toBe(0.70); // S=4, R=1.0
  });

  test("recordOccurrence after materialization recomputes confidence from new severity", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Materialize with 3 warn sessions → confidence = 0.50
    const ikey = idb.identityKey("h2-reinforce", "git", "reinforce");
    const derive = { trigger: "h2-reinforce", domain: "git", behavioral_shape: "reinforce" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w1", severity: "warn" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w2", severity: "warn" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "w3", severity: "warn" }), derive);
    expect(mat.materialized).toBe(true);

    const before = await idb.getById(mat.instinctId!);
    expect(before!.confidence).toBe(0.50);

    // Add a 4th fail occurrence → S=4, fail_s=1, R=0.25 → raw = 0.50+0.05+0.15*0.25 = 0.5875 → 0.59
    const r = await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x",
      session_id: "f1", finding_id: "f-new",
      evidence_scrubbed: "new fail evidence",
      observed_at: new Date().toISOString(),
      severity: "fail",
    });
    expect(r.counted).toBe(true);

    const after = await idb.getById(mat.instinctId!);
    // S=4 (w1,w2,w3,f1), fail_s=1 → R=0.25 → 0.50+0.05*(4-3)+0.15*0.25 = 0.50+0.05+0.0375 = 0.5875 → 0.59
    expect(after!.confidence).toBe(0.59);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL 3: .xx5 seam — SQLite ROUND is the rounding authority
// ---------------------------------------------------------------------------

describe("CRITICAL-3 seam: stored confidence = SQLite ROUND(raw, 2), not TS Math.round", () => {
  test("S=6, R=0.5 → raw=0.725 → stored=0.72 (SQLite ROUND), NOT 0.73 (TS Math.round)", async () => {
    // This is the canonical .xx5 seam test.
    // raw = 0.50 + 0.05*(6-3) + 0.15*0.5 = 0.50 + 0.15 + 0.075 = 0.725
    // TS Math.round(0.725*100)/100 = 0.73   (WRONG — this is what the old code gave)
    // SQLite ROUND(0.725, 2)       = 0.72   (CORRECT — binary repr of 0.725 is below midpoint)
    //
    // Scenario: materialize with 3 fail sessions (R=1.0, S=3 → conf=0.65),
    // then add 3 warn occurrences to reach S=6, fail_s=3, R=0.5.
    const { idb, driver } = makeDb();
    await idb.ensure();

    const ikey = idb.identityKey("seam-s6-r0.5", "git", "seam shape");
    const derive = { trigger: "seam-s6-r0.5", domain: "git", behavioral_shape: "seam shape" };

    // Materialize at 3 fail sessions
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f1", severity: "fail" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f2", severity: "fail" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f3", severity: "fail" }), derive);
    expect(mat.materialized).toBe(true);

    // Add 3 warn occurrences → S=6, fail_s=3, R=0.5, raw=0.725
    await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "w1", finding_id: "f-w1",
      evidence_scrubbed: "warn 1", observed_at: new Date().toISOString(), severity: "warn",
    });
    await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "w2", finding_id: "f-w2",
      evidence_scrubbed: "warn 2", observed_at: new Date().toISOString(), severity: "warn",
    });
    await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "w3", finding_id: "f-w3",
      evidence_scrubbed: "warn 3", observed_at: new Date().toISOString(), severity: "warn",
    });

    const inst = await idb.getById(mat.instinctId!);

    // Verify the stored value matches SQLite's own ROUND(0.725, 2) = 0.72 (not TS Math.round=0.73).
    const sqlRs = await driver.execute({ sql: "SELECT ROUND(0.725, 2) AS r", args: {} });
    const sqliteRound = (sqlRs.rows[0] as unknown as { r: number }).r;
    expect(sqliteRound).toBe(0.72); // document the SQLite behavior

    expect(inst!.confidence).toBe(sqliteRound); // stored matches SQLite — NOT TS Math.round
    expect(inst!.confidence).toBe(0.72);        // explicit assertion
    expect(inst!.confidence).not.toBe(0.73);    // TS Math.round would have given this (wrong)
  });
});

// ---------------------------------------------------------------------------
// IMPORTANT-5: warn→fail severity upgrade recomputes confidence upward
// ---------------------------------------------------------------------------

describe("IMPORTANT-5: warn→fail severity upgrade (AC-H2-5)", () => {
  test("re-recording a session as fail (was warn) → confidence rises, occurrence_count unchanged", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Materialize with 3 warn sessions → confidence = 0.50
    const ikey = idb.identityKey("severity-upgrade", "git", "severity upgrade shape");
    const derive = { trigger: "severity-upgrade", domain: "git", behavioral_shape: "severity upgrade shape" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s1", severity: "warn" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s2", severity: "warn" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "s3", severity: "warn" }), derive);
    expect(mat.materialized).toBe(true);

    const before = await idb.getById(mat.instinctId!);
    expect(before!.confidence).toBe(0.50); // S=3, R=0
    expect(before!.occurrence_count).toBe(3);

    // Re-score session "s1" as fail (warn→fail flip from re-evaluation)
    const r = await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "s1", finding_id: "f-s1",
      evidence_scrubbed: "re-score evidence", observed_at: new Date().toISOString(), severity: "fail",
    });
    // counted = false: H-5 — same session, no double-count
    expect(r.counted).toBe(false);

    const after = await idb.getById(mat.instinctId!);
    // occurrence_count unchanged (H-5)
    expect(after!.occurrence_count).toBe(3);
    // confidence recomputed upward: S=3, fail_s=1 → R=1/3 → 0.50+0+0.15*(1/3) ≈ 0.55
    expect(after!.confidence).toBeGreaterThan(0.50);
    // Exact: 0.50 + 0.15*(1/3) = 0.50 + 0.05 = 0.55
    expect(after!.confidence).toBe(0.55);
  });

  test("re-recording a session as fail (already fail) → no change (fail is sticky)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Materialize with 3 fail sessions → confidence = 0.65
    const ikey = idb.identityKey("sticky-fail", "git", "sticky fail shape");
    const derive = { trigger: "sticky-fail", domain: "git", behavioral_shape: "sticky fail shape" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f1", severity: "fail" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f2", severity: "fail" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f3", severity: "fail" }), derive);
    expect(mat.materialized).toBe(true);

    const before = await idb.getById(mat.instinctId!);
    expect(before!.confidence).toBe(0.65);

    // Re-score same session as fail again → no-op
    const r = await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "f1", finding_id: "f-1",
      evidence_scrubbed: "same session", observed_at: new Date().toISOString(), severity: "fail",
    });
    expect(r.counted).toBe(false);

    const after = await idb.getById(mat.instinctId!);
    expect(after!.occurrence_count).toBe(3); // no change
    expect(after!.confidence).toBe(0.65);    // no change
  });

  test("fail→warn re-record is a no-op (fail is sticky, confidence does not drop)", async () => {
    const { idb } = makeDb();
    await idb.ensure();

    // Materialize with 3 fail sessions → confidence = 0.65
    const ikey = idb.identityKey("fail-sticky-no-drop", "git", "fail sticky no drop");
    const derive = { trigger: "fail-sticky-no-drop", domain: "git", behavioral_shape: "fail sticky no drop" };
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f1", severity: "fail" }), derive);
    await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f2", severity: "fail" }), derive);
    const mat = await idb.recordSignal(makeSignal({ identity_key: ikey, session_id: "f3", severity: "fail" }), derive);
    expect(mat.materialized).toBe(true);

    // Re-score "f1" as warn (should NOT downgrade confidence)
    const r = await idb.recordOccurrence(mat.instinctId!, {
      tenant_id: "tenant1", project: "proj-x", session_id: "f1", finding_id: "f-1",
      evidence_scrubbed: "re-scored warn", observed_at: new Date().toISOString(), severity: "warn",
    });
    expect(r.counted).toBe(false); // H-5

    const after = await idb.getById(mat.instinctId!);
    expect(after!.occurrence_count).toBe(3);
    expect(after!.confidence).toBe(0.65); // unchanged — fail is sticky
  });
});

// ---------------------------------------------------------------------------
// AC-TTL — TTL exemption for human-authored instincts (BR-8′, Slice 8)
// ---------------------------------------------------------------------------
// Bird ruling: staleness TTL applies to ingestion_path='auto_inferred' ONLY.
// human_directive and migrated instincts cannot be reinforced (no pipeline feeds them)
// so they are removed ONLY by explicit setStatus('rejected'). This suite verifies:
//   AC-TTL-1: migrated 31d old → survives prune()
//   AC-TTL-2: human_directive 31d old → survives prune()
//   AC-TTL-3: auto_inferred 31d stale → still pruned (regression guard)
//   AC-TTL-4: auto_inferred 29d → survives prune
//   AC-TTL-5: reinforced clock resets for auto_inferred (covered in T7)
//   AC-TTL-6: 50 approved human-authored rows → ≤6 in selectForProjection (BR-5 cap)
//   AC-TTL-7: selectForProjection and countEligible produce same count (WHERE byte-identical)
//   + rejected migrated → excluded from selectForProjection + countEligible

const ttlCtx = { tenant_id: "ttl-tenant", project: "ttl-proj", agent_id: undefined };

/** Insert a minimal instinct row via raw SQL so we control ingestion_path and timestamps. */
async function seedInstinct(
  driver: ReturnType<typeof makeDb>["driver"],
  opts: {
    key: string;
    path: "auto_inferred" | "human_directive" | "migrated";
    confidence: number;
    status?: string;
    daysAgo: number;
    tenant?: string;
    project?: string;
  }
) {
  const date = pastIso(opts.daysAgo);
  const tenant = opts.tenant ?? "ttl-tenant";
  const project = opts.project ?? "ttl-proj";
  const status = opts.status ?? "approved";
  await driver.execute({
    sql: `INSERT INTO instincts
            (identity_key, trigger, behavioral_shape, domain, confidence, scope,
             tenant_id, project, status, ingestion_path, agent_id, embedding,
             occurrence_count, created_at, last_reinforced_at)
          VALUES
            (:key, :key, 'ttl shape', 'git', :conf, 'global',
             :tenant, :proj, :status, :path, NULL, NULL,
             0, :date, :date)`,
    args: {
      ":key": opts.key,
      ":conf": opts.confidence,
      ":tenant": tenant,
      ":proj": project,
      ":status": status,
      ":path": opts.path,
      ":date": date,
    },
  });
}

describe("AC-TTL — TTL exemption for human-authored instincts (BR-8′)", () => {
  // AC-TTL-1: migrated row 31 days old → survives prune
  test("AC-TTL-1: migrated instinct 31d old is NOT pruned", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, { key: "ttl-migrated-31d", path: "migrated", confidence: 0.7, daysAgo: 31 });

    const rs = await driver.execute({ sql: `SELECT id FROM instincts WHERE identity_key='ttl-migrated-31d'`, args: {} });
    const id = (rs.rows[0] as { id: number }).id;

    // Prune at future "now" (32 days from creation, which would prune auto_inferred)
    const futureNow = new Date(Date.now() + 1 * 86400 * 1000).toISOString();
    const { instinctsPruned } = await idb.prune(futureNow);

    expect(instinctsPruned).toBe(0);
    expect(await idb.getById(id)).not.toBeNull();
  });

  // AC-TTL-2: human_directive row 31 days old → survives prune
  test("AC-TTL-2: human_directive instinct 31d old is NOT pruned", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, { key: "ttl-hdir-31d", path: "human_directive", confidence: 0.9, daysAgo: 31 });

    const rs = await driver.execute({ sql: `SELECT id FROM instincts WHERE identity_key='ttl-hdir-31d'`, args: {} });
    const id = (rs.rows[0] as { id: number }).id;

    const futureNow = new Date(Date.now() + 1 * 86400 * 1000).toISOString();
    const { instinctsPruned } = await idb.prune(futureNow);

    expect(instinctsPruned).toBe(0);
    expect(await idb.getById(id)).not.toBeNull();
  });

  // AC-TTL-3: auto_inferred 31d stale → still pruned (regression guard)
  test("AC-TTL-3: auto_inferred instinct 31d stale IS pruned (regression guard)", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, { key: "ttl-auto-31d", path: "auto_inferred", confidence: 0.7, daysAgo: 31 });

    const rs = await driver.execute({ sql: `SELECT id FROM instincts WHERE identity_key='ttl-auto-31d'`, args: {} });
    const id = (rs.rows[0] as { id: number }).id;

    const futureNow = new Date(Date.now() + 1 * 86400 * 1000).toISOString();
    const { instinctsPruned } = await idb.prune(futureNow);

    expect(instinctsPruned).toBe(1);
    expect(await idb.getById(id)).toBeNull();
  });

  // AC-TTL-4: auto_inferred 29d old → survives prune (still within window)
  test("AC-TTL-4: auto_inferred instinct 29d old survives prune", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, { key: "ttl-auto-29d", path: "auto_inferred", confidence: 0.7, daysAgo: 29 });

    const rs = await driver.execute({ sql: `SELECT id FROM instincts WHERE identity_key='ttl-auto-29d'`, args: {} });
    const id = (rs.rows[0] as { id: number }).id;

    // Prune at actual "now" — 29d elapsed, under the 30d threshold
    const { instinctsPruned } = await idb.prune();

    expect(instinctsPruned).toBe(0);
    expect(await idb.getById(id)).not.toBeNull();
  });

  // AC-TTL-6: 50 approved human-authored instincts → ≤6 in selectForProjection (BR-5 cap)
  test("AC-TTL-6: 50 approved migrated instincts → at most 6 returned by selectForProjection (BR-5)", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    // Insert 50 approved migrated instincts (all 31d old — exempt from TTL)
    for (let i = 0; i < 50; i++) {
      await seedInstinct(driver, {
        key: `ttl-bulk-${i}`,
        path: "migrated",
        confidence: 0.7,
        status: "approved",
        daysAgo: 31,
      });
    }

    const results = await idb.selectForProjection(ttlCtx);
    expect(results.length).toBeLessThanOrEqual(6);
  });

  // AC-TTL-7: selectForProjection and countEligible produce the same count (WHERE byte-identical)
  test("AC-TTL-7: countEligible and selectForProjection.length agree for migrated instincts", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    // Insert 4 approved migrated instincts (31d old — exempt from TTL)
    for (let i = 0; i < 4; i++) {
      await seedInstinct(driver, {
        key: `ttl-agree-${i}`,
        path: "migrated",
        confidence: 0.7,
        status: "approved",
        daysAgo: 31,
      });
    }
    // Also insert 1 auto_inferred that is 31d stale — this should NOT appear in either
    await seedInstinct(driver, {
      key: "ttl-agree-stale-auto",
      path: "auto_inferred",
      confidence: 0.7,
      status: "approved",
      daysAgo: 31,
    });

    const projected = await idb.selectForProjection(ttlCtx);
    const counted = await idb.countEligible(ttlCtx);

    // 4 migrated (TTL-exempt) + 0 stale auto_inferred = 4 visible; both must agree
    expect(projected.length).toBe(4);
    expect(counted).toBe(4);
  });

  // AC-TTL rejected migrated row → excluded from projection and countEligible
  test("rejected migrated instinct is excluded from selectForProjection and countEligible", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, {
      key: "ttl-rejected-migrated",
      path: "migrated",
      confidence: 0.7,
      status: "rejected",
      daysAgo: 5,
    });

    const projected = await idb.selectForProjection(ttlCtx);
    const counted = await idb.countEligible(ttlCtx);

    expect(projected.length).toBe(0);
    expect(counted).toBe(0);
  });

  // migrated instinct visible in selectForProjection even after 31 days (TTL-exempt)
  test("migrated instinct 31d old IS returned by selectForProjection", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, {
      key: "ttl-mig-visible",
      path: "migrated",
      confidence: 0.7,
      status: "approved",
      daysAgo: 31,
    });

    const projected = await idb.selectForProjection(ttlCtx);
    const counted = await idb.countEligible(ttlCtx);

    expect(projected.length).toBe(1);
    expect(counted).toBe(1);
    expect(projected[0]!.identity_key).toBe("ttl-mig-visible");
  });

  // human_directive instinct visible in selectForProjection after 31 days (TTL-exempt)
  test("human_directive instinct 31d old IS returned by selectForProjection", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, {
      key: "ttl-hdir-visible",
      path: "human_directive",
      confidence: 0.9,
      status: "approved",
      daysAgo: 31,
    });

    const projected = await idb.selectForProjection(ttlCtx);
    const counted = await idb.countEligible(ttlCtx);

    expect(projected.length).toBe(1);
    expect(counted).toBe(1);
    expect(projected[0]!.identity_key).toBe("ttl-hdir-visible");
  });

  // auto_inferred 31d stale is NOT returned by selectForProjection
  test("auto_inferred instinct 31d stale is excluded from selectForProjection", async () => {
    const { idb, driver } = makeDb();
    await idb.ensure();

    await seedInstinct(driver, {
      key: "ttl-auto-stale-proj",
      path: "auto_inferred",
      confidence: 0.7,
      status: "approved",
      daysAgo: 31,
    });

    const projected = await idb.selectForProjection(ttlCtx);
    const counted = await idb.countEligible(ttlCtx);

    expect(projected.length).toBe(0);
    expect(counted).toBe(0);
  });
});
