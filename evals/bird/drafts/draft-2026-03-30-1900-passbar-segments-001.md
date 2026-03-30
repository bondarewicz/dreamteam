# Eval: Bird — Scenario 22 — Passbar multi-segment domain analysis (capability)

## Overview

Auto-captured from Dream Team session on 2026-03-30. Scoring rubric auto-generated from reference_output. Ready for Generate Graders.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 1
  - type: json_field
    path: "acceptance_criteria"
    min_items: 1
  - type: json_field
    path: "edge_cases"
    min_items: 1

prompt: |
  Analyze this task and provide:
  - Key business rules and domain constraints
  - Acceptance criteria (what "correct" looks like)
  - What must never break

  TASK: The eval dashboard passbar (the horizontal progress bar on each run row) currently renders as a single-color bar based on the overall pass rate. It should instead show multi-segment colors matching the actual pass/partial/fail breakdown:
  - Green segment for pass count
  - Yellow/orange segment for partial count
  - Red segment for fail count
  - When pass rate is 0% and there are failures, show a full-width red bar
  - When there are no results (0 total), show empty gray track

  The relevant files are in the dreamteam web app:
  - web/src/views/html.ts — contains the passBar() helper function
  - web/src/views/Dashboard.ts — calls passBar() for each run row
  - web/static/theme.css — contains .passbar CSS styles

  The run object has pass_count, partial_count, fail_count fields (INTEGER, nullable in SQLite).

  There is already a similar multi-segment progress bar in web/src/views/EvalRun.ts (the overall score progress bar) that uses .progress-segment.pass/.partial/.fail classes — this is the pattern to follow.

  IMPORTANT: Do research by reading the actual source files to understand the current implementation before providing your analysis.

reference_output: |
  {
    "domain_analysis": {
      "business_context": "The eval dashboard displays evaluation run results for an AI agent team. Each run row shows a horizontal progress bar (passbar) summarizing how many scenarios passed, partially passed, or failed. Currently, the passbar uses a single color based on overall pass rate, losing the pass/partial/fail distribution information that is already available in the data and already displayed numerically in the same row.",
      "bounded_context": "Eval Dashboard — visualization of agent evaluation run results",
      "ubiquitous_language": [
        {"term": "pass_count", "definition": "Number of scenarios that fully passed in an eval run (INTEGER, nullable in SQLite)"},
        {"term": "partial_count", "definition": "Number of scenarios that partially passed in an eval run (INTEGER, nullable in SQLite)"},
        {"term": "fail_count", "definition": "Number of scenarios that failed in an eval run (INTEGER, nullable in SQLite)"},
        {"term": "pass_rate", "definition": "Fraction of scenarios that passed (REAL, 0.0-1.0), used for percentage display"},
        {"term": "passbar", "definition": "Horizontal progress bar on each run row showing result distribution"},
        {"term": "progress-segment", "definition": "CSS class pattern for colored segments within a multi-segment progress bar (already exists in EvalRun.ts)"},
        {"term": "scenarios_run", "definition": "Total number of scenarios evaluated in a run"},
        {"term": "baseline", "definition": "A complete eval run covering all scenarios, used as a reference point for comparison"}
      ]
    },
    "business_rules": [
      {"id": "BR-1", "rule": "The passbar must visually represent the actual pass/partial/fail breakdown as three contiguous colored segments, not a single color derived from overall rate.", "invariant": true},
      {"id": "BR-2", "rule": "Segment colors must be: green (--pass) for pass, yellow/orange (--partial) for partial, red (--fail) for fail — matching the established color system used throughout the dashboard.", "invariant": true},
      {"id": "BR-3", "rule": "When pass_rate is 0% and there are failures (fail_count > 0), the bar must show a full-width red segment.", "invariant": false},
      {"id": "BR-4", "rule": "When total count is 0 (pass_count + partial_count + fail_count = 0), show an empty gray track with no colored segments.", "invariant": true},
      {"id": "BR-5", "rule": "Segment widths must be calculated as percentages of total count (pass+partial+fail), not based on pass_rate alone.", "invariant": true},
      {"id": "BR-6", "rule": "The passBar function signature must accept pass_count, partial_count, and fail_count (or the run object) instead of just a rate number.", "invariant": false},
      {"id": "BR-7", "rule": "Null counts from SQLite must be treated as 0 for rendering purposes.", "invariant": true}
    ],
    "acceptance_criteria": [
      {"id": "AC-1", "given": "A run with pass_count=5, partial_count=2, fail_count=3 (total=10)", "when": "The dashboard renders the passbar for this run", "then": "Three contiguous segments appear: green at 50% width, yellow/orange at 20% width, red at 30% width"},
      {"id": "AC-2", "given": "A run with pass_count=0, partial_count=0, fail_count=5", "when": "The dashboard renders the passbar for this run", "then": "A single full-width (100%) red segment fills the entire bar"},
      {"id": "AC-3", "given": "A run with pass_count=0, partial_count=0, fail_count=0 (no results)", "when": "The dashboard renders the passbar for this run", "then": "The bar shows only the gray background track with no colored segments"},
      {"id": "AC-4", "given": "A run with pass_count=10, partial_count=0, fail_count=0", "when": "The dashboard renders the passbar for this run", "then": "A single full-width green segment fills the entire bar (no yellow or red segments rendered)"},
      {"id": "AC-5", "given": "A run with pass_count=null, partial_count=null, fail_count=null", "when": "The dashboard renders the passbar for this run", "then": "All counts treated as 0, resulting in an empty gray track (same as AC-3)"},
      {"id": "AC-6", "given": "The existing progress bar in EvalRun.ts using .progress-segment.pass/.partial/.fail classes", "when": "The passbar is refactored", "then": "The passbar follows the same HTML pattern or uses passbar-specific segment classes"},
      {"id": "AC-7", "given": "Any run row in the dashboard", "when": "The passbar renders", "then": "The segment widths sum to exactly 100% of the total count (no gaps, no overflow)"},
      {"id": "AC-8", "given": "A run with pass_count=1, partial_count=0, fail_count=1 (total=2)", "when": "The dashboard renders the passbar", "then": "Green segment at 50%, red segment at 50%, no yellow segment visible"}
    ],
    "edge_cases": [
      {"scenario": "All three counts are null (SQLite nullable)", "expected_behavior": "Treat as 0/0/0, render empty gray track"},
      {"scenario": "Only partial results (pass=0, partial=5, fail=0)", "expected_behavior": "Single full-width yellow/orange segment"},
      {"scenario": "Rounding causes widths to sum to 99% or 101%", "expected_behavior": "Acceptable minor rounding variance"},
      {"scenario": "Very small counts like pass=1, partial=0, fail=99", "expected_behavior": "Green segment at 1% width — may be barely visible but must still be rendered"},
      {"scenario": "pass_rate is 0 but partial_count > 0 (e.g., pass=0, partial=3, fail=2)", "expected_behavior": "Should NOT show full-width red. Show the actual yellow+red distribution."}
    ],
    "confidence": {"level": 92}
  }

