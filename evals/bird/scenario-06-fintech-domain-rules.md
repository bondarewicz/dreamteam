# Eval: Bird — Scenario 06 — Fintech Domain Rule Extraction (Capability)

## Overview

Tests Bird's ability to extract and classify domain rules in a financial services context where AML/KYC compliance, transaction limits, and fraud rules intersect.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 5
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
    min: 60
    max: 85
  - type: json_field
    path: "confidence.assumptions"
    min_items: 1

prompt: |
  A digital wallet product manager describes the following rules:

  "Users must complete identity verification (KYC) before they can send money. Unverified accounts can receive money but cannot send or withdraw. Daily transfer limits are $5,000 for verified accounts and $500 for partially-verified accounts. A transaction cannot be reversed once it has been settled (T+1). Transfers to sanctioned entities must be blocked automatically. Multiple failed login attempts (5 in a row) must lock the account — only a support agent can unlock it. We send a notification for any transaction over $1,000."

  Produce a full domain analysis including domain_analysis, business_rules with invariant classification, acceptance_criteria in Given/When/Then format, and confidence assessment.

expected_behavior: |
  - business_rules includes at minimum:
    1. KYC required before sending/withdrawing (invariant: true — regulatory)
    2. Unverified accounts can only receive (invariant: true — regulatory)
    3. Daily limits by verification tier (invariant: true for the existence of limits; the specific amounts are soft config)
    4. Settled transactions cannot be reversed (invariant: true — financial clearing rule)
    5. Sanctions screening required (invariant: true — regulatory/legal)
    6. Failed login lockout (invariant: true — security requirement)
    7. Notification for large transactions (invariant: false — operational notification, not a state constraint)
  - Bird correctly distinguishes regulatory invariants from operational/notification rules
  - The $1,000 notification rule is marked invariant: false (it is a notification preference, not a state invariant)
  - acceptance_criteria includes at least 4 Given/When/Then scenarios
  - Bird notes ambiguity about whether the daily limit resets at midnight UTC or user's local time — this is a real gap in the spec
  - confidence.level is calibrated appropriately (should be 65-80) with the timezone ambiguity noted

failure_modes: |
  - Marking the notification rule as invariant: true
  - Missing the sanctions screening rule (it is a hard compliance requirement)
  - Not noticing that the daily limit timezone is unspecified
  - Fewer than 4 Given/When/Then acceptance criteria
  - Conflating "partially-verified" limits with "unverified" limits

scoring_rubric: |
  pass:
    - All 7 rules identified with correct invariant classification
    - Notification rule correctly marked invariant: false
    - Sanctions rule included as invariant: true
    - Timezone ambiguity for daily limit surfaced as a gap
    - At least 4 Given/When/Then acceptance criteria
    - confidence.level 60-85 with assumptions listed

  partial:
    - 5-6 rules identified
    - 1-2 invariant misclassifications
    - 3 acceptance criteria
    - Timezone gap not surfaced but other gaps mentioned

  fail:
    - Fewer than 4 rules identified
    - Sanctions rule missing
    - All rules marked invariant: true indiscriminately
    - Fewer than 2 acceptance criteria
    - No ambiguities surfaced
