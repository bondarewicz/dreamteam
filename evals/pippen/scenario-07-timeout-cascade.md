# Eval: Pippen — Scenario 07 — Timeout Cascade Risk (Medium)

## Overview

Tests Pippen's ability to identify a timeout misconfiguration that creates a cascading failure risk — specifically, when the client timeout is shorter than the server's processing time, causing client retries to compound load on an already-overwhelmed server.

---

category: capability

prompt: |
  You are Pippen reviewing an "order enrichment service" before it ships to production. Here is what exists:

  - The service receives an order event and calls three downstream services to enrich it: ProductService (p99: 200ms), CustomerService (p99: 150ms), InventoryService (p99: 800ms)
  - All three calls are made sequentially
  - The order enrichment service has an inbound timeout of 500ms (the upstream caller will timeout after 500ms)
  - The order enrichment service has outbound timeouts of 1000ms on each downstream call
  - Structured JSON logging with request ID and duration per downstream call
  - /health endpoint checks all three downstream service connectivity
  - Prometheus metrics: enrichment_requests_total, enrichment_duration_histogram, enrichment_failed_total
  - No retry logic on outbound calls
  - Rollback: redeploy previous image

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies the timeout mismatch: the sequential calls to ProductService (200ms) + CustomerService (150ms) + InventoryService (800ms) add up to ~1150ms p99, which exceeds the inbound 500ms timeout
  - Pippen explains the consequence: the upstream caller will timeout at 500ms and potentially retry, but the downstream calls continue processing for up to 1000ms each — this creates orphaned downstream requests and compounds load
  - Pippen flags that the outbound timeouts (1000ms each) are longer than the inbound timeout (500ms), meaning downstream work continues after the upstream has already given up
  - Pippen recommends either: (1) parallelizing the three downstream calls, (2) increasing the inbound timeout to accommodate p99 sequential execution, or (3) reducing outbound timeouts to fail fast before the inbound timeout
  - Verdict is NOT READY or READY WITH CAVEATS — this is a correctness and reliability risk under load

failure_modes: |
  - Approving because "timeouts exist on all calls"
  - Not computing the sequential p99 total (~1150ms) against the inbound timeout (500ms)
  - Flagging only the lack of retry logic without identifying the timeout mismatch
  - Not explaining the orphaned-downstream-request consequence
  - Providing only "increase the inbound timeout" without considering parallelization

scoring_rubric: |
  pass:
    - Timeout mismatch identified: sequential p99 sum (~1150ms) exceeds inbound 500ms timeout
    - Orphaned downstream request consequence described
    - Outbound timeout > inbound timeout relationship identified
    - At least two remediation options provided (parallelization, timeout adjustment)
    - Verdict is NOT READY or READY WITH CAVEATS

  partial:
    - Timeout mismatch identified but consequence not fully explained
    - Only one remediation option provided
    - Verdict correct but analysis thin

  fail:
    - Timeout mismatch not identified
    - Verdict is READY because "timeouts exist"
    - No computation of sequential call duration vs inbound timeout
    - No remediation options
