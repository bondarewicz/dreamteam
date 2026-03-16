# Eval: MJ — Scenario 10 — Technology Migration Strategy (Hard)

## Overview

Tests MJ's ability to design a safe migration strategy from one technology to another, including rollback planning, data migration, and phased cutover — not just the target architecture.

---

category: capability

graders:
  - type: contains
    values: ["migration", "rollback", "strangler", "risk", "trade_off"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 500

prompt: |
  The platform currently uses MongoDB for all data storage. The team wants to migrate the Order Management domain to PostgreSQL for the following reasons: need for ACID transactions across order and payment records; complex join queries for reporting; need for foreign key constraints to prevent orphaned records.

  Current state: 8 million order documents in MongoDB. Production traffic is 200 order writes/minute. The service cannot have downtime during migration.

  Design the migration architecture. Use your full output schema.

expected_behavior: |
  - MJ designs a migration that does not require downtime: dual-write pattern or change data capture (CDC)
  - Migration phases identified:
    1. Set up PostgreSQL with schema
    2. Backfill historical data (8M records — this is an offline batch operation)
    3. Enable dual-write: new writes go to both MongoDB and PostgreSQL
    4. Validate data consistency between the two stores
    5. Switch reads to PostgreSQL (canary first, then full cutover)
    6. Disable MongoDB writes
    7. Decommission MongoDB for this domain
  - MJ identifies the backfill as a significant risk: 8M records must be migrated without blocking production traffic; batch job must be designed to not saturate the database
  - rollback plan: if PostgreSQL shows issues after read cutover, revert reads to MongoDB (MongoDB still has current data during dual-write phase)
  - risks: data divergence between MongoDB and PostgreSQL during dual-write phase; schema mapping issues (MongoDB documents may have inconsistent shapes); performance differences affecting P99 latency
  - MJ raises the data shape risk: MongoDB documents may have evolved over time with inconsistent fields — schema validation before migration is required
  - trade_offs: dual-write adds latency to every write; maintaining two stores temporarily increases operational burden

failure_modes: |
  - Designing a "stop the world" migration requiring downtime
  - Not designing a rollback plan
  - Missing the data shape inconsistency risk in MongoDB
  - Not addressing how to handle writes that occur during the backfill
  - Recommending a single-phase cutover (backup, migrate, restore)

scoring_rubric: |
  pass:
    - Zero-downtime migration strategy (dual-write or CDC)
    - Phases clearly defined including backfill, dual-write, read cutover, decommission
    - Rollback plan at each phase
    - MongoDB data shape inconsistency risk identified
    - trade_offs includes dual-write latency and operational overhead

  partial:
    - Zero-downtime strategy present but phases incomplete
    - Rollback plan for some phases
    - Backfill approach addressed
    - MongoDB data shape risk mentioned

  fail:
    - Downtime migration designed
    - No rollback plan
    - Backfill not addressed
    - MongoDB inconsistency risk not mentioned
    - Single-phase cutover
