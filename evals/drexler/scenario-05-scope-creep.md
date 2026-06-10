# Eval: Drexler — Scenario 05 — Scope Creep Detection

## Overview

Tests Drexler's spec compliance check: Shaq built more than the spec asked for. No duplication exists, but the implementation exceeds scope. Drexler must compare what was built against what was specified and flag the delta.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: spec_compliance.in_scope
    equals: false
  - type: json_field
    path: spec_compliance.out_of_scope_items
    min_items: 1
    advisory: true

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add a health check endpoint that returns HTTP 200 with `{ status: "ok" }`.

  SPEC:
  # Spec: health-check
  ## Problem Statement
  Ops team needs a liveness probe. Return 200 with JSON body `{ status: "ok" }`.
  ## Acceptance Criteria
  - WHEN GET /health is called, THE SYSTEM SHALL return HTTP 200
  - THE SYSTEM SHALL respond with JSON body `{ status: "ok" }`
  ## Out of Scope
  Database connectivity checks, dependency status, version info.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: GET /health endpoint with full dependency health reporting
  - Files changed:
    - src/routes/health.ts (created) — health check with DB ping, Redis ping, version info
    - src/app.ts (modified) — register route

  Here is the new code:

  ```typescript
  // src/routes/health.ts
  import { db } from "../db";
  import { redis } from "../redis";
  import { version } from "../../package.json";

  export async function healthHandler(req: Request): Promise<Response> {
    const dbOk = await db.raw("SELECT 1").then(() => true).catch(() => false);
    const redisOk = await redis.ping().then(r => r === "PONG").catch(() => false);
    const status = dbOk && redisOk ? "ok" : "degraded";
    return Response.json({
      status,
      version,
      dependencies: { database: dbOk, redis: redisOk },
      uptime: process.uptime(),
    }, { status: status === "ok" ? 200 : 503 });
  }
  ```

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler flags that the spec said "return 200 with { status: ok }" and explicitly excluded DB/dependency checks
  - spec_compliance.in_scope is false
  - spec_compliance.out_of_scope_items includes at minimum: database ping, redis ping, version info, 503 response
  - deletion_candidates includes the dependency checks, version field, and uptime field
  - summary.verdict is BLOATED
  - Drexler does NOT flag this as a correctness issue — the extra features work, they just weren't asked for

failure_modes: |
  - Missing that the spec explicitly excluded DB checks
  - Verdict LEAN or ACCEPTABLE — extra features do not justify scope expansion
  - Treating the "degraded" status logic as correct behavior (it's underdefined by spec)
  - Not reading the spec carefully enough to identify out_of_scope_items

scoring_rubric: |
  pass:
    - spec_compliance.in_scope is false
    - out_of_scope_items has at least 2 items (db check, redis check, OR version/uptime)
    - deletion_candidates references specific out-of-spec additions
    - summary.verdict is BLOATED

  partial:
    - Scope creep identified but only 1 out_of_scope_item listed
    - Verdict ACCEPTABLE with clear scope note

  fail:
    - spec_compliance.in_scope is true
    - Verdict LEAN
    - No out_of_scope_items listed
