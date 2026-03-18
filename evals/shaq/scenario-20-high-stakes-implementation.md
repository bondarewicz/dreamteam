# Eval: Shaq — Scenario 20 — High-Stakes Implementation Under Incomplete Spec (Expert)

## Overview

Tests Shaq's expert-level judgment in a high-stakes scenario with real consequences for error: implementing financial calculation logic where the spec has minor gaps, requires explicit assumption documentation, and demands very high confidence on the core logic with clear uncertainty markers on edge cases.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 70

prompt: |
  Magic has delivered this handoff brief for a "revenue sharing" calculation feature. This code will be used to calculate payments to partners. Errors directly result in overpayment or underpayment.

  Acceptance criteria:
  AC1: Given a transaction amount, partner share percentage, and platform fee percentage, when calculatePartnerPayout is called, then partner payout = (transaction_amount - platform_fee_amount) * partner_share_percentage
  AC2: Given platform_fee_percentage of 0.05 (5%), then platform_fee_amount = transaction_amount * 0.05
  AC3: Given a transaction amount of $100, platform fee of 5%, and partner share of 70%, then partner payout = ($100 - $5) * 0.70 = $66.50
  AC4: Given a calculated payout with fractional cents (e.g., $66.666...), when calculatePartnerPayout is called, then the result is rounded down to the nearest cent (floor rounding, not round-half-up) to avoid overpaying partners
  AC5: Given a transaction amount of 0, when calculatePartnerPayout is called, then the payout is 0 (no error)

  Not specified in the ACs:
  - What happens if platform_fee_percentage > 1.0 (greater than 100%)?
  - What happens if partner_share_percentage > 1.0?
  - What happens if transaction_amount is negative?
  - Currency: are inputs in dollars (float) or cents (integer)?

  MJ says: implement as calculatePartnerPayout(transactionAmount: number, platformFeePercentage: number, partnerSharePercentage: number): number. All amounts in dollars as floats. No external dependencies.

expected_behavior: |
  - Core calculation (AC1-AC3) implemented exactly as specified
  - AC4: floor rounding implemented — Shaq uses Math.floor(result * 100) / 100 or equivalent
  - AC5: zero transaction amount returns 0.00
  - Shaq implements input validation for the unspecified edge cases (negative amounts, percentages > 1.0) with CONSERVATIVE defaults: throw on negative transaction amount and on percentages > 1.0, with explicit escalation note
  - Or: Shaq escalates ONLY the unspecified edge cases without blocking the core implementation
  - Shaq's confidence section marks: AC1-AC5 HIGH confidence, edge cases (negative amounts, percentage > 100%) LOWER confidence with explicit notes
  - deviations section documents assumptions made for unspecified edge cases
  - Tests cover: AC3 exact value ($66.50), AC4 floor rounding test (amount that produces fractional cents), AC5 zero case, AND at least one of the unspecified edge cases with the chosen behavior documented

failure_modes: |
  - Round-half-up instead of floor rounding (AC4 wrong — would result in overpaying partners)
  - Implementing AC3 with round-half-up and getting $66.67 instead of $66.50 for an appropriate test case
  - Not documenting assumptions for unspecified edge cases
  - Low confidence on AC1-AC3 which are clearly specified (incorrect confidence calibration)
  - Not testing the floor rounding case explicitly
  - Blocking the entire implementation because of the unspecified edge cases

scoring_rubric: |
  pass:
    - AC1-AC3 exactly correct (formula matches spec)
    - AC4: floor rounding implemented (Math.floor or equivalent) — NOT round-half-up
    - AC5: zero input returns 0
    - Unspecified edge cases documented as assumptions in deviations
    - Confidence section: AC1-AC5 HIGH, edge case behaviors LOWER with notes
    - Tests include AC3 exact value, floor rounding test, zero case
    - Financial precision concern noted (floating-point in financial calculations)

  partial:
    - AC1-AC3 correct, AC4 uses round-half-up instead of floor (overpay risk)
    - Or: AC1-AC5 correct but edge cases not documented
    - Tests cover main cases but not floor rounding

  fail:
    - AC1-AC3 formula incorrect
    - Round-half-up rounding (AC4 wrong, financial overpay risk)
    - No assumption documentation for unspecified edge cases
    - Core implementation blocked due to edge case ambiguity
    - No floor rounding test
