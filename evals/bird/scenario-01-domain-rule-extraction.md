# Eval: Bird — Scenario 01 — Domain Rule Extraction (Happy Path)

## Overview

Tests Bird's core function: reading a codebase and extracting accurate, explicit domain rules with proper invariant classification.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 4
  - type: json_field
    path: "business_rules[*].invariant"
    type_check: "boolean"
  - type: json_field
    path: "business_rules[*].invariant_justification"
    type_check: "string"
  - type: json_field
    path: "acceptance_criteria"
    min_items: 3
  - type: json_field
    path: "confidence.level"
    min: 65
    max: 90

prompt: |
  A logistics platform handles parcel delivery. The following rules have been described by a product manager:

  "A shipment can be created when there is a pickup address and a delivery address. Once in transit, it cannot be sent back to pending. Delivered shipments are final — their state cannot change. Weight must be positive and cannot exceed 1000 kg. We charge by weight bracket: under 10 kg is standard, 10 kg up to but not including 50 kg is heavy (10 kg is the lower boundary, inclusive), 50 kg and above is freight (50 kg is the lower boundary, inclusive)."

  Read this description and produce a domain analysis using your full output schema. Include: domain_analysis, business_rules (with invariant flags), acceptance_criteria (with Given/When/Then), and confidence assessment.

expected_behavior: |
  - domain_analysis identifies "shipment lifecycle" as the bounded context and correctly names the domain entities (Shipment, Address, WeightBracket)
  - business_rules lists at minimum 4 rules:
    1. Shipment requires pickup and delivery address (invariant: true)
    2. State transition: pending -> in_transit is allowed; in_transit -> pending is NOT allowed (invariant: true)
    3. Delivered state is terminal — no further transitions (invariant: true)
    4. Weight must be > 0 and <= 1000 kg (invariant: true)
    5. Weight bracket classification (invariant: false — this is a pricing rule, not a state invariant)
  - Each rule has a testable_assertion that a developer could write a test against
  - acceptance_criteria uses Given/When/Then format with concrete preconditions
  - The weight bracket rule is correctly classified as invariant: false (it is a soft business rule, not a state invariant)
  - confidence.level is >= 70 given the unambiguous inputs

failure_modes: |
  - Classifying the weight bracket pricing rule as invariant: true (it is a soft pricing rule)
  - Missing the state machine directionality (only flagging that state changes exist, not that in_transit -> pending is forbidden)
  - Using vague testable_assertions such as "weight should be correct" instead of "given weight=0, creating a shipment raises a validation error"
  - Omitting the "delivered is terminal" rule
  - Producing acceptance_criteria without Given/When/Then structure
  - Confidence level set above 90 without noting any assumptions about what "created" means in the domain model

scoring_rubric: |
  pass:
    - All 5 rules identified (4 invariant: true, 1 invariant: false)
    - State machine directionality correctly modeled (in_transit -> pending forbidden)
    - At least 3 acceptance_criteria in Given/When/Then format
    - testable_assertions are concrete and developer-actionable
    - Weight bracket correctly marked invariant: false
    - Confidence level between 65-90 with stated assumptions

  partial:
    - 3-4 of 5 rules identified
    - State machine present but directionality incomplete
    - acceptance_criteria present but some lack Given or When or Then
    - testable_assertions partially concrete

  fail:
    - Fewer than 3 rules identified
    - No state machine modeled
    - No Given/When/Then structure in acceptance_criteria
    - Weight bracket misclassified as invariant: true with no explanation
    - Confidence level set at 100 with no assumptions listed
