/**
 * db-driver.ts — async DB-driver seam for the Session Learning Loop.
 *
 * v1: wraps bun:sqlite synchronous calls and Promise.resolve()-s them.
 *     Async ceremony now = zero call-site rewrite when the Turso driver swap lands.
 *
 * Turso phase: replace createDriver() internals with:
 *   createClient({ url: "file:"+dbPath(), syncUrl: TURSO_DATABASE_URL, authToken: … })
 *   and adjust execStmt() to await the async libSQL client methods.
 *
 * RIGIDITY (architecture §1): this MUST be the only new-loop module importing
 * bun:sqlite or @libsql/client. Existing eval files (db.ts, sessions-db.ts, migrate.ts)
 * are exempt in v1 and will migrate behind the seam at the Turso phase.
 *
 * Surface mirrors @libsql/client so the Turso swap is drop-in:
 *   execute(stmt) → Promise<ResultSet>
 *   batch(stmts, mode) → Promise<ResultSet[]>
 *   transaction(fn) → Promise<T>
 *   close() → void
 *
 * Operational notes (single shared connection — v1 SQLite):
 *   - All writes serialize on the single bun:sqlite connection (WAL allows concurrent reads).
 *   - NEVER await non-DB work (e.g. LLM calls, file I/O) inside a transaction(fn) callback —
 *     the connection is held open and no other DB operation can proceed while you await.
 *   - batch() and transaction() must NOT overlap on the same driver (single-flight).
 *   - PRAGMA foreign_keys=ON is applied per-connection; FK constraints are enforced.
 *   - PRAGMA journal_mode=WAL + PRAGMA busy_timeout=5000 applied on open (H-4).
 *   - PRAGMA foreign_keys=ON applied on open (required by §2 schema CASCADE rules).
 *   - Logging/metrics/tracing deferred to the Turso phase (wrap execStmt + opentelemetry).
 */

import { Database } from "bun:sqlite";
import type { Statement as BunStatement } from "bun:sqlite";
import fs from "fs";
import { dbPath as defaultDbPath } from "../../scripts/paths.ts";

// ---------------------------------------------------------------------------
// Public types (mirror @libsql/client)
// ---------------------------------------------------------------------------

/**
 * Scalar value accepted by bun:sqlite / libSQL.
 * null | boolean | number | bigint | string | Uint8Array
 *
 * Note (v1 boolean/bigint parity):
 *   boolean → SQLite stores as 0/1 (SQLite has no native boolean type).
 *   bigint  → binds correctly; retrieved as number by default (no precision loss up to
 *             Number.MAX_SAFE_INTEGER). For values > MAX_SAFE_INTEGER, enable stmt.safeIntegers(true)
 *             at the call site, or query via BigInt() after retrieval. libSQL always returns bigint.
 *             This is a v1 known limitation; Turso phase will enable safeIntegers globally.
 */
export type InValue = null | boolean | number | bigint | string | Uint8Array;

/**
 * Positional args (Array) or named args (Record with :name/$name/@name keys).
 * Both are accepted by execute() and batch().
 */
export type InArgs = InValue[] | Record<string, InValue>;

/**
 * A statement — either a plain SQL string or an object with sql + optional args.
 */
export interface StmtInput {
  sql: string;
  args?: InArgs;
}

/** A statement parameter accepted by execute() and batch(). */
export type StatementParam = string | StmtInput;

/**
 * A single result row — keyed by column name (matches libSQL default Row shape).
 */
export type Row = Record<string, unknown>;

/**
 * Result shape that mirrors @libsql/client ResultSet exactly:
 *   rows            — result rows (empty [] for pure-write operations)
 *   columns         — column names in the order the DB returns them
 *   rowsAffected    — number of rows modified (0 for reads)
 *   lastInsertRowid — bigint (bun:sqlite returns number; coerced here for swap-safety)
 *                     undefined for read operations
 */
export interface ResultSet {
  rows: Row[];
  columns: string[];
  rowsAffected: number;
  lastInsertRowid: bigint | undefined;
}

/**
 * Transaction handle passed to the transaction() callback.
 * Exposes the same execute() surface as the top-level driver.
 */
export interface DriverTx {
  execute(stmt: StatementParam): Promise<ResultSet>;
}

/**
 * The full driver interface — mirrors @libsql/client Client.
 */
