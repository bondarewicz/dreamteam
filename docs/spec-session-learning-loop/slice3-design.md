# Slice 3 — Two-Tier Schema + Store Modules — Build-Ready Design

**Author:** MJ (Strategic Systems Architect) · **For:** Shaq (implementation) · **Status:** build-ready spec.
**Builds on:** `web/src/db-driver.ts` (the seam) · matches `web/src/db.ts` conventions · serves §3 ingestion + §4 projection.
**Pending dependency:** `agent_id` *semantics/precedence* are Bird's concurrent ruling. This doc pins the *structure* so Bird's answer is absorbed by swapping ONE index — no table migration. Marked **[BIRD]** throughout.

---

## 0. Reconciliation notes (read first)

1. **`provenance` → `ingestion_path` (RENAME).** architecture.md §2 (2026-06-18) said `provenance CHECK('auto','directive')`. The authoritative, newer spec.md/domain.md (2026-06-26) uses **`ingestion_path CHECK('auto_inferred','human_directive')`**, and BR-1/BR-1a reference `ingestion_path='auto_inferred'`/`'human_directive'` directly. **Use `ingestion_path`.** This is a resolved naming reconciliation, not an open question.
2. **UNIQUE constraints are declared as named `CREATE UNIQUE INDEX` statements, NOT inline table constraints.** This is the load-bearing structural decision that lets Bird's `agent_id` ruling become a one-line index swap instead of an `ALTER TABLE` rebuild. See §1.5.
3. **NULL-in-UNIQUE landmine (H-1-adjacent, MUST FIX).** SQLite treats `NULL` as *distinct* in UNIQUE constraints. `project_id`/`project` are nullable (NULL = user-scoped / global). A raw `UNIQUE(...project...)` will therefore **fail to dedup** two user-scoped facts or two global instincts and break supersede-on-upsert. **All uniqueness on a nullable scope column MUST use `COALESCE(col,'')` in a UNIQUE INDEX expression.** Pinned in every DDL block below.

---

## 1. Schema DDL

All DDL runs through the seam (`driver.batch([...], "write")`), NOT raw `bun:sqlite`. Each store owns an idempotent `ensure()` that issues `CREATE TABLE IF NOT EXISTS` + `CREATE [UNIQUE] INDEX IF NOT EXISTS` (matches `db.ts` `initSchema` idempotency; because we pre-add `agent_id`/`embedding` now, v1 needs no `ALTER`). Timestamps are ISO-8601 TEXT (`datetime('now')` / `new Date().toISOString()`), matching `db.ts`.

### 1.1 `scoped_facts` — tier 1 (NOT scrubbed, tenant-isolated, NO TTL)

```sql
CREATE TABLE IF NOT EXISTS scoped_facts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  project_id  TEXT,                          -- NULL = user-scoped
  kind        TEXT NOT NULL CHECK (kind IN ('user','project','reference')),
  content_key TEXT NOT NULL,
  content     TEXT NOT NULL,                 -- verbatim, NEVER scrubbed
  source      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- supersede-on-upsert key (NULL-safe via COALESCE — note #3):
CREATE UNIQUE INDEX IF NOT EXISTS ux_scoped_facts_identity
  ON scoped_facts (tenant_id, user_id, COALESCE(project_id,''), kind, content_key);
-- read path index:
CREATE INDEX IF NOT EXISTS ix_scoped_facts_scope
  ON scoped_facts (tenant_id, project_id, kind);
```
No `status`, no TTL, no `last_reviewed_at` — scoped facts are exempt from prune/TTL (BR-8) and deleted only by explicit user action.

### 1.2 `instincts` — tier 2 (scrubbed, promotable)

