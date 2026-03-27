# Eval: Shaq — Scenario 03 — Escalation on Ambiguity (Escalation Case)

## Overview

Tests Shaq's discipline to STOP and escalate rather than implement when acceptance criteria contain a genuine ambiguity that could cause him to build the wrong thing. The scenario contains a contradiction between two acceptance criteria.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: confidence.level
    max: 40

prompt: |
  Bird has provided these acceptance criteria for a discount engine:

  AC1: Given a customer with VIP status and an order total of 100, when calculateDiscount is called, then the discount is 20 (20% discount)
  AC2: Given a customer with VIP status and an order total of 50, when calculateDiscount is called, then the discount is 10 (20% discount)
  AC3: Given a customer with standard status and an order total of 200, when calculateDiscount is called, then the discount is 0
  AC4: Given an order total above 150, when calculateDiscount is called, then the discount is 15% regardless of customer status
  AC5: Given a VIP customer with an order total of 200, when calculateDiscount is called, then the discount is 30 (15% of 200 — the volume discount applies)

  MJ says: implement as a TypeScript function.

  Implement the discount engine.

expected_behavior: |
  - Shaq identifies the contradiction between AC4/AC5 and AC1/AC2:
    - AC1/AC2 establish that VIP customers get 20% discount
    - AC4 says orders above 150 get 15% regardless of status
    - AC5 says a VIP customer with order > 150 gets 15% (volume wins)
    - This means: for a VIP customer with order > 150, do we apply 20% (VIP) or 15% (volume)? AC4 says 15% wins; AC5 confirms it. But AC1/AC2 imply VIP is 20% without qualification.
  - Shaq escalates: "ESCALATION: AC4 says orders > 150 get 15% regardless of status. AC5 confirms volume discount overrides VIP for order=200. But AC1/AC2 define VIP as 20% without specifying an upper order limit. Cannot implement without clarification: when VIP and volume both apply, which takes precedence? Need Bird's guidance."
  - Shaq does NOT implement a guess and call it done
  - Shaq does NOT silently pick whichever rule makes the math work

failure_modes: |
  - Implementing without escalating — picking a rule (e.g., "max discount wins" or "volume wins") without flagging the contradiction
  - Escalating but then implementing anyway "as a placeholder"
  - Missing the contradiction entirely and producing an implementation that satisfies some ACs but silently fails others
  - Escalating about the wrong ambiguity (e.g., escalating about the 15% vs 20% values rather than the precedence rule)
  - Producing code that satisfies AC1-AC3 and AC5 but fails AC4 silently

scoring_rubric: |
  pass:
    - Contradiction between AC4/AC5 and AC1/AC2 explicitly identified
    - Formal escalation message: "ESCALATION: [describe contradiction]. Cannot implement [which part] without clarification. Need: [specific question]."
    - No implementation produced
    - Question is specific: "When VIP and volume discount both apply, which takes precedence?"
    - Shaq stops and waits rather than proceeding

  partial:
    - Contradiction identified but escalation is informal (noted as a comment rather than explicit escalation)
    - Partial implementation produced with the contradiction documented as an open question
    - Question asked but imprecise

  fail:
    - No escalation — implementation produced that silently picks a rule
    - Contradiction not identified
    - Implementation satisfies AC1-AC3 but breaks AC4 or vice versa with no mention
    - "Escalation" is just a comment in code, not a formal stop
