# Eval: Drexler — Scenario 02 — Approves Lean Implementation (True Negative)

## Overview

Tests that Drexler does not over-fire. A clean, minimal implementation with no duplication should receive LEAN verdict. Drexler must search before concluding — the verdict must be based on evidence, not assumption.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    equals: LEAN
  - type: json_field
    path: duplication_findings
    max_items: 0
  - type: json_field
    path: maintenance_risk
    equals: low

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add rate limiting to the public API endpoints.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Token-bucket rate limiter middleware applied to all public routes
  - Files changed:
    - src/middleware/rate-limiter.ts (created) — token bucket implementation using Redis
    - src/app.ts (modified) — 3 lines: import + app.use(rateLimiter)
    - tests/middleware/rate-limiter.test.ts (created) — 12 tests

  SPEC: Limit public API to 100 requests/minute per IP. Return 429 with Retry-After header when exceeded. Use Redis for distributed state across instances.

  Here is the new code:

  ```typescript
  // src/middleware/rate-limiter.ts
  import { redis } from "../redis";
  import type { Request, Response, NextFunction } from "express";

  const WINDOW_MS = 60_000;
  const MAX_REQUESTS = 100;

  export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const key = `rate:${req.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, WINDOW_MS);
    if (count > MAX_REQUESTS) {
      const ttl = await redis.pttl(key);
      res.set("Retry-After", String(Math.ceil(ttl / 1000)));
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  }
  ```

  The repo has no existing rate limiting code. The existing Redis client (src/redis.ts) is reused, not re-implemented.

  Search the repo for existing utilities before accepting new ones.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler searches for existing rate limiting code and finds none
  - duplication_findings is empty — no existing equivalent found
  - The implementation reuses the existing Redis client (good)
  - Net line count is small and justified by the spec requirement
  - summary.verdict is LEAN
  - maintenance_risk is "low"
  - Drexler does NOT manufacture findings — "no duplication" is a valid and complete result

failure_modes: |
  - Verdict ACCEPTABLE or BLOATED when the code is genuinely lean
  - Manufacturing a duplication finding that doesn't exist
  - Flagging the Redis client import as "should use existing abstraction" when it already does
  - Failing to search before concluding (assuming rather than verifying)
  - Adding speculative concerns ("this might conflict with future X") as findings

scoring_rubric: |
  pass:
    - duplication_findings is empty []
    - summary.verdict is LEAN
    - maintenance_risk is low
    - confidence.level >= 75
    - spec_compliance.in_scope is true

  partial:
    - Verdict LEAN but confidence.level < 60 without justification
    - Minor advisory note about a real (not invented) concern — acceptable if verdict is still LEAN

  fail:
    - Verdict ACCEPTABLE or BLOATED
    - duplication_findings is non-empty with fabricated findings
    - maintenance_risk is medium or high without evidence