```sql
CREATE TABLE IF NOT EXISTS instincts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key       TEXT NOT NULL,          -- sha256 hex, post-scrub (H-1, §3)
  trigger            TEXT NOT NULL,
  behavioral_shape   TEXT NOT NULL,
  domain             TEXT NOT NULL,          -- bounded vocab, validated in TS (see §1.6)
  confidence         REAL NOT NULL CHECK (confidence >= 0.3 AND confidence <= 0.9),
  scope              TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project','global')),
  tenant_id          TEXT NOT NULL,
  project            TEXT,                    -- NULL when global
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  ingestion_path     TEXT NOT NULL CHECK (ingestion_path IN ('auto_inferred','human_directive','migrated')), -- 'migrated' added per Bird ruling 2026-06-26, Slice 8 (corrected per MJ re-resolution 2026-06-26)
  agent_id           TEXT,                    -- [BIRD] nullable; NULL = team-wide. FORWARD-COMPAT.
  embedding          BLOB,                    -- FORWARD-COMPAT (libSQL vector_top_k). Zero v1 behavior.
  occurrence_count   INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  last_reinforced_at TEXT NOT NULL,
  last_reviewed_at   TEXT,                    -- NULL until first approve/reject
  promoted_at        TEXT                     -- v1.1 (BR-7); no v1 writer — dormant forward-compat
);
-- canonical dedup / supersede key (NULL-safe). v1 form:
CREATE UNIQUE INDEX IF NOT EXISTS ux_instincts_identity
  ON instincts (tenant_id, identity_key, scope, COALESCE(project,''));
-- [BIRD] IF Bird rules agent_id participates in identity, REPLACE the index above with:
--   CREATE UNIQUE INDEX ux_instincts_identity
--     ON instincts (tenant_id, identity_key, scope, COALESCE(project,''), COALESCE(agent_id,'*'));
--   (Sentinel is '*' not '' — BR-AG3, spec.md; corrected per MJ re-resolution 2026-06-26.)
--   (DROP + CREATE INDEX only — NO ALTER TABLE, NO data migration.)
CREATE INDEX IF NOT EXISTS ix_instincts_selection
  ON instincts (status, confidence, last_reinforced_at);
CREATE INDEX IF NOT EXISTS ix_instincts_identity_key
  ON instincts (identity_key);
```

### 1.3 `signals_buffer` — sub-threshold staging (two-table ruling, NO nullable FK)

```sql
CREATE TABLE IF NOT EXISTS signals_buffer (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key      TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  project           TEXT,
  session_id        TEXT NOT NULL,
  finding_id        TEXT NOT NULL,
  evidence_scrubbed TEXT NOT NULL,
  observed_at       TEXT NOT NULL
);
-- one row per (identity, tenant, project, session) — feeds COUNT(DISTINCT session) (BR-1); NULL-safe:
CREATE UNIQUE INDEX IF NOT EXISTS ux_signals_buffer_session
  ON signals_buffer (identity_key, tenant_id, COALESCE(project,''), session_id);
CREATE INDEX IF NOT EXISTS ix_signals_buffer_identity
  ON signals_buffer (identity_key, tenant_id);
```
No FK by design: a buffer row exists *before* its `instincts` row does (a nullable FK would be the anti-pattern §2 forbids).

### 1.4 `instinct_occurrences` — post-materialization evidence (valid FK)

```sql
CREATE TABLE IF NOT EXISTS instinct_occurrences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  instinct_id       INTEGER NOT NULL REFERENCES instincts(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,
  project           TEXT,
  session_id        TEXT NOT NULL,
  finding_id        TEXT NOT NULL,
  evidence_scrubbed TEXT NOT NULL,
  observed_at       TEXT NOT NULL
);
-- 1-session-≤-1-occurrence; blocks double-count on re-score (H-5); NULL-safe:
CREATE UNIQUE INDEX IF NOT EXISTS ux_occurrences_session
  ON instinct_occurrences (instinct_id, COALESCE(project,''), session_id);
CREATE INDEX IF NOT EXISTS ix_occurrences_instinct
  ON instinct_occurrences (instinct_id);
```
FK CASCADE relies on `PRAGMA foreign_keys=ON` — already applied by the seam on every connection.

