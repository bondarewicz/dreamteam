# Eval: Kobe — Scenario 02 — False Positive Rate (Edge Case)

## Overview

Tests Kobe's precision: given code that is mostly correct, Kobe must identify real issues without over-flagging. The scenario includes code patterns that could superficially look risky but are actually safe in context. Kobe must not pad findings to appear thorough.

---

category: regression

graders:
  - type: not_contains
    values: ["race condition", "injection", "Critical"]
  - type: section_present
    sections: ["Production"]
  - type: length_bounds
    min: 200

prompt: |
  Review the following TypeScript function:

  ```typescript
  function calculateShippingCost(
    weightKg: number,
    distanceKm: number,
    expressDelivery: boolean
  ): number {
    if (weightKg <= 0) throw new Error("Weight must be positive");
    if (distanceKm <= 0) throw new Error("Distance must be positive");

    const baseRate = 2.50;
    const weightCost = weightKg * 0.80;
    const distanceCost = distanceKm * 0.05;
    const expressSurcharge = expressDelivery ? 15.00 : 0;

    const total = baseRate + weightCost + distanceCost + expressSurcharge;
    return Math.round(total * 100) / 100;
  }
  ```

  This is a pure synchronous function with no external dependencies. It is called in a read-only context — the result is displayed to users before they confirm an order; no payment is taken based on this calculation alone.

  Produce your full output schema.

expected_behavior: |
  - Kobe finds at most 1-2 findings total, none Critical
  - A legitimate finding might be: floating-point precision edge cases (e.g., specific inputs could produce rounding artifacts) — but this is at most Important or Suggestion given the business context (display only, not payment)
  - A legitimate suggestion: distanceKm could be a float (0.5 km) — no validation for very large distance values
  - Kobe does NOT escalate to Critical any of: lack of return type annotation, variable naming choices, the absence of logging, the absence of tests (these are review concerns for the test file, not this function)
  - production_readiness.safe_to_deploy: the review should note this function itself is safe — the concern is what calls it
  - Kobe does NOT invent risks ("what if distanceKm is NaN") if the calling context has already validated inputs
  - confidence.level appropriate given limited context about callers

failure_modes: |
  - Flagging lack of logging as Critical or Important (this is a pure calculation function)
  - Flagging variable naming as a finding
  - Inventing a race condition that cannot exist in a synchronous pure function
  - Flagging the absence of tests as a critical finding in a review of this function (tests are Shaq's job)
  - Classifying floating-point rounding as Critical in a display-only context
  - Producing 3+ Critical findings on code that has no critical risks

scoring_rubric: |
  pass:
    - 0-2 findings total, none Critical
    - Any floating-point finding correctly rated Important or Suggestion
    - No invented risks for a pure synchronous function
    - No style/naming findings elevated above Suggestion
    - production_readiness verdict is SHIP or SHIP WITH FIXES (not BLOCK)

  partial:
    - 1-2 findings but one incorrectly rated Critical
    - Some padding but main issues correctly identified
    - Verdict is SHIP WITH FIXES with reasonable justification

  fail:
    - 3+ Critical findings on a pure calculation function
    - Invented risks (race conditions, injection vulnerabilities)
    - Verdict is BLOCK with no real justification
    - Style/naming findings rated Critical or Important
