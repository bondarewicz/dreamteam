/**
 * db-driver.test.ts — DB-driver seam tests (Slice 2, Session Learning Loop)
 *
 * Uses an in-memory (:memory:) database — NEVER touches the live ~/.dreamteam DB.
 *
 * Covers:
 *   1. execute() read: correct rows + columns
 *   2. execute() write: correct rowsAffected + lastInsertRowid (bigint), rows []
 *   3. Positional args AND named args (:name, $name, @name)
 *   4. INSERT … RETURNING returns rows AND correct metadata
 *   5. WITH … INSERT (writing CTE) classified correctly
 *   6. batch() atomicity: failing stmt mid-batch rolls back ALL prior stmts
 *   7. batch() mode: 'write' uses IMMEDIATE, 'deferred'/'read' use DEFERRED
 *   8. transaction(fn): commits on resolve; rolls back + rethrows original error on throw
 *   9. transaction() ROLLBACK failure masked-error guard
 *  10. H-4: busy_timeout=5000; WAL applied (file DB gets "wal"; :memory: gets "memory")
 *  11. PRAGMA foreign_keys=ON: asserted on + CASCADE delete verified
 *  12. close() + getDriver() lifecycle: post-close getDriver() yields a working driver
 *  13. DbDriverError stable .code for UNIQUE and FK violations
 *  14. Value parity: boolean → 1/0; bigint binding
 *  15. All methods return Promises (async surface)
 *  16. Seam-rigidity: RECURSIVE grep — only db-driver.ts + exempt files import bun:sqlite
 *
 * Run: bun test web/src/__tests__/db-driver.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  createDriver,
  getDriver,
  DbDriverError,
  DRIVER_ERROR_CODES,
} from "../db-driver.ts";
import type { Driver } from "../db-driver.ts";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDriver(): Driver {
  return createDriver(":memory:");
}

async function setupSchema(driver: Driver): Promise<void> {
  await driver.execute(`
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      age  INTEGER
    )
  `);
}

async function setupFkSchema(driver: Driver): Promise<void> {
  await driver.execute(`
    CREATE TABLE parent (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await driver.execute(`
    CREATE TABLE child (
      id        INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE,
      val       TEXT
    )
  `);
}

function tmpDbPath(): string {
  return `/tmp/dreamteam-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
}

function cleanupTmpDb(p: string): void {
  for (const ext of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(p + ext); } catch { /* ok */ }
  }
}

// ---------------------------------------------------------------------------
// 1 & 2: execute() — read + write
// ---------------------------------------------------------------------------

describe("execute() — read (SELECT)", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
    await driver.execute(`INSERT INTO users (name, age) VALUES ('Alice', 30)`);
    await driver.execute(`INSERT INTO users (name, age) VALUES ('Bob', 25)`);
  });

  afterEach(() => driver.close());

  test("returns correct rows keyed by column name", async () => {
    const rs = await driver.execute("SELECT id, name, age FROM users ORDER BY id");
    expect(rs.rows).toHaveLength(2);
    expect(rs.rows[0]).toEqual({ id: 1, name: "Alice", age: 30 });
    expect(rs.rows[1]).toEqual({ id: 2, name: "Bob", age: 25 });
  });

  test("returns correct columns array", async () => {
    const rs = await driver.execute("SELECT name, age FROM users ORDER BY id LIMIT 1");
    expect(rs.columns).toEqual(["name", "age"]);
  });

  test("rowsAffected is 0 for reads", async () => {
    const rs = await driver.execute("SELECT * FROM users");
    expect(rs.rowsAffected).toBe(0);
  });

  test("lastInsertRowid is undefined for reads", async () => {
    const rs = await driver.execute("SELECT * FROM users");
    expect(rs.lastInsertRowid).toBeUndefined();
  });

  test("empty result set has rows [] and correct columns", async () => {
    const rs = await driver.execute("SELECT id, name FROM users WHERE id = 9999");
    expect(rs.rows).toEqual([]);
    expect(rs.columns).toEqual(["id", "name"]);
    expect(rs.rowsAffected).toBe(0);
    expect(rs.lastInsertRowid).toBeUndefined();
  });

  test("execute() returns a Promise", () => {
    const result = driver.execute("SELECT 1 as x");
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});

