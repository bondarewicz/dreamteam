# Eval: Magic — Scenario 01 — Synthesis Completeness (Happy Path)

## Overview

Tests Magic's ability to produce a complete, well-structured synthesis from multiple agent outputs — preserving critical context, translating between domain and technical language, and producing a handoff brief that Shaq can act on without going back to read every upstream output.

---

category: regression

prompt: |
  Bird produced this domain analysis summary:
  - Bounded context: Order Fulfillment
  - Domain rule: An order cannot transition from SHIPPED to PENDING (invariant)
  - Domain rule: A refund can only be issued on a DELIVERED order (invariant)
  - Acceptance criterion: Given an order in SHIPPED state, when a revert-to-pending is attempted, then it is rejected with error code ORDER_STATE_INVALID

  MJ produced this architecture summary:
  - The order service will expose a PATCH /orders/{id}/state endpoint
  - State transitions will be validated in an OrderStateMachine class
  - Refund logic lives in a separate RefundService that calls the order service to verify state before issuing

  Produce a handoff brief for Shaq using your handoff_brief output format. Include recipient, task_context, domain_rules, architecture_guidance, acceptance_criteria, and any terminology_alignment needed.

expected_behavior: |
  - handoff_brief.recipient is "Shaq"
  - task_context is one paragraph that accurately summarizes what Shaq is building and why
  - domain_rules section contains both invariant rules (state transition + refund precondition) with testable_assertions
  - architecture_guidance contains both implementation decisions (PATCH endpoint + OrderStateMachine + RefundService) with implementation_notes
  - acceptance_criteria includes the Given/When/Then criterion from Bird, not paraphrased in a way that loses precision
  - terminology_alignment addresses that Bird says "SHIPPED" and MJ says "PATCH /orders/{id}/state" — Magic should confirm these refer to the same state and clarify that "state" is the technical term for Bird's "order status"
  - No information is invented that was not in the source summaries
  - No information from the source summaries is silently dropped

failure_modes: |
  - task_context is vague ("Shaq should implement the order stuff") without specific context
  - domain_rules omit one of the two invariant rules
  - architecture_guidance omits RefundService design (partial synthesis)
  - acceptance_criteria paraphrased loosely, losing the specific error code ORDER_STATE_INVALID
  - terminology_alignment absent despite Bird and MJ using different language for the same concept
  - Magic invents a detail not in either source (e.g., adding a "timeout" rule not mentioned by Bird or MJ)

scoring_rubric: |
  pass:
    - Both domain rules present with testable_assertions
    - Both architecture decisions present with implementation_notes
    - acceptance_criteria preserves the error code ORDER_STATE_INVALID verbatim
    - terminology_alignment present and addresses Bird/MJ language differences
    - task_context is one paragraph, specific, and actionable
    - No invented information

  partial:
    - Both domain rules present but testable_assertions thin
    - One of two architecture decisions missing
    - acceptance_criteria present but error code paraphrased
    - terminology_alignment absent

  fail:
    - One or both domain rules missing
    - Architecture guidance absent or covers only one decision
    - acceptance_criteria vague or missing error code
    - Invented information present
    - terminology_alignment absent and Bird/MJ language not reconciled
