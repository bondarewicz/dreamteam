# Eval: Pippen — Scenario 09 — Microservice Mesh Integration (Hard)

## Overview

Tests Pippen's ability to assess a multi-service integration scenario where the individual services look fine but the integration pattern between them creates a reliability risk at the system level.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a three-service integration for a "checkout" flow before it ships to production.

  Service A — CartService (caller):
  - Calls OrderService and PaymentService synchronously via HTTP
  - Calls OrderService first, then PaymentService
  - Timeout: 5s on each call
  - No retry logic between calls
  - Circuit breaker on PaymentService (30s reset)
  - No circuit breaker on OrderService

  Service B — OrderService:
  - Accepts order creation requests
  - Calls InventoryService synchronously to reserve stock
  - Timeout: 3s on InventoryService call
  - Retry: 1 retry on InventoryService timeout
  - /health endpoint checking InventoryService

  Service C — PaymentService:
  - Accepts payment requests
  - Calls external payment gateway with 8s timeout
  - No circuit breaker on payment gateway
  - /health endpoint checking payment gateway connectivity

  Assess the integration's operational readiness.

expected_behavior: |
  - Pippen identifies the chain timeout issue: CartService has a 5s timeout on OrderService, but OrderService itself can take up to 3s + 3s (retry) = 6s on InventoryService — meaning CartService will timeout before OrderService can complete under retry conditions
  - Pippen identifies that CartService has no circuit breaker on OrderService: if OrderService is slow, every checkout request will block for 5s before failing
  - Pippen identifies the 8s payment gateway timeout in PaymentService exceeds CartService's 5s timeout — same orphaned-call problem as scenario-07
  - Pippen flags the dual-write risk: if OrderService succeeds but PaymentService fails (or CartService times out before PaymentService responds), an order may be created without payment captured
  - Pippen recommends: saga pattern or distributed transaction consideration, circuit breaker on OrderService, alignment of timeout budgets across the chain
  - Verdict: NOT READY — multiple systemic risks

failure_modes: |
  - Approving each service individually without assessing the chain
  - Missing the chain timeout calculation (OrderService can take 6s, CartService timeout is 5s)
  - Missing the dual-write / order-without-payment risk
  - Not recommending circuit breaker on OrderService
  - Treating the 8s payment gateway timeout as just a PaymentService concern without the chain impact

scoring_rubric: |
  pass:
    - Chain timeout violation identified: OrderService can take 6s > CartService's 5s timeout
    - Missing circuit breaker on OrderService identified
    - PaymentService 8s timeout > CartService 5s timeout identified as orphaned call risk
    - Dual-write / partial completion risk (order created, payment not captured) identified
    - Saga/compensation pattern or alternative recommended
    - Verdict is NOT READY

  partial:
    - Two of four systemic risks identified
    - Chain timeout OR dual-write risk identified
    - Verdict is NOT READY but analysis incomplete

  fail:
    - Services assessed individually, not as a chain
    - Chain timeout violation not identified
    - Dual-write risk not identified
    - Verdict is READY
