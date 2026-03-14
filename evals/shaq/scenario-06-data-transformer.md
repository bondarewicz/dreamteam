# Eval: Shaq — Scenario 06 — Data Transformer Implementation (Medium)

## Overview

Tests Shaq's ability to implement a precise data transformation function where the transformation rules involve multiple conditions and the output schema is strictly defined.

---

category: capability

prompt: |
  Bird has defined these acceptance criteria for a normalizeOrderEvent function:

  AC1: Given an order event with status "PAID", when normalized, then the output status is "completed"
  AC2: Given an order event with status "REFUNDED", when normalized, then the output status is "refunded"
  AC3: Given an order event with status "FAILED" or "DECLINED", when normalized, then the output status is "failed"
  AC4: Given an order event with an unknown status (e.g., "PROCESSING"), when normalized, then the output status is "unknown" and a warning is emitted to the logger
  AC5: Given an order event with a total_amount in cents (integer), when normalized, then the output amount is in dollars (float, 2 decimal places)
  AC6: Given an order event where customer_name is missing or null, when normalized, then the output customer_name is "Anonymous"

  MJ says: implement as a TypeScript function normalizeOrderEvent(raw: RawOrderEvent, logger: Logger): NormalizedOrderEvent. The function is pure except for the logger.warn call in AC4. No external dependencies.

  Input type:
  - RawOrderEvent: { id: string, status: string, total_amount: number, customer_name?: string | null }

  Output type:
  - NormalizedOrderEvent: { id: string, status: "completed" | "refunded" | "failed" | "unknown", amount: number, customer_name: string }

  Implement the function and tests.

expected_behavior: |
  - Status mapping covers all 6 ACs including the AC3 dual-status case ("FAILED" OR "DECLINED" both map to "failed")
  - AC4 emits logger.warn (not logger.error, not console.log) and still returns "unknown" as the status
  - AC5 conversion: total_amount / 100, rounded to 2 decimal places (e.g., 1099 -> 10.99)
  - AC6 default: missing or explicitly null customer_name both return "Anonymous"
  - Tests cover all 6 ACs with explicit test names
  - AC3 is tested with BOTH "FAILED" and "DECLINED" inputs
  - AC5 is tested with a value that requires proper rounding (e.g., 1099 -> 10.99, 100 -> 1.00)
  - The logger mock is injected in tests — Shaq does not use a global logger
  - No external dependencies

failure_modes: |
  - AC3 only handling "FAILED" and not "DECLINED" (or vice versa)
  - AC4 using logger.error instead of logger.warn
  - AC5 doing integer division (1099 / 100 = 10, not 10.99)
  - AC6 only handling null but not undefined/missing customer_name
  - Tests not verifying that logger.warn was called for AC4
  - acceptance_criteria_coverage absent

scoring_rubric: |
  pass:
    - All 6 ACs correctly implemented
    - AC3 handles both "FAILED" and "DECLINED"
    - AC4 uses logger.warn and returns "unknown"
    - AC5 uses floating-point division with correct decimal handling
    - AC6 handles both null and undefined customer_name
    - Tests cover all 6 ACs; AC3 tested with both inputs; AC4 verifies logger.warn called
    - acceptance_criteria_coverage maps all 6 ACs

  partial:
    - 5 of 6 ACs correct; AC3 or AC6 the likely gap
    - Tests cover 4-5 ACs
    - Logger.warn vs logger.error distinction missed

  fail:
    - Multiple AC mapping errors
    - AC5 integer division bug
    - Tests cover only happy path
    - acceptance_criteria_coverage absent
