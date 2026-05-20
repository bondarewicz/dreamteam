# Eval: Drexler — Scenario 01 — Catches Re-implementation

## Overview

Tests Drexler's core capability: searching the repo before accepting new utilities, and flagging when Shaq has re-implemented something that already exists. The duplication must be found via repo search, not inferred from the prompt.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    equals: BLOATED
  - type: json_field
    path: duplication_findings
    min_items: 1
  - type: json_field
    path: maintenance_risk
    one_of: [medium, high]

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add a date formatting utility to the reporting module.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: New `formatDate` and `formatDateRange` functions in `src/reporting/utils.ts`
  - Files changed:
    - src/reporting/utils.ts (created) — date formatting helpers
    - src/reporting/report-generator.ts (modified) — imports new utils

  SPEC: Format dates as "DD MMM YYYY" for all report outputs. Support date ranges formatted as "DD MMM YYYY – DD MMM YYYY".

  Here is the new code Shaq added:

  ```typescript
  // src/reporting/utils.ts
  export function formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }

  export function formatDateRange(start: Date, end: Date): string {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  ```

  And here is what already exists in the repo at src/shared/date-utils.ts:

  ```typescript
  // src/shared/date-utils.ts  (pre-existing, Shaq did not read this file)
  export function formatDisplayDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  export function formatDisplayDateRange(from: Date, to: Date): string {
    return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  }
  ```

  Search the repo for existing utilities before accepting new ones. Flag re-implementations, over-engineered abstractions, and unnecessary API surface.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies that `formatDate` is functionally identical to `formatDisplayDate` in src/shared/date-utils.ts
  - `formatDateRange` is flagged as a re-implementation of `formatDisplayDateRange`
  - duplication_findings contains at least 1 entry with similarity: "exact" or "near"
  - The recommendation is to delete src/reporting/utils.ts and reuse src/shared/date-utils.ts
  - summary.verdict is BLOATED
  - maintenance_risk is "medium" or "high"
  - Drexler does NOT flag the implementation as incorrect (that is Kobe's domain) — only as duplicated

failure_modes: |
  - Missing the duplication entirely (verdict LEAN or ACCEPTABLE without finding the existing utility)
  - Flagging it as a correctness issue rather than a duplication issue
  - Recommending a "merge" strategy that adds more code instead of deleting
  - Verdict ACCEPTABLE when identical functions exist under different names

scoring_rubric: |
  pass:
    - duplication_findings has at least 1 entry pointing to src/shared/date-utils.ts
    - similarity is "exact" or "near" (not "partial")
    - recommendation explicitly says delete new code and reuse existing
    - summary.verdict is BLOATED
    - maintenance_risk is medium or high

  partial:
    - duplication found but recommendation is vague ("consider reusing")
    - Only one of the two functions flagged, not both
    - Verdict BLOATED but no specific file:line reference

  fail:
    - Duplication not found
    - Verdict LEAN or ACCEPTABLE
    - Recommendation adds more code instead of reducing
