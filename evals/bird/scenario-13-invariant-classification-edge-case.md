# Eval: Bird — Scenario 13 — Invariant Classification Edge Case (Hard)

## Overview

Tests Bird's ability to correctly classify a rule that appears to be an invariant but is actually a configurable policy — and to justify the classification with reasoning.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "policy", "configurable", "confidence"]
  - type: regex
    pattern: "invariant:\\s*(true|false)"
  - type: section_present
    sections: ["business_rules"]
  - type: field_count
    pattern: "invariant:"
    min: 4
  - type: length_bounds
    min: 400
    max: 7000

prompt: |
  A subscription billing platform has these rules described by the product team:

  "A subscription cannot be activated with a failed payment method on file. Subscriptions auto-renew 7 days before the billing cycle ends to allow retry time. After 3 failed renewal attempts, the subscription is automatically cancelled. A cancelled subscription cannot be reactivated — customers must create a new subscription. Premium tier subscribers get a 14-day grace period before cancellation (instead of the 3-strike rule). Free trial subscriptions cannot have more than one active trial per email address at any time."

  For each rule, classify as invariant: true or invariant: false, and provide a written justification for each classification.

expected_behavior: |
  - Bird classifies and justifies each rule:
    1. Failed payment method prevents activation (invariant: true — financial integrity, cannot activate without valid payment)
    2. 7-day pre-renewal window (invariant: false — this is a configurable operational parameter)
    3. 3 failed attempts before cancellation (invariant: false — this is a configurable policy threshold, not a state integrity rule)
    4. Cancelled subscription cannot be reactivated (invariant: true — this is a lifecycle state constraint)
    5. Premium tier grace period override (invariant: false — tier-specific policy)
    6. One active trial per email (invariant: true — prevents abuse, system integrity rule)
  - Bird's written justifications distinguish between "configurable policy" (can be changed by ops) and "state integrity rule" (changing it would break the domain model)
  - Bird notes that rules 2, 3, and 5 should be stored as configuration, not hard-coded constants
  - Bird surfaces ambiguity: "Can a premium subscriber also exhaust the grace period and get cancelled? The spec implies the grace period replaces the 3-strike rule but doesn't say what happens after 14 days."

failure_modes: |
  - Marking the renewal window (7 days) as invariant: true (it is a configurable parameter)
  - Marking the 3-strike rule as invariant: true (it is a configurable threshold)
  - Marking "cancelled cannot be reactivated" as invariant: false (it is a state lifecycle constraint)
  - Providing classifications without written justifications
  - Missing the ambiguity about premium tier grace period end behavior

scoring_rubric: |
  pass:
    - All 6 rules classified correctly
    - Written justification provided for each, distinguishing state integrity from policy
    - Rules 2, 3, 5 correctly marked invariant: false with "configurable" reasoning
    - Rules 1, 4, 6 correctly marked invariant: true
    - Grace period ambiguity surfaced
    - Recommendation to store policies as configuration

  partial:
    - 4-5 rules classified correctly
    - Justifications present but thin
    - Configurable vs. invariant distinction mentioned but not systematically applied
    - Grace period ambiguity missed

  fail:
    - Fewer than 3 correct classifications
    - No justifications provided
    - All rules marked invariant: true or all marked false with no reasoning
    - Configurable policy concept not applied
