# Eval: MJ — Scenario 12 — Capacity Planning and Scaling (Hard)

## Overview

Tests MJ's ability to reason about capacity, identify bottlenecks before they occur, and design a scaling strategy that is appropriate for the team size and growth trajectory.

---

category: capability

graders:
  - type: contains
    values: ["bottleneck", "scaling", "database", "trade_off", "risk"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 500

prompt: |
  Current system metrics:
  - 50,000 orders/day, growing 20% month-over-month
  - PostgreSQL database: 400GB, 70% CPU at peak, 85% disk utilization
  - API servers: 4 instances, 60% CPU at peak
  - Average query time: 150ms; P99: 800ms
  - Primary slow queries are: order search by customer (full table scan), delivery history aggregation

  The team wants a capacity plan for the next 12 months. Team size: 4 engineers.

  Produce a capacity analysis and scaling plan. Use your full output schema.

expected_behavior: |
  - MJ performs growth projection: 20% monthly growth over 12 months = ~8.9x growth. 50,000 orders/day becomes ~445,000 orders/day. This means ~9x the current data volume, write volume, and query load.
  - MJ identifies the bottleneck: the database is the primary bottleneck (70% CPU at peak now; at 9x load this will be 630% — clearly needs intervention before API servers)
  - MJ identifies the root cause: full table scans indicate missing indexes; this is the highest ROI fix
  - Short-term (months 1-3): add indexes on the slow queries (order by customer, delivery history); this requires no infrastructure change and can be done by Shaq
  - Medium-term (months 3-6): read replicas for reporting/aggregation queries; cache frequently-accessed customer order history
  - Longer-term (months 6-12): if 9x growth is sustained, disk capacity will be exhausted (~3.6TB from 400GB × 9); storage scaling plan required; consider table partitioning for the orders table
  - MJ explicitly flags the 85% disk utilization as a near-term emergency: at 20% monthly data growth, disk will be full in approximately 1-2 months
  - trade_offs: read replicas add replication lag; caching adds invalidation complexity
  - For a 4-engineer team, MJ recommends NOT over-engineering (avoid sharding, distributed databases) until the index fix is validated

failure_modes: |
  - Not performing the growth projection math
  - Missing that 85% disk utilization is an immediate risk (will be full in 1-2 months)
  - Recommending database sharding as a first step (over-engineering before the index fix)
  - Not identifying that the full table scans are the root cause of slow queries
  - Treating API server scaling as the primary bottleneck (it is not — database is)

scoring_rubric: |
  pass:
    - 12-month growth projection calculated (~8-9x)
    - Database identified as the primary bottleneck
    - 85% disk utilization flagged as near-term emergency
    - Index fix identified as highest ROI first step
    - Phased plan: indexes -> read replicas -> storage
    - Database sharding explicitly deferred (not recommended for 4-engineer team at this stage)
    - trade_offs includes replication lag and cache invalidation

  partial:
    - Growth projection present but math approximate
    - Database as bottleneck identified
    - Disk emergency mentioned
    - Index fix identified
    - No phasing or scaling order

  fail:
    - No growth projection math
    - Disk emergency not identified
    - Index fix not mentioned
    - Sharding recommended as first step
    - API servers treated as bottleneck
