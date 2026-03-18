# Eval: Pippen — Scenario 08 — Missing Alertable Metrics (Medium)

## Overview

Tests Pippen's ability to identify that a service has metrics instrumentation but lacks the specific metrics needed to support alerting and SLA monitoring — a service can have metrics and still be unmonitorable.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a "file upload processing service" before it ships to production. Here is what exists:

  - The service accepts file uploads (up to 50MB), validates format, and stores them in S3
  - The SLA is: 99% of uploads must complete within 10 seconds
  - Structured JSON logging with request ID, file size, and duration
  - /health endpoint checking S3 connectivity
  - Prometheus metrics currently instrumented: requests_total, requests_failed_total
  - No latency histogram or summary metric
  - No file size tracking in metrics
  - No S3 storage error rate metric (S3 failures are counted in requests_failed_total but not broken out)
  - Timeout of 30s on S3 upload calls
  - Retry logic: 2 retries on S3 failures
  - Rollback: redeploy previous image

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies that without a latency histogram, the 10-second SLA cannot be monitored or alerted on
  - Pippen identifies that requests_failed_total conflates all failure types — S3 failures, validation failures, and timeout failures are indistinguishable, making root cause analysis very difficult
  - Pippen recommends adding: (1) an upload_duration_seconds histogram to enable p99 alerting against the 10s SLA, (2) a failure_reason label on the failed counter (validation|s3_error|timeout) to distinguish failure types
  - Pippen notes that file size tracking in metrics (e.g., a histogram of upload file sizes) would help correlate latency spikes with large file uploads — this is a nice-to-have, not a blocker
  - Pippen's verdict is NOT READY or READY WITH CAVEATS (must-fix: latency histogram for SLA monitoring)

failure_modes: |
  - Approving because "metrics exist"
  - Missing the latency histogram gap as it relates to SLA monitoring
  - Not identifying that the single requests_failed_total counter cannot support root cause analysis
  - Recommending file size tracking as a must-have (it is a nice-to-have)
  - Vague recommendations ("add more metrics")

scoring_rubric: |
  pass:
    - Latency histogram gap identified as blocking SLA monitoring
    - Undifferentiated failure counter identified as a root cause analysis gap
    - Specific recommendations: histogram for duration, failure_reason label for failed counter
    - File size tracking noted as nice-to-have, not a blocker
    - Verdict is NOT READY or READY WITH CAVEATS with clear must-fix items

  partial:
    - Latency histogram gap identified but SLA connection not made explicit
    - Failure counter issue identified but recommendation imprecise
    - Verdict correct

  fail:
    - Verdict is READY because "metrics exist"
    - Latency histogram gap not identified
    - SLA monitoring capability not assessed
    - No specific metric recommendations
