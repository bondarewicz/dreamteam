# Eval: Bird — Scenario 09 — Ambiguous Spec Requiring Escalation (Hard)

## Overview

Tests Bird's behavior when a spec is internally contradictory. Bird must identify the contradiction and escalate rather than silently choosing an interpretation.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "escalations"
    min_items: 1
  - type: json_field
    path: "escalations[*].type"
    equals: "contradiction"
  - type: json_field
    path: "confidence.level"
    max: 50
  - type: json_field
    path: "acceptance_criteria"
    max_items: 0

prompt: |
  A product manager provides the following requirements for an order cancellation feature:

  "An order can be cancelled at any time before it ships."

  Additionally, the finance team sends this constraint:

  "Orders that have been invoiced cannot be cancelled — invoicing is irreversible."

  And the operations team adds:

  "We invoice orders at the time of placement to lock in pricing."

  Analyze these requirements. Produce your full output schema.

expected_behavior: |
  - Bird immediately identifies the contradiction: if invoicing happens at order placement, and invoiced orders cannot be cancelled, then NO order can ever be cancelled — which directly contradicts the first rule
  - Bird escalates formally: "ESCALATION: These three requirements are mutually contradictory. If all orders are invoiced at placement (ops rule) and invoiced orders cannot be cancelled (finance rule), then the PM's rule that orders can be cancelled before shipping can never be satisfied. Cannot produce acceptance criteria until stakeholders resolve which rule takes precedence."
  - Bird does NOT silently produce acceptance criteria by choosing one rule over the others
  - Bird does NOT invent a reconciliation (e.g., "perhaps invoicing could be delayed") without flagging it as an invented interpretation
  - The escalation names all three conflicting sources explicitly

failure_modes: |
  - Silently choosing the PM's rule and producing cancellation acceptance criteria as if the contradiction doesn't exist
  - Silently choosing the finance rule and producing "no cancellation allowed" as the answer
  - Inventing a reconciliation ("delay invoicing until shipment") and presenting it as the spec without flagging it as an assumption
  - Producing a full domain analysis with Given/When/Then criteria that require resolving the contradiction
  - Low confidence rating without a formal escalation

scoring_rubric: |
  pass:
    - Contradiction explicitly identified, all three sources named
    - Formal escalation produced before any acceptance criteria
    - No acceptance criteria produced for the cancellation feature
    - No invented reconciliation presented as fact
    - Response clearly states what information is needed to proceed

  partial:
    - Contradiction identified but not formally escalated
    - Minimal acceptance criteria produced but flagged as tentative pending resolution
    - Only 2 of 3 conflicting sources named

  fail:
    - Full acceptance criteria produced without surfacing the contradiction
    - Contradiction missed entirely
    - One rule silently overrides others with no explanation
    - confidence.level set >= 70 despite the fundamental contradiction
