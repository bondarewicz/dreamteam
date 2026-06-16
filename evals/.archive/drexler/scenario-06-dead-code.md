# Eval: Drexler — Scenario 06 — Dead Code Detection

## Overview

Tests Drexler's ability to spot unused exports introduced by the implementation. Shaq wrote and exported helper functions that are never called. These inflate API surface and become maintenance burden without delivering value.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: deletion_candidates
    min_items: 1
    advisory: true

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Implement a function that validates an email address format.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Email validation with exported helpers
  - Files changed:
    - src/validation/email.ts (created) — email validator and helper exports

  Here is the new code:

  ```typescript
  // src/validation/email.ts

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  export function isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email.trim());
  }

  // Helper functions exported for potential reuse
  export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  export function extractEmailDomain(email: string): string {
    return email.split("@")[1] ?? "";
  }

  export function isDisposableEmail(email: string): boolean {
    const disposableDomains = ["mailinator.com", "guerrillamail.com", "tempmail.com"];
    return disposableDomains.includes(extractEmailDomain(email));
  }
  ```

  The spec only asked for email format validation. `normalizeEmail`, `extractEmailDomain`, and `isDisposableEmail` are exported but called nowhere in the codebase.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies the 3 exported-but-uncalled functions as dead API surface
  - deletion_candidates lists normalizeEmail, extractEmailDomain, and isDisposableEmail
  - The "for potential reuse" comment does not justify the exports — speculative reuse is not reuse
  - scope_assessment.new_public_apis includes the 3 unused exports
  - summary.verdict is BLOATED or ACCEPTABLE (BLOATED preferred)
  - isValidEmail is NOT flagged — it is the specified function and is the entry point

failure_modes: |
  - Accepting "for potential reuse" as justification
  - Not flagging unexported-yet code as dead (they ARE exported, so they are API surface)
  - Flagging isValidEmail as dead (it is the required function)
  - Verdict LEAN when 3 unjustified public exports exist

scoring_rubric: |
  pass:
    - deletion_candidates has at least 2 of the 3 unused helpers
    - scope_assessment.new_public_apis is non-empty
    - summary.verdict is BLOATED or ACCEPTABLE
    - isValidEmail is NOT in deletion_candidates

  partial:
    - Only 1 of 3 helpers flagged
    - Verdict ACCEPTABLE with a clear note about speculative exports

  fail:
    - deletion_candidates is empty
    - Verdict LEAN
    - "Potential reuse" accepted as justification
    - isValidEmail flagged as dead
