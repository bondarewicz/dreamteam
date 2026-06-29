/**
 * fact-store.ts — FactStore: tier-1 scoped_facts repository.
 *
 * Tier-1 invariants (BR-S1/S2/S4, BR-8, BR-T1/T2):
 *   - NEVER scrubbed — `content` is verbatim and deliberately identifying.
 *   - NEVER promoted or made global — isolation is the sole protection.
 *   - NEVER auto-pruned — deletion is an explicit user action (OQ-3).
 *   - EVERY read/list REQUIRES a TenantCtx — no scopeless overload, no full-table scan.
 *   - All SQL predicates bind (tenant_id, user_id, COALESCE(project_id,'')) — fail-closed.
 *
 * Depends ONLY on the db-driver seam. No bun:sqlite imports.
 */

import { getDriver, DRIVER_ERROR_CODES, DbDriverError } from "./db-driver.ts";
import type { Driver } from "./db-driver.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Caller context required on every scoped-fact read (BR-S1/S4). */
export interface TenantCtx {
  tenant_id: string;
  user_id: string;
  project_id: string | null; // null = user-scoped fact; no global tier-1 facts
}

export interface ScopedFact {
  id: number;
  tenant_id: string;
  user_id: string;
  project_id: string | null;
  kind: "user" | "project" | "reference";
  content_key: string;
  content: string; // verbatim; NEVER scrubbed
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface FactStore {
  /** Idempotent DDL: CREATE TABLE IF NOT EXISTS + CREATE [UNIQUE] INDEX IF NOT EXISTS. */
  ensure(): Promise<void>;

  /**
   * Supersede-on-upsert by identity key.
   * INSERT with ON CONFLICT(tenant_id, user_id, COALESCE(project_id,''), kind, content_key)
   * DO UPDATE — updates content/source/updated_at; preserves created_at and id.
   */
  upsertFact(
    ctx: TenantCtx,
    f: {
      kind: ScopedFact["kind"];
      content_key: string;
      content: string;
      source?: string | null;
    }
  ): Promise<ScopedFact>;

  /**
   * Tenant-bound read (BR-S1/S4). Binds tenant_id + user_id + COALESCE(project_id,'').
   * Optionally filters by kind.
   */
  getFacts(ctx: TenantCtx, opts?: { kind?: ScopedFact["kind"] }): Promise<ScopedFact[]>;

  /**
   * Trusted-section facts for MEMORY.md projection. Same tenant scope as getFacts.
   * Returns all kinds ordered by kind ASC, created_at ASC.
   */
  listForProjection(ctx: TenantCtx): Promise<ScopedFact[]>;

  /**
   * Explicit deletion — no TTL (OQ-3). Scoped to TenantCtx + content_key + kind.
   * No-ops silently if row not found.
   */
  deleteFact(ctx: TenantCtx, content_key: string, kind: ScopedFact["kind"]): Promise<void>;

  /**
   * Look up a single scoped fact by primary-key id. Returns null if not found.
   * Used by the AC-8 self-check in memory-projection.ts to re-query the DB
   * (authoritative — not trusting the serialized topic file).
   */
  getFactById(id: number): Promise<ScopedFact | null>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFactStore(driver?: Driver): FactStore {
  const db = driver ?? getDriver();

  return {
    async ensure() {
      await db.batch(
        [
          // Tier-1 table. No status, no TTL, no last_reviewed_at.
          `CREATE TABLE IF NOT EXISTS scoped_facts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id   TEXT NOT NULL,
            user_id     TEXT NOT NULL,
            project_id  TEXT,
            kind        TEXT NOT NULL CHECK (kind IN ('user','project','reference')),
            content_key TEXT NOT NULL,
            content     TEXT NOT NULL,
            source      TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
          )`,
          // Named UNIQUE INDEX (not inline) — COALESCE prevents the NULL-distinct landmine
          // (two user-scoped facts with project_id=NULL would otherwise not collide).
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_scoped_facts_identity
            ON scoped_facts (tenant_id, user_id, COALESCE(project_id,''), kind, content_key)`,
          // Read-path scan index.
          `CREATE INDEX IF NOT EXISTS ix_scoped_facts_scope
            ON scoped_facts (tenant_id, project_id, kind)`,
        ],
        "write"
      );
    },

    async upsertFact(ctx, f) {
      const now = new Date().toISOString();
      // SQLite 3.24+ supports ON CONFLICT with expression indexes by repeating
      // the expression exactly. Confirmed working on 3.51 (bun current).
      const rs = await db.execute({
        sql: `INSERT INTO scoped_facts
                (tenant_id, user_id, project_id, kind, content_key, content, source, created_at, updated_at)
              VALUES
                (:tenant_id, :user_id, :project_id, :kind, :content_key, :content, :source, :now, :now)
              ON CONFLICT(tenant_id, user_id, COALESCE(project_id,''), kind, content_key) DO UPDATE SET
                content    = excluded.content,
                source     = excluded.source,
                updated_at = excluded.updated_at
              RETURNING *`,
        args: {
          ":tenant_id": ctx.tenant_id,
          ":user_id": ctx.user_id,
          ":project_id": ctx.project_id,
          ":kind": f.kind,
          ":content_key": f.content_key,
          ":content": f.content,
          ":source": f.source ?? null,
          ":now": now,
        },
      });
      return rs.rows[0] as unknown as ScopedFact;
    },

    async getFacts(ctx, opts) {
      const kindClause = opts?.kind != null ? " AND kind = :kind" : "";
      const rs = await db.execute({
        sql: `SELECT * FROM scoped_facts
              WHERE tenant_id = :tenant_id
                AND user_id   = :user_id
                AND COALESCE(project_id,'') = COALESCE(:project_id,'')
                ${kindClause}
              ORDER BY created_at ASC`,
        args: {
          ":tenant_id": ctx.tenant_id,
          ":user_id": ctx.user_id,
          ":project_id": ctx.project_id,
          ...(opts?.kind != null ? { ":kind": opts.kind } : {}),
        },
      });
      return rs.rows as unknown as ScopedFact[];
    },

    async listForProjection(ctx) {
      const rs = await db.execute({
        sql: `SELECT * FROM scoped_facts
              WHERE tenant_id = :tenant_id
                AND user_id   = :user_id
                AND COALESCE(project_id,'') = COALESCE(:project_id,'')
              ORDER BY kind ASC, created_at ASC`,
        args: {
          ":tenant_id": ctx.tenant_id,
          ":user_id": ctx.user_id,
          ":project_id": ctx.project_id,
        },
      });
      return rs.rows as unknown as ScopedFact[];
    },

    async deleteFact(ctx, content_key, kind) {
      await db.execute({
        sql: `DELETE FROM scoped_facts
              WHERE tenant_id = :tenant_id
                AND user_id   = :user_id
                AND COALESCE(project_id,'') = COALESCE(:project_id,'')
                AND content_key = :content_key
                AND kind        = :kind`,
        args: {
          ":tenant_id": ctx.tenant_id,
          ":user_id": ctx.user_id,
          ":project_id": ctx.project_id,
          ":content_key": content_key,
          ":kind": kind,
        },
      });
    },

    async getFactById(id) {
      const rs = await db.execute({
        sql: `SELECT * FROM scoped_facts WHERE id = :id`,
        args: { ":id": id },
      });
      if (rs.rows.length === 0) return null;
      return rs.rows[0] as unknown as ScopedFact;
    },
  };
}
