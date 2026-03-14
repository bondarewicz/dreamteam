# Eval: Shaq — Scenario 10 — Refactoring Existing Code (Hard)

## Overview

Tests Shaq's ability to refactor existing code to meet new acceptance criteria without breaking existing behavior — identifying what must change, what must stay the same, and producing tests that verify both.

---

category: capability

prompt: |
  The following existing function must be refactored:

  ```typescript
  export function calculateShipping(weight: number, destination: string): number {
    if (destination === "domestic") {
      return weight * 2.5;
    } else {
      return weight * 7.5;
    }
  }
  ```

  Current behavior (must be preserved):
  - Domestic shipping: weight * 2.5
  - International shipping: weight * 7.5

  New acceptance criteria (must be added without breaking existing behavior):
  AC1: Given destination "domestic" and weight 0 or negative, then throw with code INVALID_WEIGHT
  AC2: Given destination "express_domestic", when calculateShipping is called, then return weight * 4.0
  AC3: Given destination "freight", when calculateShipping is called, then return weight * 1.5 (freight is cheaper per kg due to bulk rates)
  AC4: Given an unknown destination (e.g., "mars"), when calculateShipping is called, then throw with code UNKNOWN_DESTINATION
  AC5: The existing domestic (weight * 2.5) and international (weight * 7.5) rates must continue to work unchanged

  MJ says: keep the same function signature. Extend it. No external dependencies.

  Refactor the function and write tests covering both existing behavior (AC5) and all new ACs.

expected_behavior: |
  - Refactored function preserves existing domestic (2.5) and international (7.5) rates
  - AC1 weight validation added: applies to ALL destinations (not just domestic) — weight <= 0 throws INVALID_WEIGHT
  - AC2 "express_domestic" destination added at 4.0 rate
  - AC3 "freight" destination added at 1.5 rate
  - AC4 unknown destination throws UNKNOWN_DESTINATION
  - Tests explicitly cover AC5: regression tests for domestic and international existing rates
  - Tests cover all 4 new ACs
  - deviations section is empty or notes that weight validation was applied globally (not just domestic) — if Shaq applies it only to domestic, that would need to be flagged
  - No scope creep: Shaq does NOT add additional destinations beyond the spec

failure_modes: |
  - AC1 weight validation applied only to domestic destination (not global)
  - AC4 unknown destination not handled (falls through with NaN or undefined result)
  - No regression tests for existing behavior (AC5 not tested)
  - Changing existing rates (2.5 domestic, 7.5 international) accidentally
  - Adding extra unrequested destinations (e.g., "same_day") not in the spec

scoring_rubric: |
  pass:
    - Existing rates unchanged (domestic 2.5, international 7.5)
    - All 4 new ACs implemented correctly
    - Weight validation applies to all destinations (or Shaq notes his interpretation with a deviations entry)
    - Regression tests for existing rates explicitly present
    - All new ACs tested
    - No extra destinations added
    - acceptance_criteria_coverage maps AC1-AC5

  partial:
    - Existing rates unchanged, 3 of 4 new ACs correct
    - Regression tests present but incomplete
    - Weight validation scoped incorrectly but noted in deviations

  fail:
    - Existing rates changed
    - AC4 not handled
    - No regression tests for existing behavior
    - Multiple new ACs missing
    - acceptance_criteria_coverage absent
