# Eval: Shaq — Draft — Validation result position (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-27. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  Implement this task according to the domain analysis below.
  Follow existing codebase patterns. NEVER commit or push to git — leave that to the user.

  TASK: In the eval scenario edit page (ScenarioEditPage in web/src/views/Scenarios.ts), move the #validation-result div from the top of the page (line 304, before the form) to between the Generated Graders section and the action buttons.

  DOMAIN BRIEF:
  - Business rules:
    - The `#validation-result` div must move from line 304 (top of page, before form fields) to between the Generated Graders section (ends ~line 392) and the sc-actions div (starts ~line 394)
    - The HTMX outerHTML swap chain must be preserved — the div must always have id="validation-result"
    - Both initial render (issuesHtml variable) and HTMX fragment (ValidationResultFragment) target the same id — only the position in the template changes
    - The savedFlash path also renders into the same id and must appear in the new position

  - Acceptance criteria:
    - AC-1: Given no validation issues, when page renders, an empty #validation-result div exists between Generated Graders section and action buttons (not at page top)
    - AC-2: Given validation issues on initial load, the validation box appears between graders and buttons
    - AC-3: Given savedFlash=true, the "Saved successfully" message appears between graders and buttons
    - AC-4: Given user clicks Validate, HTMX swaps the result into the correct position between graders and buttons
    - AC-5: Given multiple Validate clicks, the swap chain is not broken (outerHTML preserves the id)

  - Must-never-break:
    - The #validation-result element must always exist in the DOM for HTMX targeting
    - The id="validation-result" must be preserved on all paths (empty, issues, savedFlash, ValidationResultFragment)
    - The Generate Graders button's hx-target="#grader-preview-panel" must not be affected

  IMPLEMENTATION:
  The change is in web/src/views/Scenarios.ts in the ScenarioEditPage function:
  1. Remove `${issuesHtml}` from line 304 (between page-title and form tag)
  2. Add `${issuesHtml}` between the graders section closing div (after line 392) and the sc-actions div (before line 394)

reference_output: |
  Shaq modified web/src/views/Scenarios.ts with two edits:
  1. Removed ${issuesHtml} from between the page-title div and the form tag
  2. Inserted ${issuesHtml} between the Generated Graders section closing div and the Actions comment
  Confidence: 98%. No deviations from spec. All 5 acceptance criteria covered.

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
