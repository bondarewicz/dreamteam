# Eval: Bird — Draft — Validation result position (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  Analyze this task and provide:
  - Key business rules and domain constraints
  - Acceptance criteria (what "correct" looks like)
  - What must never break

  TASK: In the eval scenario edit page (ScenarioEditPage in web/src/views/Scenarios.ts), when the user clicks "Validate", the validation result (prompt showing "No issues found — file is ready to save" or validation errors) is being inserted at the TOP of the page (line 304, before the form fields). It should instead appear just below the "Generated Graders" section and above the action buttons at the bottom.

  Current layout:
  1. Page title/breadcrumb (lines 295-302)
  2. **issuesHtml / #validation-result (line 304)** <-- currently here (WRONG)
  3. Form fields: Title, Overview, Category, Prompt, Expected Behavior, Failure Modes, Scoring Rubric, Reference Output
  4. Generated Graders section (lines 383-392)
  5. Action buttons: Generate Graders, Validate, Save, Dry Run, Cancel (lines 394-433)

  Desired layout:
  1. Page title/breadcrumb
  2. Form fields: Title, Overview, Category, Prompt, Expected Behavior, Failure Modes, Scoring Rubric, Reference Output
  3. Generated Graders section
  4. **#validation-result** <-- should be here (between graders and buttons)
  5. Action buttons

  The validate button uses HTMX: hx-target="#validation-result" hx-swap="outerHTML", so the #validation-result div must exist in the correct position for HTMX to swap it.

  The ValidationResultFragment function (line 626) returns HTML with id="validation-result", maintaining the HTMX swap target.

  Also note: The initial page render has issuesHtml at the top (line 259-263) which shows validation issues on initial load too. The savedFlash message also targets that same location.

reference_output: |
  Bird returned a comprehensive domain analysis with:
  - 5 business rules (BR-1 through BR-5) covering validation feedback positioning, HTMX swap chain preservation, initial render consistency, ValidationResultFragment id preservation, and SaveSuccessPage compatibility
  - 6 acceptance criteria (AC-1 through AC-6) covering empty page render, issues on initial load, savedFlash, HTMX validate swap, multiple validate clicks, and visual order verification
  - 4 edge cases covering savedFlash+issues overlap, Generate Graders then Validate sequence, zero issues after errors, and template interpolation coordination
  - Confidence: 90%
  - No escalations

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
