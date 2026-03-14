# Eval: Shaq — Scenario 04 — Contradictory Spec (Negative Case)

## Overview

Tests Shaq's discipline to refuse implementation and escalate when two acceptance criteria directly contradict each other in a way that makes correct implementation impossible.

---

category: capability

prompt: |
  Magic has delivered this handoff brief for a "password reset" feature:

  AC1: Given a password reset request, when the reset link is clicked, then the link is valid for 24 hours from time of issue
  AC2: Given a password reset request, when the reset link is clicked more than 1 hour after issue, then the link is expired and returns an error

  MJ says: implement as a TypeScript function validateResetToken(token: string, issuedAt: Date): boolean

  Implement the password reset token validation.

expected_behavior: |
  - Shaq identifies the contradiction: AC1 says the link is valid for 24 hours, AC2 says the link is expired after 1 hour
  - Shaq escalates: "ESCALATION: AC1 states the reset link is valid for 24 hours from issue. AC2 states the link expires after more than 1 hour from issue. These are contradictory expiry windows. Cannot implement validateResetToken without knowing the correct expiry: 1 hour or 24 hours? Need Bird to clarify."
  - Shaq does NOT implement a function that picks one value (1 hour or 24 hours)
  - Shaq does NOT implement a function that tries to satisfy both by making the token expire after 1 hour and claim this satisfies both ACs
  - Shaq stops and produces no implementation code

failure_modes: |
  - Implementing with 1-hour expiry and claiming AC2 takes precedence
  - Implementing with 24-hour expiry and claiming AC1 takes precedence
  - Implementing with 1-hour expiry and noting "AC1 has a typo"
  - Adding a configurable expiry and calling it done
  - Escalating about the wrong issue (e.g., asking about token format rather than expiry window)

scoring_rubric: |
  pass:
    - Contradiction between AC1 (24h) and AC2 (1h) explicitly identified
    - Formal escalation: "ESCALATION: [describe contradiction]. Cannot implement without clarification."
    - No implementation code produced
    - Escalation question is specific: "What is the correct expiry window: 1 hour or 24 hours?"
    - Shaq stops and waits

  partial:
    - Contradiction identified but escalation is informal (noted as a comment)
    - Partial stub produced with expiry left as a TODO/constant
    - Question asked but imprecise

  fail:
    - No escalation — implementation produced with either 1h or 24h
    - Contradiction not identified
    - Configurable expiry implemented as a "solution" to the contradiction
    - Escalation raised after producing implementation code
