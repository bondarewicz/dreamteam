# Eval: MJ — Scenario 09 — Conflicting Constraints (Hard)

## Overview

Tests MJ's ability to handle a requirements set where low latency, high consistency, and small team size are simultaneously required — a genuinely unsolvable combination that requires trade-off acknowledgment and escalation.

---

category: capability

graders:
  - type: contains
    values: ["trade_off", "CAP theorem", "consistency", "latency", "escalat"]
  - type: section_present
    sections: ["trade_offs", "risks"]
  - type: length_bounds
    min: 500
    max: 8000

prompt: |
  A logistics platform needs to build a courier assignment system. The product team's requirements:

  1. When an order is placed, a courier must be assigned within 200ms (low latency)
  2. Two orders must never be assigned to the same courier simultaneously (strong consistency)
  3. The system must stay available even if a database node fails (high availability)
  4. Team size: 2 engineers who will maintain this system

  Analyze these requirements and design the architecture. Use your full output schema.

expected_behavior: |
  - MJ explicitly identifies the CAP theorem tension: requirements 1+2+3 collectively ask for low latency + strong consistency + high availability, which is fundamentally constrained by the CAP theorem
  - MJ explains: strong consistency + high availability in a distributed system conflicts (CAP theorem — you can have CP or AP, not CAP)
  - MJ does NOT produce a design that claims to satisfy all three simultaneously without acknowledging the trade-off
  - MJ escalates: "Requirements 1-3 collectively request low latency + strong consistency + high availability. Under network partition, you must choose between consistency (no double-assignment) and availability (system continues assigning). Which takes priority?"
  - MJ also flags the team size constraint: strong consistency at low latency typically requires coordination primitives (distributed locks, Paxos, Raft) that are operationally complex for 2 engineers
  - If MJ proposes a design, it must explicitly state which property is sacrificed (e.g., "I propose prioritizing consistency over availability during partitions — double assignment is unacceptable, so we accept that the system may temporarily reject assignments during a partition")
  - trade_offs clearly names the CAP trade-off

failure_modes: |
  - Designing a system that claims to satisfy all three constraints without acknowledging the CAP tension
  - Not mentioning CAP theorem or distributed consistency trade-offs
  - Not escalating the conflict to Bird/product for priority decision
  - Recommending a complex distributed consensus solution without flagging the 2-engineer team constraint
  - trade_offs section listing only gains

scoring_rubric: |
  pass:
    - CAP theorem tension explicitly identified
    - Escalation produced asking which property has priority
    - If a design is produced, clearly states which property is sacrificed
    - Team size constraint factored (complexity management)
    - trade_offs includes the CAP trade-off explicitly

  partial:
    - CAP tension mentioned but not clearly explained
    - Design produced without stating which property is sacrificed
    - Team size constraint mentioned but not factored into design
    - Escalation informal

  fail:
    - All three constraints claimed to be satisfied simultaneously
    - CAP theorem not mentioned
    - No escalation
    - Complex distributed system recommended for 2-engineer team without acknowledgment
