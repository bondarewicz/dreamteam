# Eval: MJ — Scenario 01 — Architecture Pattern Selection (Happy Path)

## Overview

Tests MJ's ability to evaluate multiple architectural patterns against a concrete set of requirements and produce a justified, trade-off-aware recommendation using his full output schema.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: trade_offs
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 60

prompt: |
  A courier company needs to build a notification system. Requirements:
  - Send delivery status updates to customers via email and SMS
  - Support adding new channels (push notifications, WhatsApp) in the future
  - High reliability: a failed notification must be retried, not silently dropped
  - Low latency is NOT required — notifications within 5 minutes of an event is acceptable
  - The team is small (3 engineers) and cannot maintain complex infrastructure

  Two patterns are being considered:
  A) Synchronous REST calls to email/SMS providers from the delivery service
  B) Event-driven: delivery service publishes domain events to a queue; notification workers consume and dispatch

  Analyze both options using your full output schema. Include: architecture.patterns_used with rationale, trade_offs, flexibility_points, rigidity_points, risks, and implementation_guidance.

expected_behavior: |
  - MJ recommends Option B (event-driven) for this use case with clear rationale:
    - Retry handling is built into queue semantics (dead letter queues)
    - New channels can be added as new consumers without touching the delivery service
    - Decoupling protects the delivery service from notification provider failures
  - trade_offs explicitly names what Option B sacrifices: operational complexity (queue infrastructure), debugging complexity, eventual consistency in notification timing
  - flexibility_points correctly identifies notification channel addition as a flexibility point (new consumer, no service changes)
  - rigidity_points identifies the event schema as a rigidity point (changing it breaks all consumers)
  - risks includes: queue infrastructure becoming a single point of failure, event schema drift
  - implementation_guidance for Shaq is actionable: specific queue technology recommendation (or explicit deferral with reasoning), retry policy, dead letter queue design
  - MJ does not over-engineer: given "small team" constraint, he does NOT recommend a full event sourcing or CQRS approach

failure_modes: |
  - Recommending Option A for any reason other than team complexity constraints (which should be weighed, not decisive here)
  - Not naming the event schema as a rigidity point
  - Recommending CQRS or event sourcing without acknowledging this contradicts the small-team constraint
  - trade_offs section contains only gains with no stated sacrifices
  - implementation_guidance for Shaq is vague (e.g., "use a message queue") without technology guidance or decision deferral with rationale
  - Missing the retry/dead-letter-queue as a key design element

scoring_rubric: |
  pass:
    - Option B recommended with at least 3 explicit reasons
    - trade_offs lists both gains AND sacrifices for Option B
    - Event schema identified as rigidity_point
    - Channel extensibility identified as flexibility_point
    - implementation_guidance names concrete next steps for Shaq
    - Small-team constraint factored into the recommendation (i.e., complex patterns rejected with explanation)
    - risks section includes queue infrastructure risk

  partial:
    - Option B recommended but with fewer than 3 reasons
    - trade_offs present but sacrifices thin or missing
    - implementation_guidance present but vague
    - Event schema not explicitly named as rigid

  fail:
    - No recommendation made (pure description of both options)
    - Option A recommended without sound reasoning
    - trade_offs missing entirely
    - flexibility_points or rigidity_points missing
    - implementation_guidance absent
