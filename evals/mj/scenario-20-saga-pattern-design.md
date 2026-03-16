# Eval: MJ — Scenario 20 — Saga Pattern for Distributed Transactions (Expert)

## Overview

Expert-level: MJ must design a saga pattern for a multi-step distributed transaction, including compensating transactions for each step and handling partial failure scenarios correctly.

---

category: capability

graders:
  - type: contains
    values: ["saga", "compensat", "rollback", "idempoten", "trade_off"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 600

prompt: |
  A courier marketplace order flow involves these sequential steps across 4 services:

  1. Order Service: creates an order record (status: PENDING)
  2. Inventory Service: reserves the items in the order
  3. Payment Service: charges the customer
  4. Courier Service: assigns a courier

  Each step can fail. The business rule: if any step fails, all prior steps must be undone. For example, if payment fails (step 3), the inventory reservation (step 2) must be released and the order (step 1) must be cancelled.

  Design the saga pattern for this flow. Use your full output schema.

expected_behavior: |
  - MJ designs a choreography or orchestration saga (either is acceptable; orchestration is preferred for clarity and should be recommended)
  - Compensating transactions for each step:
    1. Order creation -> compensating: mark order CANCELLED
    2. Inventory reservation -> compensating: release reservation
    3. Payment charge -> compensating: issue refund (most complex — payment refunds have their own latency and failure modes)
    4. Courier assignment -> compensating: unassign courier (make them available again)
  - MJ identifies that the Payment compensating transaction is the most dangerous: issuing a refund can fail; if the refund fails, the customer was charged but the order is cancelled — "stuck" state
  - MJ addresses idempotency: all steps must be idempotent (if the saga replays a step, it should not double-charge or double-reserve)
  - MJ addresses the "saga stuck" problem: if a compensating transaction fails, the system enters a stuck state that requires manual intervention — this must be monitored and alerted
  - trade_offs: sagas are eventually consistent — for a window of time, the inventory is reserved but the order may be in the process of being cancelled; this must be acceptable to the domain
  - risks: payment refund failure causing stuck state; compensating transactions must be idempotent but are harder to test than forward transactions
  - implementation_guidance: recommend an orchestrator-based saga (single state machine in an Orchestrator Service) over choreography (easier to reason about, easier to monitor)

failure_modes: |
  - Not designing compensating transactions for all 4 steps
  - Missing that payment refund is the most failure-prone compensating transaction
  - Not addressing idempotency for saga step replay
  - Not addressing the "stuck saga" problem when compensating transactions themselves fail
  - Recommending choreography over orchestration without justifying why for this complexity level

scoring_rubric: |
  pass:
    - Compensating transactions for all 4 steps designed
    - Payment refund failure (stuck state) identified as the highest risk
    - Idempotency for all saga steps addressed
    - Saga stuck state monitoring/alerting addressed
    - Orchestration recommended over choreography with reasoning
    - trade_offs includes eventual consistency and compensating transaction failure risk

  partial:
    - Compensating transactions for 3 of 4 steps
    - Payment refund risk mentioned
    - Idempotency mentioned but not fully designed
    - Stuck state mentioned but not fully addressed

  fail:
    - Fewer than 3 compensating transactions designed
    - Payment refund failure not identified
    - No idempotency consideration
    - Saga stuck state not addressed
    - trade_offs missing eventual consistency
