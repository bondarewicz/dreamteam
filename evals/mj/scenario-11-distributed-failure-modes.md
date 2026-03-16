# Eval: MJ — Scenario 11 — Distributed System Failure Modes (Hard)

## Overview

Tests MJ's ability to enumerate failure modes in a distributed architecture and design appropriate resilience patterns for each, rather than designing only the happy path.

---

category: capability

graders:
  - type: contains
    values: ["failure", "circuit breaker", "timeout", "retry", "idempoten"]
  - type: section_present
    sections: ["Risk", "Implementation"]
  - type: length_bounds
    min: 600

prompt: |
  The following architecture has been deployed:

  - Order Service calls Payment Service synchronously (HTTP) to charge customers
  - Payment Service calls a third-party payment gateway (Stripe) synchronously
  - Order Service calls Notification Service asynchronously (fire-and-forget HTTP POST) to send confirmation emails

  Enumerate the failure modes in this architecture and design the resilience patterns needed. Use your full output schema.

expected_behavior: |
  - MJ identifies failure modes:
    1. Payment Service is unavailable: Order Service hangs or errors; without timeout/circuit breaker, threads accumulate
    2. Stripe is slow/unavailable: Payment Service hangs; cascades to Order Service
    3. Network timeout between Order and Payment: Payment may have been charged but Order Service doesn't know (phantom charge)
    4. Notification Service is down: fire-and-forget means failures are silently dropped; emails not sent
    5. Partial failure: Payment succeeds but Order Service crashes before updating order status (phantom charge, as in Kobe scenario 01)
  - MJ designs resilience for each:
    1 & 2: Timeout on all synchronous calls (not indefinite); circuit breaker for Stripe to prevent cascade; retry with exponential backoff but only for idempotent operations
    3: Idempotency key on payment requests — if Order retries after timeout, Stripe deduplicates
    4: Notification Service should use a message queue, not fire-and-forget HTTP (converts it from a lost-event risk to an at-least-once delivery guarantee)
    5: Distributed transaction or saga pattern for the Order-Payment sequence
  - MJ identifies that the fire-and-forget notification is an architectural issue that requires changing the integration pattern (not a local fix)
  - trade_offs: adding circuit breakers and retries increases code complexity; idempotency keys require Stripe support (need to verify)
  - implementation_guidance: specific retry parameters (e.g., 3 retries, 100ms/500ms/1000ms backoff)

failure_modes: |
  - Listing failure modes without designing resilience patterns for each
  - Missing the phantom charge risk (timeout between Order and Payment)
  - Missing that fire-and-forget is insufficient for critical notifications
  - Recommending retries for non-idempotent operations (e.g., retrying a charge without idempotency keys)
  - Not distinguishing between transient failures (worth retrying) and permanent failures (circuit break)

scoring_rubric: |
  pass:
    - At least 5 failure modes identified
    - Phantom charge risk identified
    - Fire-and-forget notification weakness addressed
    - Circuit breaker and timeout patterns recommended
    - Idempotency key for payment retries specified
    - trade_offs for added complexity acknowledged

  partial:
    - 3-4 failure modes identified
    - Phantom charge mentioned but not fully addressed
    - Notification pattern weakness mentioned
    - Circuit breakers recommended but details thin

  fail:
    - Fewer than 3 failure modes
    - Phantom charge not identified
    - Fire-and-forget not challenged
    - No resilience patterns beyond "add error handling"
    - No idempotency consideration
