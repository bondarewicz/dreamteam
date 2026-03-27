# Eval: Shaq — Draft — Fix Stats Aggregation (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  You are Shaquille O'Neal, the Primary Code Executor.

  Your implementation was reviewed by Kobe (quality). He found issues that must be fixed. Fix each one, then verify the build works.

  FINDINGS TO FIX:

  1. FINDING [HIGH]: getAllRuns() loads all rows into memory, defeating pagination at scale
     - Location: web/src/routes/evals.ts:39
     - Problem: Every dashboard page load fetches ALL eval_run rows into JS memory just to compute 3 aggregate values (count, baseline count, latest run stats). This negates the performance benefit of DB-level LIMIT/OFFSET pagination.
     - Fix: Replace getAllRuns() call in dashboardHandler with a dedicated SQL aggregate query. Add a getGlobalStats() function in db.ts that returns { total: number, baselines: number, latestRun: EvalRun | null } using:
       - SELECT COUNT(*) as total, SUM(is_complete_baseline) as baselines FROM eval_runs
       - SELECT * FROM eval_runs ORDER BY timestamp DESC LIMIT 1 (for latest run)
     - Then update dashboardHandler to call getGlobalStats() instead of getAllRuns()
     - Update DashboardPage to accept stats object instead of allRuns array

  2. FINDING [HIGH]: DashboardPage default parameter allRuns=runs silently breaks stat card correctness
     - Location: web/src/views/Dashboard.ts:13
     - Problem: The function signature `allRuns: EvalRun[] = runs` means any caller that omits the third argument gets stats computed from only the current page's runs.
     - Fix: Remove the default value. Better yet, accept a pre-computed stats object { total: number, baselines: number, latestRun: EvalRun | null } instead of raw rows. This also solves Finding 1 since DashboardPage no longer needs all rows.

  NEVER commit or push. Verify the build works after fixes.

reference_output: |
  3 files changed:
  - web/src/db.ts: Added GlobalStats type and getGlobalStats() using COUNT/SUM aggregation + LIMIT 1 for latest run
  - web/src/views/Dashboard.ts: Changed third param from allRuns: EvalRun[] = runs to stats: GlobalStats (required, no default)
  - web/src/routes/evals.ts: Replaced getAllRuns() with getGlobalStats(), removed getAllRuns import
  Confidence: 97%. Build verified.

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
