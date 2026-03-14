# Eval: Bird — Scenario 20 — Domain Synthesis Under Pressure (Expert)

## Overview

Expert-level: Bird is given a dense, poorly-organized feature dump from multiple stakeholders and must synthesize a coherent domain model while identifying contradictions, missing rules, and risks — expected to partially succeed at best.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "contradiction", "confidence", "escalat"]
  - type: regex
    pattern: "invariant:\\s*(true|false)"
  - type: section_present
    sections: ["business_rules", "confidence"]
  - type: field_count
    pattern: "invariant:"
    min: 4
  - type: length_bounds
    min: 600
    max: 12000

prompt: |
  The following notes were collected from a product discovery workshop for a new "Express Delivery" product. They are raw and unfiltered:

  Product Manager: "Express deliveries are guaranteed within 2 hours. If we miss the window, we refund the express fee but not the base delivery fee. The customer can only select express if they're within 10km of a warehouse."

  Operations Lead: "Express orders must be picked up within 15 minutes of placement. We can't guarantee 2 hours if pickup takes more than 15 minutes. Also, drivers doing express must have at least a 4-star rating."

  Finance: "Express fee is $12.99. Refunds for missed windows are processed within 3 business days. Oh, also, we don't refund if the customer gave a wrong address."

  Customer Success: "Customers should be able to track their express driver in real time. The 2-hour guarantee should be shown prominently. If a driver cancels mid-delivery, a replacement should be assigned within 10 minutes or we refund automatically."

  Legal: "We cannot guarantee a 2-hour delivery time in writing — this is a 'best effort' SLA, not a contractual guarantee. The refund is a goodwill gesture, not legally enforceable."

  Synthesize a domain model from these notes. Flag all contradictions and gaps.

expected_behavior: |
  - Bird identifies the core contradiction: PM says "guaranteed 2 hours" but Legal says this cannot be a contractual guarantee — these are directly conflicting
  - Bird identifies additional gaps and tensions:
    1. Who is responsible for the clock starting? PM implies from order placement; Ops implies from pickup — if pickup takes 14 minutes, the customer has only 1h46m of effective delivery time
    2. The wrong-address refund exception (Finance) is not mentioned in PM's refund policy — these need reconciliation
    3. Auto-refund for mid-delivery driver cancellation (Customer Success) requires automated triggering — the 3-business-day processing (Finance) may conflict
  - business_rules are extracted for what CAN be determined:
    1. 10km radius limit (invariant: true — eligibility constraint)
    2. Pickup within 15 minutes (invariant: true — express SLA requirement)
    3. Driver rating >= 4 stars for express (invariant: true — quality gate)
    4. Express fee = $12.99 (invariant: false — pricing policy)
    5. Wrong-address exception to refund (invariant: true — caveat on refund obligation)
  - Formal escalations:
    - "ESCALATION: Legal and PM have directly conflicting positions on whether the 2-hour window is a guarantee or best-effort. This is a marketing/legal/product decision."
    - "ESCALATION: Clock start time for 2-hour SLA is undefined across stakeholders."
  - confidence.level <= 45 given the contradictions

failure_modes: |
  - Producing a clean domain model without surfacing the PM/Legal contradiction
  - Missing the clock-start ambiguity
  - Missing the wrong-address refund exception from Finance
  - Setting confidence >= 65 with so many contradictions
  - Inventing resolutions to the contradictions without escalating

scoring_rubric: |
  pass:
    - PM/Legal contradiction explicitly identified and escalated
    - Clock-start ambiguity identified
    - Wrong-address exception from Finance noted
    - Auto-refund vs. 3-day processing conflict noted
    - At least 5 rules extracted with correct classifications
    - At least 2 formal escalations
    - confidence.level <= 50

  partial:
    - PM/Legal contradiction identified but not formally escalated
    - Clock-start ambiguity missed
    - 3-4 rules extracted
    - confidence.level 51-65

  fail:
    - Contradictions not identified
    - Clean domain model produced without escalations
    - PM/Legal conflict silently resolved
    - Fewer than 3 rules extracted
    - confidence >= 70