export interface Driver {
  execute(stmt: StatementParam): Promise<ResultSet>;
  batch(stmts: StatementParam[], mode?: "write" | "read" | "deferred"): Promise<ResultSet[]>;
  transaction<T>(fn: (tx: DriverTx) => Promise<T>): Promise<T>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Stable error type (swap-safe — stores can branch on .code without knowing
// whether the underlying driver is bun:sqlite or @libsql/client)
// ---------------------------------------------------------------------------

/**
 * Stable error codes the stores may branch on.
 * Mapped from SQLite-specific codes so the Turso swap doesn't break those branches.
 */
export const DRIVER_ERROR_CODES = {
  UNIQUE: "DRIVER_CONSTRAINT_UNIQUE",
  FOREIGN_KEY: "DRIVER_CONSTRAINT_FOREIGNKEY",
  CONSTRAINT: "DRIVER_CONSTRAINT",
  ERROR: "DRIVER_ERROR",
} as const;

export type DriverErrorCode = (typeof DRIVER_ERROR_CODES)[keyof typeof DRIVER_ERROR_CODES];

/** Seam-level error wrapping any DB error with a stable .code. */
export class DbDriverError extends Error {
  constructor(
    message: string,
    public readonly code: DriverErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DbDriverError";
  }
}

/**
 * Map a raw bun:sqlite error (or any thrown value) into a DbDriverError.
 * At the Turso phase, this maps libSQL errors instead.
 */
function mapDbError(e: unknown): DbDriverError {
  const err = e as { code?: string; message?: string };
  const raw = err.code ?? "";
  let code: DriverErrorCode;
  if (raw === "SQLITE_CONSTRAINT_UNIQUE") {
    code = DRIVER_ERROR_CODES.UNIQUE;
  } else if (raw === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    code = DRIVER_ERROR_CODES.FOREIGN_KEY;
  } else if (raw.startsWith("SQLITE_CONSTRAINT")) {
    code = DRIVER_ERROR_CODES.CONSTRAINT;
  } else {
    code = DRIVER_ERROR_CODES.ERROR;
  }
  return new DbDriverError(err.message ?? String(e), code, e);
}

// ---------------------------------------------------------------------------
// SQL classification
// ---------------------------------------------------------------------------

/** Internal classification of a SQL statement's execution mode. */
type SqlMode =
  | "read"                 // SELECT / PRAGMA / EXPLAIN / read CTE → .all(), no write metadata
  | "write"                // INSERT/UPDATE/DELETE/CREATE/… → .run(), rows []
  | "write-with-returning"; // INSERT/UPDATE/DELETE … RETURNING → .all() + query metadata

/**
 * Classify a SQL string into its execution mode.
 *
 * RETURNING detection: any DML statement that contains \bRETURNING\b must be executed via
 * .all() (not .run()) so the returned rows are captured; we then query `changes()` /
 * `last_insert_rowid()` immediately after on the same connection.
 *
 * Writing CTEs: `WITH … INSERT/UPDATE/DELETE` starts with `WITH` but is a write.
 * They are classified as "write" (or "write-with-returning" if RETURNING is present).
 * Plain `WITH … SELECT` stays "read".
 */
function classifySql(sql: string): SqlMode {
  const firstWord = sql.trimStart().match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() ?? "";

  // WITH: could be a read CTE or a writing CTE
  if (firstWord === "WITH") {
    const isWritingCte = /\b(INSERT|UPDATE|DELETE)\b/i.test(sql);
    if (!isWritingCte) return "read"; // pure read CTE
    return /\bRETURNING\b/i.test(sql) ? "write-with-returning" : "write";
  }

  // Pure reads
  if (
    firstWord === "SELECT" ||
    firstWord === "PRAGMA" ||
    firstWord === "EXPLAIN" ||
    firstWord === "VALUES"
  ) {
    return "read";
  }

  // Writes — check for RETURNING
  if (/\bRETURNING\b/i.test(sql)) return "write-with-returning";
  return "write";
}

// ---------------------------------------------------------------------------
// Core synchronous execution
// ---------------------------------------------------------------------------

/**
 * Execute one statement on a bun:sqlite Database and return a libSQL-shaped ResultSet.
 *
 * Three paths:
 *   "read"                → stmt.all(args)  → rows + columns; rowsAffected=0; lirId=undefined
 *   "write"               → stmt.run(args)  → RunResult → rows=[]; coerce lastInsertRowid to bigint
 *   "write-with-returning" → stmt.all(args) to capture RETURNING rows, then query
 *                            `changes()` / `last_insert_rowid()` on the SAME connection.
 *
 * bun:sqlite RunResult shape (empirically verified):
 *   { changes: number, lastInsertRowid: number }  ← number, NOT bigint
 * libSQL shape: lastInsertRowid is bigint — coerced here for swap-safety.
 *
 * All DB errors are caught and re-thrown as DbDriverError with a stable .code.
 */
function execStmt(db: Database, stmt: StatementParam): ResultSet {
  const { sql, args } = normalizeStmt(stmt);
  const mode = classifySql(sql);

  try {
    const prepared: BunStatement = db.prepare(sql);

    if (mode === "read") {
      const rows: Row[] = args === undefined
        ? (prepared.all() as Row[])
        : (prepared.all(args as Parameters<BunStatement["all"]>[0]) as Row[]);
      return {
        rows,
        columns: prepared.columnNames,
        rowsAffected: 0,
        lastInsertRowid: undefined,
      };
    }

    if (mode === "write-with-returning") {
      // Execute via .all() to capture RETURNING rows
      const rows: Row[] = args === undefined
        ? (prepared.all() as Row[])
        : (prepared.all(args as Parameters<BunStatement["all"]>[0]) as Row[]);

      // ⚠️  BUN-ONLY v1 WORKAROUND — DELETE THIS BLOCK AT THE TURSO SWAP, DO NOT PORT IT.
      // bun:sqlite's .all() does not return write metadata (rowsAffected / lastInsertRowid)
      // so we recover them with a follow-up query.  This two-step is race-free ONLY because
      // execStmt is entirely synchronous — no other statement can interleave between .all()
      // and the SELECT changes() query on this same connection.
      // At the Turso phase, libSQL returns rows + rowsAffected + lastInsertRowid natively in
      // a single ResultSet for every RETURNING statement.  The follow-up query below must be
      // DELETED (not ported) — two awaited async round-trips would reintroduce an interleaving
      // race that does not exist in v1.
      const meta = db.query(
        "SELECT changes() as c, last_insert_rowid() as lir",
      ).get() as { c: number; lir: number };

      // Note: for UPDATE/DELETE … RETURNING, last_insert_rowid() is connection-scoped and
      // reflects the most recent INSERT on this connection, not the current UPDATE/DELETE.
      // This is harmless parity with libSQL semantics (which also returns the last INSERT rowid
      // for UPDATE/DELETE RETURNING); documented here so callers know not to rely on it for
      // UPDATE/DELETE.  For INSERT … RETURNING it is always correct.
      return {
        rows,
        columns: prepared.columnNames,
        rowsAffected: meta.c,
        lastInsertRowid: BigInt(meta.lir),
      };
    }

    // Pure write — use .run() for RunResult
    const runResult = args === undefined
      ? prepared.run()
      : prepared.run(args as Parameters<BunStatement["run"]>[0]);
    return {
      rows: [],
      columns: [],
      rowsAffected: runResult.changes,
      lastInsertRowid: BigInt(runResult.lastInsertRowid),
    };
  } catch (e) {
    if (e instanceof DbDriverError) throw e;
    throw mapDbError(e);
  }
}

/** Normalise the two accepted stmt forms into { sql, args }. */
function normalizeStmt(stmt: StatementParam): { sql: string; args: InArgs | undefined } {
  if (typeof stmt === "string") return { sql: stmt, args: undefined };
  return { sql: stmt.sql, args: stmt.args };
}

// ---------------------------------------------------------------------------
// Connection setup (H-4 + FK)
// ---------------------------------------------------------------------------

/**
 * Apply required pragmas on every freshly opened Database connection:
 *   PRAGMA journal_mode=WAL  — concurrent reads + single writer (H-4)
 *   PRAGMA busy_timeout=5000 — 5 s retry on SQLITE_BUSY instead of instant failure (H-4)
 *   PRAGMA foreign_keys=ON   — enforce FK constraints + CASCADE rules (§2 schema, H-5)
 *
 * On an in-memory (:memory:) DB, journal_mode=WAL is silently ignored by SQLite
 * (reports "memory" back); correct and expected for test DBs.
 */
function applyConnectionPragmas(db: Database): void {
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");
  db.run("PRAGMA foreign_keys=ON");
}

// ---------------------------------------------------------------------------
// Driver factory + default singleton
// ---------------------------------------------------------------------------

/**
 * Create a Driver for the given database URL.
 *
 * @param url      SQLite file path or ":memory:". Defaults to the live workspace DB.
 *                 Pass ":memory:" or a temp path in tests to avoid touching the live DB.
 * @param _onClose Optional callback invoked when close() is called (used by getDriver()
 *                 to reset the singleton reference so the next getDriver() call reopens).
 */
export function createDriver(url?: string, _onClose?: () => void): Driver {
  const dbFilePath = url ?? defaultDbPath();

  // Ensure workspace directory exists for file-based DBs
  if (dbFilePath !== ":memory:" && !dbFilePath.startsWith(":")) {
    const dir = dbFilePath.substring(0, dbFilePath.lastIndexOf("/"));
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbFilePath);
  applyConnectionPragmas(db);

  // ---- execute ----
  async function execute(stmt: StatementParam): Promise<ResultSet> {
    return Promise.resolve(execStmt(db, stmt));
  }

  // ---- batch ----
  // All statements run atomically in an implicit transaction.
  // Any failure rolls back ALL prior statements in the batch.
  //
  // mode mapping to libSQL semantics:
  //   'write'    → BEGIN IMMEDIATE — acquires write-lock immediately (no reader→writer upgrade)
  //   'deferred' → BEGIN DEFERRED  — lazily escalates (default SQLite behavior)
  //   'read'     → BEGIN DEFERRED  — SQLite has no native read-only transaction; DEFERRED is the
  //                                   closest equivalent.  ⚠️  Swap divergence: libSQL "read" mode
  //                                   may actively reject writes inside the transaction; v1 DEFERRED
  //                                   permits them silently.  Revisit at the Turso phase.
  //
  // bun:sqlite's db.transaction() automatically issues BEGIN/COMMIT/ROLLBACK.
  // The .immediate() and .deferred() variant methods control the BEGIN type.
  // ROLLBACK on throw is automatic and rethrows the original error.
  async function batch(
    stmts: StatementParam[],
    mode: "write" | "read" | "deferred" = "write",
  ): Promise<ResultSet[]> {
    const results: ResultSet[] = [];

    const tx = db.transaction(() => {
      for (const stmt of stmts) {
        results.push(execStmt(db, stmt));
      }
    });

    try {
      if (mode === "write") {
        tx.immediate();
      } else {
        tx.deferred();
      }
    } catch (e) {
      if (e instanceof DbDriverError) throw e;
      throw mapDbError(e);
    }

    return Promise.resolve(results);
  }

  // ---- transaction ----
  // Callback style: fn receives a tx handle with execute().
  // Commits if fn resolves, rolls back + rethrows if fn rejects.
  //
  // IMPORTANT CONSTRAINT (v1, single-connection):
  //   Do NOT await non-DB work (LLM calls, file I/O, timers) inside fn.
  //   The connection is held open between BEGIN and COMMIT; no other DB operation can
  //   run on this driver until fn completes.  Concurrent batch()/transaction() calls
  //   on the same driver will deadlock.
  async function transaction<T>(fn: (tx: DriverTx) => Promise<T>): Promise<T> {
    // BEGIN: wrap so a failed BEGIN cannot silently leave state dangling
    try {
      db.run("BEGIN");
    } catch (e) {
      throw e instanceof DbDriverError ? e : mapDbError(e);
    }

    const txHandle: DriverTx = {
      execute: (stmt: StatementParam) => {
        return Promise.resolve(execStmt(db, stmt));
      },
    };

    let result: T;
    try {
      result = await fn(txHandle);
    } catch (fnErr) {
      // fn threw (or a DB op inside fn threw a DbDriverError).
      // Wrap ROLLBACK in its own try/catch: if SQLite already auto-rolled-back
      // (e.g. due to SQLITE_BUSY or constraint error that triggered implicit rollback),
      // the explicit ROLLBACK would throw "cannot rollback — no transaction is active"
      // and would mask the original error.  We always rethrow fnErr.
      try {
        db.run("ROLLBACK");
      } catch {
        // ROLLBACK failure is intentionally swallowed — original error is the meaningful one.
      }
      throw fnErr;
    }

    try {
      db.run("COMMIT");
    } catch (e) {
      // COMMIT failed (e.g. disk full).  The transaction is implicitly rolled back by SQLite.
      throw e instanceof DbDriverError ? e : mapDbError(e);
    }

    return result;
  }

  // ---- close ----
  function close(): void {
    db.close();
    _onClose?.();
  }

  return { execute, batch, transaction, close };
}

// ---------------------------------------------------------------------------
// Lazily-initialized default singleton (mirrors db.ts's getDb() convention)
// ---------------------------------------------------------------------------

let _defaultDriver: Driver | null = null;

/**
 * Returns the lazily-initialized default Driver backed by the live workspace DB.
 * The same singleton is returned on every call until close() is called.
 * After close(), the next getDriver() call creates a fresh connection.
 *
 * Tests should use createDriver(":memory:") or a temp path — never the live DB.
 */
export function getDriver(): Driver {
  if (_defaultDriver) return _defaultDriver;
  _defaultDriver = createDriver(defaultDbPath(), () => {
    _defaultDriver = null;
  });
  return _defaultDriver;
}