### 1.5 Why UNIQUE INDEX, not inline UNIQUE (the agent_id absorber)

Declaring identity as a *named index* (`ux_instincts_identity`) means Bird's ruling — "does `agent_id` participate in instinct identity?" — is satisfied by `DROP INDEX` + `CREATE INDEX` over the (already-present) `agent_id` column. No `ALTER TABLE`, no table rebuild, no data copy. If Bird says **defer/no-consumer**, the column sits unused and the v1 index stands. If Bird says **include**, swap to the 5-column index. Either ruling is a config flip. This is the single most important structural choice in the slice.

### 1.6 Drexler flags — over-built-for-v1 (keep, but noted)

- **`promoted_at`** — promotion is v1.1 (BR-7). Nullable, zero v1 writer. Keep (forward-compat, free).
- **`scope='global'` + the `scope='global' OR …` selection branch** — global only arrives via promotion (v1.1); in v1 every new row is `'project'`, so the OR branch is *dormant* (no v1 producer). Keep anyway: it is the LOCKED AC-8 selection SQL and the parentheses guard depends on it.
- **`domain` as TS-validated enum, NOT a SQL `CHECK` list** — spec says "bounded vocab" but does not freeze the list. A SQL `CHECK(domain IN (...))` would force a table migration to add a vocab term — rigidity in the wrong place. Validate the bounded vocab in TS (one exported `const DOMAINS` + guard); keep the column a plain `TEXT NOT NULL`. Flexibility where the vocab will grow; rigidity (CHECK) only where values are truly closed (`status`/`scope`/`kind`/`ingestion_path`).

---

## 2. Forward-compat include/defer calls

| Addition | Call | Reasoning |
|---|---|---|
| **`agent_id`** (nullable TEXT on `instincts`) | **INCLUDE column; structure index to absorb [BIRD]** | Adding a column to `instincts` later is more disruptive than a standalone table (touches the hot table + its identity index). Include the nullable column now (zero v1 behavior, NULL = team-wide). The *precedence/dedup-order/v1-consumer* questions are Bird's — design so "defer" = unused column + v1 index, "include" = one index swap (§1.5). The projection WHERE clause gets a commented, dormant `agent_id` hook (§4) so Bird's ruling drops in. |
| **`embedding` BLOB** (nullable on `instincts`) | **INCLUDE** | Pure forward-compat for libSQL `vector_top_k` (Turso has native vectors, confirmed). One nullable column, no index, no v1 read/write path. Adding it now makes RAG a later *feature add*, not a *migration* of the hot table. Drexler-clean: no logic ships. |
| **`memory_links(from_id,to_id,…)` table** | **DEFER** (clear trigger) | Asymmetry vs. the columns above: a *standalone table* is trivial to add later (`CREATE TABLE`, no touch to `instincts`/`scoped_facts`), whereas columns on `instincts` are disruptive later — so the lean call differs. **There is no v1 consumer:** the §4 projection selection does NOT traverse links, and the Slice 8 file-memory importer that parses `[[wikilinks]]` is downstream. Shipping an empty table nobody reads is the Drexler over-build. **Trigger to add:** when `scripts/import-file-memory.ts` (Slice 8) begins parsing `[[links]]`, OR the projection adds link-traversal — whichever first. At that point it is a clean new-table add, not a migration. |

Net: **include the two columns, defer the table** — calibrated by "how disruptive is adding it later," not by uniform caution.

---

## 3. Store module interfaces

Both stores: async, depend ONLY on the seam (`Driver`/`DriverTx`/`ResultSet`/`DbDriverError`/`DRIVER_ERROR_CODES`), accept an injected `Driver` (default `getDriver()`) for testability against `createDriver(":memory:")`. Supersede/dedup branch on **`err.code === DRIVER_ERROR_CODES.UNIQUE`**, never raw `SQLITE_*` strings. No non-DB work awaited inside `transaction(fn)` (seam single-flight): compute `identity_key`, confidence, scrub, and `now` BEFORE opening the transaction.

