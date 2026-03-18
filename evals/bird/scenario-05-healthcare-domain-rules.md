# Eval: Bird — Scenario 05 — Healthcare Domain Rule Extraction (Capability)

## Overview

Tests Bird's ability to extract domain rules from a healthcare context where regulatory constraints (like HIPAA) and clinical safety rules must be distinguished from soft operational preferences.

---

category: capability

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
    min_items: 4
  - type: json_field
    path: "confidence.level"
    min: 65
    max: 90

prompt: |
  A telemedicine platform has the following rules described by the product and compliance teams:

  "A patient can only book an appointment with a licensed physician. Physicians cannot be double-booked — two appointments cannot overlap for the same physician. Appointments can be cancelled by the patient up to 2 hours before start time; after that, only a staff administrator can cancel. A physician's license number must be verified before they can accept bookings. Patient medical records are visible only to the treating physician and the patient themselves. Consultation notes must be locked (read-only) 48 hours after the appointment ends."

  Produce a full domain analysis. Include domain_analysis, business_rules with invariant classification, acceptance_criteria in Given/When/Then format, and confidence assessment.

expected_behavior: |
  - domain_analysis identifies "appointment scheduling" and "medical records access" as the bounded contexts
  - business_rules includes at minimum:
    1. Patient can only book with licensed physician (invariant: true — regulatory)
    2. No double-booking for same physician (invariant: true — scheduling invariant)
    3. Cancellation time window: patient cancels up to 2h before; admin only after (invariant: true for the role boundary, the time window is a soft rule)
    4. License verification before accepting bookings (invariant: true — regulatory)
    5. Record visibility restricted to treating physician and patient (invariant: true — privacy/regulatory)
    6. Consultation notes locked after 48h (invariant: true — clinical record integrity)
  - Bird correctly classifies regulatory rules (license, visibility) as invariant: true versus operational preferences
  - acceptance_criteria includes at least 4 Given/When/Then scenarios covering: booking a licensed physician, double-booking attempt, late cancellation attempt, unauthorized record access
  - confidence.level is >= 70 (inputs are reasonably clear) with noted assumption about what "licensed" means in the domain model

failure_modes: |
  - Classifying record visibility or license verification as invariant: false (these are hard compliance requirements)
  - Missing the role boundary in cancellation (patient vs. admin cancellation window)
  - Not distinguishing regulatory constraints from operational ones
  - Producing fewer than 4 Given/When/Then acceptance criteria
  - Setting confidence >= 95 without noting assumptions about license validation mechanism

scoring_rubric: |
  pass:
    - All 6 rules identified with correct invariant classification
    - Regulatory rules (license, visibility, record lock) marked invariant: true
    - At least 4 Given/When/Then acceptance criteria
    - Role-based cancellation rule correctly captured
    - confidence.level 65-90 with stated assumptions

  partial:
    - 4-5 rules identified
    - Some invariant misclassifications (1 error acceptable)
    - 3 acceptance criteria
    - Regulatory nature mentioned but not systematically classified

  fail:
    - Fewer than 3 rules identified
    - Regulatory and operational rules conflated with no invariant distinction
    - Fewer than 2 acceptance criteria
    - No mention of regulatory context
