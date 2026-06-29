/**
 * instincts-db.ts — InstinctsDb: tier-2 shareable-instinct repository.
 *
 * Tables owned: instincts, signals_buffer, instinct_occurrences.
 *
 * Key invariants:
 *   BR-1:    auto-inferred instinct requires COUNT(DISTINCT session_id) >= 3.
 *   BR-1a:   human-directive needs n=1, confidence fixed 0.9.
 *   BR-3:    new auto instincts start scope='project'.
 *   BR-4:    injection only for ROUND(confidence,2) >= 0.7 (H-3).
 *   BR-5:    ≤6 instincts per projection (LIMIT 6).
 *   BR-6:    project instinct wins over same-pattern global (dedup_rank window fn).
 *   BR-8:    prune after 30 days unreinforced/unreviewed; scoped_facts UNTOUCHED.
 *   BR-9:    shareable tier ONLY; scrub applied upstream before calling these methods.
 *   BR-13:   never inject unapproved instinct.
 *   BR-AG1:  all v1 instincts are team-wide (agent_id IS NULL).
 *   BR-AG2:  agent_id write boundary: only roster names allowed (forward-compat guard).
 *   BR-AG5:  no v1 query references the agent_id column.
 *
 * Confidence rules (scoped cleanly per ingestion path — BR-2 applies to LIVE paths only):
 *   auto_inferred  → recomputed via analyzerConfidence() from S/R occurrence statistics.
 *   human_directive → fixed 0.9 (BR-1a). Only the LIVE human-directive write path uses 0.9.
 *   migrated       → fixed 0.7 (Bird ruling: no occurrences/sessions available; injection-
 *                    eligible at minimum threshold). NOT 0.9. NOT analyzerConfidence().
 *                    importMigrated() enforces this; no other path may write ingestion_path='migrated'.
 *   H-1:     identity_key = sha256_hex(norm(trigger) + "\x1f" + domain + "\x1f" + norm(shape)).
 *   H-3:     ROUND(confidence,2) before every float compare.
 *   H-5:     1-session-≤-1-occurrence enforced by UNIQUE index on instinct_occurrences.
 *
 * Depends ONLY on the db-driver seam. No bun:sqlite imports.
 * All compute (identity_key, confidence, now) is done BEFORE opening any transaction.
 */

import { getDriver, DRIVER_ERROR_CODES, DbDriverError } from "./db-driver.ts";
import type { Driver, DriverTx } from "./db-driver.ts";

// ---------------------------------------------------------------------------
// Domain vocabulary (TS-validated, not SQL CHECK — lets vocab grow without migration)
// ---------------------------------------------------------------------------

export const DOMAINS = [
  "code_quality",
  "code_review",
  "testing",
  "debugging",
  "architecture",
  "communication",
  "git",
  "tooling",
  "performance",
  "security",
  "process",
  "documentation",
] as const;

export type Domain = (typeof DOMAINS)[number];

