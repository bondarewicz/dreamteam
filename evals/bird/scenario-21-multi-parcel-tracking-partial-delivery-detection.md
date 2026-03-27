# Eval: Bird — Scenario 21 — Multi-Parcel Tracking Partial Delivery Detection (Capability)

## Overview

Tests Bird's ability to analyze domain rules for a logistics platform where individual parcel tracking enables partial delivery detection, validating that Bird correctly identifies entity boundaries, state machines, and business invariants.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 1
  - type: json_field
    path: "acceptance_criteria"
    min_items: 1
  - type: json_field
    path: "edge_cases"
    min_items: 1

prompt: |
  We're building a logistics platform and the product manager said: "each shipment parcel needs to be tracked individually so we can detect partial delivery." We have a Shipment that contains multiple Parcels. Right now our code treats the shipment as a single unit — one tracking number, one status. We need to refactor so each parcel has its own lifecycle. Can you do a domain analysis on this? What are the correct entities, states, transitions, and business rules? We need to handle cases like: 3 out of 5 parcels delivered, one parcel lost, customer disputes partial receipt, etc.

expected_behavior: |
  Bird should perform a thorough domain analysis that includes:

  1. **Entity identification**: Clearly distinguish Shipment (aggregate root) from Parcel (child entity), each with its own identity and lifecycle. Possibly identify DeliveryAttempt, TrackingEvent, or similar value objects.

  2. **State machines**: Define Parcel-level states (e.g., Pending, InTransit, OutForDelivery, Delivered, Lost, Returned, Disputed) AND Shipment-level derived states that are computed from parcel states (e.g., FullyDelivered, PartiallyDelivered, InTransit, Failed).

  3. **Derivation rule**: Shipment status must be derived from the aggregate of its parcel statuses — not independently set. Bird should explicitly call out that shipment status is a projection, not an independent field. This is the critical domain insight.

  4. **Business rules / invariants**:
     - A shipment cannot be marked 'Delivered' unless ALL parcels are delivered
     - 'Partially Delivered' is triggered when at least one but not all parcels reach Delivered
     - A single parcel marked 'Lost' should trigger shipment-level escalation
     - Customer dispute on partial receipt must reference specific parcels, not the shipment as a whole
     - Refund/reshipment logic must operate at parcel granularity

  5. **Edge cases and risks**: Bird should identify tricky scenarios such as:
     - Race conditions where parcels arrive out of order
     - What happens if a 'Lost' parcel is later found and delivered
     - Parcels delivered to different addresses (split shipment)
     - Time windows for partial delivery (how long before escalation)
     - Idempotency of tracking events (duplicate scans)

  6. **Acceptance criteria**: Bird should define clear, testable acceptance criteria for the partial delivery detection feature.

failure_modes: |
  1. **Shallow analysis**: Simply restating the requirement ('track parcels individually') without decomposing entities, states, and invariants.

  2. **Missing the derivation rule**: Treating Shipment status as independently settable rather than derived from Parcel states — this is the most critical domain insight and missing it means the analysis fails.

  3. **Incomplete state machine**: Defining only happy-path states (Pending → InTransit → Delivered) without Lost, Disputed, Returned, or partial states.

  4. **No edge cases**: Failing to surface race conditions, out-of-order delivery, lost-then-found parcels, or duplicate tracking events.

  5. **Generic advice**: Giving boilerplate DDD advice (use aggregates, use events) without grounding it in the specific logistics domain rules.

  6. **Missing dispute granularity**: Allowing disputes or refunds at shipment level only, rather than requiring parcel-level granularity as the PM's rule implies.

  7. **No acceptance criteria**: Providing analysis without actionable, testable criteria that engineering can implement against.

scoring_rubric: |
  pass:
    Bird identifies Shipment vs Parcel as distinct entities with separate lifecycles. Shipment status is explicitly described as derived/projected from parcel states (not independently set). At least 4 parcel-level states are defined. Business invariants cover partial delivery detection, lost parcel escalation, and parcel-level dispute/refund. At least 3 non-trivial edge cases are surfaced. Acceptance criteria or testable rules are provided.
  partial:
    Bird correctly separates Shipment and Parcel entities and defines per-parcel tracking, but either (a) does not explicitly state that shipment status is derived, (b) defines fewer than 3 edge cases, (c) omits acceptance criteria, or (d) handles disputes/refunds only at shipment level.
  fail:
    Bird restates the requirement without meaningful decomposition, treats shipment status as independent from parcel states, defines only happy-path states, or provides generic DDD advice without logistics-specific domain rules.
