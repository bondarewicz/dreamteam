# Eval: Pippen — Scenario 17 — Distributed System Observability (Expert)

## Overview

Tests Pippen's ability to assess observability in a distributed system with multiple async hops, identifying where trace context is lost and where observability gaps would make a production incident uninvestigable.

---

category: capability

prompt: |
  You are Pippen reviewing the observability of a five-service order processing system.

  Services and their observability:
  1. API Gateway: generates a trace ID per request, propagates it via X-Trace-ID header, emits structured logs with trace ID
  2. OrderService: receives X-Trace-ID, logs it, publishes events to Kafka with the trace ID in the message headers
  3. FulfillmentWorker: consumes Kafka events but does NOT extract or propagate the trace ID from message headers — generates a new trace ID for each consumed message
  4. NotificationService: called by FulfillmentWorker via HTTP without any trace ID — starts a fresh trace
  5. AuditService: called by both OrderService and FulfillmentWorker via HTTP without trace ID propagation

  Metrics:
  - All five services have request/event counters and duration histograms
  - No cross-service SLO tracking

  Assess the observability across the system.

expected_behavior: |
  - Pippen identifies the trace context breaks: FulfillmentWorker does not extract the trace ID from Kafka message headers — creating a new ID breaks the trace chain from API Gateway through to fulfillment
  - Pippen identifies that NotificationService has no incoming trace ID — an error in NotificationService cannot be correlated to an originating API request
  - Pippen identifies that AuditService receives calls from two services (OrderService and FulfillmentWorker) without trace context — audit records cannot be tied to originating requests
  - Pippen names the specific consequence: if a customer calls about a failed order, the on-call engineer cannot trace the full path from API Gateway to Audit without manually correlating timestamps across five separate log streams
  - Pippen recommends: FulfillmentWorker must extract trace ID from Kafka headers, all HTTP calls between services must propagate X-Trace-ID
  - Pippen notes that cross-service SLO tracking is absent — there is no end-to-end success rate metric for an order traversing all five services
  - Verdict: NOT READY for incident investigation at production scale — trace gaps make diagnosis extremely difficult

failure_modes: |
  - Approving because each service has metrics and logs individually
  - Not identifying the Kafka trace context break at FulfillmentWorker
  - Not identifying the missing trace propagation to NotificationService and AuditService
  - Missing the consequence: full order trace requires manual multi-log correlation
  - Not identifying the cross-service SLO gap

scoring_rubric: |
  pass:
    - FulfillmentWorker Kafka trace break identified
    - NotificationService and AuditService missing trace context identified
    - Consequence named: full order trace requires manual correlation of 5 log streams
    - Cross-service SLO gap identified
    - Specific fix recommendations for each trace break
    - Verdict is NOT READY or READY WITH CAVEATS

  partial:
    - FulfillmentWorker trace break identified but NotificationService or AuditService missed
    - Consequence partially explained
    - Cross-service SLO gap not mentioned

  fail:
    - Verdict is READY because individual service metrics exist
    - Kafka trace break not identified
    - No consequence analysis
    - Fix recommendations absent
