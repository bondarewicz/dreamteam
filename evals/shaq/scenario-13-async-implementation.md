# Eval: Shaq — Scenario 13 — Async Implementation with Error Propagation (Hard)

## Overview

Tests Shaq's ability to implement an async function that correctly handles multiple async operations, propagates errors with the right codes, and does not swallow errors or produce confusing error messages.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1

prompt: |
  Bird has defined these acceptance criteria for a processPayment function:

  AC1: Given valid input, when processPayment is called, then it calls the fraud check service, then the payment gateway, and returns { success: true, transaction_id }
  AC2: Given the fraud check service flags the payment as fraudulent, when processPayment is called, then it throws with code FRAUD_DETECTED (payment gateway must NOT be called)
  AC3: Given the payment gateway returns a decline, when processPayment is called, then it throws with code PAYMENT_DECLINED with the decline reason from the gateway
  AC4: Given the fraud check service is unavailable (network error), when processPayment is called, then it throws with code FRAUD_SERVICE_UNAVAILABLE (original error should be chained)
  AC5: Given the payment gateway is unavailable (network error), when processPayment is called, then it throws with code GATEWAY_UNAVAILABLE (original error should be chained)
  AC6: Given AC2 fires, the payment gateway must not be called (no side effects on fraud block)

  MJ says: implement as an async TypeScript function processPayment(input: PaymentInput, fraudService: FraudService, gateway: PaymentGateway): Promise<PaymentResult>. Both service parameters are injected. No external dependencies.

  Implement the function and tests.

expected_behavior: |
  - Calls are sequential: fraud check first, then payment gateway (never in parallel — AC2 requires fraud block to prevent gateway call)
  - AC2 and AC6 tested together: when fraud is detected, the mock gateway is verified to NOT have been called
  - AC4 and AC5 error chaining: the wrapped error should include a cause property (or equivalent) pointing to the original network error
  - Tests use mock services with controlled return values for each scenario
  - AC3 preserves the decline reason from the gateway in the thrown error
  - No use of Promise.all (would violate AC2/AC6)

failure_modes: |
  - Using Promise.all to call fraud check and gateway simultaneously (violates AC2/AC6)
  - AC4 and AC5 catching the original error and throwing a new one without chaining it
  - AC3 not preserving the decline reason
  - AC6 not tested (test doesn't verify gateway was not called on fraud block)
  - try/catch that swallows all errors under a single generic error code

scoring_rubric: |
  pass:
    - Sequential async calls: fraud check before gateway
    - AC6 tested: mock gateway is verified NOT called when fraud detected
    - AC4 and AC5 include original error in cause/chain
    - AC3 preserves decline reason from gateway
    - All 6 ACs tested with mock services
    - acceptance_criteria_coverage maps all 6 ACs

  partial:
    - Sequential calls correct, AC6 not verified in tests
    - 4-5 ACs covered
    - Error chaining partially implemented

  fail:
    - Promise.all or parallel calls used
    - AC6 not tested
    - Error messages swallowed (all errors become a single generic error)
    - AC3 decline reason lost
    - acceptance_criteria_coverage absent
