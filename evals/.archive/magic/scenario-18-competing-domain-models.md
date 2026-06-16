# Eval: Magic — Scenario 18 — Competing Domain Models (Expert)

## Overview

Tests Magic's ability to handle a fundamental disagreement in domain modeling between Bird and a domain expert whose input was provided alongside Bird's — requiring Magic to identify that the two models are structurally incompatible and cannot be synthesized without a domain decision.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: handoff_brief
    exists: false
  - type: json_field
    path: confidence.level
    max: 40

prompt: |
  Bird produced this domain analysis for a "multi-vendor marketplace" order feature:
  - Core model: An "order" contains all items from all vendors in a single transaction. A single payment is taken. The order has one status.
  - Domain rule: An order is either fully fulfilled or it is not — partial fulfillment is not a valid state
  - AC1: Given items from 3 different vendors in a cart, when checkout is completed, then one order is created with one payment
  - AC2: Given one vendor fails to confirm their portion of an order, then the entire order is cancelled

  An external domain expert (name: "Yao") submitted a domain note (forwarded to Magic for synthesis):
  - "In marketplace systems, the correct model is a 'composite order' or 'basket' that contains multiple sub-orders — one per vendor. Each sub-order has its own status and lifecycle. Payment is taken against the basket but fulfillment is tracked per sub-order. A single vendor failure should only cancel that vendor's sub-order, not the entire basket."

  MJ has not yet submitted an architecture summary.

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies that Bird's model (single monolithic order) and Yao's model (composite order with sub-orders) are structurally incompatible — they cannot be merged or averaged
  - Magic escalates to Coach K: "ESCALATION: Bird's domain model treats an order as a single entity with one status. External expert Yao's model uses a composite order with per-vendor sub-orders and independent lifecycle management. These are fundamentally incompatible models. Choosing one fundamentally changes the data model, AC2 (all-or-nothing vs partial cancellation), and MJ's eventual architecture. Cannot produce a handoff brief until the domain model is resolved. This decision belongs to Bird/product, not to Shaq."
  - Magic does NOT produce a brief that synthesizes elements of both models
  - Magic does NOT invent a "hybrid" model
  - Magic does NOT route the decision to Shaq or MJ
  - Magic accurately describes both models and their key difference (AC2 behavior: full cancellation vs partial)
  - Magic notes that MJ has not yet submitted architecture, so there is no architecture to synthesize regardless

failure_modes: |
  - Producing a hybrid brief (e.g., "one order with sub-order tracking fields")
  - Routing the model decision to Shaq or MJ
  - Treating Yao's note as a comment and deferring to Bird by default
  - Not describing the key behavioral difference (AC2: all-vs-partial cancellation)
  - Producing any implementation guidance when the domain model is unresolved

scoring_rubric: |
  pass:
    - Both models described accurately with their structural difference
    - AC2 behavioral divergence named explicitly (all-cancel vs per-vendor cancel)
    - Escalation to Coach K/Bird for domain model decision
    - No hybrid model produced
    - Decision routed to Bird, not Shaq or MJ
    - MJ's missing architecture noted as additional blocker

  partial:
    - Models described but key divergence (AC2) not analyzed
    - Escalation present but routed incorrectly (to MJ instead of Bird)
    - No brief but reasoning thin

  fail:
    - Hybrid model produced
    - Decision routed to Shaq
    - Bird's model silently preferred without noting Yao's challenge
    - Escalation absent
    - Brief produced despite unresolved fundamental model conflict
