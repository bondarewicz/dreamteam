# Eval: MJ — Scenario 03 — Trade-off Analysis (Escalation Case)

## Overview

Tests MJ's escalation behavior when a domain-architecture conflict exists: the cleanest architectural approach conflicts with a business constraint that Bird owns. MJ must escalate rather than silently compromise.

---

category: regression

graders:
  - type: contains
    values: ["trade_off", "escalat", "PostgreSQL", "throughput", "confidence"]
  - type: section_present
    sections: ["Trade", "Risk"]
  - type: length_bounds
    min: 400

prompt: |
  Bird has defined this domain rule: "A courier's location must be updated in real-time — any location reading older than 30 seconds is considered stale and must not be displayed to customers."

  MJ is now designing the courier tracking system. The current infrastructure uses a relational database (PostgreSQL). The engineering team suggests storing location updates directly in PostgreSQL with a timestamp column.

  Design the architecture. Use your full output schema. If you identify any conflicts between Bird's domain rule and the pragmatic architecture, escalate them explicitly.

expected_behavior: |
  - MJ identifies the core tension: PostgreSQL is not optimized for high-frequency time-series writes (location updates at sub-30-second intervals for many couriers simultaneously). This creates a real architecture-domain conflict.
  - MJ escalates the conflict rather than silently picking one side: "Bird's rule requires sub-30-second freshness. PostgreSQL write throughput at scale may not support this. Need: confirmation of fleet size and expected update frequency before committing to a storage solution."
  - MJ proposes at least 2 architectural options with their trade-offs:
    Option A: Use PostgreSQL with careful indexing and connection pooling (pragmatic, avoids new infrastructure, but has scale ceiling)
    Option B: Use a time-series database or Redis for location data (better fit for the domain rule, but adds operational complexity)
  - MJ does NOT silently choose Option A just because it's simpler — he surfaces the risk explicitly
  - trade_offs section acknowledges what is sacrificed in each option
  - risks includes: PostgreSQL approaching write throughput limits as fleet grows; stale location data reaching customers if updates fall behind

failure_modes: |
  - Recommending PostgreSQL without acknowledging the high-frequency write problem
  - Silently choosing the pragmatic option without flagging the domain rule risk
  - Not escalating the conflict to get fleet size / update frequency data before committing to a design
  - Recommending a complex solution (e.g., Kafka + Flink) without justifying why simpler options were rejected given the missing scale information
  - trade_offs section lists only the recommended option's gains, not its sacrifices

scoring_rubric: |
  pass:
    - Domain-architecture conflict explicitly identified
    - Formal escalation with specific questions (fleet size, update frequency)
    - At least 2 architectural options presented with trade-offs
    - trade_offs includes sacrifices for the recommended option
    - risks includes PostgreSQL throughput ceiling
    - MJ does not commit to a final design without the missing information
    - confidence.level is reduced due to missing context (should be <= 70)

  partial:
    - Conflict identified but not formally escalated
    - 2 options presented but trade-offs thin
    - risks present but throughput ceiling not mentioned
    - Commits to a design but acknowledges the caveat

  fail:
    - Recommends PostgreSQL without acknowledging write throughput concern
    - No escalation
    - Single option presented as the answer
    - trade_offs missing sacrifices
    - confidence.level >= 85 with missing information
