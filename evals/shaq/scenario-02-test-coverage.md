# Eval: Shaq — Scenario 02 — Test Coverage (Edge Case)

## Overview

Tests Shaq's ability to write tests that are actually valuable — covering boundary conditions, error paths, and integration behavior — not just the happy path. The prompt provides a completed implementation with gaps in test coverage; Shaq must write the missing tests.

---

prompt: |
  The following TypeScript function has been implemented:

  ```typescript
  export function processRefund(
    orderId: string,
    amount: number,
    paymentMethod: "credit_card" | "bank_transfer"
  ): RefundResult {
    if (!orderId || orderId.trim() === "") {
      throw new Error("orderId is required");
    }
    if (amount <= 0) {
      throw new Error("amount must be positive");
    }
    if (amount > 10000) {
      throw new Error("amount exceeds maximum refund limit");
    }
    const fee = paymentMethod === "bank_transfer" ? 1.5 : 0;
    return {
      orderId,
      refundAmount: amount - fee,
      status: "approved",
      fee
    };
  }
  ```

  Bird's acceptance criteria include:
  AC1: Credit card refunds have no fee
  AC2: Bank transfer refunds have a 1.50 fee deducted
  AC3: Empty orderId throws validation error
  AC4: Amount of 0 throws validation error
  AC5: Amount of 10001 throws validation error
  AC6: Amount of 10000 is valid (boundary — should succeed)
  AC7: Whitespace-only orderId throws validation error (e.g., "   ")

  Write tests for all 7 ACs. Produce your full output schema.

expected_behavior: |
  - Tests cover all 7 ACs with explicit test names referencing the AC
  - AC6 boundary test is correct: amount=10000 does NOT throw, returns approved with refundAmount=10000 (or 10000-1.50 for bank_transfer)
  - AC7 whitespace test calls processRefund("   ", 100, "credit_card") and expects throw
  - Fee arithmetic is verified in AC2 test: refundAmount === amount - 1.50
  - Tests for AC4 and AC5 use boundary values exactly (0 and 10001), not arbitrary values
  - No implementation changes made (tests only)
  - acceptance_criteria_coverage maps all 7 ACs to test names
  - deviations section is empty (no scope creep)

failure_modes: |
  - AC6 boundary test missing (tests go up to AC5 but skip the valid-boundary case)
  - AC7 whitespace test missing (only tests empty string "" not "   ")
  - Fee arithmetic not verified (test only checks status: "approved", not refundAmount value)
  - Using arbitrary values for boundary tests (e.g., amount=99999 for the too-high test instead of 10001)
  - Modifying the implementation to make tests pass easier
  - acceptance_criteria_coverage absent or incomplete

scoring_rubric: |
  pass:
    - All 7 ACs covered with correct test logic
    - AC6 boundary correctly tested as valid (not as error)
    - AC7 whitespace tested with whitespace-only string
    - Fee arithmetic verified numerically in AC2
    - Boundary values exact (0, 10000, 10001)
    - No implementation changes
    - acceptance_criteria_coverage complete

  partial:
    - 5-6 of 7 ACs covered
    - Boundary values mostly correct
    - Fee arithmetic tested but imprecisely (e.g., checks refundAmount is not equal to amount)
    - acceptance_criteria_coverage present but incomplete

  fail:
    - Fewer than 5 ACs covered
    - AC6 boundary tested as error (incorrect)
    - No fee arithmetic verification
    - Implementation modified to make tests pass
    - acceptance_criteria_coverage absent
