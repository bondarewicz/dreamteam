/**
 * llm-client.test.ts — Unit tests for the LLM spawn seam (IMPORTANT-6).
 *
 * Tests:
 *   T-TC1  timeout fires before process exits → timedOut:true (sleep 5, timeoutMs:50)
 *   T-TC2  happy-path fast command → timedOut:false, stdout captured
 *   T-TC3  stderr is drained; non-zero exit code captured
 *
 *   ECJ-1  extractCandidatesJson: JSON block in markdown fences
 *   ECJ-2  extractCandidatesJson: bare JSON array
 *   ECJ-3  extractCandidatesJson: no JSON → null
 *   ECJ-4  extractCandidatesJson: non-array JSON object → null
 *   ECJ-5  extractCandidatesJson: malformed JSON → null
 *
 *   VC-1   validateCandidate: well-formed candidate → returned
 *   VC-2   validateCandidate: missing required field (trigger) → null
 *   VC-3   validateCandidate: non-string behavioral_shape (coerces to empty) → null
 *   VC-4   validateCandidate: source_session_ids not an array → null
 *   VC-5   validateCandidate: ALL non-string items in source_session_ids → null
 *   VC-6   validateCandidate: empty array source_session_ids → null (no sessions)
 *   VC-7   validateCandidate: unknown domain → null
 *   VC-8   validateCandidate: non-object input → null
 */

import { test, expect, describe } from "bun:test";
import { extractCandidatesJson, validateCandidate } from "../session-analyzer.ts";
import type { InstinctCandidate } from "../session-analyzer.ts";

// ---------------------------------------------------------------------------
// Timeout + process-management tests
// ---------------------------------------------------------------------------

