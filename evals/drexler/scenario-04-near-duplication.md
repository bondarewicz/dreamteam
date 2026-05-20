# Eval: Drexler — Scenario 04 — Near Duplication (Different Name, Same Logic)

## Overview

Tests whether Drexler catches partial/near duplication — new code that implements the same logic as existing code under a different name. This is the hardest duplication class: it doesn't grep cleanly, requires semantic understanding. Drexler must search broadly (not just exact names) and assess similarity rather than identity.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: duplication_findings
    min_items: 1

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add a helper to truncate long error messages before logging.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: `truncateMessage(msg, maxLen)` in `src/logger/helpers.ts`
  - Files changed:
    - src/logger/helpers.ts (created) — message truncation helper
    - src/logger/index.ts (modified) — imports and applies truncateMessage

  Here is the new code:

  ```typescript
  // src/logger/helpers.ts
  export function truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) return message;
    return message.slice(0, maxLength) + "...";
  }
  ```

  And here is what already exists:

  ```typescript
  // src/utils/strings.ts  (pre-existing)
  export function clampString(str: string, limit: number): string {
    return str.length > limit ? str.substring(0, limit) + "…" : str;
  }
  ```

  The functions differ in name, parameter names, and the ellipsis character used (`...` vs `…`), but implement identical truncation logic.

  Search the repo for existing utilities. Flag near-duplicates even when names differ.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies that truncateMessage and clampString implement identical logic
  - duplication_findings has at least 1 entry with similarity: "near" (not "partial")
  - Drexler notes the difference is cosmetic (ellipsis char, parameter names) not semantic
  - Recommendation: reuse clampString, possibly aliasing or wrapping it rather than adding a new implementation
  - summary.verdict is BLOATED or ACCEPTABLE (BLOATED preferred)
  - Drexler does NOT flag the minor difference in ellipsis character as a correctness concern

failure_modes: |
  - Missing the duplication because function names differ
  - Classifying as "partial" when the logic is semantically identical
  - Accepting the cosmetic differences as justifying a new implementation
  - Flagging the ellipsis difference as a correctness bug (Kobe's domain)

scoring_rubric: |
  pass:
    - duplication_findings has entry for truncateMessage / clampString
    - similarity is "near" or "exact"
    - Recommendation points to reusing src/utils/strings.ts
    - summary.verdict is BLOATED or ACCEPTABLE

  partial:
    - Duplication found but similarity understated as "partial"
    - Recommendation vague ("consider using existing code")

  fail:
    - Duplication not found
    - Verdict LEAN
    - Near-duplication dismissed because names differ
