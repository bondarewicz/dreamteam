# Eval: Bird — Scenario 10 — Conflicting Stakeholder Requirements (Hard)

## Overview

Tests Bird's ability to handle requirements where two stakeholders want opposite behaviors, and Bird must identify the conflict, characterize each stakeholder's legitimate interest, and escalate for resolution.

---

category: capability

graders:
  - type: contains
    values: ["stakeholder", "conflict", "escalat", "confidence"]
  - type: section_present
    sections: ["business_rules", "confidence"]
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  You are analyzing requirements for a courier-tracking feature where customers can see their courier's real-time location.

  Customer Success team: "Customers must be able to see the courier's exact GPS coordinates at all times during delivery. Transparency is our key differentiator."

  Operations team: "Courier location must never be shown to customers — our drivers have reported feeling surveilled and it is a retention problem. We are losing drivers because of this."

  Both teams are presenting their requirement as non-negotiable.

  Analyze this conflict. Produce your full output schema.

expected_behavior: |
  - Bird identifies this as a genuine stakeholder conflict — both requirements cannot both be satisfied simultaneously
  - Bird characterizes each stakeholder's legitimate interest:
    - Customer Success: competitive differentiation, customer trust
    - Operations: driver welfare, driver retention, labor relations
  - Bird does NOT simply declare one stakeholder wrong
  - Bird escalates the conflict: "ESCALATION: Customer Success and Operations have directly conflicting, non-negotiable requirements around courier location visibility. This is a strategic business decision that cannot be resolved at the domain analysis level. Requires executive or product leadership decision."
  - Bird may optionally propose a middle-ground option (e.g., zone-level location instead of GPS coordinates) but must clearly label it as a proposed compromise, not a resolution of the stated requirements
  - business_rules should note that no invariants can be finalized until the conflict is resolved
  - confidence.level <= 40 given the unresolved conflict

failure_modes: |
  - Choosing one stakeholder's requirement over the other without escalation
  - Producing acceptance criteria as if the conflict is resolved
  - Setting confidence.level >= 60 while acknowledging the conflict
  - Proposing a compromise and presenting it as the final requirement
  - Missing that both requirements are framed as non-negotiable

scoring_rubric: |
  pass:
    - Both stakeholders' interests characterized fairly
    - Formal escalation produced to decision-maker level
    - No acceptance criteria produced as if the conflict is resolved
    - confidence.level <= 45
    - Any proposed compromise is clearly labeled as a proposal, not a resolution

  partial:
    - Conflict identified and both interests noted
    - Escalation informal but present
    - confidence.level between 46-60
    - Minor acceptance criteria produced with heavy caveats

  fail:
    - One stakeholder's view adopted as the answer
    - Full acceptance criteria produced for either option
    - Conflict not identified or minimized
    - confidence.level >= 65
