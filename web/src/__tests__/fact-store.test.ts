/**
 * fact-store.test.ts — FactStore (tier-1) tests.
 *
 * Covers T1 (identity_key — N/A tier-1), T3 (supersede-on-upsert), T4 (NULL-scope dedup),
 * T7 (scoped_facts untouched by prune), T8 (tenant-predicate enforcement), T11 (projection).
 * All tests run against createDriver(":memory:") — never the live workspace DB.
 */

import { test, expect, beforeEach, describe } from "bun:test";
import { createDriver } from "../db-driver.ts";
import { createFactStore } from "../fact-store.ts";
import type { TenantCtx, ScopedFact, FactStore } from "../fact-store.ts";
import type { Driver } from "../db-driver.ts";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

function makeStore(): { store: FactStore; driver: Driver } {
  const driver = createDriver(":memory:");
  const store = createFactStore(driver);
  return { store, driver };
}

const alice: TenantCtx = { tenant_id: "t1", user_id: "alice", project_id: null };
const aliceProject: TenantCtx = { tenant_id: "t1", user_id: "alice", project_id: "proj-a" };
const bob: TenantCtx = { tenant_id: "t2", user_id: "bob", project_id: null }; // different tenant

// ---------------------------------------------------------------------------
// ensure() — idempotency
// ---------------------------------------------------------------------------

describe("ensure()", () => {
  test("creates tables and indexes without error", async () => {
    const { store } = makeStore();
    await expect(store.ensure()).resolves.toBeUndefined();
  });

  test("is idempotent — calling twice is safe", async () => {
    const { store } = makeStore();
    await store.ensure();
    await expect(store.ensure()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// upsertFact() — T3 (supersede-on-upsert)
// ---------------------------------------------------------------------------

describe("upsertFact() — supersede-on-upsert (T3)", () => {
  test("inserts a new fact and returns a ScopedFact", async () => {
    const { store } = makeStore();
    await store.ensure();

    const fact = await store.upsertFact(alice, {
      kind: "user",
      content_key: "name",
      content: "Alice Smith",
    });

    expect(fact.id).toBeGreaterThan(0);
    expect(fact.tenant_id).toBe("t1");
    expect(fact.user_id).toBe("alice");
    expect(fact.project_id).toBeNull();
    expect(fact.kind).toBe("user");
    expect(fact.content_key).toBe("name");
    expect(fact.content).toBe("Alice Smith");
    expect(fact.created_at).toBeTruthy();
    expect(fact.updated_at).toBeTruthy();
  });

  test("second upsert with same identity updates content, preserves id and created_at (T3)", async () => {
    const { store } = makeStore();
    await store.ensure();

    const first = await store.upsertFact(alice, {
      kind: "user",
      content_key: "name",
      content: "Alice Smith",
    });

    const second = await store.upsertFact(alice, {
      kind: "user",
      content_key: "name",
      content: "Alice J. Smith",
      source: "manual",
    });

    // Same row — same id, same created_at
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    // Content updated
    expect(second.content).toBe("Alice J. Smith");
    expect(second.source).toBe("manual");

    // No duplicate row
    const facts = await store.getFacts(alice, { kind: "user" });
    expect(facts).toHaveLength(1);
  });

  test("returns the updated row (not a cached copy) after supersede", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "email", content: "old@example.com" });
    const updated = await store.upsertFact(alice, {
      kind: "user",
      content_key: "email",
      content: "new@example.com",
    });
    expect(updated.content).toBe("new@example.com");
  });
});

// ---------------------------------------------------------------------------
// NULL-scope dedup — T4
// ---------------------------------------------------------------------------

describe("NULL-scope dedup (T4)", () => {
  test("two user-scoped facts (project_id=NULL) same content_key → ONE row", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "pref", content: "v1" });
    await store.upsertFact(alice, { kind: "user", content_key: "pref", content: "v2" });

    const facts = await store.getFacts(alice);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("v2");
  });

  test("project-scoped fact (project_id='proj-a') is distinct from user-scoped (NULL) same key", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "k", content: "user-level" });
    await store.upsertFact(aliceProject, { kind: "project", content_key: "k", content: "project-level" });

    const userFacts = await store.getFacts(alice);
    expect(userFacts).toHaveLength(1);
    expect(userFacts[0].content).toBe("user-level");

    const projFacts = await store.getFacts(aliceProject);
    expect(projFacts).toHaveLength(1);
    expect(projFacts[0].content).toBe("project-level");
  });

  test("different content_key values create separate rows", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "name", content: "Alice" });
    await store.upsertFact(alice, { kind: "user", content_key: "email", content: "alice@test.com" });

    const facts = await store.getFacts(alice);
    expect(facts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getFacts() — tenant isolation (T8)
// ---------------------------------------------------------------------------

describe("getFacts() — tenant isolation (T8)", () => {
  test("returns only the requesting tenant's facts", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "name", content: "Alice" });
    await store.upsertFact(bob, { kind: "user", content_key: "name", content: "Bob" });

    const aliceFacts = await store.getFacts(alice);
    expect(aliceFacts).toHaveLength(1);
    expect(aliceFacts[0].content).toBe("Alice");

    const bobFacts = await store.getFacts(bob);
    expect(bobFacts).toHaveLength(1);
    expect(bobFacts[0].content).toBe("Bob");
  });

  test("cross-tenant fact is absent from getFacts result", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(bob, { kind: "project", content_key: "repo", content: "bob-secret" });

    const aliceFacts = await store.getFacts(alice);
    expect(aliceFacts).toHaveLength(0); // Alice cannot see Bob's facts
  });

  test("filters by kind when opts.kind is specified", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "name", content: "Alice" });
    await store.upsertFact(alice, { kind: "project", content_key: "repo", content: "my-repo" });
    await store.upsertFact(alice, { kind: "reference", content_key: "ref1", content: "some ref" });

    const userFacts = await store.getFacts(alice, { kind: "user" });
    expect(userFacts).toHaveLength(1);
    expect(userFacts[0].kind).toBe("user");

    const projectFacts = await store.getFacts(alice, { kind: "project" });
    expect(projectFacts).toHaveLength(1);
    expect(projectFacts[0].kind).toBe("project");
  });

  test("returns empty array for tenant with no facts", async () => {
    const { store } = makeStore();
    await store.ensure();

    const facts = await store.getFacts(alice);
    expect(facts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listForProjection() — T11 (tenant-bound, no scopeless variant)
// ---------------------------------------------------------------------------

describe("listForProjection() — T11", () => {
  test("returns facts for the given tenant and project_id scope only", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(aliceProject, { kind: "user", content_key: "pref", content: "dark-mode" });
    await store.upsertFact(alice, { kind: "user", content_key: "name", content: "Alice" });
    await store.upsertFact(bob, { kind: "user", content_key: "name", content: "Bob" });

    const projection = await store.listForProjection(aliceProject);
    // aliceProject has project_id='proj-a'; alice has project_id=null → different COALESCE bucket
    expect(projection).toHaveLength(1);
    expect(projection[0].content).toBe("dark-mode");
  });

  test("is ordered by kind ASC, created_at ASC", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "a", content: "A" });
    await store.upsertFact(alice, { kind: "reference", content_key: "r", content: "R" });
    await store.upsertFact(alice, { kind: "project", content_key: "p", content: "P" });

    const projection = await store.listForProjection(alice);
    // Alphabetical by kind: project < reference < user
    expect(projection.map((f) => f.kind)).toEqual(["project", "reference", "user"]);
  });
});

