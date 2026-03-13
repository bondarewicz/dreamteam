# Eval: Magic — Scenario 02 — Contradiction Detection (Edge Case)

## Overview

Tests Magic's ability to detect and surface contradictions between agent outputs rather than papering over them. Magic must NOT synthesize a clean-looking document that hides a real conflict.

---

prompt: |
  Bird produced this domain rule:
  - "A courier must be assigned to a delivery before the delivery enters IN_TRANSIT state. An unassigned delivery cannot be in transit." (invariant: true)

  MJ produced this architecture note:
  - "The delivery state machine will allow transitioning to IN_TRANSIT without a courier assignment, relying on a background job to assign couriers within 30 seconds of the transition. This allows faster order acknowledgement to customers."

  Synthesize these two outputs into a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the contradiction explicitly: Bird's invariant requires courier assignment BEFORE IN_TRANSIT, but MJ's design allows IN_TRANSIT WITHOUT assignment (relying on a background job)
  - Magic names both agents and quotes or precisely paraphrases their conflicting positions
  - Magic escalates to Coach K (not Shaq) for resolution
  - Magic does NOT silently pick one interpretation or average the two positions
  - Magic provides resolution options (e.g., uphold invariant, relax invariant, introduce intermediate state)
  - If a brief is produced alongside the escalation, it clearly marks the contradiction as blocking and tells Shaq not to implement

failure_modes: |
  - Producing a handoff brief that silently adopts MJ's design without flagging the invariant violation
  - Paraphrasing the conflict as "there is some flexibility on assignment timing" — this hides the real disagreement
  - Not naming both agents and their specific positions
  - Presenting the contradiction as a design choice Shaq should resolve (outside Shaq's authority — this is Bird's call)
  - Softening the invariant language (e.g., "courier should ideally be assigned") without flagging this as a domain model change

scoring_rubric: |
  pass:
    - Contradiction explicitly named with both agents' positions quoted or paraphrased precisely
    - Escalation routed to Coach K (not Shaq) for resolution
    - Escalation asks the right question: "Is courier assignment a hard precondition or a soft requirement?"
    - Resolution options provided (at least 2 concrete paths)
    - Does not silently adopt one position — if a brief is produced, the contradicted fields are explicitly marked as contested/blocked
    - Does not route the resolution to Shaq

  partial:
    - Contradiction identified but escalation is vague or missing resolution options
    - Both positions referenced but one is softened or mischaracterized
    - Escalation routed to Coach K but question is imprecise

  fail:
    - Contradiction not identified
    - Handoff brief produced that silently adopts one position without flagging the conflict
    - Conflict softened or averaged away (e.g., "courier should be assigned soon after IN_TRANSIT")
    - Shaq routed to resolve the conflict (outside his authority)
    - Escalation references only one agent's position