### 3.1 `web/src/fact-store.ts` (tier 1 — NO scrub; tenant REQUIRED on every read)

```ts
export interface TenantCtx {                 // every read binds this — no scopeless overload (BR-S1/S4)
  tenant_id: string;
  user_id: string;
  project_id: string | null;                 // null = user-scoped
}
export interface ScopedFact {
  id: number; tenant_id: string; user_id: string; project_id: string | null;
  kind: "user" | "project" | "reference";
  content_key: string; content: string; source: string | null;
  created_at: string; updated_at: string;
}
export interface FactStore {
  ensure(): Promise<void>;
  // supersede-on-upsert by identity key; INSERT ... ON CONFLICT(ux_scoped_facts_identity) DO UPDATE
  upsertFact(ctx: TenantCtx, f: {
    kind: ScopedFact["kind"]; content_key: string; content: string; source?: string | null;
  }): Promise<ScopedFact>;
  // REQUIRES ctx; binds tenant_id + user_id + (project_id via COALESCE) — fail-closed
  getFacts(ctx: TenantCtx, opts?: { kind?: ScopedFact["kind"] }): Promise<ScopedFact[]>;
  // trusted-section facts for the projection; binds (:user_id,:project_id) — no scopeless variant
  listForProjection(ctx: TenantCtx): Promise<ScopedFact[]>;
  deleteFact(ctx: TenantCtx, content_key: string, kind: ScopedFact["kind"]): Promise<void>; // explicit, no TTL
}
export function createFactStore(driver?: Driver): FactStore;
```
**BAKED-IN INVARIANTS:** (a) NO exported method omits `TenantCtx` — there is deliberately no `getAllFacts()`; the type system enforces BR-S1/S4 at the call site. (b) Every SQL binds `tenant_id = :tenant_id AND user_id = :user_id AND COALESCE(project_id,'') = COALESCE(:project_id,'')`. (c) Never scrubs — `content` is verbatim. (d) No `status`/TTL columns touched.

### 3.2 `web/src/instincts-db.ts` (tier 2)

```ts
export interface InstinctCtx {
  tenant_id: string;
  project: string | null;
  agent_id?: string | null;                  // [BIRD] dormant in v1 selection; wired per ruling
}
export interface SignalInput {
  identity_key: string; tenant_id: string; project: string | null;
  session_id: string; finding_id: string; evidence_scrubbed: string; observed_at: string;
}
export interface Instinct { /* all 1.2 columns, typed */ }

export interface InstinctsDb {
  ensure(): Promise<void>;

  // H-1: pure, exported, unit-testable. sha256_hex( norm(trigger) ‖\x1f‖ domain ‖\x1f‖ norm(shape) )
  identityKey(trigger: string, domain: string, behavioral_shape: string): string;

  // AUTO path. INSERT OR IGNORE the signal (UNIQUE → silent no-op = H-5/BR-6 one-session-≤-one);
  // then if COUNT(DISTINCT session_id) >= 3 (BR-1) → materialize in ONE transaction:
  //   create instinct (status='pending', confidence precomputed in TS, ingestion_path='auto_inferred'),
  //   copy buffer rows → instinct_occurrences, delete this identity's buffer rows, set occurrence_count.
  recordSignal(s: SignalInput, derive: { confidence: number; trigger: string;
    domain: string; behavioral_shape: string }): Promise<{ materialized: boolean; instinctId?: number }>;

  // post-materialization reinforcement. INSERT OR IGNORE occurrence (UNIQUE(instinct_id,project,session));
  // bump occurrence_count + last_reinforced_at ONLY if rowsAffected===1 (H-5 no double-count on re-score).
  recordOccurrence(instinctId: number, occ: Omit<SignalInput,"identity_key">): Promise<{ counted: boolean }>;

  // DIRECTIVE path (n=1, BR-1a). confidence fixed 0.9; status from caller ('approved' on confirm keystroke,
  // else 'pending'); supersede-on-upsert via ux_instincts_identity (ON CONFLICT DO UPDATE).
  upsertDirective(i: { ctx: InstinctCtx; identity_key: string; trigger: string; domain: string;
    behavioral_shape: string; status: "pending" | "approved"; }): Promise<Instinct>;

  // approve/reject (CLI). Sets status + last_reviewed_at=now.
  setStatus(id: number, status: "approved" | "rejected"): Promise<void>;

  // §4 projection. EXACT LOCKED SQL (parenthesized scope clause, ROUND>=0.7, dedup_rank=1, LIMIT 6).
  selectForProjection(ctx: InstinctCtx): Promise<Instinct[]>;

  // BR-8 prune (global). scoped_facts UNTOUCHED (different store). + orphan signals_buffer prune.
  prune(nowIso?: string): Promise<{ instinctsPruned: number; bufferPruned: number }>;

  // CLI list/approve/reject/review — tenant-bound.
  listByStatus(ctx: InstinctCtx, status: Instinct["status"]): Promise<Instinct[]>;
  getById(id: number): Promise<Instinct | null>;
}
export function createInstinctsDb(driver?: Driver): InstinctsDb;
```

