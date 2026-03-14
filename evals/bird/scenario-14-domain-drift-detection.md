# Eval: Bird — Scenario 14 — Domain Drift Detection (Very Hard)

## Overview

Tests Bird's ability to detect when a newly requested feature silently violates an existing domain invariant, even when the feature description is phrased in neutral business language.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "violat", "drift", "conflict"]
  - type: section_present
    sections: ["business_rules", "confidence"]
  - type: length_bounds
    min: 400
    max: 7000

prompt: |
  Existing domain model (already established and in production):
  - A Shipment must have exactly one assigned Carrier.
  - Once a Carrier is assigned to a Shipment, the assignment is locked — only a Supervisor can reassign.
  - Carrier assignment is an invariant: the system guarantees that at the time of dispatch, every Shipment has exactly one Carrier.

  New feature request from the product team:
  "We want to add an 'auto-split' feature. When a shipment exceeds 500 kg, it should be automatically split into multiple sub-shipments, each handled by a different carrier, without requiring supervisor involvement."

  Analyze this feature request against the existing domain model.

expected_behavior: |
  - Bird identifies that the auto-split feature creates domain drift: it violates the "locked assignment requires Supervisor" invariant by allowing the system to automatically create new carrier assignments without supervisor approval
  - Bird identifies a second violation: if a 600 kg shipment becomes 2 sub-shipments of 300 kg each with different carriers, the original invariant "exactly one Carrier" is effectively destroyed for the original shipment
  - Bird does NOT simply implement the feature as described — he surfaces the invariant violations before any acceptance criteria are written
  - Escalation: "This feature request conflicts with two existing domain invariants: (1) carrier assignment changes require Supervisor approval; (2) a Shipment has exactly one Carrier. These invariants must be explicitly revised or the feature scoped to not violate them. Cannot proceed without stakeholder alignment."
  - Bird may propose boundary options: keep invariant and require supervisor sign-off for splits; or formally revise the invariant to allow system-initiated splits for weight-triggered cases
  - confidence.level <= 50 until invariant resolution

failure_modes: |
  - Writing acceptance criteria for the auto-split feature without flagging the invariant violations
  - Treating this as a new feature addition with no domain model conflict
  - Missing that carrier assignment changes require Supervisor (focusing only on the weight splitting)
  - Proposing a reconciliation and presenting it as the accepted requirement
  - Setting confidence >= 70 despite the unresolved invariant conflict

scoring_rubric: |
  pass:
    - Both invariant violations explicitly identified and named
    - Escalation produced with specific reference to the violated invariants
    - No acceptance criteria written for the feature as described
    - Options proposed (with invariant revision or scoped feature) clearly labeled as proposals
    - confidence.level <= 55

  partial:
    - One violation identified (either the supervisor bypass or the one-carrier invariant)
    - Escalation present but informal
    - Limited acceptance criteria with heavy caveats
    - confidence.level 56-70

  fail:
    - No violations identified
    - Feature accepted as-is with full acceptance criteria written
    - Invariant conflicts ignored
    - confidence.level >= 75
