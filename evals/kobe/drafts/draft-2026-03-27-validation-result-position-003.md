# Eval: Kobe — Draft — Validation result position (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  Review this implementation for critical risks. Max 3 findings.
  Focus on edge cases, race conditions, and failure modes.
  Propose fixes for each finding.

  TASK: Move the #validation-result div from the top of the ScenarioEditPage template to between the Generated Graders section and the action buttons.

  DOMAIN RULES (from Bird):
  - The #validation-result div must always exist in the DOM for HTMX outerHTML swap targeting
  - The id="validation-result" must be preserved on all paths (empty, issues, savedFlash, ValidationResultFragment)
  - Both initial render and HTMX fragment responses target the same id
  - The Generate Graders button's hx-target="#grader-preview-panel" must not be affected

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Moved ${issuesHtml} template interpolation in ScenarioEditPage function
  - File changed: web/src/views/Scenarios.ts
    - Removed ${issuesHtml} from line 304 (before form)
    - Inserted ${issuesHtml} at line 392 (between graders section and action buttons)
  - The issuesHtml variable definition (lines 259-263) was NOT changed
  - The ValidationResultFragment function was NOT changed
  - Shaq's confidence: 98%
  - No deviations from spec

reference_output: |
  Kobe's verdict: SHIP. No critical findings. One minor note: SaveSuccessPage is dead code (exported but never called) — unrelated to this change. Verified: no duplicate issuesHtml, HTMX swap chain intact, Generate Graders button unaffected. Confidence: 95%.

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
