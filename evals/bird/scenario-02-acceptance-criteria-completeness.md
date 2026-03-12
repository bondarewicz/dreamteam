# Eval: Bird — Scenario 02 — Acceptance Criteria Completeness (Edge Case)

## Overview

Tests Bird's ability to produce complete, non-vague acceptance criteria when the domain description is intentionally incomplete or ambiguous. Bird must surface gaps rather than fill them silently.

---

prompt: |
  A product manager says: "Users should be able to cancel their order."

  Produce acceptance criteria for this feature. Use your full output schema. Specifically address edge_cases in your acceptance_criteria section.

expected_behavior: |
  - Bird produces acceptance_criteria with at least 3 Given/When/Then scenarios covering:
    1. Happy path: an order in a cancellable state (e.g., "pending") can be cancelled
    2. Edge case: an order already shipped or delivered cannot be cancelled
    3. Edge case: an order already cancelled cannot be cancelled again
  - Bird explicitly surfaces ambiguities in the escalation pattern or confidence.low_confidence_areas:
    - "What states is cancellation allowed from?" (the PM did not specify)
    - "Is there a time window restriction?" (not mentioned)
    - "Who can cancel — only the customer, or also operations staff?" (not mentioned)
  - confidence.level is <= 60 due to the underspecified input
  - Bird does NOT invent answers to these questions — he flags them as unknowns

failure_modes: |
  - Silently assuming that only "pending" orders can be cancelled without flagging the assumption
  - Producing only one acceptance criterion (the happy path)
  - Not mentioning the already-cancelled state as an edge case
  - Setting confidence.level >= 80 on an underspecified prompt
  - Inventing a "cancellation window" rule (e.g., "within 30 minutes") without flagging it as an assumption
  - Omitting the question of who has permission to cancel

scoring_rubric: |
  pass:
    - At least 3 Given/When/Then criteria (happy path + 2 edge cases)
    - At least 2 explicit ambiguities surfaced in confidence.low_confidence_areas or as escalation
    - confidence.level <= 65
    - No invented business rules presented as facts
    - edge_cases section populated in acceptance_criteria

  partial:
    - 2 Given/When/Then criteria
    - 1 ambiguity surfaced
    - confidence.level between 66-80
    - Minor invented rules but flagged as assumptions

  fail:
    - Only 1 criterion (happy path only)
    - No ambiguities surfaced
    - confidence.level >= 80
    - Invented rules presented as facts with no caveats
    - No edge_cases in acceptance_criteria output
