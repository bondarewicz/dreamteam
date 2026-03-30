# Eval: Kobe — Draft — Passbar verify fixes (Auto-captured)

## Overview

Auto-captured from Dream Team session on 2026-03-30. Fix-verify loop verification. Scoring rubric auto-generated from reference_output. Ready for Generate Graders.

---

category: draft

graders: []

prompt: |
  You are verifying that your previous findings have been correctly fixed.

  You previously found these issues:

  1. FINDING [HIGH]: Math.round rounding gap — segments could sum to 99%, leaving visible gray sliver
     Expected fix: Last segment uses flex:1 instead of percentage width

  2. FINDING [HIGH]: Negative counts produce broken CSS widths
     Expected fix: Math.max(0, x) clamping on each count

  3. FINDING [MINOR]: Dead CSS (.passbar-fill) and dead code (barClass()) should be removed

  Shaq has applied fixes. Verify each one:
  - Read the relevant files: web/src/views/html.ts, web/static/theme.css
  - Confirm the fix is correct
  - State VERIFIED or NOT VERIFIED for each finding
  - Final verdict: SHIP or BLOCK

reference_output: |
  Finding 1 [HIGH]: Math.round rounding gap -- segments could sum to 99%
  VERIFIED. Line 78-79 in html.ts: the last segment uses flex:1 instead of a percentage width, while all preceding segments use Math.round percentages. The flexbox container (display: flex on .passbar) ensures the last segment absorbs any rounding slack. No gray sliver possible.

  Finding 2 [HIGH]: Negative counts produce broken CSS widths
  VERIFIED. Lines 65-67 in html.ts: each input is clamped with Math.max(0, ...) before any arithmetic. Negative values become zero, preventing negative percentages.

  Finding 3 [MINOR]: Dead CSS (.passbar-fill) and dead code (barClass())
  VERIFIED. No .passbar-fill class exists anywhere in the codebase. The barClass reference found in EvalRun.ts:1511 is a different component (trend chart bar, not the pass-rate bar) and is not dead code -- it is actively used two lines later. The passbar-specific dead code has been cleaned up.

  Final verdict: SHIP

  All three fixes are correctly implemented. The passbar rendering is now robust against rounding gaps and negative inputs, and the dead code has been removed.

expected_behavior: |
  Agent produces structured prose output (not necessarily JSON) that:
  - Addresses each of the 3 findings by name/number in the same order as the prompt
  - States explicitly "VERIFIED" or "NOT VERIFIED" for each finding
  - Provides a brief explanation of what was observed in the source files to support each verdict
  - Concludes with a final verdict of either "SHIP" or "BLOCK"

  For this scenario the correct outcome is:
  - Finding 1 (rounding gap): VERIFIED — last segment uses flex:1
  - Finding 2 (negative counts): VERIFIED — Math.max(0, ...) clamping present
  - Finding 3 (dead CSS/code): VERIFIED — .passbar-fill and barClass() removed
  - Final verdict: SHIP

failure_modes: |
  - Output does not address all three findings
  - "VERIFIED" or "NOT VERIFIED" verdict is missing for any finding
  - Agent does not read the source files and fabricates line numbers or code (hallucination)
  - Final verdict is missing (no SHIP or BLOCK conclusion)
  - Final verdict is BLOCK despite all findings being correctly fixed
  - Agent only provides a final verdict without verifying individual findings

scoring_rubric: |
  pass:
    - All three findings explicitly addressed with VERIFIED or NOT VERIFIED
    - Each verdict is supported by a reference to what was found in the source files
    - Final verdict of SHIP or BLOCK is clearly stated
    - Verdicts for all three findings are VERIFIED (correct outcome given the fixes applied)

  partial:
    - Two of three findings addressed with explicit verdicts but one is missing
    - All three findings addressed but no final verdict stated
    - Verdicts present but no supporting explanation from source files

  fail:
    - Fewer than two findings addressed
    - No explicit VERIFIED / NOT VERIFIED verdicts (only general commentary)
    - No final verdict
    - Output is completely off-topic
