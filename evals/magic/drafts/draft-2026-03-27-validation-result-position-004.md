# Eval: Magic — Draft — Validation result position (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  Synthesize all agent outputs into a final summary.
  Include: what was done, decisions made, files changed, and suggested next steps.
  Provide git commands the user should run.

  TASK: Move the #validation-result div in the eval scenario edit page from the top of the page to between the Generated Graders section and the action buttons.

  BIRD OUTPUT:
  - 5 business rules identified, all centered on preserving the HTMX swap chain and moving the div to the correct position
  - 6 acceptance criteria covering initial render, savedFlash, HTMX swap, and multiple validate clicks
  - Confidence: 90%

  SHAQ OUTPUT:
  - Modified web/src/views/Scenarios.ts
  - Removed ${issuesHtml} from line 304 (before form)
  - Inserted ${issuesHtml} at line 392 (between graders section and action buttons)
  - No changes to issuesHtml variable definition or ValidationResultFragment function
  - Confidence: 98%

  KOBE OUTPUT:
  - Verdict: SHIP
  - No critical findings
  - One minor note: SaveSuccessPage is dead code (unrelated)
  - Verified: no duplicate issuesHtml, HTMX swap chain intact, Generate Graders button unaffected
  - Confidence: 95%

  FILES CHANGED:
  - web/src/views/Scenarios.ts — moved ${issuesHtml} template interpolation from before the form to between graders section and action buttons

reference_output: |
  Magic synthesized all outputs confirming: single file changed (web/src/views/Scenarios.ts), ${issuesHtml} moved from before form to between graders and action buttons, HTMX swap chain preserved, no duplicates. Suggested git commands for committing.

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
