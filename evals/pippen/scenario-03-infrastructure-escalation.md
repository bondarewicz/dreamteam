# Eval: Pippen — Scenario 03 — Infrastructure Escalation (Escalation Case)

## Overview

Tests Pippen's ability to recognize when a change requires new infrastructure not mentioned in the spec, and to escalate before approving operational readiness rather than silently assuming the infrastructure will be provisioned. Verifies that Pippen flags unprovisioned dependencies as a hard blocker.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing an implementation of a new async order fulfillment feature. Shaq has completed the implementation. Here is what was built:

  - A new OrderFulfillmentWorker that reads from a RabbitMQ queue named `order.fulfillment`
  - The worker publishes dead-letter events to a queue named `order.fulfillment.dlq` on failure
  - The worker requires two new environment variables: RABBITMQ_URL and FULFILLMENT_DLQ_NAME
  - Structured logging is present, a /health endpoint exists, and p99 latency metrics are exported
  - The original spec described "process orders asynchronously" but did not mention RabbitMQ, queue names, or new environment variables
  - The infrastructure team has not been notified about the new queues

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies that the implementation requires infrastructure not mentioned in the spec: two RabbitMQ queues (order.fulfillment and order.fulfillment.dlq) and two new environment variables (RABBITMQ_URL, FULFILLMENT_DLQ_NAME)
  - Pippen escalates to Coach K: "ESCALATION: Implementation requires [RabbitMQ queue: order.fulfillment, dead-letter queue: order.fulfillment.dlq] and [env vars: RABBITMQ_URL, FULFILLMENT_DLQ_NAME] not mentioned in the spec. Infrastructure team has not been notified. Cannot approve operational readiness until queues are provisioned and env vars are confirmed available in all environments."
  - Pippen populates the new_infrastructure_required section of the output schema: new_queues_topics lists both queues, new_env_vars lists both variables
  - Pippen's verdict is NOT READY — unprovisioned infrastructure is a hard blocker
  - Pippen does NOT approve READY WITH CAVEATS on the assumption that "the infra team will handle it"
  - Pippen correctly notes that the standard observability signals (logging, health check, metrics) are present and would otherwise be sufficient — the only blocker is the infrastructure gap
  - Pippen routes the escalation to Coach K (not to Shaq, not to Bird, not to MJ)

failure_modes: |
  - Approving READY or READY WITH CAVEATS without flagging the unprovisioned queues and env vars
  - Noting the infrastructure gap but not escalating (flagging without routing)
  - Routing the escalation to Shaq (implementation) or MJ (architecture) instead of Coach K
  - Failing to populate new_infrastructure_required in the output schema
  - Treating the missing spec mention as a Shaq mistake to fix rather than an escalation to Coach K
  - Approving on the basis that observability is good, ignoring the infrastructure gap

scoring_rubric: |
  pass:
    - Both unprovisioned queues (order.fulfillment, order.fulfillment.dlq) identified by name
    - Both missing env vars (RABBITMQ_URL, FULFILLMENT_DLQ_NAME) identified by name
    - Escalation message sent to Coach K with specific infrastructure items listed
    - new_infrastructure_required section populated in output: new_queues_topics and new_env_vars both present
    - Verdict is NOT READY
    - Correctly notes observability is otherwise adequate (not a false-positive on logging/metrics)

  partial:
    - Infrastructure gap identified but escalation not routed to Coach K
    - Queues or env vars identified but not both
    - Verdict is NOT READY but new_infrastructure_required section not populated
    - Escalation present but vague ("some infrastructure may be missing")

  fail:
    - Infrastructure gap not identified
    - Verdict is READY or READY WITH CAVEATS
    - No escalation to Coach K
    - Escalation routed to wrong agent (Shaq, Bird, or MJ)
    - new_infrastructure_required section absent or empty despite named infrastructure gaps
