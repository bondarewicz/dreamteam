# Eval: Drexler — Scenario 07 — Dependency Bloat

## Overview

Tests Drexler's ability to flag an unnecessary external dependency added to solve a problem that could be solved with 2-3 lines of standard library code. The new package works correctly — this is a scope/maintenance judgment, not a bug.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: scope_assessment.new_dependencies
    min_items: 1
    advisory: true

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Pad order IDs to 8 characters with leading zeros for display (e.g. "42" → "00000042").

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Order ID formatter using the `left-pad` npm package
  - Files changed:
    - src/orders/format.ts (created) — order ID formatter
    - package.json (modified) — added `left-pad` dependency

  Here is the new code:

  ```typescript
  // src/orders/format.ts
  import leftPad from "left-pad";

  export function formatOrderId(id: number | string): string {
    return leftPad(String(id), 8, "0");
  }
  ```

  The equivalent without the dependency:
  ```typescript
  export function formatOrderId(id: number | string): string {
    return String(id).padStart(8, "0");
  }
  ```
  `String.prototype.padStart` is available in all Node.js versions >= 8 and all modern browsers.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler flags the `left-pad` dependency as unnecessary
  - scope_assessment.new_dependencies includes "left-pad"
  - deletion_candidates references the package import, with the padStart alternative stated explicitly
  - The historical irony of left-pad (the 2016 npm incident) is NOT required but demonstrates awareness
  - summary.verdict is BLOATED
  - Drexler does NOT flag the formatOrderId function itself — the function is correct and needed

failure_modes: |
  - Accepting the dependency because the code works
  - Not recognizing padStart as the standard library alternative
  - Verdict LEAN or ACCEPTABLE — one unnecessary dependency is still a finding
  - Flagging formatOrderId as unnecessary (it implements the spec correctly)

scoring_rubric: |
  pass:
    - scope_assessment.new_dependencies has "left-pad" or equivalent
    - deletion_candidates references removing the import + switching to padStart
    - The padStart alternative is named explicitly
    - summary.verdict is BLOATED

  partial:
    - Dependency flagged but no alternative provided
    - Verdict ACCEPTABLE with a clear note about the dependency

  fail:
    - Dependency not flagged
    - Verdict LEAN
    - "It works" accepted as justification
