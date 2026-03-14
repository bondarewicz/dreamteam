# Eval: Pippen — Scenario 01 — Integration Review (Happy Path)

## Overview

Tests Pippen's ability to assess a deployed service with adequate observability coverage and correctly determine that the service meets operational readiness standards. Verifies that Pippen produces a structured, complete stability review when the service is genuinely production-ready.

---

category: regression

prompt: |
  You are Pippen reviewing a newly deployed payment notification microservice. Here is what exists:

  - Structured JSON logging on every request, including request ID, duration, status code, and error details
  - A /health endpoint returning 200 with service status and dependency checks (database, message broker)
  - Prometheus metrics exported for request rate, error rate, and p99 latency
  - Retry logic with exponential backoff on message broker publish failures (max 3 retries)
  - A circuit breaker on the downstream email provider with 30s reset window
  - Timeout of 5s on all outbound HTTP calls
  - A rollback plan: redeploy previous container image, no schema migrations in this release

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen produces a structured review using the full output schema: integration_assessment, observability_review, resilience_assessment, operational_readiness, escalations, confidence
  - Pippen confirms logging coverage is adequate: structured JSON with request ID, duration, status, errors
  - Pippen confirms metrics coverage is adequate: request rate, error rate, p99 latency present
  - Pippen confirms health check is present and checks dependencies (database, message broker)
  - Pippen confirms resilience patterns are in place: retry with backoff, circuit breaker, timeouts
  - Pippen confirms rollback is possible (no migrations, previous image available)
  - Pippen's verdict is READY or READY WITH CAVEATS (minor gaps only, not blockers)
  - Pippen does NOT invent gaps that are not present in the scenario
  - Pippen may note nice-to-have improvements (e.g., distributed tracing) without blocking the verdict
  - Escalations section is empty or contains only non-blocking observations

failure_modes: |
  - Marking the service NOT READY despite all standard NFRs being satisfied
  - Inventing missing gaps (e.g., claiming there are no metrics when metrics are explicitly present)
  - Approving the service without reviewing the full observability and resilience checklist
  - Producing a verdict without a rollback plan assessment
  - Missing structured output fields (e.g., no resilience_assessment section)
  - Treating distributed tracing absence as a blocker when it is a nice-to-have

scoring_rubric: |
  pass:
    - All output schema sections present: integration_assessment, observability_review, resilience_assessment, operational_readiness, escalations, confidence
    - Logging, metrics, and health check each assessed and confirmed adequate
    - Resilience patterns (retry, circuit breaker, timeouts) each confirmed present
    - Rollback capability confirmed (no migrations, image rollback available)
    - Verdict is READY or READY WITH CAVEATS with clear rationale
    - No fabricated gaps

  partial:
    - Most schema sections present but one missing (e.g., no resilience_assessment)
    - Verdict correct but rationale thin or checklist incomplete
    - Nice-to-have gaps listed but not incorrectly blocking verdict

  fail:
    - Verdict is NOT READY despite all standard NFRs being satisfied
    - Key schema sections missing (e.g., no observability_review)
    - Fabricated gaps cited as blockers
    - No rollback assessment
    - Observability items confirmed without reading the scenario details
