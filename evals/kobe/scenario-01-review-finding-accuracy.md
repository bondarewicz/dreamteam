# Eval: Kobe — Scenario 01 — Review Finding Accuracy (Happy Path)

## Overview

Tests Kobe's ability to accurately identify real critical risks in an implementation — using his hypothesis-driven methodology — and produce findings that are actionable, precisely located, and correctly severity-rated.

---

category: regression

graders:
  - type: contains
    values: ["Critical", "phantom", "idempoten", "safe_to_deploy"]
  - type: section_present
    sections: ["critical_findings", "production_readiness"]
  - type: field_count
    pattern: "severity:\\s*Critical"
    min: 1
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  Review the following TypeScript implementation of a payment processing function:

  ```typescript
  async function processPayment(
    orderId: string,
    amount: number,
    cardToken: string
  ): Promise<PaymentResult> {
    const order = await db.orders.findById(orderId);
    await paymentGateway.charge(cardToken, amount);
    await db.orders.update(orderId, { status: "paid", paidAt: new Date() });
    return { success: true, orderId };
  }
  ```

  Produce your full output schema including critical_findings, production_readiness, and confidence assessment.

expected_behavior: |
  - Kobe identifies the critical race condition / failure mode: the payment is charged (line 3) but if the database update (line 4) fails, the customer is charged but the order is not marked as paid. This creates a "phantom payment" scenario.
  - This is correctly classified as Critical severity.
  - A second finding: no idempotency check — if processPayment is called twice with the same orderId (e.g., due to a retry), the customer is charged twice.
  - production_readiness.safe_to_deploy is false
  - The fix for the phantom payment is specific: either use a database transaction wrapping the charge (if the gateway supports two-phase commit) or implement a compensation pattern (attempt to void the charge if the DB update fails)
  - Kobe produces a maximum of 3 critical findings — he does not pad the list
  - confidence.level is >= 80 (code is clearly readable, issues are definitive)

failure_modes: |
  - Missing the phantom payment risk (charge succeeds, DB update fails)
  - Missing the double-charge risk on retry
  - Classifying these as "Important" instead of "Critical" for a payment function
  - Proposing a vague fix ("add error handling") without specifying the compensation pattern
  - Finding a style issue and elevating it to critical (false positive)
  - Producing more than 3 critical findings (padding)

scoring_rubric: |
  pass:
    - Phantom payment scenario identified as Critical finding
    - Double-charge on retry identified (Critical or High)
    - Specific fix proposed for each (compensation pattern or idempotency key)
    - production_readiness.safe_to_deploy is false
    - No more than 3 critical_findings
    - No style or cosmetic issues elevated to critical
    - confidence.level >= 75

  partial:
    - Phantom payment identified but retry/idempotency missed
    - Fix proposed but vague
    - safe_to_deploy is false
    - confidence.level >= 60

  fail:
    - Phantom payment not identified
    - safe_to_deploy is true or not set
    - Only style findings produced
    - Fix absent or trivial ("add a try/catch")
    - More than 3 critical_findings
