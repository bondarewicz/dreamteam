# Eval: MJ — Scenario 07 — Event Sourcing Evaluation (Capability)

## Overview

Tests MJ's ability to evaluate whether event sourcing is appropriate for a given use case, including identifying the genuine benefits and the operational costs that are often overlooked.

---

category: capability

graders:
  - type: contains
    values: ["event sourcing", "event store", "trade_off", "risk", "audit"]
  - type: section_present
    sections: ["trade_offs", "risks", "implementation_guidance"]
  - type: length_bounds
    min: 500
    max: 8000

prompt: |
  A financial services platform needs to track every change to a loan application's status and data for regulatory audit purposes. The audit trail must be immutable and must capture who changed what and when. Currently they use a single "loan_applications" table with update-in-place semantics; they add a "last_updated_by" column but lose historical state.

  The compliance team requires: full history of all field changes, ability to reconstruct the application state at any point in time, and immutable audit log.

  The engineering team is considering event sourcing. Evaluate event sourcing for this use case. Use your full output schema.

expected_behavior: |
  - MJ identifies this as a legitimate use case for event sourcing due to the regulatory audit requirement: append-only event log naturally satisfies immutability and temporal reconstruction requirements
  - MJ explains the event sourcing model: each change becomes a domain event (e.g., LoanApplicationSubmitted, LoanStatusChanged, LoanAmountUpdated); current state is derived by replaying events
  - trade_offs identifies:
    - Gain: immutable audit trail is inherent (not bolted on); full history; temporal queries natural
    - Cost: reading current state requires event replay (or snapshotting); developer mental model shift; event schema evolution is hard (old events must be migratable); tooling/framework required
  - MJ raises the snapshot requirement: for loans with thousands of events, replaying from the beginning becomes slow — a snapshotting strategy is needed
  - risks includes: event schema evolution (a changed field name in a new event version breaks the old event replays without migration); operational complexity; debugging is harder
  - MJ notes that a simpler alternative exists: append-only audit log table alongside the existing table (not full event sourcing). This is worth considering if the team lacks event sourcing experience.
  - implementation_guidance distinguishes between "full event sourcing" and "audit log table" as two options with different complexity profiles

failure_modes: |
  - Recommending event sourcing without acknowledging the schema evolution problem
  - Not mentioning snapshotting as a necessary pattern for event sourcing at scale
  - Missing the simpler alternative (append-only audit table) that may satisfy the requirements at lower complexity
  - Presenting event sourcing as purely beneficial with no operational costs

scoring_rubric: |
  pass:
    - Event sourcing correctly identified as appropriate but not the only option
    - Schema evolution risk identified
    - Snapshotting requirement identified for long-lived aggregates
    - Simpler audit-log alternative presented
    - trade_offs includes both gains and costs
    - implementation_guidance distinguishes the two approaches

  partial:
    - Event sourcing recommended correctly but no alternatives presented
    - Schema evolution risk mentioned but not explained
    - Snapshotting not mentioned
    - trade_offs present but costs thin

  fail:
    - Event sourcing recommended without any operational costs
    - Schema evolution not mentioned
    - No alternative considered
    - trade_offs section only lists benefits
