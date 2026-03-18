# Eval: Shaq — Scenario 07 — State Machine Implementation (Medium)

## Overview

Tests Shaq's ability to implement a finite state machine with valid and invalid transition enforcement, where some transitions are one-way and others are conditional.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1

prompt: |
  Bird has defined these acceptance criteria for an order state machine:

  AC1: Valid transitions: PENDING -> CONFIRMED, CONFIRMED -> SHIPPED, SHIPPED -> DELIVERED, CONFIRMED -> CANCELLED, PENDING -> CANCELLED
  AC2: Invalid transitions must throw with error code INVALID_TRANSITION (e.g., DELIVERED -> SHIPPED, SHIPPED -> PENDING, CANCELLED -> any state)
  AC3: A CANCELLED order cannot transition to any other state (terminal state)
  AC4: A DELIVERED order cannot transition to any other state (terminal state)
  AC5: Given an order in PENDING state, when transition to CONFIRMED is called, then the new state is CONFIRMED
  AC6: Given an order in SHIPPED state, when transition to PENDING is attempted, then INVALID_TRANSITION error is thrown

  MJ says: implement as a TypeScript class OrderStateMachine with method transition(currentState: OrderState, targetState: OrderState): OrderState. Throw an Error with code: "INVALID_TRANSITION" on invalid transitions. No external dependencies.

  Implement the state machine and tests.

expected_behavior: |
  - The state machine correctly encodes all valid transitions from AC1
  - Invalid transitions throw an Error with a code property of "INVALID_TRANSITION" (not just a message string)
  - CANCELLED and DELIVERED are treated as terminal states — no outgoing transitions allowed (AC3, AC4)
  - Tests cover: at least one happy path per valid transition (5 valid transitions), at least two invalid transitions (DELIVERED -> SHIPPED, CANCELLED -> any)
  - AC6 is tested explicitly: SHIPPED -> PENDING throws INVALID_TRANSITION
  - The error object has a code property (not just throws a string message)
  - No external state machine library introduced

failure_modes: |
  - Encoding transitions as a whitelist that misses the CONFIRMED -> CANCELLED path
  - Throwing a string error rather than an Error object with code property
  - Terminal state enforcement only by checking the list of outgoing transitions (which may work for DELIVERED but be missing for CANCELLED if CANCELLED was not in the initial state map)
  - Tests that only test the five happy paths without any invalid transition tests
  - Using an external state machine library (XState etc.) not approved by MJ

scoring_rubric: |
  pass:
    - All 5 valid transitions from AC1 correctly implemented
    - Error thrown has code: "INVALID_TRANSITION" property
    - Both terminal states (DELIVERED, CANCELLED) have no outgoing transitions
    - Tests cover all valid transitions and at least 2 invalid transitions
    - AC6 (SHIPPED -> PENDING) explicitly tested
    - No external libraries
    - acceptance_criteria_coverage maps all 6 ACs

  partial:
    - 4 of 5 valid transitions correct (likely CONFIRMED -> CANCELLED missed)
    - Error code present but object structure inconsistent
    - Tests cover happy paths only

  fail:
    - Valid transitions incomplete
    - Error thrown as string or without code property
    - Terminal states not enforced
    - Tests cover only happy path
    - External library introduced
