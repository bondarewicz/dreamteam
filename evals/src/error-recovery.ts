/**
 * error-recovery.ts — s20 error classification + transient retry for the eval harness.
 *
 * The harness shells out to four provider CLIs/APIs (claude, ollama, gemini, codex).
 * Failures fall into three classes that demand different responses:
 *
 *   transient       — a rate limit (429), a 5xx, a socket/timeout, a model-loading
 *                      blip. NOT a capability failure. Retry with exponential backoff.
 *   user_actionable — auth expired, CLI not installed, quota exhausted. Retrying
 *                     can't help; surface clearly so the human fixes it.
 *   permanent       — the model answered but the answer was wrong/unparseable. This
 *                     is the signal evals exist to measure; never retried, never masked.
 *
 * IMPORTANT — no cross-provider fallback here. Falling back to Claude when a Gemini
 * run errors would record a Claude result under a Gemini run and silently corrupt
 * the per-provider comparison the harness exists to produce. Fallback-to-Claude is
 * an INTERACTIVE /team concern (see commands/team.md "Liveness & Fallback"), not a
 * measurement concern. Here we only retry true transients and otherwise tag the
 * error with its class so the report tells the truth.
 */

export type ErrorClass = "transient" | "user_actionable" | "permanent";

const TRANSIENT = [
  /\b429\b/,
  /\b5\d\d\b/, // 500/502/503/504
  /rate.?limit/i,
  /too many requests/i,
  /timed?.?out|timeout|etimedout/i,
  /econnreset|econnrefused|enetunreach|eai_again|socket hang up/i,
  /overloaded|temporarily unavailable|service unavailable/i,
  /model is loading|loading model|server busy/i,
];

const USER_ACTIONABLE = [
  /\b401\b|\b403\b/,
  /unauthor|authenticat|invalid api key|expired|forbidden/i,
  /not (found|installed)|command not found|enoent/i,
  /quota|insufficient_quota|billing|payment required|\b402\b/i,
];

/**
 * Classify an error string emitted by a backend (or a thrown Error's message).
 * user_actionable is checked before transient so a 403 auth failure is not mistaken
 * for a retriable transient. Everything unrecognized is treated as permanent — the
 * conservative default for a measurement harness (never silently retry the unknown).
 */
export function classifyError(message: string | undefined | null): ErrorClass {
  const m = (message ?? "").toString();
  if (!m.trim()) return "permanent";
  if (USER_ACTIONABLE.some((re) => re.test(m))) return "user_actionable";
  if (TRANSIENT.some((re) => re.test(m))) return "transient";
  return "permanent";
}

/** Backoff delay (ms) for attempt N (0-based), capped. Pure → unit-testable. */
export function backoffMs(attempt: number, baseMs = 500, capMs = 8000): number {
  return Math.min(capMs, baseMs * 2 ** attempt);
}

export type RetryOptions = {
  retries?: number; // max RE-tries after the first attempt (default 2 → 3 total)
  baseMs?: number;
  capMs?: number;
  /** Pull an error string out of a *resolved* result (backends return errors in-band, not by throwing). */
  errorOf?: (result: unknown) => string | undefined;
  /** Injectable sleep (tests pass a no-op); defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional progress callback for logging each retry. */
  onRetry?: (info: { attempt: number; delayMs: number; cls: ErrorClass; error: string }) => void;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying ONLY when the failure classifies as transient. Backends signal
 * failure in two ways: by throwing, or by resolving a record whose `errorOf()` is set
 * (the provider-backends pattern). Both are inspected. user_actionable and permanent
 * results are returned/thrown immediately — no wasted retries, no masked signal.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? realSleep;
  const errorOf = options.errorOf;

  let lastResult: T | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let result: T;
    try {
      result = await fn();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const cls = classifyError(error);
      if (cls !== "transient" || attempt === retries) throw e;
      const delayMs = backoffMs(attempt, options.baseMs, options.capMs);
      options.onRetry?.({ attempt: attempt + 1, delayMs, cls, error });
      await sleep(delayMs);
      continue;
    }
    // Resolved — inspect in-band error (backends don't throw on provider failure).
    const inBand = errorOf?.(result);
    if (!inBand) return result;
    const cls = classifyError(inBand);
    if (cls !== "transient" || attempt === retries) return result;
    lastResult = result;
    const delayMs = backoffMs(attempt, options.baseMs, options.capMs);
    options.onRetry?.({ attempt: attempt + 1, delayMs, cls, error: inBand });
    await sleep(delayMs);
  }
  // Exhausted retries on an in-band transient error — return the last (errored) result.
  return lastResult as T;
}