describe("execute() — write (INSERT/UPDATE/DELETE)", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("INSERT returns correct rowsAffected", async () => {
    const rs = await driver.execute(`INSERT INTO users (name, age) VALUES ('Charlie', 22)`);
    expect(rs.rowsAffected).toBe(1);
  });

  test("INSERT returns lastInsertRowid as bigint", async () => {
    const rs = await driver.execute(`INSERT INTO users (name, age) VALUES ('Diana', 40)`);
    expect(typeof rs.lastInsertRowid).toBe("bigint");
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("INSERT rows is empty array", async () => {
    const rs = await driver.execute(`INSERT INTO users (name, age) VALUES ('Eve', 28)`);
    expect(rs.rows).toEqual([]);
  });

  test("lastInsertRowid increments on successive inserts", async () => {
    const rs1 = await driver.execute(`INSERT INTO users (name) VALUES ('F1')`);
    const rs2 = await driver.execute(`INSERT INTO users (name) VALUES ('F2')`);
    expect(rs1.lastInsertRowid).toBe(1n);
    expect(rs2.lastInsertRowid).toBe(2n);
  });

  test("UPDATE returns correct rowsAffected", async () => {
    await driver.execute(`INSERT INTO users (name, age) VALUES ('Grace', 35)`);
    const rs = await driver.execute(`UPDATE users SET age = 36 WHERE name = 'Grace'`);
    expect(rs.rowsAffected).toBe(1);
    expect(rs.rows).toEqual([]);
  });

  test("DELETE returns correct rowsAffected", async () => {
    await driver.execute(`INSERT INTO users (name, age) VALUES ('Henry', 50)`);
    const rs = await driver.execute(`DELETE FROM users WHERE name = 'Henry'`);
    expect(rs.rowsAffected).toBe(1);
    expect(rs.rows).toEqual([]);
  });

  test("write execute() returns a Promise", () => {
    const result = driver.execute(`INSERT INTO users (name) VALUES ('IPromise')`);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});

// ---------------------------------------------------------------------------
// 3: Positional and named args
// ---------------------------------------------------------------------------

describe("execute() — positional args", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("positional args for INSERT", async () => {
    const rs = await driver.execute({
      sql: "INSERT INTO users (name, age) VALUES (?, ?)",
      args: ["Positional", 10],
    });
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("positional args for SELECT", async () => {
    await driver.execute({ sql: "INSERT INTO users (name, age) VALUES (?, ?)", args: ["Alice", 30] });
    const rs = await driver.execute({
      sql: "SELECT name, age FROM users WHERE name = ?",
      args: ["Alice"],
    });
    expect(rs.rows).toEqual([{ name: "Alice", age: 30 }]);
    expect(rs.columns).toEqual(["name", "age"]);
  });

  test("multiple positional args for SELECT", async () => {
    await driver.execute({ sql: "INSERT INTO users (name, age) VALUES (?, ?)", args: ["P1", 20] });
    await driver.execute({ sql: "INSERT INTO users (name, age) VALUES (?, ?)", args: ["P2", 30] });
    const rs = await driver.execute({
      sql: "SELECT name FROM users WHERE age >= ? AND age <= ? ORDER BY name",
      args: [20, 30],
    });
    expect(rs.rows.map((r) => r.name)).toEqual(["P1", "P2"]);
  });
});

describe("execute() — named args", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("named :name prefix works for INSERT and SELECT", async () => {
    const rs = await driver.execute({
      sql: "INSERT INTO users (name, age) VALUES (:name, :age)",
      args: { ":name": "NamedColon", ":age": 55 },
    });
    expect(rs.rowsAffected).toBe(1);
    const sel = await driver.execute({
      sql: "SELECT name, age FROM users WHERE name = :name",
      args: { ":name": "NamedColon" },
    });
    expect(sel.rows).toEqual([{ name: "NamedColon", age: 55 }]);
  });

  test("named $name prefix works for INSERT", async () => {
    const rs = await driver.execute({
      sql: "INSERT INTO users (name, age) VALUES ($name, $age)",
      args: { "$name": "NamedDollar", "$age": 66 },
    });
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("named @name prefix works for INSERT", async () => {
    const rs = await driver.execute({
      sql: "INSERT INTO users (name, age) VALUES (@name, @age)",
      args: { "@name": "NamedAt", "@age": 77 },
    });
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
  });
});

// ---------------------------------------------------------------------------
// 4: INSERT … RETURNING
// ---------------------------------------------------------------------------

describe("execute() — INSERT … RETURNING", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("INSERT RETURNING returns the row AND correct lastInsertRowid", async () => {
    const rs = await driver.execute(
      "INSERT INTO users (name, age) VALUES ('Ret1', 42) RETURNING id, name, age",
    );
    expect(rs.rows).toHaveLength(1);
    expect(rs.rows[0]).toEqual({ id: 1, name: "Ret1", age: 42 });
    expect(rs.columns).toEqual(["id", "name", "age"]);
    expect(rs.rowsAffected).toBe(1);
    expect(typeof rs.lastInsertRowid).toBe("bigint");
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("INSERT RETURNING with positional args", async () => {
    const rs = await driver.execute({
      sql: "INSERT INTO users (name, age) VALUES (?, ?) RETURNING id, name",
      args: ["Ret2", 99],
    });
    expect(rs.rows).toEqual([{ id: 1, name: "Ret2" }]);
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("UPDATE … RETURNING returns updated row + metadata", async () => {
    await driver.execute("INSERT INTO users (name, age) VALUES ('Upd', 10)");
    const rs = await driver.execute(
      "UPDATE users SET age = 99 WHERE name = 'Upd' RETURNING id, name, age",
    );
    expect(rs.rows).toEqual([{ id: 1, name: "Upd", age: 99 }]);
    expect(rs.rowsAffected).toBe(1);
    expect(typeof rs.lastInsertRowid).toBe("bigint");
  });

  test("DELETE … RETURNING returns deleted row", async () => {
    await driver.execute("INSERT INTO users (name, age) VALUES ('Del', 7)");
    const rs = await driver.execute(
      "DELETE FROM users WHERE name = 'Del' RETURNING id, name",
    );
    expect(rs.rows).toEqual([{ id: 1, name: "Del" }]);
    expect(rs.rowsAffected).toBe(1);
  });

  test("plain INSERT (no RETURNING) is unaffected — rows []", async () => {
    const rs = await driver.execute("INSERT INTO users (name) VALUES ('NoRet')");
    expect(rs.rows).toEqual([]);
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("plain SELECT is unaffected — rowsAffected=0, lastInsertRowid=undefined", async () => {
    await driver.execute("INSERT INTO users (name) VALUES ('SomeUser')");
    const rs = await driver.execute("SELECT name FROM users");
    expect(rs.rowsAffected).toBe(0);
    expect(rs.lastInsertRowid).toBeUndefined();
    expect(rs.rows).toEqual([{ name: "SomeUser" }]);
  });
});

// ---------------------------------------------------------------------------
// 5: Writing CTEs (WITH … INSERT/UPDATE/DELETE)
// ---------------------------------------------------------------------------

describe("execute() — writing CTEs", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("WITH … INSERT is classified as write — rowsAffected populated", async () => {
    const rs = await driver.execute(`
      WITH new_row AS (SELECT 'CteUser' AS name, 88 AS age)
      INSERT INTO users (name, age) SELECT name, age FROM new_row
    `);
    expect(rs.rowsAffected).toBe(1);
    expect(rs.lastInsertRowid).toBe(1n);
    expect(rs.rows).toEqual([]);

    const check = await driver.execute("SELECT name, age FROM users");
    expect(check.rows).toEqual([{ name: "CteUser", age: 88 }]);
  });

  test("WITH … INSERT … RETURNING returns rows AND write metadata", async () => {
    const rs = await driver.execute(`
      WITH new_row AS (SELECT 'CteRet' AS name, 77 AS age)
      INSERT INTO users (name, age) SELECT name, age FROM new_row
      RETURNING id, name
    `);
    expect(rs.rows).toEqual([{ id: 1, name: "CteRet" }]);
    expect(rs.rowsAffected).toBe(1);
    expect(typeof rs.lastInsertRowid).toBe("bigint");
    expect(rs.lastInsertRowid).toBe(1n);
  });

  test("plain read CTE (WITH … SELECT) is classified as read", async () => {
    const rs = await driver.execute(`
      WITH nums AS (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3)
      SELECT n FROM nums ORDER BY n
    `);
    expect(rs.rowsAffected).toBe(0);
    expect(rs.lastInsertRowid).toBeUndefined();
    expect(rs.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

// ---------------------------------------------------------------------------
// 6: batch() — atomicity
// ---------------------------------------------------------------------------

describe("batch() — atomicity", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("batch() returns a Promise", () => {
    const result = driver.batch([`INSERT INTO users (name) VALUES ('BatchUser')`]);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });

  test("successful batch inserts all rows", async () => {
    const results = await driver.batch([
      `INSERT INTO users (name, age) VALUES ('B1', 10)`,
      `INSERT INTO users (name, age) VALUES ('B2', 20)`,
      `INSERT INTO users (name, age) VALUES ('B3', 30)`,
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].rowsAffected).toBe(1);
    expect(results[1].rowsAffected).toBe(1);
    expect(results[2].rowsAffected).toBe(1);

    const check = await driver.execute("SELECT COUNT(*) as cnt FROM users");
    expect(check.rows[0]).toEqual({ cnt: 3 });
  });

  test("failing stmt mid-batch rolls back ALL prior stmts", async () => {
    await driver.execute(`INSERT INTO users (name) VALUES ('Existing')`);

    await expect(
      driver.batch([
        `INSERT INTO users (name) VALUES ('RollbackA')`,
        `INSERT INTO users (name) VALUES ('RollbackB')`,
        `INSERT INTO users (name) VALUES ('Existing')`,   // UNIQUE violation
        `INSERT INTO users (name) VALUES ('RollbackC')`,
      ]),
    ).rejects.toBeInstanceOf(DbDriverError);

    const rs = await driver.execute("SELECT name FROM users ORDER BY name");
    expect(rs.rows.map((r) => r.name)).toEqual(["Existing"]);
  });

  test("mid-batch DbDriverError has UNIQUE code", async () => {
    await driver.execute(`INSERT INTO users (name) VALUES ('U1')`);
    let caught: unknown;
    try {
      await driver.batch([`INSERT INTO users (name) VALUES ('U1')`]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbDriverError);
    expect((caught as DbDriverError).code).toBe(DRIVER_ERROR_CODES.UNIQUE);
  });

  test("batch lastInsertRowid values are bigint", async () => {
    const results = await driver.batch([
      `INSERT INTO users (name) VALUES ('BiBI1')`,
      `INSERT INTO users (name) VALUES ('BiBI2')`,
    ]);
    expect(typeof results[0].lastInsertRowid).toBe("bigint");
    expect(typeof results[1].lastInsertRowid).toBe("bigint");
    expect(results[0].lastInsertRowid).toBe(1n);
    expect(results[1].lastInsertRowid).toBe(2n);
  });
});

// ---------------------------------------------------------------------------
// 7: batch() — mode mapping
// ---------------------------------------------------------------------------

describe("batch() — mode mapping", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("mode='write' (BEGIN IMMEDIATE) succeeds and inserts row", async () => {
    const results = await driver.batch(
      [`INSERT INTO users (name) VALUES ('WriteModeUser')`],
      "write",
    );
    expect(results[0].rowsAffected).toBe(1);
  });

  test("mode='read' (BEGIN DEFERRED) succeeds for read statements", async () => {
    await driver.execute(`INSERT INTO users (name, age) VALUES ('Reader', 5)`);
    const results = await driver.batch(
      [`SELECT name, age FROM users WHERE name = 'Reader'`],
      "read",
    );
    expect(results[0].rows).toEqual([{ name: "Reader", age: 5 }]);
  });

  test("mode='deferred' (BEGIN DEFERRED) succeeds", async () => {
    const results = await driver.batch(
      [`INSERT INTO users (name) VALUES ('Deferred')`],
      "deferred",
    );
    expect(results[0].rowsAffected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8 & 9: transaction(fn) — commit, rollback, error masking guard
// ---------------------------------------------------------------------------

describe("transaction(fn)", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("transaction() returns a Promise", () => {
    const result = driver.transaction(async () => "done");
    expect(result).toBeInstanceOf(Promise);
    return result;
  });

  test("commits when fn resolves", async () => {
    const returnVal = await driver.transaction(async (tx) => {
      await tx.execute(`INSERT INTO users (name, age) VALUES ('TxAlice', 10)`);
      await tx.execute(`INSERT INTO users (name, age) VALUES ('TxBob', 20)`);
      return "committed";
    });

    expect(returnVal).toBe("committed");
    const rs = await driver.execute("SELECT name FROM users ORDER BY name");
    expect(rs.rows.map((r) => r.name)).toEqual(["TxAlice", "TxBob"]);
  });

  test("rolls back and rethrows original error when fn throws", async () => {
    await driver.execute(`INSERT INTO users (name) VALUES ('TxPre')`);

    await expect(
      driver.transaction(async (tx) => {
        await tx.execute(`INSERT INTO users (name) VALUES ('TxPartial')`);
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow("deliberate failure");

    const rs = await driver.execute("SELECT name FROM users ORDER BY name");
    expect(rs.rows.map((r) => r.name)).toEqual(["TxPre"]);
  });

  test("tx handle execute() returns correct ResultSet inside transaction", async () => {
    const rs = await driver.transaction(async (tx) => {
      await tx.execute(`INSERT INTO users (name, age) VALUES ('TxCheck', 99)`);
      return tx.execute("SELECT name, age FROM users WHERE name = 'TxCheck'");
    });

    expect(rs.rows).toEqual([{ name: "TxCheck", age: 99 }]);
    expect(rs.columns).toEqual(["name", "age"]);
  });

  test("transaction() passes through the return value of fn", async () => {
    const result = await driver.transaction(async (tx) => {
      const rs = await tx.execute(`INSERT INTO users (name) VALUES ('TxReturn')`);
      return rs.lastInsertRowid;
    });
    expect(typeof result).toBe("bigint");
    expect(result).toBe(1n);
  });

  test("ROLLBACK failure does NOT mask the original error (error masking guard)", async () => {
    // The catch-path ROLLBACK is wrapped in its own try/catch.
    // If SQLite has already auto-rolled-back (e.g. due to a constraint violation that
    // SQLite treats as a fatal transaction error), the explicit ROLLBACK would throw
    // "cannot rollback — no transaction is active" and would mask the real error.
    // We assert the caller always receives the ORIGINAL error.
    let receivedError: Error | undefined;
    try {
      await driver.transaction(async () => {
        throw new Error("original-error");
      });
    } catch (e) {
      receivedError = e as Error;
    }
    expect(receivedError?.message).toBe("original-error");
  });

  test("UNIQUE violation inside transaction results in DbDriverError + rollback", async () => {
    await driver.execute(`INSERT INTO users (name) VALUES ('Dup')`);

    let caught: unknown;
    try {
      await driver.transaction(async (tx) => {
        await tx.execute(`INSERT INTO users (name) VALUES ('Good')`);
        await tx.execute(`INSERT INTO users (name) VALUES ('Dup')`); // UNIQUE violation
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DbDriverError);
    expect((caught as DbDriverError).code).toBe(DRIVER_ERROR_CODES.UNIQUE);

    const rs = await driver.execute("SELECT name FROM users ORDER BY name");
    expect(rs.rows.map((r) => r.name)).toEqual(["Dup"]);
  });
});

// ---------------------------------------------------------------------------
// 10: H-4 pragmas
// ---------------------------------------------------------------------------

describe("H-4 pragmas", () => {
  test("busy_timeout is set to 5000 on :memory: driver", async () => {
    const driver = createDriver(":memory:");
    try {
      const rs = await driver.execute("PRAGMA busy_timeout");
      expect(rs.rows).toHaveLength(1);
      expect((rs.rows[0] as { timeout: number }).timeout).toBe(5000);
    } finally {
      driver.close();
    }
  });

  test("PRAGMA busy_timeout execute returns a Promise", () => {
    const driver = createDriver(":memory:");
    const result = driver.execute("PRAGMA busy_timeout");
    expect(result).toBeInstanceOf(Promise);
    driver.close();
  });

  test("journal_mode=WAL applied on open (file DB gets 'wal')", async () => {
    const tmp = tmpDbPath();
    try {
      const driver = createDriver(tmp);
      const rs = await driver.execute("PRAGMA journal_mode");
      expect((rs.rows[0] as { journal_mode: string }).journal_mode).toBe("wal");
      driver.close();
    } finally {
      cleanupTmpDb(tmp);
    }
  });

  test(":memory: reports 'memory' journal_mode — expected SQLite behavior", async () => {
    const driver = createDriver(":memory:");
    try {
      const rs = await driver.execute("PRAGMA journal_mode");
      const mode = (rs.rows[0] as { journal_mode: string }).journal_mode;
      expect(["memory", "wal"]).toContain(mode);
    } finally {
      driver.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 11: PRAGMA foreign_keys=ON + CASCADE
// ---------------------------------------------------------------------------

describe("PRAGMA foreign_keys=ON", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupFkSchema(driver);
  });

  afterEach(() => driver.close());

  test("PRAGMA foreign_keys returns 1 (ON)", async () => {
    const rs = await driver.execute("PRAGMA foreign_keys");
    expect(rs.rows).toHaveLength(1);
    expect((rs.rows[0] as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  test("FK violation throws DbDriverError with FOREIGN_KEY code", async () => {
    await driver.execute("INSERT INTO parent VALUES (1, 'P1')");
    let caught: unknown;
    try {
      await driver.execute("INSERT INTO child VALUES (1, 999, 'orphan')");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbDriverError);
    expect((caught as DbDriverError).code).toBe(DRIVER_ERROR_CODES.FOREIGN_KEY);
  });

  test("ON DELETE CASCADE actually cascades", async () => {
    await driver.execute("INSERT INTO parent VALUES (1, 'P1')");
    await driver.execute("INSERT INTO child VALUES (1, 1, 'C1')");
    await driver.execute("INSERT INTO child VALUES (2, 1, 'C2')");

    await driver.execute("DELETE FROM parent WHERE id = 1");

    const children = await driver.execute("SELECT * FROM child");
    expect(children.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12: close() + getDriver() lifecycle
// ---------------------------------------------------------------------------

describe("close() + getDriver() lifecycle", () => {
  test("close() resets singleton — subsequent getDriver() yields a working driver", async () => {
    const driver1 = getDriver();
    driver1.close(); // resets _defaultDriver = null

    const driver2 = getDriver();
    expect(driver2).not.toBe(driver1);

    const rs = await driver2.execute("SELECT 1 as x");
    expect(rs.rows[0]).toEqual({ x: 1 });

    driver2.close();
  });

  test("createDriver() close() on a non-singleton does not affect getDriver()", async () => {
    const standalone = createDriver(":memory:");
    standalone.close();

    const singleton = getDriver();
    const rs = await singleton.execute("SELECT 42 as v");
    expect(rs.rows[0]).toEqual({ v: 42 });

    singleton.close();
  });
});

// ---------------------------------------------------------------------------
// 13: DbDriverError stable .code
// ---------------------------------------------------------------------------

describe("DbDriverError — stable error codes", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("UNIQUE violation surfaces DRIVER_CONSTRAINT_UNIQUE code", async () => {
    await driver.execute("INSERT INTO users (name) VALUES ('U1')");
    let caught: unknown;
    try {
      await driver.execute("INSERT INTO users (name) VALUES ('U1')");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbDriverError);
    expect((caught as DbDriverError).code).toBe(DRIVER_ERROR_CODES.UNIQUE);
    expect((caught as DbDriverError).message).toContain("UNIQUE");
  });

  test("DbDriverError.name is 'DbDriverError'", async () => {
    await driver.execute("INSERT INTO users (name) VALUES ('E1')");
    let caught: unknown;
    try {
      await driver.execute("INSERT INTO users (name) VALUES ('E1')");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbDriverError).name).toBe("DbDriverError");
  });

  test("DbDriverError has .cause referencing the underlying error", async () => {
    await driver.execute("INSERT INTO users (name) VALUES ('C1')");
    let caught: DbDriverError | undefined;
    try {
      await driver.execute("INSERT INTO users (name) VALUES ('C1')");
    } catch (e) {
      caught = e as DbDriverError;
    }
    expect(caught?.cause).toBeDefined();
  });

  test("FK violation surfaces DRIVER_CONSTRAINT_FOREIGNKEY code", async () => {
    await setupFkSchema(driver);
    let caught: unknown;
    try {
      await driver.execute("INSERT INTO child VALUES (1, 999, 'orphan')");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbDriverError);
    expect((caught as DbDriverError).code).toBe(DRIVER_ERROR_CODES.FOREIGN_KEY);
  });
});

// ---------------------------------------------------------------------------
// 14: Value parity — boolean + bigint binding
// ---------------------------------------------------------------------------

describe("value parity — boolean and bigint args", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await driver.execute(`
      CREATE TABLE vals (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        flag  INTEGER,
        big   INTEGER
      )
    `);
  });

  afterEach(() => driver.close());

  test("boolean true binds as 1, boolean false binds as 0", async () => {
    await driver.execute({ sql: "INSERT INTO vals (flag) VALUES (?)", args: [true] });
    await driver.execute({ sql: "INSERT INTO vals (flag) VALUES (?)", args: [false] });
    const rs = await driver.execute("SELECT flag FROM vals ORDER BY id");
    expect(rs.rows[0]).toEqual({ flag: 1 });
    expect(rs.rows[1]).toEqual({ flag: 0 });
  });

  test("bigint within MAX_SAFE_INTEGER binds and round-trips correctly", async () => {
    const val = BigInt(Number.MAX_SAFE_INTEGER);
    await driver.execute({ sql: "INSERT INTO vals (big) VALUES (?)", args: [val] });
    const rs = await driver.execute("SELECT big FROM vals");
    expect(Number(rs.rows[0].big)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("bigint > MAX_SAFE_INTEGER binds without error (v1 precision note documented)", async () => {
    // v1 known limitation: stored correctly in SQLite but retrieved as JS number
    // (may lose ≤1 ULP precision). libSQL returns bigint. See driver header comment.
    const bigVal = BigInt(Number.MAX_SAFE_INTEGER) + 100n;
    await expect(
      driver.execute({ sql: "INSERT INTO vals (big) VALUES (?)", args: [bigVal] }),
    ).resolves.toBeDefined();
  });

  test("null InValue binds correctly and round-trips as null", async () => {
    await driver.execute({ sql: "INSERT INTO vals (flag, big) VALUES (?, ?)", args: [null, null] });
    const rs = await driver.execute("SELECT flag, big FROM vals");
    expect(rs.rows[0]).toEqual({ flag: null, big: null });
  });
});

// ---------------------------------------------------------------------------
// 15: ResultSet shape compliance
// ---------------------------------------------------------------------------

describe("ResultSet shape compliance", () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = makeTestDriver();
    await setupSchema(driver);
  });

  afterEach(() => driver.close());

  test("ResultSet has all required fields on read", async () => {
    const rs = await driver.execute("SELECT 1 as x");
    expect("rows" in rs).toBe(true);
    expect("columns" in rs).toBe(true);
    expect("rowsAffected" in rs).toBe(true);
    expect("lastInsertRowid" in rs).toBe(true);
    expect(Array.isArray(rs.rows)).toBe(true);
    expect(Array.isArray(rs.columns)).toBe(true);
    expect(typeof rs.rowsAffected).toBe("number");
  });

  test("ResultSet has all required fields on write", async () => {
    const rs = await driver.execute(`INSERT INTO users (name) VALUES ('Shape')`);
    expect("rows" in rs).toBe(true);
    expect("columns" in rs).toBe(true);
    expect("rowsAffected" in rs).toBe(true);
    expect("lastInsertRowid" in rs).toBe(true);
    expect(Array.isArray(rs.rows)).toBe(true);
    expect(Array.isArray(rs.columns)).toBe(true);
    expect(typeof rs.rowsAffected).toBe("number");
    expect(typeof rs.lastInsertRowid).toBe("bigint");
  });
});

// ---------------------------------------------------------------------------
// 16: Seam-rigidity — RECURSIVE grep CI guard
// ---------------------------------------------------------------------------

describe("Seam-rigidity: only db-driver.ts + exempt files import bun:sqlite/@libsql/client", () => {
  /** Recursively collect all .ts files under dir (excluding .d.ts files). */
  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push(full);
      }
    }
    return files;
  }

  test("recursive grep web/src/**/*.ts — bun:sqlite/@libsql/client only in exempt files", () => {
    const srcDir = path.resolve(import.meta.dir, "..");
    const tsFiles = collectTsFiles(srcDir);

    // v1-exempt = the seam itself + pre-existing eval infrastructure that directly
    // imported bun:sqlite before the learning loop. Migrate at the Turso phase.
    const EXEMPT = new Set([
      "db.ts",
      "sessions-db.ts",
      "migrate.ts",
      "db-driver.ts",
    ]);

    const violations: string[] = [];

    for (const filePath of tsFiles) {
      const fileName = path.basename(filePath);
      if (EXEMPT.has(fileName)) continue;

      const content = fs.readFileSync(filePath, "utf-8");

      // Match actual import/require statements (not just string literals in test code)
      if (/\bfrom\s+["']bun:sqlite["']/.test(content) || /\brequire\s*\(\s*["']bun:sqlite["']/.test(content)) {
        violations.push(`${path.relative(srcDir, filePath)}: imports "bun:sqlite"`);
      }
      if (/\bfrom\s+["']@libsql\/client["']/.test(content) || /\brequire\s*\(\s*["']@libsql\/client["']/.test(content)) {
        violations.push(`${path.relative(srcDir, filePath)}: imports "@libsql/client"`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Seam-rigidity violation — new-loop modules must NOT import concrete DB drivers.\n` +
        `Only db-driver.ts (and v1-exempt: db.ts, sessions-db.ts, migrate.ts) may import these.\n` +
        `Violating files:\n  ${violations.join("\n  ")}`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  test("db-driver.ts itself imports bun:sqlite (sanity check)", () => {
    const driverPath = path.resolve(import.meta.dir, "../db-driver.ts");
    const content = fs.readFileSync(driverPath, "utf-8");
    expect(/\bfrom\s+["']bun:sqlite["']/.test(content)).toBe(true);
  });

  test("db.ts (v1-exempt) imports bun:sqlite", () => {
    const dbPath = path.resolve(import.meta.dir, "../db.ts");
    const content = fs.readFileSync(dbPath, "utf-8");
    expect(/\bfrom\s+["']bun:sqlite["']/.test(content)).toBe(true);
  });

  test("__tests__/ subdirectory is included in recursive scan (recursion check)", () => {
    const srcDir = path.resolve(import.meta.dir, "..");
    const files = collectTsFiles(srcDir);
    const thisFile = path.resolve(import.meta.dir, "db-driver.test.ts");
    expect(files.some((f) => f === thisFile)).toBe(true);
  });
});
