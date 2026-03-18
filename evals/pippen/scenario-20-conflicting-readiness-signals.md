# Eval: Pippen — Scenario 20 — Conflicting Readiness Signals (Expert)

## Overview

Tests Pippen's ability to produce a calibrated, nuanced verdict when readiness signals conflict — some aspects are excellent while others are critical gaps. Pippen must avoid both over-approving and over-blocking, and must produce a precise, differentiated assessment.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a "real-time analytics ingestion service" before it ships to production. The service receives clickstream events via HTTP and writes them to a data warehouse.

  Strong signals:
  - Excellent observability: structured JSON logging with request ID, event type, duration; distributed tracing with OpenTelemetry; Prometheus metrics with latency histograms; p99 dashboard and alerts configured
  - Resilience: circuit breaker on data warehouse writes, exponential backoff retry (3 retries), dead-letter queue for failed events
  - Deployment: blue/green deployment with automated smoke tests; instant rollback via load balancer traffic switch
  - Load tested: 10,000 events/sec sustained for 30 minutes without degradation

  Critical gaps:
  - Data warehouse writes are NOT idempotent — retried events create duplicate records
  - No deduplication logic in the consumer pipeline
  - The dead-letter queue has no consumer — failed events accumulate but are never processed or alerted on
  - At-least-once delivery: the service can emit duplicate events under normal operation (acknowledged but also retried if the ACK is lost)

  Assess operational readiness.

expected_behavior: |
  - Pippen explicitly acknowledges the strong signals and does NOT dismiss them — this service has excellent operational foundations
  - Pippen identifies the non-idempotent write issue as a critical blocker: retries (which the service will perform due to its retry policy) will create duplicate records in the data warehouse, corrupting analytics data
  - Pippen identifies that the dead-letter queue with no consumer is a silent data loss risk — events that fail all retries are queued but never processed or alerted on
  - Pippen identifies that at-least-once delivery combined with non-idempotent writes is a guaranteed data quality issue under normal operation
  - Pippen recommends: (1) idempotency key on data warehouse writes (deduplication by event_id), (2) consumer for the DLQ with alerting on DLQ depth, (3) acknowledgment of the at-least-once delivery semantics as an accepted trade-off (or switch to exactly-once if available)
  - Verdict: NOT READY — the non-idempotent write + retry combination guarantees data corruption
  - Pippen does NOT let the excellent observability and load test results compensate for the data correctness issue

failure_modes: |
  - Approving because the service has excellent observability, load testing, and resilience patterns
  - Treating non-idempotent writes as a nice-to-have fix
  - Missing that the retry policy + non-idempotent writes = guaranteed duplicates
  - Missing the dead-letter queue with no consumer
  - Blocking the service because of the observability strengths being somehow concerning (paranoia)

scoring_rubric: |
  pass:
    - Strong signals explicitly acknowledged (not dismissed)
    - Non-idempotent write + retry policy = guaranteed duplicate data identified as the blocker
    - Dead-letter queue with no consumer identified as silent data loss risk
    - At-least-once delivery + non-idempotent = data quality issue under normal operation identified
    - Specific recommendations: idempotency key, DLQ consumer with alerting
    - Verdict is NOT READY, explicitly grounded in data correctness, not observability
    - Pippen does not let strong observability compensate for data correctness gaps

  partial:
    - Non-idempotent write issue identified but retry connection not made explicit
    - DLQ consumer gap identified but not framed as silent data loss
    - Verdict is NOT READY but reasoning partially correct

  fail:
    - Verdict is READY or READY WITH CAVEATS based on excellent observability
    - Non-idempotent write issue not identified
    - DLQ consumer gap not identified
    - At-least-once + non-idempotent combination not analyzed
