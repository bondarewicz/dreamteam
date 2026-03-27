# Eval: Magic — Scenario 23 — Learning Review No Single Root Cause (Hard / Capability)

## Overview

Tests that Magic refuses to identify a single root cause when presented with a complex multi-agent incident. The spec is explicit: "Never identify a single root cause. Single root cause analysis creates the illusion that one fix would have prevented everything." This scenario provides a 4-agent incident with at least 5 independent contributing factors, each of which was necessary for the outcome to occur. The graders verify that singular root cause language is absent, multiple factors are surfaced, and the "What had to be true" framing from the spec is used.

---

category: capability

graders:
  - type: not_contains
    values: ["the root cause was", "primary cause", "the cause was", "caused by a single"]
  - type: contains
    values: ["Contributing Factors"]
  - type: field_count
    pattern: "\\*\\*[A-Za-z]"
    min: 4
  - type: contains
    values: ["DETECT"]
  - type: length_bounds
    min: 2000

prompt: |
  Produce a learning review for the following incident. Pay particular attention to the Contributing Factors section — surface every independent condition that was necessary for this outcome to occur.

  **Incident summary**: On 2026-03-05, the payment processing service double-charged 312 customers during a scheduled infrastructure failover. Each affected customer was charged twice for a single transaction. Total financial exposure was £28,400. Refunds were issued within 6 hours. The incident involved failures across four independent systems.

  **What happened — Shaq's implementation notes**:
  "The payment service uses an idempotency key (order_id + attempt_number) to prevent duplicate charges. During failover, the attempt_number counter resets to 1 if it cannot reach the counter service. I implemented this fallback 8 months ago — the intent was to allow the payment service to keep functioning if the counter service was temporarily unavailable. The fallback was never tested against a full infrastructure failover scenario."

  **MJ's architecture notes (post-incident)**:
  "The idempotency key design assumes the counter service is always reachable. I reviewed Shaq's original fallback PR — it was a reasonable defensive move but I did not flag that counter-reset behavior could produce key collisions. The payment processor (Stripe) deduplicates on idempotency keys per 24-hour window — if the same key is submitted twice within 24 hours, Stripe returns the original charge, not a new one. However, the counter reset meant the second charge used a key that had not been used before in Stripe's window."

  **Kobe's review notes**:
  "I reviewed the failover runbook used by the ops team. The runbook says to restart services in dependency order. The counter service was listed as a non-critical service and was restarted last, after the payment service had already come back online. The runbook did not document the payment service's dependency on the counter service for idempotency. I added a dependency note to the runbook 3 months ago for a different dependency but this one was missing."

  **Bird's domain notes**:
  "The domain rule is: a customer must never be charged more than once for a single order. The idempotency enforcement is the technical implementation of this rule. I was not aware that the technical implementation had a fallback mode that could violate the domain rule. The acceptance criteria for the payment service do not include a test for counter-service-unavailable scenarios."

  **Pippen's operational notes**:
  "The failover took 4 minutes. During that window, 312 payment requests came in that hit the counter-reset fallback. We have no monitoring on idempotency key uniqueness — we track charge success/failure rates but not duplicate charge detection. The double-charge pattern was caught by a customer complaint 40 minutes after the failover, not by alerting."

  Produce a full learning review for this incident. Use the "What had to be true for this to happen?" prompt when building the Contributing Factors section.

expected_behavior: |
  - All 6 sections present
  - Contributing Factors section explicitly uses "What had to be true" framing or equivalent
  - At least 5 separate contributing factors identified:
      (1) Counter-reset fallback producing colliding idempotency keys
      (2) Failover runbook not documenting counter service as payment-critical dependency
      (3) No acceptance criteria covering counter-unavailable scenario
      (4) No monitoring for duplicate charge detection (only success/failure rates)
      (5) Stripe's 24-hour deduplication window not being accounted for in the fallback design
      (6) Failover runbook restart ordering placing counter service last
  - "root cause" (singular) does NOT appear anywhere in the review
  - "primary cause" does NOT appear
  - "the cause was" does NOT appear
  - Each factor described as independently necessary — not as proximate/distal hierarchy
  - What We Learned section has at least 3 learnings in "We now know that X, which means Y" format
  - Forward Commitments include DETECT-tagged action (monitoring for duplicate charges)
  - Tone does not single out any agent as primarily responsible

failure_modes: |
  - "root cause" appears (e.g., "The root cause was the counter reset fallback")
  - Fewer than 4 contributing factors identified
  - Contributing factors listed as a narrative paragraph rather than separate enumerated items
  - One factor presented as more important/primary than others
  - "What had to be true" framing absent from Contributing Factors
  - DETECT-tagged commitment for duplicate charge monitoring absent
  - Any agent singled out as the main cause of the incident
  - Shaq's fallback implementation described as "the bug" without surfacing the system conditions that made it dangerous

scoring_rubric: |
  pass:
    - "root cause" (singular) completely absent
    - "What had to be true" framing present in Contributing Factors
    - At least 5 contributing factors enumerated separately
    - No hierarchy of factors (no primary/proximate/distal framing)
    - At least 3 "We now know that X, which means Y" learnings
    - DETECT-tagged commitment for duplicate charge monitoring present
    - All 6 review sections present

  partial:
    - "root cause" absent but "What had to be true" framing also absent
    - 3-4 contributing factors identified but presented as narrative rather than separate items
    - Fewer than 3 "We now know" learnings
    - DETECT commitment present but not specifically about duplicate charges
    - 5 of 6 sections present

  fail:
    - "root cause" (singular) appears
    - Fewer than 3 contributing factors
    - One agent singled out as primarily responsible
    - What We Learned section absent or uses "what went wrong" framing
    - DETECT commitment absent
    - Fewer than 5 sections present
