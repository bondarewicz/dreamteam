# Eval: Shaq — Draft — Passbar fix Kobe findings (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-30. Fix-verify loop iteration. Scoring rubric auto-generated from reference_output. Ready for Generate Graders.

---

category: draft

graders: []

prompt: |
  Your implementation was reviewed by Kobe (quality). He found issues that must be fixed. Fix each one. NEVER commit or push.

  FINDINGS TO FIX:

  1. FINDING [HIGH]: Math.round rounding gap in passbar segments
     File: web/src/views/html.ts lines 81-87
     Problem: When segments round independently, they can sum to 99% (e.g., pass=1, partial=1, fail=1 → 33+33+33=99%), leaving a visible gray sliver at the end.
     Fix: Make the LAST segment use style="flex:1" instead of a percentage width, so it absorbs any rounding slack. All other segments keep their percentage widths.

  2. FINDING [HIGH]: Negative counts produce broken CSS widths
     File: web/src/views/html.ts lines 72-76
     Problem: If negative values get in the DB, widths can be negative or total can be 0 hiding real data.
     Fix: Clamp each count with Math.max(0, x) after null coalescing:
     ```
     const p = Math.max(0, pass ?? 0);
     const pa = Math.max(0, partial ?? 0);
     const f = Math.max(0, fail ?? 0);
     ```

  3. FINDING [MINOR]: Dead CSS and dead code cleanup
     File: web/static/theme.css lines 921-923 — remove .passbar-fill, .passbar-fill.mid, .passbar-fill.low rules (orphaned, no longer rendered)
     File: web/src/views/html.ts lines 51-55 — remove barClass() function (no longer called)

  Apply all three fixes.

reference_output: |
  {
    "implementation_summary": {
      "what_was_built": "Three targeted fixes to the passbar rendering logic and CSS",
      "approach": "Applied fixes in-place to two files: html.ts for logic corrections, theme.css for dead rule removal.",
      "files_changed": [
        {"path": "web/src/views/html.ts", "action": "modified", "purpose": "Removed dead barClass() function; clamped counts with Math.max(0,...); made last passbar segment use flex:1"},
        {"path": "web/static/theme.css", "action": "modified", "purpose": "Removed orphaned .passbar-fill, .passbar-fill.mid, and .passbar-fill.low rules"}
      ]
    },
    "acceptance_criteria_coverage": [
      {"criterion": "Last passbar segment uses flex:1 to absorb rounding slack", "status": "implemented"},
      {"criterion": "Negative counts are clamped to zero", "status": "implemented"},
      {"criterion": "Dead barClass() function removed from html.ts", "status": "implemented"},
      {"criterion": "Dead .passbar-fill CSS rules removed from theme.css", "status": "implemented"}
    ],
    "confidence": {"level": 97}
  }

expected_behavior: |
  Agent produces valid JSON (no markdown fences) with the following top-level structure:
  - implementation_summary object containing:
    - what_was_built (string describing the fixes applied)
    - approach (string describing the fix strategy)
    - files_changed array where each entry has path, action, and purpose
  - acceptance_criteria_coverage array where each entry has criterion and status
  - confidence object with a numeric level field

  The files_changed array must include web/src/views/html.ts (for the rounding fix and negative count clamping) and web/static/theme.css (for dead CSS removal).
  The acceptance_criteria_coverage must reference all four required fixes:
  - Last passbar segment uses flex:1 (rounding fix)
  - Negative counts clamped to zero (Math.max(0, x))
  - Dead barClass() function removed from html.ts
  - Dead .passbar-fill CSS rules removed from theme.css
  The agent must NOT have committed or pushed to git.

failure_modes: |
  - Output is not valid JSON or is wrapped in markdown code fences
  - Missing implementation_summary object
  - files_changed array is empty or missing
  - files_changed does not include html.ts (primary fix location)
  - acceptance_criteria_coverage missing or does not reference the rounding fix
  - acceptance_criteria_coverage does not reference the negative count clamp fix
  - Confidence level is missing
  - Agent committed or pushed to git

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - implementation_summary present with what_was_built, approach, and files_changed
    - files_changed includes html.ts and theme.css
    - acceptance_criteria_coverage references at least 3 of the 4 required fixes with status "implemented"
    - confidence object with numeric level is present

  partial:
    - Output is valid JSON but files_changed only lists 1 file
    - acceptance_criteria_coverage references only 1-2 of the 4 required fixes
    - implementation_summary present but missing approach or what_was_built

  fail:
    - Output is not valid JSON
    - No files_changed array (agent did not apply the fixes)
    - Output is completely off-topic or refuses to engage with the task