**H-1 normalization (PINNED — `identityKey` + `norm`):**
1. `text.normalize("NFKC")` → 2. lowercase → 3. collapse internal whitespace runs to a single space → 4. trim.
5. Join the three parts with the ASCII Unit Separator `"\x1f"` (NOT a space/`+`): `sha256_hex( norm(trigger) + "\x1f" + domain + "\x1f" + norm(shape) )`. `domain` is from the bounded vocab (already canonical) — joined as-is.
6. Computed **post-scrub** (client identifiers already removed). Use `new Bun.CryptoHasher("sha256")` or `node:crypto.createHash("sha256")`, hex digest.
The `\x1f` delimiter is load-bearing: it prevents the concatenation collision class where `("ab","x","cd")` and `("a","x","bcd")` would otherwise hash equal.

**BR rules → concrete queries:**
- **BR-1 (materialize ≥3):** inside `recordSignal`, after the buffer insert: `SELECT COUNT(DISTINCT session_id) AS n FROM signals_buffer WHERE identity_key=:k AND tenant_id=:t AND COALESCE(project,'')=COALESCE(:p,'')`. `n >= 3` → materialize. Whole materialization is one `transaction(fn)`.
- **BR-6 (dedup project-over-global):** in the §4 selection CTE — `ROW_NUMBER() OVER (PARTITION BY identity_key ORDER BY (scope='project') DESC) AS dedup_rank`, take `dedup_rank=1`.
- **BR-8 (prune/TTL):** `DELETE FROM instincts WHERE julianday('now') - julianday(MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at))) > 30;` then orphan buffer prune (`DELETE FROM signals_buffer WHERE … older than 30d`). `scoped_facts` is in the *other* store and is never referenced here.
- **H-3 (ROUND before compare):** projection eligibility `ROUND(confidence,2) >= 0.7`; promotion (v1.1) `ROUND(AVG(confidence),2) >= 0.8`. Never compare raw floats.

### 3.3 §4 projection selection SQL (LOCKED — copy verbatim)

