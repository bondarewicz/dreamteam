# Eval: MJ — Scenario 06 — CQRS Pattern Application (Capability)

## Overview

Tests MJ's ability to correctly identify when CQRS is and is not appropriate, and to design a CQRS implementation with correct read/write model separation and event handling.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: trade_offs
    min_items: 1

prompt: |
  A logistics platform has a reporting problem. The order management database has 50 million records. Queries for the operations dashboard (showing: orders by status, delivery success rates, average transit time by zone, courier performance rankings) are taking 30-60 seconds. These queries are read-only. The underlying order data model is highly normalized (12 tables, complex joins required). Write volume is low: ~500 new orders/day.

  The team is considering CQRS to separate the read and write paths. Evaluate CQRS for this use case and design the solution. Use your full output schema.

expected_behavior: |
  - MJ correctly identifies this as a good use case for CQRS given: read-heavy workload, complex read queries, mismatch between the normalized write model and the denormalized read requirements
  - MJ designs the solution:
    - Write side: existing normalized relational model unchanged
    - Read side: separate denormalized read models (materialized views or a separate read database) optimized for the dashboard queries
    - Synchronization: either event-driven (order events trigger read model updates) or periodic sync
  - trade_offs names what CQRS introduces: eventual consistency on the read side (dashboard data is slightly behind writes), added complexity for the team to maintain two models, read model synchronization failures as a new failure mode
  - MJ correctly notes that for 500 orders/day, eventual consistency lag is acceptable (seconds to minutes delay is fine for operational reporting)
  - risks includes: read model falling out of sync if event processing fails; initial migration to populate the read model from 50M existing records
  - MJ does NOT recommend CQRS for the write path (there is no write complexity justifying command/event separation on the command side)
  - implementation_guidance: concrete steps for Shaq including which tables need denormalized read models and the synchronization mechanism

failure_modes: |
  - Recommending CQRS for both reads and writes when only reads are the problem
  - Not acknowledging the eventual consistency trade-off
  - Missing the 50M record initial migration as a risk
  - Recommending event sourcing when it was not asked for and adds unnecessary complexity
  - Not providing specific denormalization guidance for the 12-table write model

scoring_rubric: |
  pass:
    - CQRS correctly identified as appropriate for this use case with reasoning
    - Read/write model separation clearly designed
    - Eventual consistency trade-off explicitly stated
    - 50M record migration risk identified
    - implementation_guidance is actionable for Shaq
    - CQRS limited to read path only (no unnecessary write-side CQRS)

  partial:
    - CQRS recommended correctly but design is vague
    - Eventual consistency mentioned but not quantified for the use case
    - Migration risk present but thin
    - Implementation guidance present but generic

  fail:
    - CQRS applied to both sides without justification
    - Eventual consistency trade-off missing
    - Migration risk for 50M records missing
    - Event sourcing added unnecessarily
    - No concrete implementation guidance
