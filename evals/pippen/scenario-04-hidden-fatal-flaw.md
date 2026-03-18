# Eval: Pippen — Scenario 04 — Hidden Fatal Flaw (Negative Case)

## Overview

Tests Pippen's ability to identify a service that appears production-ready on the surface but has a single hidden fatal flaw that would cause silent data loss in production. Pippen must not approve a service just because its observability signals look good.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a "payment event consumer" service before it ships to production. Here is what exists:

  - The service consumes payment events from a Kafka topic named payment.events
  - Structured JSON logging on every consumed event: event ID, amount, status code, duration
  - A /health endpoint returning 200 with Kafka consumer group lag
  - Prometheus metrics: events_consumed_total, events_failed_total, consumer_lag_gauge
  - Retry logic: failed event processing is retried 3 times with 500ms backoff
  - Dead-letter topic: payment.events.dlq for events that fail all 3 retries
  - Circuit breaker on the downstream payment database with 60s reset window
  - Rollback plan: redeploy previous image, consumer group offset will resume from last committed offset

  One detail in the implementation: the service commits the Kafka offset immediately after receiving the event, before processing it.

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies the fatal flaw: committing the Kafka offset BEFORE processing the event means that if the service crashes during processing, the event is silently lost — the offset has been committed so Kafka will not redeliver it
  - The retry logic and DLQ do NOT protect against this failure mode — they only handle processing errors that are caught and returned, not crashes mid-processing
  - Pippen flags this as a hard blocker: the correct pattern is commit-after-processing (or use manual offset commits after successful processing)
  - Pippen's verdict is NOT READY — this is a data loss risk, not a monitoring gap
  - Pippen correctly notes that the observability signals are otherwise adequate (logging, metrics, health check, DLQ)
  - Pippen provides a specific recommendation: "Change to commit offset only after successful processing (or DLQ routing)"

failure_modes: |
  - Approving the service as READY because logging, metrics, and health check are present
  - Missing the pre-commit offset bug entirely
  - Mentioning the pre-commit as a "note" without flagging it as a fatal flaw
  - Treating it as a nice-to-have improvement rather than a blocker
  - Confusing the DLQ as protection against offset pre-commit failures

scoring_rubric: |
  pass:
    - Pre-commit offset pattern identified as a fatal flaw causing silent data loss on crash
    - Explanation that retry logic and DLQ do not protect against pre-commit crash
    - Verdict is NOT READY
    - Specific remediation: commit after processing, not before
    - Correctly notes that observability signals are otherwise adequate (not a false positive)

  partial:
    - Pre-commit offset concern raised but framed as a reliability risk rather than a fatal flaw
    - Verdict is NOT READY but remediation is vague
    - Observability incorrectly treated as compensating for the flaw

  fail:
    - Pre-commit offset pattern not identified
    - Verdict is READY or READY WITH CAVEATS
    - DLQ cited as protection against offset pre-commit crash
    - Observability signals treated as sufficient for approval
