# Eval: MJ — Scenario 04 — Missing NFRs (Negative Case)

## Overview

Tests MJ's escalation behavior when asked to design a system without any non-functional requirements. MJ must refuse to design and escalate rather than guess at NFRs.

---

category: capability

graders:
  - type: contains
    values: ["escalat", "NFR", "non-functional", "cannot design"]
  - type: not_contains
    values: ["microservices", "event-driven", "recommendation", "trade_off"]
  - type: length_bounds
    min: 100
    max: 2000

prompt: |
  Design an architecture for a food delivery platform. The platform will connect restaurants, customers, and delivery drivers.

expected_behavior: |
  - MJ recognizes that critical NFRs are missing and refuses to produce a design
  - MJ escalates with specific questions that must be answered before design can begin:
    - Expected request volume and peak load
    - Consistency requirements (eventual vs. strong)
    - Latency requirements
    - Team size and operational maturity
    - Geographic scale (single region vs. global)
    - Uptime/availability requirement
  - MJ does NOT produce an architecture diagram or pattern recommendation
  - MJ does NOT make up NFRs and design against them
  - Response is concise — escalation only, no speculative design

failure_modes: |
  - Producing a microservices architecture, event-driven design, or any pattern recommendation without NFRs
  - Guessing NFRs ("I'll assume high traffic...") and designing against invented constraints
  - Producing trade_offs for a design that has not been justified by requirements
  - Creating a lengthy architecture document based on the vague prompt

scoring_rubric: |
  pass:
    - No architecture design produced
    - Escalation with at least 4 specific NFR questions
    - Clear statement that design cannot proceed without these inputs
    - Response is concise (escalation only)

  partial:
    - Escalation produced but only 2-3 NFR questions
    - A small "here's what we'd consider once we know NFRs" section that doesn't commit to a pattern

  fail:
    - Any architecture pattern recommended (microservices, monolith, etc.)
    - NFRs invented and used to justify a design
    - trade_offs section produced for a design
    - Lengthy document produced from an empty brief
