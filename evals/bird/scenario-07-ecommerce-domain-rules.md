# Eval: Bird — Scenario 07 — E-commerce Domain Rule Extraction (Capability)

## Overview

Tests Bird's ability to identify domain rules in an e-commerce context with inventory management, promotions, and order lifecycle rules that have subtle ordering dependencies.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "Given", "When", "Then", "confidence"]
  - type: regex
    pattern: "invariant:\\s*(true|false)"
  - type: section_present
    sections: ["business_rules", "acceptance_criteria"]
  - type: field_count
    pattern: "invariant:"
    min: 3
  - type: length_bounds
    min: 400
    max: 8000

prompt: |
  An e-commerce platform's product team describes the following rules:

  "Customers can add items to their cart, but inventory is only reserved when checkout begins. If checkout is abandoned (no payment within 15 minutes), the reservation is released. A product can have a maximum of one active promotion at a time. Discount codes cannot be combined with promotional pricing — only one discount mechanism applies per order. Orders cannot be modified after payment is confirmed. A product with zero inventory cannot be purchased even if it is still listed. Refunds must be requested within 30 days of delivery."

  Produce a full domain analysis including domain_analysis, business_rules with invariant classification, acceptance_criteria in Given/When/Then format, and confidence assessment.

expected_behavior: |
  - domain_analysis identifies "cart and checkout lifecycle" and "inventory management" as bounded contexts
  - business_rules includes:
    1. Inventory reserved only at checkout, not cart add (invariant: true — prevents overselling)
    2. Reservation released on 15-minute timeout (invariant: true — inventory management rule)
    3. One active promotion per product (invariant: true — promotions model constraint)
    4. Discount codes and promotions are mutually exclusive (invariant: true — pricing rule)
    5. Orders immutable after payment (invariant: true — financial integrity)
    6. Zero-inventory products cannot be purchased (invariant: true — inventory constraint)
    7. Refund window is 30 days from delivery (invariant: false — customer service policy, may change)
  - Bird flags ambiguity: "Does the 15-minute timer start at checkout page load or first item addition?" and "What constitutes 'delivery' for the refund window — courier scan or customer confirmation?"
  - At least 4 Given/When/Then acceptance criteria
  - The 30-day refund window is correctly classified as invariant: false (it is a policy, not a state integrity rule)

failure_modes: |
  - Marking the refund window as invariant: true
  - Missing the mutual exclusivity of discount codes and promotions
  - Not flagging the ambiguity in when the 15-minute timer starts
  - Missing that the cart-add step does NOT reserve inventory (this is a common domain misconception)
  - Fewer than 4 acceptance criteria

scoring_rubric: |
  pass:
    - All 7 rules identified with correct classification
    - Refund window marked invariant: false
    - Cart-add vs checkout reservation distinction correctly captured
    - At least 1 ambiguity surfaced (timer or delivery definition)
    - At least 4 Given/When/Then acceptance criteria
    - confidence.level appropriate with stated assumptions

  partial:
    - 5-6 rules identified
    - Refund window classification debatable but reasoned
    - 3 acceptance criteria
    - 1 ambiguity surfaced

  fail:
    - Fewer than 4 rules identified
    - Cart/checkout inventory distinction missed
    - Discount and promotion exclusivity missed
    - No ambiguities surfaced
    - Fewer than 2 acceptance criteria
