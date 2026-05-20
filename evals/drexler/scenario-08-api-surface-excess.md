# Eval: Drexler — Scenario 08 — Excessive API Surface Export

## Overview

Tests Drexler's ability to identify when internal implementation details are over-exported, creating unnecessary public API surface. Shaq exported types, constants, and internals that should be private. The implementation works — the issue is coupling risk from over-exposure.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: scope_assessment.new_public_apis
    min_items: 2

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Implement a retry wrapper for API calls with exponential backoff.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Retry utility with full internals exported
  - Files changed:
    - src/utils/retry.ts (created) — retry with exponential backoff
    - src/utils/index.ts (modified) — barrel export

  Here is the new code:

  ```typescript
  // src/utils/retry.ts
  export const DEFAULT_MAX_ATTEMPTS = 3;
  export const DEFAULT_BASE_DELAY_MS = 100;
  export const DEFAULT_MAX_DELAY_MS = 5000;

  export type RetryOptions = {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  };

  export type RetryState = {
    attempt: number;
    lastError: unknown;
    totalDelayMs: number;
  };

  export function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    return Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  }

  export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    let attempt = 0;
    while (true) {
      try { return await fn(); }
      catch (error) {
        attempt++;
        if (attempt >= maxAttempts) throw error;
        if (options.shouldRetry && !options.shouldRetry(error)) throw error;
        await new Promise(r => setTimeout(r, calculateDelay(attempt, baseDelayMs, maxDelayMs)));
      }
    }
  }
  ```

  The public API needed is: `withRetry(fn, options)` and `RetryOptions`. Everything else is internal implementation.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies over-exported internals: DEFAULT_MAX_ATTEMPTS, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS, RetryState, calculateDelay
  - scope_assessment.new_public_apis lists at least the constants and calculateDelay as unnecessary exports
  - deletion_candidates recommends making constants and calculateDelay private (unexported)
  - RetryOptions and withRetry are NOT flagged — they are the specified public API
  - summary.verdict is BLOATED or ACCEPTABLE

failure_modes: |
  - Accepting "might be useful" as justification for exporting internals
  - Not distinguishing the required public API (withRetry, RetryOptions) from implementation details
  - Flagging withRetry or RetryOptions as excessive
  - Verdict LEAN when 5 unnecessary exports exist

scoring_rubric: |
  pass:
    - scope_assessment.new_public_apis has at least 2 unnecessary exports
    - deletion_candidates recommends making internals unexported
    - withRetry and RetryOptions NOT flagged as excessive
    - summary.verdict is BLOATED or ACCEPTABLE

  partial:
    - Only 1 unnecessary export flagged
    - Verdict ACCEPTABLE with clear note

  fail:
    - No unnecessary exports identified
    - Verdict LEAN
    - withRetry or RetryOptions flagged as excessive
