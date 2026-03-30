# Eval: Kobe — Draft — Passbar quality review (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-30. Scoring rubric auto-generated from reference_output. Ready for Generate Graders.

---

category: draft

graders: []

prompt: |
  Review this implementation for critical risks. Max 3 findings.
  Focus on edge cases, race conditions, and failure modes.
  Propose fixes for each finding.

  TASK: Refactor the eval dashboard passbar to show multi-segment colored bars (green/yellow/red) proportional to pass/partial/fail counts instead of a single-color bar.

  DOMAIN RULES (from Bird):
  - Passbar must show up to 3 contiguous colored segments proportional to counts
  - Colors: green=var(--pass), yellow=var(--partial), red=var(--fail)
  - Segment widths = percentage of total count, NOT based on pass_rate
  - Total=0 → empty gray track
  - Null counts → treated as 0
  - Zero-count segments omitted
  - Full red ONLY when pass=0 AND partial=0 AND fail>0

  Acceptance criteria:
  - AC-1: pass=5, partial=2, fail=3 → green 50%, yellow 20%, red 30%
  - AC-2: pass=0, partial=0, fail=5 → full red
  - AC-3: pass=0, partial=0, fail=0 → empty gray track
  - AC-4: pass=10, partial=0, fail=0 → full green
  - AC-5: null counts → gray track
  - AC-7: widths sum to ~100%
  - AC-8: pass=1, partial=0, fail=1 → green 50%, red 50%

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Changed passBar() to accept 3 nullable count params, render proportional .passbar-seg divs in a flex container. Updated Dashboard.ts call site. Added .passbar-seg CSS.
  - Files changed:
    - web/src/views/html.ts — passBar() signature changed from (rate, failCount) to (pass, partial, fail), renders segments
    - web/src/views/Dashboard.ts — updated call to pass run.pass_count, run.partial_count, run.fail_count
    - web/static/theme.css — added display:flex to .passbar, added .passbar-seg classes
  - Shaq's confidence: 97%, low-confidence area: border-radius on segments (relies on container overflow:hidden)
  - Deviations: none

  IMPORTANT: Read the actual changed files on disk to verify correctness. Focus review on:
  1. The border-radius concern Shaq flagged
  2. Whether null coalescing handles all SQLite edge cases
  3. Whether the CSS changes could break any other passbar usage
  4. Whether the old .passbar-fill CSS class is now orphaned (dead CSS)

reference_output: |
  {
    "summary": {
      "verdict": "SHIP WITH FIXES",
      "one_liner": "Multi-segment passbar is functionally correct for happy paths, but Math.round rounding gaps will create visible 1px gray slivers in certain count combinations, and negative counts from bad data can produce broken widths."
    },
    "critical_findings": [
      {
        "title": "Math.round rounding error leaves visible gap in passbar",
        "severity": "High",
        "location": "web/src/views/html.ts:81-87",
        "reproduction": "Render passBar(1, 1, 1). Each segment gets Math.round(33.33)=33%. Total=99%. A gray sliver is visible at the end.",
        "fix": "Make the last segment use flex:1 instead of a percentage width so it absorbs any rounding slack.",
        "acceptance_criteria_affected": "AC-7"
      },
      {
        "title": "Negative counts from corrupt data produce negative CSS widths",
        "severity": "High",
        "location": "web/src/views/html.ts:72-76",
        "reproduction": "Insert a row with pass_count=-1, partial_count=0, fail_count=1. The dashboard renders an empty gray bar instead of showing the failure.",
        "fix": "Clamp each count with Math.max(0, x) after null coalescing.",
        "acceptance_criteria_affected": "AC-5"
      }
    ],
    "important_issues": [
      {
        "title": "Dead CSS: .passbar-fill rules are orphaned",
        "description": "The old .passbar-fill, .passbar-fill.mid, and .passbar-fill.low CSS rules are no longer referenced by any template code. The barClass() function in html.ts is also unreferenced."
      }
    ],
    "confidence": {"level": 90}
  }

expected_behavior: |
  Agent produces valid JSON (no markdown fences) with the following top-level structure:
  - summary object containing:
    - verdict string: must be one of "SHIP", "SHIP WITH FIXES", or "BLOCK"
    - one_liner string summarizing the review outcome
  - critical_findings array where each entry has:
    - title (string)
    - severity (string: "High", "Medium", or "Low")
    - location (string referencing a file and line range)
    - fix (string describing how to fix the issue)
  - confidence object with a numeric level field

  The agent must read the actual source files on disk before producing findings — findings must reference real file locations.
  The verdict must be "SHIP WITH FIXES" given the rounding gap and negative count issues present in the implementation.
  critical_findings must include at least one finding about the Math.round rounding gap in html.ts.

failure_modes: |
  - Output is not valid JSON or is wrapped in markdown code fences
  - Missing summary object or verdict field
  - Verdict is not one of the three allowed values
  - critical_findings array is missing or empty (agent found no issues)
  - Findings lack proposed fixes (title and description only)
  - Findings reference non-existent files or made-up line numbers (agent did not read source)
  - No confidence level provided
  - Agent rubberstamps the implementation as SHIP without identifying any issues

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - summary.verdict is one of SHIP / SHIP WITH FIXES / BLOCK
    - critical_findings array has at least 1 entry with title, severity, location, and fix
    - At least one finding references the rounding gap or negative count issue
    - confidence object with numeric level is present

  partial:
    - Output is valid JSON but findings lack fix proposals (only description)
    - Only one finding when two clear issues exist
    - Verdict present but critical_findings is empty

  fail:
    - Output is not valid JSON
    - No verdict provided
    - Agent rubberstamps implementation as SHIP with no findings despite known issues
    - Output is completely off-topic
