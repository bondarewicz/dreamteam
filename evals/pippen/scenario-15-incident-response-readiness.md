# Eval: Pippen — Scenario 15 — Incident Response Readiness (Very Hard)

## Overview

Tests Pippen's ability to assess whether a service's observability is sufficient not just for normal monitoring, but for effective incident response — specifically whether an on-call engineer could diagnose and resolve a production incident using only the available tooling.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing an "order state machine service" from an incident response readiness perspective. The service manages order state transitions.

  Available tooling:
  - Structured JSON logs with: request_id, order_id, from_state, to_state, actor_id, duration_ms, error_code (if applicable)
  - Logs shipped to a central log aggregator with 30-second ingestion delay
  - Prometheus metrics: state_transitions_total (labels: from_state, to_state, success=true|false), transition_duration_histogram
  - No distributed tracing (no trace IDs, no span correlation across services)
  - No ability to replay or reprocess failed state transitions (no event log or outbox)
  - Alert: state_transitions_total{success=false} > 5 per minute triggers PagerDuty
  - Runbook: exists but last updated 18 months ago

  In a hypothetical incident: an on-call engineer gets paged that state transitions are failing. Orders are stuck in PROCESSING state.

  Assess the incident response readiness.

expected_behavior: |
  - Pippen assesses the incident response capability, not just monitoring coverage
  - Pippen identifies that without distributed tracing, the on-call engineer cannot correlate a failed transition across the services that participated in the order flow
  - Pippen flags the 30-second log ingestion delay as a concern during fast-moving incidents where the engineer needs real-time visibility
  - Pippen flags the stale runbook (18 months) as an incident response risk — the runbook may not reflect current service behavior
  - Pippen identifies that there is no way to reprocess stuck orders without manual intervention — the lack of an event log or outbox means recovery requires direct database intervention
  - Pippen recommends: (1) distributed tracing even if minimal (trace ID propagation), (2) runbook review and update process, (3) an admin endpoint or tooling to requeue/reprocess stuck transitions
  - Pippen notes the alert threshold and alert routing (PagerDuty) are adequate
  - Verdict: NOT READY or READY WITH CAVEATS — incident response tooling has significant gaps

failure_modes: |
  - Assessing monitoring coverage only (metrics + logging = adequate) without assessing incident response capability
  - Missing the distributed tracing gap as it relates to cross-service incident diagnosis
  - Not flagging the stale runbook
  - Not identifying the lack of stuck-order recovery tooling
  - Treating the 30-second log delay as a minor concern when it can significantly hinder fast incident resolution

scoring_rubric: |
  pass:
    - Distributed tracing gap identified as cross-service diagnosis blocker
    - 30-second log delay identified as incident response concern
    - Stale runbook identified and flagged
    - No recovery tooling for stuck orders identified
    - At least two specific recommendations (tracing, runbook refresh, recovery endpoint)
    - Verdict is NOT READY or READY WITH CAVEATS

  partial:
    - Two of four incident response gaps identified
    - Recommendations present for identified gaps
    - Verdict correct

  fail:
    - Incident response assessment not performed (only coverage assessed)
    - Verdict is READY because metrics and logging exist
    - Three or more gaps missed
    - No recovery tooling issue identified
