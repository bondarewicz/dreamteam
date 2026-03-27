# Eval: Pippen — Scenario 05 — Logging Gaps (Medium)

## Overview

Tests Pippen's ability to identify specific, actionable logging gaps in a service that has some logging but is missing critical fields that would prevent effective incident diagnosis in production.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing an "address validation" microservice before it ships to production. Here is what exists:

  - The service accepts an address via POST /validate and calls an external address validation API (SmartyStreets)
  - Logging: logs "Validation request received" on every call and "Validation result: valid/invalid" on completion
  - No request ID in log lines
  - No duration logged for the SmartyStreets API call
  - No logging of the input address or the raw API response
  - A /health endpoint exists returning 200 when SmartyStreets is reachable
  - Prometheus metric: validation_requests_total (no label for valid/invalid breakdown, no latency histogram)
  - Timeout of 3s on the SmartyStreets API call
  - Rollback: redeploy previous image

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen flags missing request ID in log lines: without a request ID, correlated log traces across services are impossible
  - Pippen flags missing API call duration: impossible to diagnose SmartyStreets latency issues without timing data
  - Pippen flags missing valid/invalid label on the metric counter: cannot calculate validation pass rate or alert on a spike in invalid addresses
  - Pippen flags that no latency histogram exists for the external API call: cannot track p99 latency for SLA purposes
  - Pippen notes that logging the input address has a PII consideration — this should be flagged as a decision point, not an automatic recommendation (the service may intentionally omit PII from logs)
  - Pippen's verdict is NOT READY or READY WITH CAVEATS (must-fix: request ID, duration, metric labels)
  - Recommendations are specific: "Add correlation ID to all log lines", "Log SmartyStreets API call duration in ms", "Add result label (valid|invalid) to validation_requests_total"

failure_modes: |
  - Approving as READY because "logging and metrics exist"
  - Missing the metric label gap (valid/invalid breakdown)
  - Missing the request ID gap
  - Recommending logging raw input address without flagging the PII consideration
  - Vague recommendations ("improve logging detail")

scoring_rubric: |
  pass:
    - Request ID gap identified
    - API call duration gap identified
    - Metric label (valid/invalid) gap identified
    - Latency histogram absence noted
    - PII consideration flagged for input address logging (not blindly recommended)
    - Verdict is NOT READY or READY WITH CAVEATS
    - Recommendations are specific and actionable

  partial:
    - 3 of 4 gaps identified
    - Recommendations partially specific
    - PII consideration absent (recommends logging address without flagging risk)

  fail:
    - Verdict is READY
    - Fewer than 2 gaps identified
    - No actionable recommendations
    - Metric label gap entirely missed
