# Eval: Shaq — Draft — Passbar multi-segment implementation (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-30. Scoring rubric auto-generated from reference_output. Ready for Generate Graders.

---

category: draft

graders:
  - type: json_valid
  - type: json_field
    path: "acceptance_criteria_coverage"
    min_items: 1

prompt: |
  Implement this task according to the domain analysis below.
  Follow existing codebase patterns. NEVER commit or push to git — leave that to the user.

  TASK: Refactor the eval dashboard passbar to show multi-segment colored bars (green for pass, yellow for partial, red for fail) instead of a single-color bar based on overall pass rate.

  DOMAIN BRIEF:

  Business rules:
  - The passbar must show up to 3 contiguous colored segments (green/yellow/red) proportional to pass_count/partial_count/fail_count
  - Segment colors: green = var(--pass), yellow/orange = var(--partial), red = var(--fail) — matching existing color system
  - Segment widths calculated as percentage of total count (pass+partial+fail), NOT based on pass_rate
  - When total count is 0, show empty gray track only (no segments)
  - Null counts from SQLite treated as 0
  - Zero-count segments should be omitted (not rendered) rather than rendered at width:0%
  - Full-width red bar ONLY when pass=0 AND partial=0 AND fail>0

  Acceptance criteria:
  - AC-1: Given pass=5, partial=2, fail=3 → green 50%, yellow 20%, red 30%
  - AC-2: Given pass=0, partial=0, fail=5 → single full-width red (100%)
  - AC-3: Given pass=0, partial=0, fail=0 → empty gray track
  - AC-4: Given pass=10, partial=0, fail=0 → single full-width green
  - AC-5: Given null counts → treated as 0, empty gray track
  - AC-6: Follow the existing multi-segment pattern from EvalRun.ts (.progress-segment) OR use passbar-specific segment classes
  - AC-7: Segment widths sum to ~100%
  - AC-8: Given pass=1, partial=0, fail=1 → green 50%, red 50%

  Edge cases:
  - Rounding: if widths don't sum to exactly 100%, acceptable minor variance
  - Very small counts (e.g., pass=1, fail=99): 1% green still visible
  - pass_rate=0 with partials present (e.g., 0P 3p 2F): show yellow+red distribution, NOT full red

  Files to modify:
  1. web/src/views/html.ts — change passBar() function signature to accept counts, render multi-segment HTML
  2. web/src/views/Dashboard.ts — update passBar() call to pass count data
  3. web/static/theme.css — add segment CSS classes for .passbar children (use flex display on container)

  IMPORTANT IMPLEMENTATION NOTES:
  - The .passbar container already has: height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; min-width: 80px;
  - Add display: flex to .passbar container
  - Use child divs with height: 100% and appropriate background colors
  - Handle border-radius on first-child/last-child/only-child for rounded ends
  - The EvalRun.ts file imports passBar but does NOT call it — the import won't break but the signature change is fine
  - The barClass() function in html.ts may become unused — leave it (don't clean up what wasn't asked)
  - The run object in Dashboard.ts has: pass_count, partial_count, fail_count (all nullable integers)

reference_output: |
  {
    "implementation_summary": {
      "what_was_built": "Refactored the eval dashboard passbar from a single-color fill bar to a multi-segment bar showing green/yellow/red proportional to pass_count/partial_count/fail_count.",
      "approach": "Changed passBar() signature in html.ts to accept three nullable count parameters instead of a pass rate float. The function computes segment widths as percentages of total count, omits zero-count segments, and returns an empty gray track when total is zero. Updated Dashboard.ts to pass run.pass_count/partial_count/fail_count directly. Added display:flex to .passbar in theme.css and new .passbar-seg color classes. Left barClass() and .passbar-fill styles untouched per spec.",
      "files_changed": [
        {"path": "web/src/views/html.ts", "action": "modified", "purpose": "Changed passBar() to accept (pass, partial, fail) nullable counts and render proportional .passbar-seg divs inside a flex container"},
        {"path": "web/src/views/Dashboard.ts", "action": "modified", "purpose": "Updated passBar() call to pass run.pass_count, run.partial_count, run.fail_count instead of pass_rate"},
        {"path": "web/static/theme.css", "action": "modified", "purpose": "Added display:flex to .passbar container; added .passbar-seg, .passbar-seg.pass, .passbar-seg.partial, .passbar-seg.fail CSS classes"}
      ]
    },
    "acceptance_criteria_coverage": [
      {"criterion": "AC-1", "status": "implemented"},
      {"criterion": "AC-2", "status": "implemented"},
      {"criterion": "AC-3", "status": "implemented"},
      {"criterion": "AC-4", "status": "implemented"},
      {"criterion": "AC-5", "status": "implemented"},
      {"criterion": "AC-6", "status": "implemented"},
      {"criterion": "AC-7", "status": "implemented"},
      {"criterion": "AC-8", "status": "implemented"}
    ],
    "confidence": {
      "level": 97,
      "low_confidence_areas": ["Border-radius on first/last segment — spec mentioned handling it but the container's overflow:hidden with border-radius:3px already clips children, making per-segment border-radius unnecessary"]
    }
  }

expected_behavior: |
  Agent produces valid JSON (no markdown fences) with the following top-level structure:
  - implementation_summary object containing:
    - what_was_built (string describing the feature)
    - approach (string describing how it was implemented)
    - files_changed array where each entry has path, action (created/modified/deleted), and purpose
  - acceptance_criteria_coverage array where each entry has criterion (e.g. "AC-1") and status (implemented/partially/skipped)
  - confidence object with a numeric level field

  The files_changed array must include all three expected files: web/src/views/html.ts, web/src/views/Dashboard.ts, and web/static/theme.css.
  The acceptance_criteria_coverage must reference AC-1 through AC-8 with status "implemented" for the core cases.
  The agent must NOT have committed or pushed to git.

failure_modes: |
  - Output is not valid JSON or is wrapped in markdown code fences
  - Missing implementation_summary object
  - files_changed array is empty or missing
  - files_changed does not include html.ts (the primary passBar() function change)
  - files_changed does not include Dashboard.ts (the call site update)
  - acceptance_criteria_coverage is missing or empty
  - Confidence level is missing
  - Agent committed or pushed to git

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - implementation_summary present with what_was_built, approach, and files_changed
    - files_changed includes at least 2 of the 3 expected files (html.ts, Dashboard.ts, theme.css)
    - acceptance_criteria_coverage present with at least 5 entries referencing AC-1 through AC-8
    - confidence object with numeric level is present

  partial:
    - Output is valid JSON but files_changed only lists 1 file
    - acceptance_criteria_coverage present but references fewer than 4 criteria
    - implementation_summary present but missing approach or what_was_built

  fail:
    - Output is not valid JSON
    - No files_changed array (agent did not implement the task)
    - Output is completely off-topic or refuses to engage with the task
