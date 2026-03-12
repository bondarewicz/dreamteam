# Eval: Pippen — Scenario 02 — Operational Readiness Gaps (Edge Case)

## Overview

Tests Pippen's ability to detect missing operational readiness signals in a service that appears functional but has critical observability and health monitoring gaps. Verifies that Pippen correctly identifies and flags these gaps rather than approving a service that cannot be debugged or monitored in production.

---

prompt: |
  You are Pippen reviewing a newly written inventory sync service before it ships to production. Here is what exists:

  - The service connects to an external inventory API and syncs product stock counts to the local database every 5 minutes
  - Logging is present: `console.log("sync completed")` and `console.log("sync failed: " + err.message)` on success/failure
  - No /health endpoint
  - No metrics instrumentation
  - No retry logic on API call failures — if the inventory API is down, the sync silently fails and the next run will try again
  - No timeout on the outbound inventory API call
  - No circuit breaker
  - Rollback: re-deploy previous image (no migrations in this release)

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies that unstructured console.log output is insufficient: no request IDs, no duration tracking, no structured fields for log aggregation
  - Pippen flags absence of a /health endpoint as a gap: no way for orchestrators or load balancers to detect service failure
  - Pippen flags absence of metrics: no visibility into sync success rate, sync duration, or API error rate
  - Pippen flags missing timeout on the outbound API call: a hung API call will block the sync indefinitely
  - Pippen notes that silent failure on API outage (no retry, no alert) means data staleness goes undetected
  - Pippen's verdict is NOT READY or READY WITH CAVEATS (with must-fix items before shipping)
  - Pippen distinguishes between must-have gaps (health check, structured logs, timeout) and nice-to-haves (circuit breaker as optimization)
  - Pippen produces actionable recommendations: "Add /health endpoint", "Replace console.log with structured JSON logger", "Add 10s timeout on inventory API call"
  - Escalations section notes that without metrics, operational readiness cannot be confirmed post-deploy

failure_modes: |
  - Approving the service as READY because it "has logging" (unstructured console.log is not adequate)
  - Missing the timeout gap (no timeout on outbound call is a reliability risk)
  - Treating all gaps as nice-to-haves and not blocking the verdict
  - Not producing actionable recommendations — vague output like "improve observability"
  - Inventing gaps not present in the scenario (e.g., claiming there are no logs at all)
  - Escalating everything to Coach K without forming a verdict (Pippen's job is to assess, not defer)

scoring_rubric: |
  pass:
    - Unstructured console.log flagged as insufficient (no structured fields, no request ID)
    - Missing /health endpoint flagged as a gap
    - Missing metrics flagged (no sync success rate, duration, or error rate)
    - Missing timeout on outbound API call flagged as reliability risk
    - Silent failure on API outage flagged as an observability gap
    - Verdict is NOT READY or READY WITH CAVEATS with must-fix items listed
    - Recommendations are actionable and specific (not vague)

  partial:
    - 3-4 of the 5 gaps identified
    - Verdict is correctly NOT READY or READY WITH CAVEATS but gaps not fully enumerated
    - Recommendations present but some vague

  fail:
    - Verdict is READY despite critical gaps
    - Fewer than 3 gaps identified
    - No actionable recommendations
    - Console.log accepted as adequate structured logging
    - Timeout gap missed entirely