```sql
WITH eligible AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY identity_key ORDER BY (scope='project') DESC) AS dedup_rank
  FROM instincts
  WHERE status = 'approved'                                  -- BR-13 (LOCKED)
    AND ROUND(confidence, 2) >= 0.7                          -- BR-4 / H-3
    AND tenant_id = :tenant
    AND (scope = 'global' OR project = :project)             -- EXPLICIT PARENS — AC-8, do not remove
    -- [BIRD] agent_id hook (DORMANT in v1; uncomment per ruling):
    -- AND (agent_id IS NULL OR agent_id = :agent_id)
    AND julianday('now') - julianday(MAX(last_reinforced_at, COALESCE(last_reviewed_at, last_reinforced_at))) <= 30
)
SELECT * FROM eligible WHERE dedup_rank = 1
ORDER BY confidence DESC, last_reinforced_at DESC LIMIT 6;
```
The parentheses around `(scope = 'global' OR project = :project)` are a correctness boundary (AC-8): without them, AND/OR precedence leaks cross-tenant/cross-project rows into `MEMORY.md`, which auto-loads with no read-time gate.

---

## 4. Test plan (ACs Shaq must satisfy)

| # | AC | Assertion |
|---|---|---|
| T1 | **identity_key normalization (H-1)** | Case/whitespace/NFKC variants of the same `(trigger,domain,shape)` → identical key. |
| T2 | **identity_key collision guard (H-1)** | `("ab","d","c")` vs `("a","d","bc")` vs `("a","d","cb")` → all DISTINCT keys (proves the `\x1f` delimiter, not naive concat). |
| T3 | **supersede-on-upsert** | Second `upsertFact`/`upsertDirective` with same identity → row UPDATED, not duplicated; if the catch-path is used it branches on `DbDriverError.code === DRIVER_ERROR_CODES.UNIQUE`, never a raw `SQLITE_*` string. |
| T4 | **NULL-scope dedup (note #3)** | Two user-scoped facts (project_id NULL) same `content_key` → ONE row (COALESCE index works); two global instincts same identity → ONE row. |
| T5 | **materialization @ 3 (BR-1)** | 2 distinct sessions → 0 instincts, 2 buffer rows; 3rd distinct session → exactly 1 instinct, 3 `instinct_occurrences`, buffer emptied for that identity_key. |
| T6 | **dedup precedence (BR-6)** | Same identity_key, one `scope='project'` + one `scope='global'`, both eligible → projection returns ONLY the project row (`dedup_rank=1`). |
| T7 | **TTL prune excludes scoped_facts (BR-8)** | Instinct with `MAX(reinforced,reviewed)` > 31d ago → pruned; orphan buffer rows pruned; a 1-year-old scoped_fact → UNTOUCHED. |
| T8 | **tenant-predicate enforcement (BR-S1/S4)** | No exported fact-read without `TenantCtx` (type-level + a test that a cross-tenant fact is absent from `getFacts`/`listForProjection`). |
| T9 | **ROUND boundary (H-3)** | confidence `0.70` → eligible; `0.694` → not; `0.799` promotion-check → NOT promotable (`ROUND(.,2) < 0.8`). |
| T10 | **re-score no double-count (H-5)** | `recordOccurrence` twice for same `(instinct_id,project,session_id)` → `occurrence_count` +1 once; one `instinct_occurrences` row; second call returns `{counted:false}`. |
| T11 | **parentheses guard (AC-8)** | Mixed fixture (right project + wrong-project global-look-alike) → only legitimately-eligible rows returned; assert the selection SQL literally contains the parenthesized `(scope = 'global' OR project = :project)`. |
| T12 | **agent_id absorber (structural)** | Document/verify that swapping `ux_instincts_identity` to the 5-column form needs no `ALTER TABLE` and no data change (Bird-ruling readiness). |

All tests run against `createDriver(":memory:")` (or temp path) — never the live workspace DB — and exercise stores via the injected driver.

---

## 5. Dependencies / open items for reconciliation

- **[BIRD] agent_id semantics** — precedence (does project-over-global dedup also order by agent-specific over team-wide?), and whether v1 has any consumer. Structure is ready either way (§1.5, §3.3 dormant hook). MJ to reconcile once Bird rules.
- **Reconciliation #1 (`ingestion_path`)** resolved in-doc by spec recency + BR references; flag for Magic to align architecture.md §2 wording on the next pass.