export function isDomain(v: string): v is Domain {
  return (DOMAINS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Agent-id write boundary (BR-AG2 — invariant; forward-compat guard even for v1)
// ---------------------------------------------------------------------------

const ROSTER = new Set(["mj", "bird", "shaq", "kobe", "pippen", "magic", "drexler"]);

function assertValidAgentId(agent_id?: string | null): void {
  if (agent_id != null && !ROSTER.has(agent_id)) {
    throw new Error(
      `agent_id '${agent_id}' is not in the Dream Team roster. ` +
        `Allowed: ${[...ROSTER].join(", ")}.`
    );
  }
}

// ---------------------------------------------------------------------------
// H-2: analyzerConfidence — deterministic confidence derivation (BR-2)
// ---------------------------------------------------------------------------

/**
 * Derive the RAW clamped confidence for auto-inferred instincts from the occurrence set.
 *
 * Formula (Bird ruling, locked):
 *   raw     = 0.50 + 0.05 * (S - 3) + 0.15 * R
 *   clamped = clamp(raw, 0.30, 0.90)
 *   stored  = ROUND(clamped, 2)   — **rounding is done IN SQL (ROUND(:raw, 2)), not here**
 *
 * WHY SQL ROUND? IEEE 754 `Math.round(0.725*100)/100 = 0.73` but SQLite
 * `ROUND(0.725, 2) = 0.72` (binary representation of 0.725 is slightly < midpoint).
 * Making SQL the single rounding authority keeps the stored value consistent with
 * every SQLite expression that reads `confidence` (projection ROUND(confidence,2)>=0.7,
 * future ROUND(AVG(confidence),2)>=0.8 promotion threshold, etc.).
 *
 * This function therefore returns the RAW clamped value — callers pass it as `:raw`
 * in `confidence = ROUND(:raw, 2)`.
 *
 * @param S  Distinct session count in instinct_occurrences (≥ 3 at materialization).
 * @param R  Fail-session fraction: COUNT(sessions whose severity='fail') / S ∈ [0,1].
 *
 * Boundary table (Bird H-2) — raw clamped values (SQL ROUND gives same 2-dp result
 * for all values in this table because they are already at 2 dp or hit the clamp):
 *   S=3, R=0 (all warn) → 0.50
 *   S=3, R=1 (all fail) → 0.65
 *   S=4, R=1            → 0.70
 *   S=6, R=1            → 0.80
 *   S=7, R=0            → 0.70
 *   S=9, R=1 (raw 0.95) → 0.90  (clamped at max)
 * .xx5 seam (S=6, R=0.5 → raw=0.725):
 *   TS Math.round gives 0.73; SQLite ROUND gives 0.72. SQL wins — do not round here.
 *
 * Model-supplied confidence is IGNORED (H-2 — attacker-influenceable via transcript).
 * This is a pure TS function with a single call site (keep swap-cost low for v1.1 tuning).
 */
export function analyzerConfidence(S: number, R: number): number {
  if (S <= 0) return 0.30;
  const raw = 0.50 + 0.05 * (S - 3) + 0.15 * R;
  const clamped = Math.min(0.90, Math.max(0.30, raw));
  // 10-dp normalization removes floating-point arithmetic noise
  // (e.g., 0.05+0.15 = 0.7000000000000001 → 0.7) without hiding meaningful
  // .xx5 seam values (0.725 stays 0.725, not rounded to 0.73).
  // SQL ROUND(:raw, 2) is the FINAL 2-dp rounding authority.
  // DO NOT use Math.round(x*100)/100 here — that gives 0.73 for raw=0.725
  // while SQLite ROUND(0.725, 2) = 0.72 (binary repr of 0.725 is below midpoint).
  return Math.round(clamped * 1e10) / 1e10;
}

// ---------------------------------------------------------------------------
// H-1: identity_key normalisation
// ---------------------------------------------------------------------------

/** NFKC → lowercase → collapse internal whitespace → trim. */
function norm(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Caller context for tier-2 queries. */
export interface InstinctCtx {
  tenant_id: string;
  project: string | null;
  agent_id?: string | null; // [BIRD] dormant in v1; validated but not stored (BR-AG1/AG5)
}

export interface SignalInput {
  identity_key: string;
  tenant_id: string;
  project: string | null;
  session_id: string;
  finding_id: string;
  evidence_scrubbed: string;
  observed_at: string;
  /** Session-level severity from the judge finding (H-2 confidence derivation). */
  severity: "warn" | "fail";
}

/** Mirrors the instincts DDL (§1.2 + §4 addenda). All columns, typed. */
export interface Instinct {
  id: number;
  identity_key: string;
  trigger: string;
  behavioral_shape: string;
  domain: string;
  confidence: number;
  scope: "project" | "global";
  tenant_id: string;
  project: string | null;
  status: "pending" | "approved" | "rejected";
  ingestion_path: "auto_inferred" | "human_directive" | "migrated";
  agent_id: string | null;
  embedding: Uint8Array | null;
  occurrence_count: number;
  created_at: string;
  last_reinforced_at: string;
  last_reviewed_at: string | null;
  promoted_at: string | null;
  /** BR-13a audit: the suggestion text presented to the human before they authored the directive. */
  suggested_content: string | null;
}

export interface InstinctsDb {
  /** Idempotent DDL: CREATE TABLE IF NOT EXISTS + CREATE [UNIQUE] INDEX IF NOT EXISTS. */
  ensure(): Promise<void>;

  /**
   * H-1 pure function — exported for unit testing.
   * sha256_hex( norm(trigger) + "\x1f" + domain + "\x1f" + norm(behavioral_shape) )
   * "\x1f" (ASCII Unit Separator) prevents concatenation-collision.
   */
  identityKey(trigger: string, domain: string, behavioral_shape: string): string;

  /**
   * AUTO path (BR-1). Steps:
   * 1. INSERT OR IGNORE into signals_buffer with s.severity (UNIQUE on identity+tenant+project+session → H-5).
   * 2. COUNT(DISTINCT session_id) for this identity in the buffer.
   * 3. If < 3: return { materialized: false }.
   * 4. If >= 3: ONE transaction:
   *    a. Upsert instinct (status='pending', ingestion_path='auto_inferred').
   *    b. INSERT OR IGNORE occurrences from buffer (copies severity, H-5 dedup).
   *    c. DELETE buffer rows for this identity.
   *    d. Recompute confidence from instinct_occurrences (S, R = fail_s/S → analyzerConfidence).
   *    e. UPDATE occurrence_count + confidence (authoritative, never delta-increment, time-independent).
   *
   * NOTE: confidence is NOT passed in `derive` — it is always recomputed in-store.
   */
  recordSignal(
    s: SignalInput,
    derive: { trigger: string; domain: string; behavioral_shape: string }
  ): Promise<{ materialized: boolean; instinctId?: number }>;

  /**
   * Post-materialization reinforcement. INSERT OR IGNORE occurrence (UNIQUE guard H-5).
   * Bumps occurrence_count + last_reinforced_at ONLY when rowsAffected === 1.
   */
  recordOccurrence(
    instinctId: number,
    occ: Omit<SignalInput, "identity_key">
  ): Promise<{ counted: boolean }>;

  /**
   * DIRECTIVE path (BR-1a). confidence=0.9, ingestion_path='human_directive'.
   * Supersede-on-upsert via ux_instincts_identity. Status from caller ('approved' on
   * confirm keystroke; 'pending' for unconfirmed candidates — BR-13).
   * suggested_content: the suggestion text shown to the human (BR-13a audit trail).
   */
  upsertDirective(i: {
    ctx: InstinctCtx;
    identity_key: string;
    trigger: string;
    domain: string;
    behavioral_shape: string;
    status: "pending" | "approved";
    suggested_content?: string | null;
  }): Promise<Instinct>;

  /**
   * MIGRATED path (Bird ruling — Slice 8). Used by import-file-memory.ts ONLY.
   * confidence=0.7 FIXED (minimum injection-eligible; migrated has no S/R occurrence set).
   * ingestion_path='migrated'. status='approved' (already curated by human in file memory).
   * agent_id=NULL (BR-AG1/BR-MIG-10 — all v1 migrated instincts are team-wide).
   * occurrence_count=0 (no signal data available).
   *
   * Supersede-on-upsert via ux_instincts_identity by identity_key — idempotent on re-run.
   * Caller MUST compute identity_key via idb.identityKey(trigger, domain, behavioral_shape)
   * before calling this method (same pattern as upsertDirective).
   *
   * Confidence scoping: 0.7 is ONLY for migrated. It does NOT affect the human_directive path
   * (which fixes 0.9) nor the auto_inferred path (which recomputes via analyzerConfidence).
   */
  importMigrated(i: {
    ctx: InstinctCtx;
    identity_key: string;
    trigger: string;
    domain: string;
    behavioral_shape: string;
    suggested_content?: string | null;
  }): Promise<Instinct>;

  /** Approve or reject. Sets status + last_reviewed_at = now. */
  setStatus(id: number, status: "approved" | "rejected"): Promise<void>;

  /**
   * §3.3 LOCKED projection SQL — copy verbatim.
   * Parentheses around (scope='global' OR project=:project) are load-bearing (AC-8).
   * Agent-id hook is DORMANT (comment only) per BR-AG5.
   */
  selectForProjection(ctx: InstinctCtx): Promise<Instinct[]>;

  /**
   * BR-8 TTL prune (global call). Deletes instincts with
   * MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at)) > 30d ago.
   * Then prunes orphan signals_buffer rows older than 30d.
   * scoped_facts are UNTOUCHED (different store).
   *
   * @param nowIso Optional ISO-8601 string for "now" — used in tests for time travel.
   */
  prune(nowIso?: string): Promise<{ instinctsPruned: number; bufferPruned: number }>;

  /** CLI list/approve/reject — tenant-bound. */
  listByStatus(ctx: InstinctCtx, status: Instinct["status"]): Promise<Instinct[]>;

  /** Lookup by id. Returns null if not found. */
  getById(id: number): Promise<Instinct | null>;

  /**
   * COUNT of projection-eligible instincts for the ctx (status='approved', ROUND(conf,2)>=0.7,
   * not expired). Uses the same WHERE clause as selectForProjection (minus LIMIT 6) so the
   * capacity counter is consistent with what would be projected.
   * Used by memory-projection.ts for the >500 soft-log (no LIMIT — counts the total, not top-6).
   */
  countEligible(ctx: InstinctCtx): Promise<number>;
}

export function createInstinctsDb(driver?: Driver): InstinctsDb {
  const db = driver ?? getDriver();

  return {
    async ensure() {
      await db.batch(
        [
          // ----------------------------------------------------------------
          // instincts — tier-2 shareable
          // ----------------------------------------------------------------
          `CREATE TABLE IF NOT EXISTS instincts (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            identity_key       TEXT NOT NULL,
            trigger            TEXT NOT NULL,
            behavioral_shape   TEXT NOT NULL,
            domain             TEXT NOT NULL,
            confidence         REAL NOT NULL CHECK (confidence >= 0.3 AND confidence <= 0.9),
            scope              TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project','global')),
            tenant_id          TEXT NOT NULL,
            project            TEXT,
            status             TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','approved','rejected')),
            ingestion_path     TEXT NOT NULL
                                    CHECK (ingestion_path IN ('auto_inferred','human_directive','migrated')),
            agent_id           TEXT,
            embedding          BLOB,
            occurrence_count   INTEGER NOT NULL DEFAULT 0,
            created_at         TEXT NOT NULL,
            last_reinforced_at TEXT NOT NULL,
            last_reviewed_at   TEXT,
            promoted_at        TEXT,
            suggested_content  TEXT
          )`,
          // Named UNIQUE INDEX — v1 form; Bird ruling swaps to 5-column form
          // by DROP + CREATE (no ALTER TABLE, no data migration) per §1.5.
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_instincts_identity
            ON instincts (tenant_id, identity_key, scope, COALESCE(project,''))`,
          // [BIRD] IF agent_id enters the key, REPLACE the index above with:
          //   CREATE UNIQUE INDEX ux_instincts_identity
          //     ON instincts (tenant_id, identity_key, scope, COALESCE(project,''), COALESCE(agent_id,'*'))
          `CREATE INDEX IF NOT EXISTS ix_instincts_selection
            ON instincts (status, confidence, last_reinforced_at)`,
          `CREATE INDEX IF NOT EXISTS ix_instincts_identity_key
            ON instincts (identity_key)`,

          // ----------------------------------------------------------------
          // signals_buffer — sub-threshold staging (NO FK on instincts)
          // ----------------------------------------------------------------
          `CREATE TABLE IF NOT EXISTS signals_buffer (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            identity_key      TEXT NOT NULL,
            tenant_id         TEXT NOT NULL,
            project           TEXT,
            session_id        TEXT NOT NULL,
            finding_id        TEXT NOT NULL,
            evidence_scrubbed TEXT NOT NULL,
            observed_at       TEXT NOT NULL,
            severity          TEXT NOT NULL CHECK(severity IN ('warn','fail'))
          )`,
          // UNIQUE: one row per (identity, tenant, project, session) → feeds COUNT(DISTINCT session).
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_signals_buffer_session
            ON signals_buffer (identity_key, tenant_id, COALESCE(project,''), session_id)`,
          `CREATE INDEX IF NOT EXISTS ix_signals_buffer_identity
            ON signals_buffer (identity_key, tenant_id)`,

          // ----------------------------------------------------------------
          // instinct_occurrences — post-materialization evidence (FK valid)
          // ----------------------------------------------------------------
          `CREATE TABLE IF NOT EXISTS instinct_occurrences (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            instinct_id       INTEGER NOT NULL REFERENCES instincts(id) ON DELETE CASCADE,
            tenant_id         TEXT NOT NULL,
            project           TEXT,
            session_id        TEXT NOT NULL,
            finding_id        TEXT NOT NULL,
            evidence_scrubbed TEXT NOT NULL,
            observed_at       TEXT NOT NULL,
            severity          TEXT NOT NULL CHECK(severity IN ('warn','fail'))
          )`,
          // H-5: 1-session-≤-1-occurrence; blocks double-count on re-score.
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_occurrences_session
            ON instinct_occurrences (instinct_id, COALESCE(project,''), session_id)`,
          `CREATE INDEX IF NOT EXISTS ix_occurrences_instinct
            ON instinct_occurrences (instinct_id)`,
        ],
        "write"
      );
    },

    identityKey(trigger, domain, behavioral_shape) {
      // H-1: sha256_hex( norm(trigger) + "\x1f" + domain + "\x1f" + norm(behavioral_shape) )
      // "\x1f" (ASCII Unit Separator) is load-bearing — prevents concatenation collision.
      // domain is already canonical (bounded enum) — joined as-is without normalisation.
      const payload = `${norm(trigger)}\x1f${domain}\x1f${norm(behavioral_shape)}`;
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(payload);
      return hasher.digest("hex");
    },

    async recordSignal(s, derive) {
      // Compute NOW before any DB operation (single-flight rule: no non-DB awaits inside tx).
      const now = new Date().toISOString();

      // Step 1: INSERT OR IGNORE signal into buffer (includes severity for H-2 derivation).
      // UNIQUE on (identity_key, tenant_id, COALESCE(project,''), session_id) enforces H-5:
      // one buffer row per (identity, session) — a duplicate same-session signal is a no-op.
      await db.execute({
        sql: `INSERT OR IGNORE INTO signals_buffer
                (identity_key, tenant_id, project, session_id, finding_id, evidence_scrubbed, observed_at, severity)
              VALUES
                (:identity_key, :tenant_id, :project, :session_id, :finding_id, :evidence_scrubbed, :observed_at, :severity)`,
        args: {
          ":identity_key": s.identity_key,
          ":tenant_id": s.tenant_id,
          ":project": s.project,
          ":session_id": s.session_id,
          ":finding_id": s.finding_id,
          ":evidence_scrubbed": s.evidence_scrubbed,
          ":observed_at": s.observed_at,
          ":severity": s.severity,
        },
      });

      // Step 2: Count distinct sessions for this identity in the buffer (BR-1 threshold).
      const countRs = await db.execute({
        sql: `SELECT COUNT(DISTINCT session_id) AS n
              FROM signals_buffer
              WHERE identity_key = :identity_key
                AND tenant_id = :tenant_id
                AND COALESCE(project,'') = COALESCE(:project,'')`,
        args: {
          ":identity_key": s.identity_key,
          ":tenant_id": s.tenant_id,
          ":project": s.project,
        },
      });

      const n = (countRs.rows[0] as unknown as { n: number }).n;
      if (n < 3) return { materialized: false };

      // Step 3: Materialize in ONE transaction (BR-1).
      // H-2: confidence is NOT supplied by caller — always computed in-store from occurrence set.
      let instinctId!: number;
      await db.transaction(async (tx: DriverTx) => {
        // 3a. Upsert instinct. Confidence placeholder 0.50 (minimum valid) — overwritten in 3e.
        //     ON CONFLICT → refresh last_reinforced_at only
        //     (re-materialization after buffer refills: instinct already exists).
        // BR-AG5: agent_id column is NOT referenced — explicitly set to NULL.
        const insRs = await tx.execute({
          sql: `INSERT INTO instincts
                  (identity_key, trigger, behavioral_shape, domain, confidence, scope,
                   tenant_id, project, status, ingestion_path,
                   agent_id, embedding,
                   occurrence_count, created_at, last_reinforced_at)
                VALUES
                  (:identity_key, :trigger, :behavioral_shape, :domain, 0.50, 'project',
                   :tenant_id, :project, 'pending', 'auto_inferred',
                   NULL, NULL,
                   0, :now, :now)
                ON CONFLICT(tenant_id, identity_key, scope, COALESCE(project,'')) DO UPDATE SET
                  last_reinforced_at = excluded.last_reinforced_at
                RETURNING id`,
          args: {
            ":identity_key": s.identity_key,
            ":trigger": derive.trigger,
            ":behavioral_shape": derive.behavioral_shape,
            ":domain": derive.domain,
            ":tenant_id": s.tenant_id,
            ":project": s.project,
            ":now": now,
          },
        });

        instinctId = (insRs.rows[0] as unknown as { id: number }).id;

        // 3b. Copy buffer rows → instinct_occurrences (copies severity for H-2 R derivation).
        //     INSERT OR IGNORE so existing occurrences (H-5) are not double-inserted.
        //     BR-AG5: no agent_id column referenced here.
        await tx.execute({
          sql: `INSERT OR IGNORE INTO instinct_occurrences
                  (instinct_id, tenant_id, project, session_id, finding_id, evidence_scrubbed, observed_at, severity)
                SELECT :instinct_id, tenant_id, project, session_id, finding_id, evidence_scrubbed, observed_at, severity
                FROM signals_buffer
                WHERE identity_key = :identity_key
                  AND tenant_id    = :tenant_id
                  AND COALESCE(project,'') = COALESCE(:project,'')`,
          args: {
            ":instinct_id": instinctId,
            ":identity_key": s.identity_key,
            ":tenant_id": s.tenant_id,
            ":project": s.project,
          },
        });

        // 3c. Delete buffer rows for this identity — buffer is now promoted.
        await tx.execute({
          sql: `DELETE FROM signals_buffer
                WHERE identity_key = :identity_key
                  AND tenant_id    = :tenant_id
                  AND COALESCE(project,'') = COALESCE(:project,'')`,
          args: {
            ":identity_key": s.identity_key,
            ":tenant_id": s.tenant_id,
            ":project": s.project,
          },
        });

        // 3d. Read S (distinct sessions) and fail_s (sessions with severity='fail')
        //     from instinct_occurrences — authoritative post-copy view.
        const statsRs = await tx.execute({
          sql: `SELECT
                  COUNT(DISTINCT session_id)                                            AS S,
                  COUNT(DISTINCT CASE WHEN severity='fail' THEN session_id END)         AS fail_s
                FROM instinct_occurrences
                WHERE instinct_id = :instinct_id`,
          args: { ":instinct_id": instinctId },
        });
        const { S, fail_s } = statsRs.rows[0] as unknown as { S: number; fail_s: number };
        // analyzerConfidence returns the RAW clamped value; SQL ROUND is the rounding authority.
        const rawConfidence = analyzerConfidence(S, S > 0 ? fail_s / S : 0);

        // 3e. Update occurrence_count + confidence (authoritative, never delta-increment).
        // ROUND(:raw, 2) in SQL is the single rounding authority — keeps confidence consistent
        // with the projection's ROUND(confidence,2)>=0.7 and future promotion thresholds.
        await tx.execute({
          sql: `UPDATE instincts
                SET occurrence_count = (
                      SELECT COUNT(*) FROM instinct_occurrences WHERE instinct_id = :instinct_id
                    ),
                    confidence = ROUND(:raw_confidence, 2)
                WHERE id = :instinct_id`,
          args: { ":instinct_id": instinctId, ":raw_confidence": rawConfidence },
        });
      });

      return { materialized: true, instinctId };
    },

    async recordOccurrence(instinctId, occ) {
      // `observed_at` is a required field on SignalInput — use it directly (no fallback needed).
      const now = occ.observed_at;

      let counted = false;
      await db.transaction(async (tx: DriverTx) => {
        // INSERT OR IGNORE — UNIQUE(instinct_id, COALESCE(project,''), session_id) enforces H-5:
        // a duplicate session never inflates occurrence_count.
        const insertRs = await tx.execute({
          sql: `INSERT OR IGNORE INTO instinct_occurrences
                  (instinct_id, tenant_id, project, session_id, finding_id, evidence_scrubbed, observed_at, severity)
                VALUES
                  (:instinct_id, :tenant_id, :project, :session_id, :finding_id, :evidence_scrubbed, :observed_at, :severity)`,
          args: {
            ":instinct_id": instinctId,
            ":tenant_id": occ.tenant_id,
            ":project": occ.project,
            ":session_id": occ.session_id,
            ":finding_id": occ.finding_id,
            ":evidence_scrubbed": occ.evidence_scrubbed,
            ":observed_at": now,
            ":severity": occ.severity,
          },
        });

        let needsRecompute = false;

        if (insertRs.rowsAffected === 1) {
          // New occurrence: bump count + recompute.
          await tx.execute({
            sql: `UPDATE instincts
                  SET occurrence_count   = occurrence_count + 1,
                      last_reinforced_at = :now
                  WHERE id = :instinct_id`,
            args: { ":now": now, ":instinct_id": instinctId },
          });
          counted = true;
          needsRecompute = true;
        } else if (occ.severity === "fail") {
          // Existing session already recorded. If the re-score flipped warn→fail (AC-H2-5):
          // upgrade severity (fail-wins, sticky — never downgrade fail→warn).
          // occurrence_count UNCHANGED (H-5: same session never double-counts).
          const upgradeRs = await tx.execute({
            sql: `UPDATE instinct_occurrences
                  SET severity = 'fail'
                  WHERE instinct_id                          = :instinct_id
                    AND COALESCE(project,'')                 = COALESCE(:project,'')
                    AND session_id                           = :session_id
                    AND severity                             = 'warn'`,
            args: {
              ":instinct_id": instinctId,
              ":project": occ.project,
              ":session_id": occ.session_id,
            },
          });
          if (upgradeRs.rowsAffected === 1) {
            // Severity upgraded: recompute confidence upward (no count change).
            needsRecompute = true;
          }
        }

        if (needsRecompute) {
          // H-2: recompute confidence from full occurrence set (S, R).
          // SQL ROUND(:raw, 2) is the rounding authority (matches projection ROUND(confidence,2)).
          const statsRs = await tx.execute({
            sql: `SELECT
                    COUNT(DISTINCT session_id)                                          AS S,
                    COUNT(DISTINCT CASE WHEN severity='fail' THEN session_id END)       AS fail_s
                  FROM instinct_occurrences
                  WHERE instinct_id = :instinct_id`,
            args: { ":instinct_id": instinctId },
          });
          const { S, fail_s } = statsRs.rows[0] as unknown as { S: number; fail_s: number };
          const rawConfidence = analyzerConfidence(S, S > 0 ? fail_s / S : 0);

          await tx.execute({
            sql: `UPDATE instincts
                  SET confidence = ROUND(:raw_confidence, 2)
                  WHERE id = :instinct_id`,
            args: { ":raw_confidence": rawConfidence, ":instinct_id": instinctId },
          });
        }
      });

      return { counted };
    },

    async upsertDirective(i) {
      // BR-AG2 write-boundary guard (forward-compat — v1 never stores non-NULL agent_id).
      assertValidAgentId(i.ctx.agent_id);

      // Human-directive: confidence fixed 0.9 (OQ-1), ingestion_path='human_directive'.
      // v1: agent_id = NULL (BR-AG1 — all instincts team-wide in v1).
      // suggested_content: audit trail of what was proposed before human authoring (BR-13a).
      const now = new Date().toISOString();
      const rs = await db.execute({
        sql: `INSERT INTO instincts
                (identity_key, trigger, behavioral_shape, domain, confidence, scope,
                 tenant_id, project, status, ingestion_path,
                 agent_id, embedding,
                 occurrence_count, created_at, last_reinforced_at,
                 suggested_content)
              VALUES
                (:identity_key, :trigger, :behavioral_shape, :domain, 0.9, 'project',
                 :tenant_id, :project, :status, 'human_directive',
                 NULL, NULL,
                 1, :now, :now,
                 :suggested_content)
              ON CONFLICT(tenant_id, identity_key, scope, COALESCE(project,'')) DO UPDATE SET
                trigger           = excluded.trigger,
                behavioral_shape  = excluded.behavioral_shape,
                status            = excluded.status,
                last_reinforced_at = excluded.last_reinforced_at,
                suggested_content = excluded.suggested_content
              RETURNING *`,
        args: {
          ":identity_key": i.identity_key,
          ":trigger": i.trigger,
          ":behavioral_shape": i.behavioral_shape,
          ":domain": i.domain,
          ":tenant_id": i.ctx.tenant_id,
          ":project": i.ctx.project,
          ":status": i.status,
          ":now": now,
          ":suggested_content": i.suggested_content ?? null,
        },
      });
      return rs.rows[0] as unknown as Instinct;
    },

    async importMigrated(i) {
      // BR-AG2 write-boundary guard (forward-compat — v1 never stores non-NULL agent_id).
      assertValidAgentId(i.ctx.agent_id);

      // Migrated path (Bird ruling, Slice 8):
      //   confidence = 0.7 FIXED (injection-eligible minimum; no S/R occurrence data).
      //   ingestion_path = 'migrated' (distinct from human_directive's 0.9).
      //   status = 'approved' (already curated by human in the file-memory system).
      //   agent_id = NULL (BR-AG1 / BR-MIG-10 — all v1 migrated instincts are team-wide).
      //   occurrence_count = 0 (no signal data for migrated instincts).
      //
      // Supersede-on-upsert by ux_instincts_identity key so re-runs are idempotent.
      // On conflict: refresh trigger/shape/confidence/status/last_reinforced_at.
      // confidence is included in the UPDATE so a re-run always re-stamps the correct 0.7
      // (protects against a hypothetical future path that wrote a different value first).
      const now = new Date().toISOString();
      const rs = await db.execute({
        sql: `INSERT INTO instincts
                (identity_key, trigger, behavioral_shape, domain, confidence, scope,
                 tenant_id, project, status, ingestion_path,
                 agent_id, embedding,
                 occurrence_count, created_at, last_reinforced_at,
                 suggested_content)
              VALUES
                (:identity_key, :trigger, :behavioral_shape, :domain, 0.7, 'project',
                 :tenant_id, :project, 'approved', 'migrated',
                 NULL, NULL,
                 0, :now, :now,
                 :suggested_content)
              ON CONFLICT(tenant_id, identity_key, scope, COALESCE(project,'')) DO UPDATE SET
                trigger            = excluded.trigger,
                behavioral_shape   = excluded.behavioral_shape,
                confidence         = excluded.confidence,
                status             = excluded.status,
                last_reinforced_at = excluded.last_reinforced_at,
                suggested_content  = excluded.suggested_content
              RETURNING *`,
        args: {
          ":identity_key": i.identity_key,
          ":trigger": i.trigger,
          ":behavioral_shape": i.behavioral_shape,
          ":domain": i.domain,
          ":tenant_id": i.ctx.tenant_id,
          ":project": i.ctx.project,
          ":now": now,
          ":suggested_content": i.suggested_content ?? null,
        },
      });
      return rs.rows[0] as unknown as Instinct;
    },

    async setStatus(id, status) {
      // Turso-phase: MUST take a TenantCtx and bind tenant_id (BR-S4 fail-closed) before
      // multi-user — scopeless UPDATE by id is only safe while v1 is single-tenant
      // (AUTOINCREMENT ids are enumerable and cross-tenant mutations are a real threat in shared DB).
      const now = new Date().toISOString();
      await db.execute({
        sql: `UPDATE instincts
              SET status          = :status,
                  last_reviewed_at = :now
              WHERE id = :id`,
        args: { ":status": status, ":now": now, ":id": id },
      });
    },

    async selectForProjection(ctx) {
      // BR-AG2: validate agent_id even though it's dormant in v1.
      assertValidAgentId(ctx.agent_id);

      // §3.3 LOCKED PROJECTION SQL — copy verbatim; do NOT remove the explicit parentheses
      // around (scope = 'global' OR project = :project) — they are a correctness boundary
      // (AC-8). Without them, AND/OR precedence would leak cross-project rows.
      //
      // BR-AG5: agent_id hook is DORMANT in v1. The commented line below is the v1.1 hook;
      // uncomment per Bird ruling when agent_id enters the key.
      //   -- AND (agent_id IS NULL OR agent_id = :agent_id)
      //
      // BR-8′ (Bird ruling, Slice 8): staleness TTL applies to ingestion_path='auto_inferred'
      // ONLY. human_directive and migrated instincts can never be reinforced (no occurrence
      // pipeline feeds them), so TTL would silently erase permanently-authored guidance ~30d
      // after import. They are removed ONLY by explicit reject (setStatus).
      // Predicate: (ingestion_path <> 'auto_inferred' OR <30d-fresh>) — short-circuits on
      // the non-auto_inferred case so the date expression is never evaluated for exempt rows.
      // IMPORTANT: this WHERE clause must remain byte-identical to countEligible() (AC-TTL-7).
      const rs = await db.execute({
        sql: `WITH eligible AS (
                SELECT *, ROW_NUMBER() OVER (
                  PARTITION BY identity_key ORDER BY (scope='project') DESC
                ) AS dedup_rank
                FROM instincts
                WHERE status = 'approved'
                  AND ROUND(confidence, 2) >= 0.7
                  AND tenant_id = :tenant
                  AND (scope = 'global' OR project = :project)
                  AND (ingestion_path <> 'auto_inferred' OR julianday('now') - julianday(
                    MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at))
                  ) <= 30)
              )
              SELECT * FROM eligible WHERE dedup_rank = 1
              ORDER BY confidence DESC, last_reinforced_at DESC LIMIT 6`,
        args: {
          ":tenant": ctx.tenant_id,
          ":project": ctx.project,
        },
      });
      return rs.rows as unknown as Instinct[];
    },

    async prune(nowIso) {
      const now = nowIso ?? new Date().toISOString();

      // BR-8′ (Bird ruling, Slice 8): staleness TTL applies to ingestion_path='auto_inferred' ONLY.
      // human_directive and migrated instincts are TTL-exempt — they cannot be reinforced so
      // they would silently vanish ~30d after import/authoring without this guard.
      // They are removed exclusively by explicit setStatus('rejected').
      //
      // Using MAX() two-arg form (SQLite "greatest" — works with ISO-8601 TEXT comparisons).
      // BR-AG5: no agent_id reference.
      // Orphan signals_buffer prune below is unchanged — buffer rows are auto_inferred only.
      const instinctsRs = await db.execute({
        sql: `DELETE FROM instincts
              WHERE ingestion_path = 'auto_inferred'
                AND julianday(:now) - julianday(
                  MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at))
                ) > 30`,
        args: { ":now": now },
      });

      // Prune orphan signals_buffer rows older than 30d (signals that never reached threshold).
      const bufferRs = await db.execute({
        sql: `DELETE FROM signals_buffer
              WHERE julianday(:now) - julianday(observed_at) > 30`,
        args: { ":now": now },
      });

      return {
        instinctsPruned: instinctsRs.rowsAffected,
        bufferPruned: bufferRs.rowsAffected,
      };
    },

    async listByStatus(ctx, status) {
      // Tenant-bound. If ctx.project is non-null, scope to that project.
      // If null, intentionally broadens scope to ALL projects for this tenant (CLI overview) —
      // this is deliberate; passing null does NOT mean "project-less only", it means "show all".
      const rs = await db.execute({
        sql: `SELECT * FROM instincts
              WHERE tenant_id = :tenant_id
                AND status    = :status
                AND (:project IS NULL OR project = :project)
              ORDER BY last_reinforced_at DESC`,
        args: {
          ":tenant_id": ctx.tenant_id,
          ":status": status,
          ":project": ctx.project,
        },
      });
      return rs.rows as unknown as Instinct[];
    },

    async getById(id) {
      // Turso-phase: MUST take a TenantCtx and bind tenant_id (BR-S4 fail-closed) before
      // multi-user — scopeless SELECT by id is only safe while v1 is single-tenant
      // (AUTOINCREMENT ids are enumerable and cross-tenant reads are a real threat in shared DB).
      const rs = await db.execute({
        sql: `SELECT * FROM instincts WHERE id = :id`,
        args: { ":id": id },
      });
      if (rs.rows.length === 0) return null;
      return rs.rows[0] as unknown as Instinct;
    },

    async countEligible(ctx) {
      assertValidAgentId(ctx.agent_id);
      // Same WHERE clause as selectForProjection without LIMIT 6 — counts the total eligible
      // pool. Uses ROW_NUMBER dedup so each identity_key is counted once (project wins over global).
      //
      // BR-8′: same TTL exemption as selectForProjection (AC-TTL-7 — WHERE must stay
      // byte-identical). ingestion_path <> 'auto_inferred' short-circuits the date expression
      // for human_directive and migrated rows exactly as in selectForProjection.
      const rs = await db.execute({
        sql: `WITH eligible AS (
                SELECT *, ROW_NUMBER() OVER (
                  PARTITION BY identity_key ORDER BY (scope='project') DESC
                ) AS dedup_rank
                FROM instincts
                WHERE status = 'approved'
                  AND ROUND(confidence, 2) >= 0.7
                  AND tenant_id = :tenant
                  AND (scope = 'global' OR project = :project)
                  AND (ingestion_path <> 'auto_inferred' OR julianday('now') - julianday(
                    MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at))
                  ) <= 30)
              )
              SELECT COUNT(*) AS n FROM eligible WHERE dedup_rank = 1`,
        args: {
          ":tenant": ctx.tenant_id,
          ":project": ctx.project,
        },
      });
      return (rs.rows[0] as unknown as { n: number }).n;
    },
  };
}
