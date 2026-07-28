import { test, expect, describe } from "bun:test";
import { classifyError, backoffMs, withTransientRetry } from "../error-recovery.ts";

const noSleep = async () => {};

describe("classifyError", () => {
  test("transient: rate limits, 5xx, timeouts, socket errors", () => {
    for (const m of [
      "ollama HTTP 503",
      "claude invocation error: request timed out",
      "Error: 429 Too Many Requests",
      "fetch failed: ECONNRESET",
      "model is loading, please wait",
      "service unavailable",
    ]) {
      expect(classifyError(m)).toBe("transient");
    }
  });

  test("user_actionable: auth, missing CLI, quota — checked before transient", () => {
    for (const m of [
      "codex exit 1: 401 unauthorized",
      "command not found: codex",
      "invalid api key",
      "insufficient_quota: billing required",
      "403 forbidden",
    ]) {
      expect(classifyError(m)).toBe("user_actionable");
    }
  });

  test("permanent: wrong/unparseable answers and the unknown default", () => {
    for (const m of [
      "no result event in stream-json output",
      "claude exited non-zero (exit 1)",
      "schema validation failed: missing field",
      "something nobody has ever seen",
    ]) {
      expect(classifyError(m)).toBe("permanent");
    }
  });

  test("empty/missing → permanent (never silently retry the unknown)", () => {
    expect(classifyError("")).toBe("permanent");
    expect(classifyError(undefined)).toBe("permanent");
    expect(classifyError(null)).toBe("permanent");
  });
});

describe("backoffMs", () => {
  test("exponential, capped", () => {
    expect(backoffMs(0, 500, 8000)).toBe(500);
    expect(backoffMs(1, 500, 8000)).toBe(1000);
    expect(backoffMs(2, 500, 8000)).toBe(2000);
    expect(backoffMs(10, 500, 8000)).toBe(8000); // capped
  });
});

describe("withTransientRetry — in-band errors (backend pattern)", () => {
  test("retries a transient in-band error then succeeds", async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls++;
        return calls < 3 ? { error: "HTTP 503 service unavailable" } : { error: undefined, ok: true };
      },
      { errorOf: (r: any) => r.error, sleep: noSleep }
    );
    expect(calls).toBe(3);
    expect((result as any).ok).toBe(true);
  });

  test("does NOT retry a permanent in-band error", async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls++;
        return { error: "no result event in stream-json output" };
      },
      { errorOf: (r: any) => r.error, sleep: noSleep }
    );
    expect(calls).toBe(1); // returned immediately, unmasked
    expect((result as any).error).toContain("no result event");
  });

  test("does NOT retry a user_actionable error", async () => {
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls++;
        return { error: "401 unauthorized" };
      },
      { errorOf: (r: any) => r.error, sleep: noSleep }
    );
    expect(calls).toBe(1);
  });

  test("gives up after `retries` and returns the last errored result", async () => {
    let calls = 0;
    const seen: number[] = [];
    const result = await withTransientRetry(
      async () => {
        calls++;
        return { error: "429 rate limit" };
      },
      { errorOf: (r: any) => r.error, sleep: noSleep, retries: 2, onRetry: ({ attempt }) => seen.push(attempt) }
    );
    expect(calls).toBe(3); // 1 + 2 retries
    expect(seen).toEqual([1, 2]);
    expect((result as any).error).toContain("429");
  });
});

describe("withTransientRetry — thrown errors", () => {
  test("retries a transient throw then succeeds", async () => {
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls++;
      if (calls < 2) throw new Error("ETIMEDOUT");
      return "ok";
    }, { sleep: noSleep });
    expect(calls).toBe(2);
    expect(result).toBe("ok");
  });

  test("rethrows a permanent throw immediately", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw new Error("TypeError: x is not a function");
      }, { sleep: noSleep })
    ).rejects.toThrow("not a function");
    expect(calls).toBe(1);
  });
});
