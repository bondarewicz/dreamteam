# Eval: Kobe — Scenario 16 — Distributed System Failure in Code (Very Hard)

## Overview

Tests Kobe's ability to identify failure modes in distributed system code — specifically, a missing saga compensation that leaves the system in an inconsistent state.

---

category: capability

graders:
  - type: contains
    values: ["Critical", "inconsistent", "compensat", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: field_count
    pattern: "(?i)(severity|critical).{0,20}(critical|severity)"
    min: 1
  - type: length_bounds
    min: 300

prompt: |
  Review the following TypeScript implementation of a courier assignment flow:

  ```typescript
  async function assignAndDispatch(orderId: string): Promise<void> {
    // Step 1: Reserve the courier
    const courierId = await courierService.reserve(orderId);

    // Step 2: Update order status
    await orderService.updateStatus(orderId, 'ASSIGNED', courierId);

    // Step 3: Send dispatch notification to courier
    await notificationService.sendDispatchAlert(courierId, orderId);

    // Step 4: Notify customer
    await notificationService.sendCustomerAlert(orderId, courierId);
  }
  ```

  This function has no error handling. Produce your full output schema.

expected_behavior: |
  - Kobe identifies Critical findings for each missing compensation:
    1. If step 2 (updateStatus) fails: the courier is reserved (step 1 succeeded) but the order is never updated to ASSIGNED. The courier is stuck in a reserved state and cannot take other deliveries. No compensation for the courier reservation.
    2. If step 3 (sendDispatchAlert) fails: courier is reserved, order is marked ASSIGNED, but courier never received the dispatch notification and won't know to go to the pickup location.
    3. If step 4 (sendCustomerAlert) fails: all critical operations succeeded but customer doesn't know their order is assigned. This is lower severity but still a failure mode.
  - Kobe identifies the systemic pattern: this is a saga with no compensating transactions and no rollback mechanism — any failure leaves the system in a partial state
  - Fix: wrap in try/catch; on step 2 failure, call `courierService.release(courierId)`; on step 3 failure, either retry notification or accept the inconsistency (courier can still see the order in their app)
  - Kobe escalates the saga design to MJ: "ESCALATION: This multi-step distributed operation has no compensating transactions. Recommend MJ review the saga design for this flow."
  - safe_to_deploy false

failure_modes: |
  - Missing the courier-reserved-but-order-not-updated inconsistency (step 1 succeeds, step 2 fails)
  - Not identifying this as a saga without compensations
  - Proposing "add try/catch and log errors" as the complete fix (logging is not compensation)
  - Not escalating the saga design to MJ
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - Courier stuck in reserved state (step 1 success, step 2 failure) identified as Critical
    - All 3 failure modes analyzed
    - Saga without compensation pattern identified
    - Escalation to MJ for saga design
    - Specific compensating transaction for courier release proposed
    - safe_to_deploy false

  partial:
    - 1-2 failure modes identified
    - Saga pattern mentioned
    - Escalation informal
    - safe_to_deploy false

  fail:
    - No failure modes identified
    - "Add try/catch" as complete fix
    - No saga pattern recognition
    - No MJ escalation
    - safe_to_deploy true
