# Eval: Shaq — Scenario 11 — Boundary Condition Precision (Hard)

## Overview

Tests Shaq's ability to implement boundary conditions with exact precision — particularly floating-point comparisons, inclusive vs exclusive boundaries, and the ordering of multiple overlapping rules.

---

category: capability

prompt: |
  Bird has defined these acceptance criteria for a calculateTax function:

  AC1: Given income below $10,000 (exclusive), when calculateTax is called, then tax = 0
  AC2: Given income of exactly $10,000, when calculateTax is called, then tax = income * 0.10 (10% bracket begins at exactly $10,000 inclusive)
  AC3: Given income of $10,001 through $50,000 (inclusive), when calculateTax is called, then tax = income * 0.10
  AC4: Given income of exactly $50,000, when calculateTax is called, then tax = income * 0.10 (still in 10% bracket — 25% bracket starts at $50,001)
  AC5: Given income of $50,001 through $150,000 (inclusive), when calculateTax is called, then tax = income * 0.25
  AC6: Given income above $150,000 (exclusive), when calculateTax is called, then tax = income * 0.40
  AC7: Given income of exactly $150,000, when calculateTax is called, then tax = income * 0.25 (25% bracket ends at $150,000 inclusive)
  AC8: Given income of 0 or negative, when calculateTax is called, then throw with code INVALID_INCOME

  MJ says: implement as a pure TypeScript function calculateTax(income: number): number. No external dependencies.

  Implement the function and tests.

expected_behavior: |
  - Brackets: [0, 10000) -> 0; [10000, 50000] -> 10%; (50000, 150000] -> 25%; (150000, inf) -> 40%
  - AC2 boundary: income === 10000 -> 10% (not 0%)
  - AC4 boundary: income === 50000 -> 10% (not 25%)
  - AC7 boundary: income === 150000 -> 25% (not 40%)
  - AC8: income <= 0 throws INVALID_INCOME
  - Tests explicitly test all boundary values: 9999, 10000, 10001, 49999, 50000, 50001, 149999, 150000, 150001
  - Tests verify the exact boundary behavior with numeric precision (e.g., 10000 * 0.10 = 1000.00)
  - Floating-point arithmetic results are verified with appropriate precision

failure_modes: |
  - Off-by-one on any bracket boundary (most commonly: 50000 returning 25% when it should be 10%)
  - Missing AC8 validation for income <= 0
  - Tests that only test mid-bracket values (e.g., 5000, 25000, 100000, 200000) without boundary values
  - Using strict inequality where inclusive is required (income < 10000 instead of income < 10000)
  - Reversing the 25% and 40% brackets

scoring_rubric: |
  pass:
    - All 4 bracket boundaries correct (9999/10000 split, 50000/50001 split, 150000/150001 split)
    - AC8 validation present
    - Tests explicitly test all 9 boundary values
    - acceptance_criteria_coverage maps all 8 ACs

  partial:
    - 3 of 4 boundary splits correct; most likely failure at 50000 (10% vs 25%) or 150000 (25% vs 40%)
    - Tests cover some but not all boundary values
    - AC8 present

  fail:
    - Two or more boundary errors
    - Tests only use mid-bracket values without boundary testing
    - AC8 missing
    - acceptance_criteria_coverage absent