expected_behavior: |
  Agent produces valid JSON (no markdown fences) with the following top-level structure:
  - domain_analysis object containing business_context and ubiquitous_language array
  - business_rules array where each entry has id (e.g. "BR-1"), rule (string), and at least one of invariant or testable_assertion
  - acceptance_criteria array where each entry has id (e.g. "AC-1"), given, when, and then fields
  - edge_cases array listing at least 2 non-obvious scenarios with expected_behavior
  - confidence object with a numeric level field

  The business rules must be specific to the task (passbar segment rendering) and include at least one rule about null handling and one about zero-total behavior.
  The acceptance criteria must cover the core cases: mixed counts, all-fail, all-zero, all-pass, and null counts.

failure_modes: |
  - Output is not valid JSON or is wrapped in markdown code fences
  - Missing business_rules array entirely
  - Missing acceptance_criteria array entirely
  - Acceptance criteria entries lack given/when/then structure (e.g., only a description string)
  - Business rules present but are generic platitudes rather than domain-specific constraints
  - No confidence level provided
  - Missing edge_cases array or edge_cases is empty
  - Output addresses a different task than the passbar segmentation prompt

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - business_rules array is present with at least 5 entries, each having id and rule
    - acceptance_criteria array is present with at least 5 entries, each having given, when, and then fields
    - edge_cases array is present with at least 2 entries
    - confidence object with numeric level is present

  partial:
    - Output is valid JSON but one required section is missing or has fewer than 3 entries
    - Acceptance criteria present but entries lack given/when/then (only description strings)
    - Business rules present but fewer than 3 entries or missing id fields

  fail:
    - Output is not valid JSON
    - Missing both business_rules and acceptance_criteria
    - Output is completely off-topic or refuses to engage with the task