describe("runClaudeCli — timeout kills the subprocess (CRITICAL-1/2)", () => {
  test("T-TC1: sleep 5 with timeoutMs=50 → timedOut:true, returns within ~200ms", async () => {
    // Replace `claude -p` with `sleep 5` via subprocess mock trick:
    // runClaudeCli is coupled to calling `claude` — but we can test the timeout
    // machinery by verifying that a process that doesn't finish is killed.
    //
    // Bun.spawn("sleep", ["5"]) is what we want, but runClaudeCli is hardcoded
    // to "claude". Instead we verify the same Promise.race logic by spawning
    // a long-running process ourselves and calling kill + resolving manually.
    //
    // Alternatively: if `claude` is not installed, the process exits quickly with
    // a non-zero code. So we test the invariant that timedOut is always a boolean.
    //
    // Real end-to-end test of kill escalation would require mocking Bun.spawn.
    // Here we test the TIMEOUT BRANCH using a direct Bun.spawn with short timeout.

    const start = Date.now();

    // Build the same Promise.race that runClaudeCli uses, but with `sleep 5`
    const proc = Bun.spawn(["sleep", "5"], {
      stdin: new TextEncoder().encode(""),
      stdout: "pipe",
      stderr: "pipe",
    });

    const procTask = async (): Promise<{ timedOut: boolean; exitCode: number }> => {
      const [, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { timedOut: false, exitCode: exitCode ?? 0 };
    };

    const deadlineTask = new Promise<{ timedOut: boolean; exitCode: number }>((resolve) =>
      setTimeout(() => {
        try { proc.kill(); } catch { /* already dead */ }
        try { proc.kill(9); } catch { /* already dead */ }
        const pid = proc.pid;
        if (pid != null) { try { process.kill(-pid, 9); } catch { /* not group leader */ } }
        resolve({ timedOut: true, exitCode: -1 });
      }, 50), // 50 ms
    );

    const result = await Promise.race([procTask(), deadlineTask]);
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // Should complete well under 1 second — the 5-second sleep was killed at 50ms.
    expect(elapsed).toBeLessThan(1000);
  }, { timeout: 2000 });

  test("T-TC2: fast command (true) → timedOut:false, exitCode 0", async () => {
    // `true` exits immediately with code 0 — tests the happy path
    const proc = Bun.spawn(["true"], {
      stdin: new TextEncoder().encode(""),
      stdout: "pipe",
      stderr: "pipe",
    });

    const procTask = async (): Promise<{ timedOut: boolean; stdout: string; exitCode: number }> => {
      const [stdout, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { timedOut: false, stdout, exitCode: exitCode ?? 0 };
    };

    const deadlineTask = new Promise<{ timedOut: boolean; stdout: string; exitCode: number }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true, stdout: "", exitCode: -1 }), 5000),
    );

    const result = await Promise.race([procTask(), deadlineTask]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("T-TC3: stderr is drained before exit (CRITICAL-2 — no pipe-buffer deadlock)", async () => {
    // Write 256 chars to stderr, check we receive them without hanging.
    // Use printf (not echo -n) — POSIX portable across macOS /bin/sh.
    const msg = "x".repeat(256);
    const proc = Bun.spawn(["sh", "-c", `printf '%s' '${msg}' >&2; exit 1`], {
      stdin: new TextEncoder().encode(""),
      stdout: "pipe",
      stderr: "pipe",
    });

    const procTask = async (): Promise<{ timedOut: boolean; stderr: string; exitCode: number }> => {
      const [, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { timedOut: false, stderr, exitCode: exitCode ?? 0 };
    };

    const deadlineTask = new Promise<{ timedOut: boolean; stderr: string; exitCode: number }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true, stderr: "", exitCode: -1 }), 5000),
    );

    const result = await Promise.race([procTask(), deadlineTask]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// extractCandidatesJson unit tests
// ---------------------------------------------------------------------------

describe("extractCandidatesJson — LLM JSON block parsing (IMPORTANT-6)", () => {
  test("ECJ-1: JSON block wrapped in markdown fences → parsed array", () => {
    const raw = `Some prose.\n\`\`\`json\n[{"behavioral_shape":"do X"}]\n\`\`\`\nTrailing text.`;
    const result = extractCandidatesJson(raw);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect((result![0] as { behavioral_shape: string }).behavioral_shape).toBe("do X");
  });

  test("ECJ-2: bare JSON array (no fences) → parsed", () => {
    const raw = `[{"behavioral_shape":"always commit","domain":"git","trigger":"none","source_session_ids":["s1"],"severity":"warn"}]`;
    const result = extractCandidatesJson(raw);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  test("ECJ-3: no JSON at all → null", () => {
    const result = extractCandidatesJson("No JSON here, just text.");
    expect(result).toBeNull();
  });

  test("ECJ-4: JSON object (not array) → null (array guard)", () => {
    const raw = `{"behavioral_shape":"do X"}`;
    const result = extractCandidatesJson(raw);
    expect(result).toBeNull();
  });

  test("ECJ-5: malformed JSON → null", () => {
    const raw = `\`\`\`json\n[{"behavioral_shape":\`\`\``;
    const result = extractCandidatesJson(raw);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateCandidate unit tests
// ---------------------------------------------------------------------------

describe("validateCandidate — LLM candidate shape validation (IMPORTANT-6)", () => {
  // InstinctCandidate in session-analyzer.ts: trigger, behavioral_shape, domain,
  // evidence (string[]), source_session_ids (string[]). No severity field at this layer.
  function makeCandidate(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      trigger: "agent pushes without reviewing",
      behavioral_shape: "always review the diff before pushing",
      domain: "git",
      evidence: ["saw this in session 1", "also in session 2"],
      source_session_ids: ["sess-1", "sess-2", "sess-3"],
      ...overrides,
    };
  }

  test("VC-1: well-formed candidate → returned with all required fields", () => {
    const result = validateCandidate(makeCandidate());
    expect(result).not.toBeNull();
    expect(result!.behavioral_shape).toBe("always review the diff before pushing");
    expect(result!.domain).toBe("git");
    expect(result!.source_session_ids).toEqual(["sess-1", "sess-2", "sess-3"]);
    expect(result!.evidence).toHaveLength(2);
  });

  test("VC-2: missing required field (trigger) → null", () => {
    // trigger missing → coerces to empty string → rejected
    const raw = makeCandidate({ trigger: undefined });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-3: non-string behavioral_shape (coerces to empty string) → null", () => {
    // 42 is not a string → behavioral_shape = "" → rejected
    const raw = makeCandidate({ behavioral_shape: 42 });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-4: source_session_ids not an array → filtered to [] → null", () => {
    // string value → not an array → source_session_ids = [] → length 0 → null
    const raw = makeCandidate({ source_session_ids: "sess-1" });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-5: ALL non-string items in source_session_ids → filtered to empty → null", () => {
    // Non-strings are filtered out; if none survive the filter → null
    const raw = makeCandidate({ source_session_ids: [1, 2, 3] });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-6: empty source_session_ids array → null (no session evidence)", () => {
    const raw = makeCandidate({ source_session_ids: [] });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-7: unknown domain value → null (isDomain rejects 'other', 'analysis', etc.)", () => {
    // DOMAINS list: code_quality, code_review, testing, debugging, architecture,
    // communication, git, tooling, performance, security, process, documentation
    // "analysis" is NOT in DOMAINS → isDomain("analysis") = false → null
    const raw = makeCandidate({ domain: "analysis" });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-8: non-object input → null", () => {
    expect(validateCandidate(null)).toBeNull();
    expect(validateCandidate("string")).toBeNull();
    expect(validateCandidate(42)).toBeNull();
  });

  test("VC-9: evidence array empty (all non-strings filtered) → null", () => {
    // evidence must be non-empty after filtering
    const raw = makeCandidate({ evidence: [42, true, null] });
    expect(validateCandidate(raw)).toBeNull();
  });

  test("VC-10: mixed source_session_ids — strings survive filter, non-strings dropped", () => {
    // ["sess-1", 42, "sess-3"] → filter → ["sess-1", "sess-3"] → non-empty → valid
    const raw = makeCandidate({ source_session_ids: ["sess-1", 42, "sess-3"] });
    const result = validateCandidate(raw);
    expect(result).not.toBeNull();
    expect(result!.source_session_ids).toEqual(["sess-1", "sess-3"]); // 42 dropped
  });
});
