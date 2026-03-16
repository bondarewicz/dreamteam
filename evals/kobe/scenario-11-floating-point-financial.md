# Eval: Kobe — Scenario 11 — Floating Point in Financial Calculation (Hard)

## Overview

Tests Kobe's ability to identify the use of floating-point arithmetic for financial calculations where it can produce incorrect results, and to distinguish this from the false positive scenario in scenario 02.

---

category: capability

graders:
  - type: contains
    values: ["floating point", "financial", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: length_bounds
    min: 200

prompt: |
  Review the following TypeScript function that calculates the total payout for a courier's weekly earnings, including base pay, bonuses, and deductions:

  ```typescript
  async function calculateWeeklyPayout(courierId: string): Promise<number> {
    const deliveries = await db.deliveries.getWeekly(courierId);

    let totalEarnings = 0;
    for (const delivery of deliveries) {
      totalEarnings += delivery.basePay;
      totalEarnings += delivery.bonusPay;
      totalEarnings -= delivery.deductions;
    }

    // Apply platform commission (15%)
    const commission = totalEarnings * 0.15;
    const payout = totalEarnings - commission;

    return payout;
  }
  ```

  This value is used directly to initiate a bank transfer to the courier.

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the floating-point issue as Critical or Important (contrast with scenario 02 where it was Suggestion because it was display-only): here the result is used to initiate a bank transfer; floating-point errors accumulate across hundreds of deliveries and the result is sent to the bank
  - Example: if a courier has 100 deliveries at $12.10 each, `100 * 12.10` in IEEE 754 floating point is 1209.9999999999998, not 1210. The courier is paid slightly less than they are owed.
  - Fix: use integer arithmetic in cents (store all monetary values as integers representing cents, divide by 100 only for display), or use a decimal library (e.g., `decimal.js`)
  - Kobe notes a second issue: there is no validation that basePay, bonusPay, and deductions are valid numbers — if any is NaN (from a database null), the entire calculation returns NaN and the transfer fails silently
  - safe_to_deploy is false because monetary calculations with floating-point have known, systematic precision errors

failure_modes: |
  - Not identifying the floating-point issue in a bank transfer context (compare with scenario 02 where it was acceptable for display)
  - Identifying it only as a Suggestion (it is Important/Critical when real money is transferred)
  - Not providing a specific fix (integer cents or decimal library)
  - Missing the NaN propagation risk from database nulls
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - Floating-point issue identified as Important or Critical (distinction from display context)
    - Specific example of floating-point error with real numbers
    - Fix: integer cents or decimal library
    - NaN propagation risk noted
    - safe_to_deploy false
    - Contrast with display-only context (this is bank transfer — higher severity)

  partial:
    - Floating-point issue identified but severity debatable
    - Fix present but vague
    - NaN risk not noted
    - safe_to_deploy false

  fail:
    - Floating-point issue not identified
    - safe_to_deploy true
    - Classified as Suggestion (not Important/Critical)
    - NaN risk not mentioned