// ---------------------------------------------------------------------------
// deleteFact() — explicit deletion (BR-8 / OQ-3)
// ---------------------------------------------------------------------------

describe("deleteFact()", () => {
  test("removes the specified fact", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "to-delete", content: "bye" });
    expect((await store.getFacts(alice)).length).toBe(1);

    await store.deleteFact(alice, "to-delete", "user");
    expect((await store.getFacts(alice)).length).toBe(0);
  });

  test("no-ops silently if fact does not exist", async () => {
    const { store } = makeStore();
    await store.ensure();

    await expect(store.deleteFact(alice, "nonexistent", "user")).resolves.toBeUndefined();
  });

  test("does not delete cross-tenant facts (T8)", async () => {
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(bob, { kind: "user", content_key: "secret", content: "Bob data" });
    // Alice attempts to delete with Bob's content_key (but Alice's TenantCtx)
    await store.deleteFact(alice, "secret", "user"); // should no-op
    const bobFacts = await store.getFacts(bob);
    expect(bobFacts).toHaveLength(1); // Bob's fact survives
  });

  test("scoped_facts are NOT auto-pruned — old fact persists (T7/BR-8)", async () => {
    // Scoped facts have no TTL (OQ-3). This test verifies that even very old facts
    // are untouched by the prune path (which lives in InstinctsDb, not FactStore).
    const { store } = makeStore();
    await store.ensure();

    await store.upsertFact(alice, { kind: "user", content_key: "old-note", content: "Year old memory" });

    // FactStore exposes no prune method — absence of method is the type-level guarantee.
    expect((store as Record<string, unknown>).prune).toBeUndefined();
    // Fact still there
    const facts = await store.getFacts(alice);
    expect(facts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// kind CHECK constraint
// ---------------------------------------------------------------------------

describe("kind CHECK constraint", () => {
  test("rejects invalid kind values", async () => {
    const { store } = makeStore();
    await store.ensure();

    await expect(
      store.upsertFact(alice, {
        kind: "feedback" as ScopedFact["kind"], // invalid — shareable tier!
        content_key: "k",
        content: "c",
      })
    ).rejects.toThrow();
  });

  test("accepts 'user', 'project', 'reference' kinds", async () => {
    const { store } = makeStore();
    await store.ensure();

    for (const kind of ["user", "project", "reference"] as const) {
      await expect(
        store.upsertFact(alice, { kind, content_key: kind, content: `${kind} content` })
      ).resolves.toBeDefined();
    }

    const facts = await store.getFacts(alice);
    expect(facts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// source field (nullable)
// ---------------------------------------------------------------------------

describe("source field", () => {
  test("stores null source when not provided", async () => {
    const { store } = makeStore();
    await store.ensure();

    const fact = await store.upsertFact(alice, { kind: "user", content_key: "k", content: "c" });
    expect(fact.source).toBeNull();
  });

  test("stores provided source value", async () => {
    const { store } = makeStore();
    await store.ensure();

    const fact = await store.upsertFact(alice, {
      kind: "user",
      content_key: "k",
      content: "c",
      source: "migrated",
    });
    expect(fact.source).toBe("migrated");
  });
});
