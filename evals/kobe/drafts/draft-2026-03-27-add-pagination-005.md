# Eval: Kobe — Draft — Verify Pagination Fixes (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  You are Kobe Bryant, verifying that your findings have been correctly fixed.

  You previously found these issues:

  1. FINDING [HIGH]: getAllRuns() loads all rows into memory, defeating pagination at scale
     - Location: web/src/routes/evals.ts
     - Required fix: Replace getAllRuns() with a getGlobalStats() function using SQL aggregates

  2. FINDING [HIGH]: DashboardPage default parameter allRuns=runs silently breaks stat card correctness
     - Location: web/src/views/Dashboard.ts
     - Required fix: Remove default value, accept pre-computed stats object instead

  Shaq has applied fixes:
  - Added GlobalStats type and getGlobalStats() to db.ts using COUNT/SUM aggregation + LIMIT 1 for latest run
  - Changed DashboardPage to accept GlobalStats (required, no default) instead of allRuns array
  - Updated dashboardHandler to call getGlobalStats() instead of getAllRuns()
  - Removed getAllRuns import from evals.ts

  Verify each one:
  - Read the relevant files (web/src/db.ts, web/src/views/Dashboard.ts, web/src/routes/evals.ts)
  - Confirm each fix is correct
  - State VERIFIED or NOT VERIFIED for each finding
  - Final verdict: SHIP or BLOCK

reference_output: |
  Finding 1: VERIFIED — getGlobalStats() uses SQL COUNT/SUM aggregation, dashboardHandler calls it instead of getAllRuns().
  Finding 2: VERIFIED — DashboardPage now requires GlobalStats parameter with no default.
  Final verdict: SHIP.

expected_behavior: |
  DRAFT - Needs human review.
  The agent produced the following output during a live session. A human reviewer should:
  1. Determine if this output represents correct behavior worth encoding as expected
  2. Extract the key behaviors that should be tested
  3. Write concrete expected_behavior criteria

failure_modes: |
  DRAFT - Needs human review.
  A human reviewer should identify:
  1. What would constitute incorrect behavior for this prompt
  2. Common failure patterns for this agent type
  3. Edge cases the agent might miss

scoring_rubric: |
  DRAFT - Needs human review.

  pass:
    - [criteria to be defined by human reviewer]

  partial:
    - [criteria to be defined by human reviewer]

  fail:
    - [criteria to be defined by human reviewer]
