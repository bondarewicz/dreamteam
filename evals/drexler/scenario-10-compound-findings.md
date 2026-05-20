# Eval: Drexler — Scenario 10 — Compound Findings (Duplication + Dead Code)

## Overview

Tests Drexler's ability to surface multiple independent issues in a single review. The implementation both duplicates an existing utility AND exports dead helpers. Drexler must identify both problems — missing either one is a partial fail. This validates that Drexler scans broadly, not just until it finds one issue.

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
  - type: json_field
    path: deletion_candidates
    min_items: 2

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add a function that generates a welcome message for a new user.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: User welcome message generator with helper exports
  - Files changed:
    - src/messaging/welcome.ts (created) — welcome message and helper exports
    - src/messaging/index.ts (modified) — barrel export

  Here is the new code:

  ```typescript
  // src/messaging/welcome.ts

  export function generateWelcomeMessage(firstName: string, plan: string): string {
    return `Welcome, ${firstName}! You're on the ${plan} plan.`;
  }

  export function capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  export function buildGreeting(name: string): string {
    return `Hello, ${capitalizeFirst(name)}!`;
  }

  export function formatPlanLabel(plan: string): string {
    return `[${plan.toUpperCase()}]`;
  }
  ```

  And here is what already exists in the codebase:

  ```typescript
  // src/utils/text.ts  (pre-existing)
  export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  export function greet(name: string): string {
    return `Hello, ${capitalize(name)}!`;
  }
  ```

  The call sites only use `generateWelcomeMessage`. The functions `capitalizeFirst`, `buildGreeting`, and `formatPlanLabel` are exported but never called anywhere in the codebase. Additionally, `capitalizeFirst` duplicates `capitalize` from `src/utils/text.ts` (identical logic, different name), and `buildGreeting` duplicates `greet` from the same file (identical output, different name).

  Search the repo for existing utilities. Flag near-duplicates even when names differ.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies BOTH issues independently:
    1. Duplication: capitalizeFirst = capitalize, buildGreeting = greet (both from src/utils/text.ts)
    2. Dead code: capitalizeFirst, buildGreeting, and formatPlanLabel are exported but never called
  - duplication_findings has at least 1 entry referencing capitalize/capitalizeFirst or greet/buildGreeting
  - deletion_candidates has at least 2 of: capitalizeFirst, buildGreeting, formatPlanLabel
  - summary.verdict is BLOATED
  - Drexler does NOT flag generateWelcomeMessage — it is the specified function and is called
  - Drexler does NOT suggest removing capitalize or greet from src/utils/text.ts (they are pre-existing, used elsewhere)

failure_modes: |
  - Finding only one issue (duplication OR dead code) and stopping — must surface both
  - Flagging generateWelcomeMessage as a duplicate of greet (different output, different purpose)
  - Recommending deletion of capitalize/greet from src/utils/text.ts (they pre-exist)
  - Verdict ACCEPTABLE when both duplication and dead code coexist
  - Missing formatPlanLabel as dead (it is never called and has no duplicate — pure dead code)

scoring_rubric: |
  pass:
    - duplication_findings is non-empty (capitalizeFirst/capitalize or buildGreeting/greet)
    - deletion_candidates has at least 2 items from: capitalizeFirst, buildGreeting, formatPlanLabel
    - generateWelcomeMessage NOT in deletion_candidates
    - summary.verdict is BLOATED

  partial:
    - Only one of the two issues (duplication or dead code) identified
    - Verdict ACCEPTABLE with a clear note

  fail:
    - Neither duplication nor dead code identified
    - duplication_findings is empty AND deletion_candidates is empty or has <2 items
    - Verdict LEAN
    - generateWelcomeMessage flagged as duplicate
