# Eval: Bird — Scenario 12 — Domain Model Evolution Analysis (Hard)

## Overview

Tests Bird's ability to analyze a proposed domain model change, identify which existing invariants would be violated, and assess the business impact of breaking changes.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "breaking", "impact", "confidence"]
  - type: section_present
    sections: ["business_rules", "business_impact"]
  - type: length_bounds
    min: 500
    max: 8000

prompt: |
  The current domain model for a delivery platform has this rule:

  "A Shipment has exactly one Recipient. The Recipient has a name, address, and phone number."

  The product team now wants to change this to support multi-recipient shipments:

  "A Shipment can have one or more Recipients. Each Recipient can have different delivery preferences."

  Existing data in production: approximately 2 million shipments, each with one recipient. There are also external partner APIs that receive shipment data in the current format.

  Analyze the business and domain impact of this model evolution. Use your full output schema.

expected_behavior: |
  - Bird identifies this as a cardinality change (1-to-1 becomes 1-to-many) and correctly labels it as a breaking change to the domain model
  - business_rules analysis identifies which existing invariants are affected:
    - "A Shipment has exactly one Recipient" was an implicit invariant — this change removes it (invariant: true becomes false or a weaker constraint)
    - New invariant: "A Shipment must have at least one Recipient" (invariant: true — cannot have a shipment with no recipients)
  - business_impact addresses:
    - Data migration: 2M existing records must be migrated (wrap existing single recipient in a list)
    - External API: partner APIs sending/receiving single recipient format will break — versioning strategy required
    - Operational: notification logic that assumes one recipient per shipment (SMS to one number) must be redesigned
  - Bird surfaces the ambiguity: "What does 'different delivery preferences' mean per recipient — separate delivery windows? Different drop-off locations? This is undefined in the spec."
  - Bird flags this as requiring MJ for the architectural migration plan
  - confidence.level <= 70 due to the "different delivery preferences" ambiguity

failure_modes: |
  - Not identifying the change as breaking for external APIs
  - Missing the data migration impact for 2M existing records
  - Not identifying the new minimum-cardinality invariant (at least 1 recipient)
  - Not surfacing the "delivery preferences" ambiguity
  - Treating this as a simple additive change with no domain model impact

scoring_rubric: |
  pass:
    - Breaking change to domain model identified
    - New minimum-cardinality invariant stated
    - Data migration impact for existing records noted
    - External API breakage identified
    - "Delivery preferences" ambiguity surfaced
    - Architectural concern flagged for MJ
    - confidence.level <= 75

  partial:
    - Breaking change identified but impact analysis thin
    - New invariant stated but existing invariant change not noted
    - Data migration mentioned but external API impact missed
    - confidence.level 76-85

  fail:
    - Treated as additive change with no domain model impact
    - No breaking changes identified
    - No ambiguities surfaced
    - Confidence >= 85 with missing information
