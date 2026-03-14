# Eval: Pippen — Scenario 14 — Monitoring Gap Analysis (Very Hard)

## Overview

Tests Pippen's ability to perform a comprehensive monitoring gap analysis — identifying not just what metrics exist, but whether the existing metrics can support the required alerting strategy for a business-critical service.

---

category: capability

prompt: |
  You are Pippen reviewing a "subscription billing service" that processes recurring subscription renewals. The service is business-critical: missed renewals directly impact revenue. Here is what exists:

  Business SLOs:
  - 99.9% of subscription renewals must be attempted within 1 hour of the scheduled renewal time
  - Failed renewals must trigger a retry within 24 hours

  Current metrics:
  - renewals_processed_total (counter, labels: status=success|failed)
  - billing_api_duration_seconds (histogram)
  - billing_api_errors_total (counter)

  Current alerts:
  - Alert: billing_api_errors_total > 10 in 5 minutes

  Logging: structured JSON with renewal ID, subscription ID, scheduled_time, processed_time, and outcome

  /health endpoint: checks billing API connectivity

  No metrics for: renewal scheduling lag, queue depth, retry attempt tracking, or whether the 99.9% SLA is being met

  Assess whether the monitoring is sufficient for a business-critical service.

expected_behavior: |
  - Pippen identifies the critical gap: there is no metric measuring renewal scheduling lag — the 99.9% within-1-hour SLA cannot be alerted on with the current metrics
  - Pippen recommends: renewal_scheduling_lag_seconds histogram (or a gauge tracking max_lag) so an alert can fire when any renewal is approaching the 1-hour SLA window
  - Pippen identifies the retry tracking gap: no metric tracks whether failed renewals are being retried within 24 hours — the SLO is unmonitorable
  - Pippen identifies that the current alert (billing_api_errors_total > 10 in 5 minutes) is a symptom alert, not an SLO alert — it may fire when renewals are still succeeding or fail to fire when renewals are silently not being scheduled
  - Pippen recommends SLO-based alerting: a recording rule tracking the renewal success rate over a rolling window with a burn rate alert
  - Verdict: NOT READY or READY WITH CAVEATS — the monitoring cannot support the stated SLOs

failure_modes: |
  - Approving because "metrics exist" and an alert is configured
  - Missing the scheduling lag metric gap (the core SLO is unmonitorable)
  - Not identifying that the current alert is a symptom alert, not an SLO alert
  - Not identifying the retry tracking gap
  - Recommending only generic "add more metrics" without SLO-specific recommendations

scoring_rubric: |
  pass:
    - Scheduling lag metric gap identified as the primary SLO-monitoring gap
    - Retry tracking gap (24-hour retry SLO) identified
    - Current alert critiqued as symptom-based, not SLO-based
    - Specific metric recommendations: scheduling lag histogram/gauge, retry_attempts_total counter
    - SLO-based alerting recommendation (burn rate or rolling window success rate)
    - Verdict is NOT READY or READY WITH CAVEATS

  partial:
    - Scheduling lag gap identified but retry tracking gap missed
    - Symptom alert critique present but SLO-based alerting recommendation absent
    - Verdict correct

  fail:
    - Verdict is READY because metrics and an alert exist
    - Scheduling lag gap not identified
    - Current alert not critiqued
    - No SLO-specific recommendations
