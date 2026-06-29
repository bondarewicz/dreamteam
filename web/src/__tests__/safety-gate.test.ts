/**
 * safety-gate.test.ts — AC-SG-1..8: Bird ruling BR-SG-3/BR-SG-4/BR-SG-5.
 *
 * Tests the new safety-gate behaviour in session-analyzer.ts:
 *   BR-SG-3: DROP gate restricted to projected fields (trigger + behavioral_shape).
 *            Evidence is excluded — a candidate MUST NOT be dropped due to evidence content.
 *   BR-SG-4: Before storing evidence_scrubbed, maskEvidence() redacts hard identifiers.
 *   BR-SG-5: Cross-field detection (trigger↔behavioral_shape) preserved even with evidence:[].
 *
 * AC-SG-1  — clean trigger+shape, evidence has .tmp/OrderApi/ → KEPT, signal recorded.
 * AC-SG-2  — kept candidate's stored evidence_scrubbed passes hard-identifier detectors.
 * AC-SG-3  — identifier in trigger (Bondarewicz/dreamteam) → DROPPED.
 * AC-SG-4  — camelCase non-allowlisted identifier in behavioral_shape → DROPPED.
 * AC-SG-5  — hard secret (sk-) in evidence → KEPT; stored evidence_scrubbed has it masked.
 * AC-SG-6  — identifier split across trigger↔behavioral_shape → DROPPED (cross-field).
 * AC-SG-7  — materialized instinct → memory-projection output has no identifier, no evidence;
 *             AC-8 self-check passes.
 * AC-SG-8  — evidence entirely an identifier → stored as "[evidence masked]", no throw.
 *
 * All tests run against in-memory SQLite; no network; no real claude -p.
 * Tests FAIL against OLD behavior and PASS with the new change.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDriver } from "../db-driver.ts";
import { createInstinctsDb } from "../instincts-db.ts";
import { createFactStore } from "../fact-store.ts";
import { createMemoryProjection, type ProjectionCtx } from "../memory-projection.ts";
import {
  createSessionAnalyzer,
  type FindingsReader,
  type LlmClient,
  type LlmResult,
  type InstinctCandidate,
  type AnalyzerCtx,
} from "../session-analyzer.ts";
import { maskEvidence } from "../instinct-scrub.ts";
import type { FindingRow } from "../sessions-db.ts";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-01-01T12:00:00.000Z";
const PROJECT = "test-project";
const TENANT = "tenant1";
const USER = "user1";

const analyzerCtx: AnalyzerCtx = { tenant_id: TENANT, project: PROJECT };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const driver = createDriver(":memory:");
  const store = createInstinctsDb(driver);
  return { store, driver };
}

function makeFindings(n: number, verdict: "warn" | "fail" = "warn"): FindingRow[] {
  return Array.from({ length: n }, (_, i) => ({
    finding_id: `sess-${i}:Q1`,
    session_id: `sess-${i}`,
    question_id: "Q1",
    verdict,
    evidence: `agent did not verify before committing in session ${i}`,
    observed_at: FIXED_NOW,
  }));
}

function makeFakeReader(rows: FindingRow[]): FindingsReader {
  return {
    async recent(_project: string, _limit: number): Promise<FindingRow[]> {
      return rows;
    },
  };
}

function makeFakeLlm(candidates: InstinctCandidate[]): LlmClient {
  return {
    async generateCandidates(): Promise<LlmResult> {
      return { candidates, timedOut: false };
    },
  };
}

function makeCandidate(overrides: Partial<InstinctCandidate> = {}): InstinctCandidate {
  return {
    trigger: "agent commits without reviewing diff",
    behavioral_shape: "always review the diff before committing",
    domain: "git",
    evidence: ["agent committed without reviewing the diff"],
    source_session_ids: ["sess-0", "sess-1", "sess-2"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-SG-1: clean trigger+shape, evidence has .tmp/OrderApi/ → KEPT (not scrubbed)
// ---------------------------------------------------------------------------

describe("AC-SG-1 — evidence with code-shape path → candidate KEPT, signal recorded", () => {
  test("evidence with .tmp/OrderApi/ does NOT cause the candidate to be dropped", async () => {
    const { store } = makeDb();
    await store.ensure();

    // OLD behavior: scrub({trigger, shape, evidence:[".tmp/OrderApi/…"]}) would fire
    // the PascalCase rule on "OrderApi" and DROP the candidate.
    // NEW behavior: scrub only sees evidence:[] so the candidate is KEPT.
    const candidate = makeCandidate({
      trigger: "agent does not verify output before pushing",
      behavioral_shape: "always verify output before pushing",
      evidence: [".tmp/OrderApi/ was the working directory during the failing session"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    // Must NOT be scrubbed
    expect(result.candidatesGenerated).toBe(1);
    expect(result.candidatesScrubbed).toBe(0);
    // Signal must be recorded for all 3 sessions
    expect(result.signalsRecorded).toBe(3);
    // Materialized at 3 sessions (BR-1 threshold met)
    expect(result.materialized).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-SG-2: stored evidence_scrubbed passes hard-identifier detectors
// ---------------------------------------------------------------------------

describe("AC-SG-2 — stored evidence_scrubbed has no raw hard identifiers", () => {
  test("stored evidence_scrubbed for .tmp/OrderApi/ evidence passes hard-identifier checks", async () => {
    const { store, driver } = makeDb();
    await store.ensure();

    const candidate = makeCandidate({
      trigger: "agent does not verify output before pushing",
      behavioral_shape: "always verify output before pushing",
      evidence: [".tmp/OrderApi/ was the working directory"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);
    expect(result.materialized).toHaveLength(1);

    // Query evidence_scrubbed from instinct_occurrences (materialized from signals_buffer)
    const rs = await driver.execute({
      sql: "SELECT evidence_scrubbed FROM instinct_occurrences ORDER BY id LIMIT 1",
      args: {},
    });
    const evStored = (rs.rows[0] as unknown as { evidence_scrubbed: string }).evidence_scrubbed;

    // The stored value must NOT contain any hard identifier patterns
    expect(evStored).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
    expect(evStored).not.toMatch(/\bghp_[A-Za-z0-9]{10,}/);
    expect(evStored).not.toMatch(/\bAKIA[A-Z0-9]{16}\b/);
    expect(evStored).not.toMatch(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    expect(evStored).not.toMatch(/(?:\/Users\/|\/home\/)[a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,63}\//);
    // The original clean text must still be present (not over-masked)
    expect(evStored).toContain(".tmp/OrderApi/");
  });
});

// ---------------------------------------------------------------------------
// AC-SG-3: identifier in TRIGGER → DROPPED
// ---------------------------------------------------------------------------

describe("AC-SG-3 — identifier in trigger → candidate DROPPED", () => {
  test("Title-case org/repo in trigger (Bondarewicz/dreamteam) → dropped, not kept", async () => {
    const { store } = makeDb();
    await store.ensure();

    // Title-case org/repo in trigger fires the filesystem-path rule (analyzer mode).
    // This must still drop even with the new evidence-exclusion change.
    const candidate = makeCandidate({
      trigger: "agent uses Bondarewicz/dreamteam project for all tasks",
      behavioral_shape: "always use the correct project reference",
      evidence: ["clean evidence with no identifiers"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesGenerated).toBe(1);
    expect(result.candidatesScrubbed).toBe(1); // DROPPED by trigger identifier
    expect(result.signalsRecorded).toBe(0);
    expect(result.materialized).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-SG-4: camelCase/PascalCase non-allowlisted in BEHAVIORAL_SHAPE → DROPPED
// ---------------------------------------------------------------------------

describe("AC-SG-4 — camelCase identifier in behavioral_shape → DROPPED", () => {
  test("camelCase non-allowlisted in behavioral_shape → dropped", async () => {
    const { store } = makeDb();
    await store.ensure();

    // "userService" is camelCase (lower + Capital + tail) → code-literal rule fires.
    // Evidence is clean; drop must come from behavioral_shape, not evidence.
    const candidate = makeCandidate({
      trigger: "agent does not handle authentication correctly",
      behavioral_shape: "agent calls userService to authenticate before each operation",
      evidence: ["clean evidence without any identifier"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesGenerated).toBe(1);
    expect(result.candidatesScrubbed).toBe(1); // DROPPED by behavioral_shape camelCase
    expect(result.signalsRecorded).toBe(0);
    expect(result.materialized).toHaveLength(0);
  });

  test("PascalCase with two capitals in behavioral_shape → dropped", async () => {
    const { store } = makeDb();
    await store.ensure();

    // "BlueSkyInc" matches PascalCase with ≥2 capitals and is not in GENERIC_TECH_ALLOWLIST.
    const candidate = makeCandidate({
      trigger: "agent interacts with external services",
      behavioral_shape: "always authenticate with BlueSkyInc before proceeding",
      evidence: ["saw this in three sessions"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesScrubbed).toBeGreaterThanOrEqual(1);
    expect(result.signalsRecorded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-SG-5: hard secret in evidence → KEPT; stored evidence_scrubbed has it masked
// ---------------------------------------------------------------------------

describe("AC-SG-5 — hard secret in evidence → candidate KEPT, secret masked in storage", () => {
  test("sk- secret in evidence → candidate not dropped; stored value has [redacted]", async () => {
    const { store, driver } = makeDb();
    await store.ensure();

    // OLD behavior: evidence with sk-... would drop the whole candidate via scrub.
    // NEW behavior: evidence excluded from DROP gate; secret masked in stored evidence_scrubbed.
    const candidate = makeCandidate({
      trigger: "agent does not rotate API keys after exposure",
      behavioral_shape: "always rotate credentials immediately after any exposure event",
      evidence: ["agent used sk-abc1234567890xyz to authenticate and left it in plaintext"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    // Candidate is KEPT — not dropped by the evidence content
    expect(result.candidatesScrubbed).toBe(0);
    expect(result.signalsRecorded).toBe(3);
    expect(result.materialized).toHaveLength(1);

    // Stored evidence_scrubbed must have the secret MASKED
    const rs = await driver.execute({
      sql: "SELECT evidence_scrubbed FROM instinct_occurrences ORDER BY id LIMIT 1",
      args: {},
    });
    const evStored = (rs.rows[0] as unknown as { evidence_scrubbed: string }).evidence_scrubbed;

    // Secret must be gone
    expect(evStored).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
    // Masked with [redacted]
    expect(evStored).toContain("[redacted]");
    // Rest of the sentence preserved (not over-masked)
    expect(evStored).toMatch(/agent used/);
  });

  test("email in evidence → candidate not dropped; email masked in storage", async () => {
    const { store, driver } = makeDb();
    await store.ensure();

    const candidate = makeCandidate({
      trigger: "agent does not sanitize contact data",
      behavioral_shape: "always sanitize personally identifiable information before logging",
      evidence: ["the session log included admin@client.io in plaintext output"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesScrubbed).toBe(0);
    expect(result.materialized).toHaveLength(1);

    const rs = await driver.execute({
      sql: "SELECT evidence_scrubbed FROM instinct_occurrences ORDER BY id LIMIT 1",
      args: {},
    });
    const evStored = (rs.rows[0] as unknown as { evidence_scrubbed: string }).evidence_scrubbed;

    // Email must be gone
    expect(evStored).not.toMatch(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    expect(evStored).toContain("[redacted]");
  });
});

// ---------------------------------------------------------------------------
// AC-SG-6: identifier split across trigger↔behavioral_shape → DROPPED (cross-field)
// ---------------------------------------------------------------------------

describe("AC-SG-6 — identifier split across trigger↔behavioral_shape → DROPPED (cross-field)", () => {
  test("eval() split across trigger↔behavioral_shape → dropped via cross-field join", async () => {
    const { store } = makeDb();
    await store.ensure();

    // Per-field: "agent calls eval" is clean (eval not followed by '(' in trigger).
    //            "('user input') for parsing" is clean (no eval in behavioral_shape).
    // Cross-field join: "agent calls eval ('user input') for parsing"
    //   → imperative-command rule \beval\s*\( fires → DROPPED.
    // With evidence:[] passed to scrub(), this cross-field detection is preserved (BR-SG-5).
    const candidate = makeCandidate({
      trigger: "agent calls eval",
      behavioral_shape: "('user input') for dynamic parsing",
      evidence: ["completely clean evidence text from three sessions"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    // Must be DROPPED via cross-field detection — BR-SG-5 preserved
    expect(result.candidatesGenerated).toBe(1);
    expect(result.candidatesScrubbed).toBe(1);
    expect(result.signalsRecorded).toBe(0);
    expect(result.materialized).toHaveLength(0);
  });

  test("clean trigger+shape are NOT dropped (cross-field negative control)", async () => {
    const { store } = makeDb();
    await store.ensure();

    // Control: both fields clean individually and in cross-field → KEPT.
    const candidate = makeCandidate({
      trigger: "agent commits without reviewing",
      behavioral_shape: "always review before committing",
      evidence: ["clean evidence"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesScrubbed).toBe(0);
    expect(result.materialized).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-SG-7: materialized instinct → memory-projection output has no identifier, no evidence
// ---------------------------------------------------------------------------

describe("AC-SG-7 — materialized instinct → projection output has no identifier, no evidence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safety-gate-proj-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("approved instinct → regenerate() outputs no identifier and no evidence; AC-8 passes", async () => {
    const driver = createDriver(":memory:");
    const idb = createInstinctsDb(driver);
    const fdb = createFactStore(driver);
    await idb.ensure();
    await fdb.ensure();

    // Seed an approved instinct with clean trigger+behavioral_shape and confidence >= 0.70.
    // Using importMigrated() which gives status='approved' and confidence=0.70 fixed.
    const cleanTrigger = "agent does not review output before finalizing";
    const cleanShape = "always review output before finalizing to catch errors";
    const ikey = idb.identityKey(cleanTrigger, "git", cleanShape);

    await idb.importMigrated({
      ctx: { tenant_id: TENANT, project: PROJECT },
      identity_key: ikey,
      trigger: cleanTrigger,
      domain: "git",
      behavioral_shape: cleanShape,
    });

    const projection = createMemoryProjection({ instincts: idb, facts: fdb });
    const projCtx: ProjectionCtx = {
      tenant_id: TENANT,
      project: PROJECT,
      user_id: USER,
      project_id: PROJECT,
    };

    // Should not throw (AC-8 self-check is embedded in regenerate)
    const result = await projection.regenerate(projCtx, tmpDir);
    expect(result.instinctsInIndex).toBe(1);

    // Read MEMORY.md — must not contain hard identifiers
    const memoryContent = fs.readFileSync(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(memoryContent).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
    expect(memoryContent).not.toMatch(/\bghp_[A-Za-z0-9]{10,}/);
    expect(memoryContent).not.toMatch(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    // Must not contain evidence_scrubbed field (instincts topic files never include raw evidence)
    expect(memoryContent).not.toContain("evidence_scrubbed");
    expect(memoryContent).not.toContain("[redacted]"); // clean instinct — no masking needed

    // Read the instinct topic file — must not contain evidence
    const topicFile = fs.readFileSync(path.join(tmpDir, `instinct_1.md`), "utf-8");
    expect(topicFile).toContain(cleanTrigger);
    expect(topicFile).toContain(cleanShape);
    // Topic file must not contain raw evidence or evidence field
    expect(topicFile).not.toContain("evidence_scrubbed");
    expect(topicFile).not.toContain("evidence");
  });
});

// ---------------------------------------------------------------------------
// AC-SG-8: evidence entirely an identifier → masked to "[evidence masked]", no throw
// ---------------------------------------------------------------------------

describe("AC-SG-8 — evidence entirely an identifier → [evidence masked], no throw", () => {
  test("evidence is only a sk- secret → stored as [evidence masked], signal still recorded", async () => {
    const { store, driver } = makeDb();
    await store.ensure();

    // OLD behavior: this would be dropped because the sk- secret fires in the per-field
    // evidence scan of scrub(). NEW behavior: evidence excluded from DROP gate; the
    // maskEvidence("sk-abc1234567890xyz") call returns "[evidence masked]" (AC-SG-8).
    const candidate = makeCandidate({
      trigger: "agent does not handle credential exposure",
      behavioral_shape: "always handle credential exposure with immediate revocation",
      evidence: ["sk-abc1234567890xyz"], // entirely an identifier
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });

    // Must not throw
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    expect(result.candidatesScrubbed).toBe(0);
    expect(result.signalsRecorded).toBe(3);
    expect(result.materialized).toHaveLength(1);

    // Stored value must be the safe placeholder
    const rs = await driver.execute({
      sql: "SELECT evidence_scrubbed FROM instinct_occurrences ORDER BY id LIMIT 1",
      args: {},
    });
    const evStored = (rs.rows[0] as unknown as { evidence_scrubbed: string }).evidence_scrubbed;
    expect(evStored).toBe("[evidence masked]");
    // Must not contain the raw secret
    expect(evStored).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
  });

  test("empty evidence → stored as [evidence masked], no throw", async () => {
    // maskEvidence("") → all-empty → "[evidence masked]"
    const result = maskEvidence("");
    expect(result).toBe("[evidence masked]");
  });

  test("maskEvidence unit: entirely-identifier string → [evidence masked]", () => {
    expect(maskEvidence("sk-abc1234567890xyz")).toBe("[evidence masked]");
    expect(maskEvidence("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk")).toBe("[evidence masked]");
  });

  test("maskEvidence unit: mixed content → identifier replaced, remainder preserved", () => {
    const masked = maskEvidence("agent used sk-abc1234567890xyz to authenticate");
    expect(masked).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
    expect(masked).toContain("[redacted]");
    expect(masked).toMatch(/agent used/);
    expect(masked).toMatch(/to authenticate/);
  });

  test("maskEvidence unit: email in evidence → email replaced", () => {
    const masked = maskEvidence("sent to user@acme.io for review");
    expect(masked).not.toMatch(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    expect(masked).toContain("[redacted]");
    expect(masked).toContain("sent to");
    expect(masked).toContain("for review");
  });

  test("maskEvidence unit: username-revealing path → username masked", () => {
    const masked = maskEvidence("found in /Users/lukasz/projects/app/config.ts");
    expect(masked).not.toMatch(/\/Users\/lukasz\//);
    expect(masked).toContain("/Users/[redacted]/");
  });

  test("maskEvidence unit: .tmp/OrderApi/ is NOT masked (soft code-shape, not hard identifier)", () => {
    const masked = maskEvidence(".tmp/OrderApi/ was the working directory");
    // PascalCase code-shape tokens and non-username-revealing paths are NOT masked
    expect(masked).toContain(".tmp/OrderApi/");
    expect(masked).not.toContain("[redacted]");
  });

  test("maskEvidence unit: Bondarewicz/dreamteam org/repo → masked (Title-case proper name)", () => {
    const masked = maskEvidence("worked in Bondarewicz/dreamteam repo");
    expect(masked).not.toContain("Bondarewicz/dreamteam");
    expect(masked).toContain("[redacted]");
  });

  // --- Regression: adjacent-pair residue (Item 1 / Kobe security review) ---
  test("maskEvidence unit: two adjacent org/repo pairs separated by single space → both masked", () => {
    // Before the fix the trailing delimiter was a consuming group: the first match
    // consumed the shared space as its suffix, leaving "Globex/Dashboard" without
    // a leading delimiter and therefore unmatched (second pair survived in plain text).
    // After the fix (lookahead), both pairs are masked.
    //
    // Because the entire string collapses to [redacted]+whitespace, AC-SG-8 fires and
    // returns "[evidence masked]" — this is correct. The key assertion is that neither
    // identifier appears in the output.
    const masked = maskEvidence("Acme/Portal Globex/Dashboard");
    expect(masked).toBe("[evidence masked]");
    expect(masked).not.toContain("Acme");
    expect(masked).not.toContain("Globex");
  });

  test("maskEvidence unit: two adjacent org/repo pairs with surrounding text → both masked, context preserved", () => {
    // Variant with non-identifier context — verifies both pairs are replaced while
    // the surrounding words survive (AC-SG-8 does NOT fire since context remains).
    const masked = maskEvidence("session from Acme/Portal and Globex/Dashboard failed");
    expect(masked).not.toContain("Acme");
    expect(masked).not.toContain("Globex");
    expect(masked).toContain("[redacted]");
    // Surrounding context must be preserved (not over-masked)
    expect(masked).toMatch(/session from/);
    expect(masked).toMatch(/failed/);
    // Both redactions present (count)
    const redactedCount = (masked.match(/\[redacted\]/g) ?? []).length;
    expect(redactedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// BR-SG-3 happy-path: identifier ONLY in evidence → NOT dropped, evidence masked
// ---------------------------------------------------------------------------

describe("BR-SG-3 — identifier only in evidence → candidate KEPT, evidence_scrubbed has [redacted]", () => {
  test("proper org/repo in evidence only → candidatesScrubbed=0, stored evidence_scrubbed masked", async () => {
    const { store, driver } = makeDb();
    await store.ensure();

    // The candidate has a clean trigger and behavioral_shape.
    // Evidence contains a Title-case org/repo pair ("Acme/Portal") — a hard identifier
    // that maskEvidence will redact. The DROP gate must NOT fire (evidence excluded from
    // scrub() per BR-SG-3). The stored evidence_scrubbed must contain [redacted].
    const candidate = makeCandidate({
      trigger: "agent does not verify assumptions before proceeding",
      behavioral_shape: "always verify assumptions with a quick sanity check before proceeding",
      evidence: ["session log from Acme/Portal showed the agent skipped verification"],
      source_session_ids: ["sess-0", "sess-1", "sess-2"],
    });

    const fakeLlm = makeFakeLlm([candidate]);
    const fakeReader = makeFakeReader(makeFindings(3));

    const analyzer = createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store, now: () => FIXED_NOW });
    const result = await analyzer.runInstinctAnalyzer(analyzerCtx);

    // Must NOT be dropped (BR-SG-3: DROP gate excludes evidence)
    expect(result.candidatesGenerated).toBe(1);
    expect(result.candidatesScrubbed).toBe(0);
    // Signal must be recorded for all 3 sessions
    expect(result.signalsRecorded).toBe(3);
    // Materialized (3 sessions meets BR-1 threshold)
    expect(result.materialized).toHaveLength(1);

    // Stored evidence_scrubbed must NOT contain the raw org/repo identifier
    const rs = await driver.execute({
      sql: "SELECT evidence_scrubbed FROM instinct_occurrences ORDER BY id LIMIT 1",
      args: {},
    });
    const evStored = (rs.rows[0] as unknown as { evidence_scrubbed: string }).evidence_scrubbed;

    // Identifier masked in storage
    expect(evStored).not.toContain("Acme/Portal");
    expect(evStored).toContain("[redacted]");
    // Rest of the sentence preserved (not over-masked)
    expect(evStored).toMatch(/session log from/);
    expect(evStored).toMatch(/showed the agent skipped verification/);
  });
});
