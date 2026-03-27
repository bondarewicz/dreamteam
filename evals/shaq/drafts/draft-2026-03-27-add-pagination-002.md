# Eval: Shaq — Draft — Dashboard Pagination Implementation (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  Implement this task according to the domain analysis below.
  Follow existing codebase patterns. NEVER commit or push to git — leave that to the user.

  TASK: Add pagination to the dashboard page. The dashboard displays eval runs and as the number of eval runs grows, the page needs pagination to remain usable.

  DOMAIN BRIEF (curated from Bird's analysis):

  Business rules:
  - Runs must display in reverse chronological order (newest first); pagination preserves this ordering
  - Summary stat cards (Total Runs, Baselines, Latest Pass Rate, Latest Pass/Partial/Fail) must reflect global totals across ALL runs, not just the current page
  - Page size: fixed at 20 runs per page, not user-configurable
  - Use query parameters (?page=2) on the root URL (/), not new route paths
  - Invalid page params (non-numeric, zero, negative) default to page 1; pages beyond last page show empty list or last page gracefully — never a server error
  - Agent badges must only be fetched for runs on the current page, not all runs
  - No pagination controls when 0 runs or fewer runs than page size
  - Empty state (0 runs) must still render correctly

  Acceptance criteria:
  - AC-1: Given >PAGE_SIZE runs, visiting / shows first 20 runs newest-first with pagination controls showing "page 1 of N"
  - AC-2: Given >PAGE_SIZE runs, visiting /?page=2 shows second page with correct prev/next links
  - AC-3: Given 0 runs, existing empty state shown, no pagination controls
  - AC-4: Given <PAGE_SIZE runs, all runs on single page, no pagination controls
  - AC-5: Stat cards always reflect ALL runs globally regardless of current page
  - AC-6: Invalid page param (?page=abc, ?page=-1, ?page=0) → page 1 without errors
  - AC-7: Page beyond last → graceful empty list with navigation back
  - AC-8: HTMX partial updates (maybeLayout pattern) preserved for pagination links
  - AC-9: SQL uses LIMIT/OFFSET at database level, not fetch-all-then-slice
  - AC-10: Agent data fetched only for displayed run_ids, not all runs

  Domain terms:
  - EvalRun: Single evaluation execution with run_id, pass/partial/fail counts, pass_rate
  - Baseline: eval run where is_complete_baseline=1, used for trend comparison
  - maybeLayout: Pattern returning full HTML for normal requests, bare fragment for HTMX (HX-Request header)
  - agentsPerRun: Map<run_id, string[]> for agent badge rendering

  Must-never-break invariants:
  - Reverse chronological ordering across pages
  - Stat cards always reflect global totals
  - Empty state renders correctly with no broken pagination controls
  - Invalid page params never cause server errors
  - Agent data scoped to current page only

reference_output: |
  Implementation completed with 4 files changed:
  - web/src/db.ts: Added getRunsPage(page, pageSize) with LIMIT/OFFSET SQL; added getAgentsForRuns(runIds) for page-scoped agent fetching
  - web/src/routes/evals.ts: Updated dashboardHandler to parse ?page, call getRunsPage, fetch global allRuns for stats, scope agent fetching to current page
  - web/src/views/Dashboard.ts: Added PaginationInfo type, updated DashboardPage to accept allRuns (global) and optional pagination, conditionally renders pagination controls
  - web/static/theme.css: Added pagination CSS styles
  All 10 ACs implemented. Confidence 95%. Deviation: getRunsPage clamps beyond-last-page to last page rather than returning empty list.

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
