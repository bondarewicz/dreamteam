# Eval: MJ — Scenario 17 — Global Distributed System Design (Very Hard)

## Overview

Tests MJ's ability to design a system that must operate across multiple geographic regions with data residency requirements and cross-region consistency constraints.

---

category: capability

graders:
  - type: contains
    values: ["data residency", "replication", "trade_off", "latency", "consistency"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 600

prompt: |
  A logistics platform needs to expand from single-region (EU) to multi-region (EU + US + APAC). Requirements:

  - EU customer data must never leave EU (GDPR data residency)
  - US customer data must stay in US (CCPA compliance)
  - A courier operating in Europe cannot be assigned to a US delivery (and vice versa)
  - Global operations dashboard must show metrics from all regions in real time
  - If the EU region goes down, EU customers should see degraded but functional service
  - Response time: < 100ms for customers in their region

  Design the multi-region architecture. Use your full output schema.

expected_behavior: |
  - MJ designs a regional isolation model: EU, US, and APAC are independent regional deployments with their own databases; customer and courier data does not cross regions
  - Cross-region operations are limited to: global metrics aggregation (read-only, for the dashboard); routing of API requests to the correct region (based on customer's region)
  - Data residency: regional databases are not replicated across regions; the global dashboard reads regional metrics endpoints (not raw data) and aggregates
  - Courier assignment: the domain rule (EU couriers stay in EU) is enforced at the assignment level — regional isolation means this is naturally enforced if each region's courier pool is separate
  - Global dashboard design: each region exposes a metrics API; the global dashboard aggregates; accepts eventual consistency (dashboard may be slightly stale)
  - Disaster recovery for EU: if EU goes down, EU customers see degraded service (can view order history from cache, cannot place new orders); this is acceptable per the "degraded but functional" requirement
  - trade_offs: operational overhead of running 3 regional deployments; deployment consistency (same version must be deployed to all regions); regional data means no cross-region queries
  - risks: global dashboard may show stale metrics during regional outage; schema migrations must be applied to all regions; cross-region bugs can be hard to reproduce

failure_modes: |
  - Designing a single global database with all customer data (violates data residency)
  - Replicating all data across regions (violates GDPR/CCPA)
  - Not addressing how the global dashboard works without cross-region raw data access
  - Missing the operational overhead of 3 regional deployments for the team

scoring_rubric: |
  pass:
    - Regional isolation model designed (no raw data crosses regions)
    - Data residency compliance addressed for both GDPR and CCPA
    - Global dashboard design that does not require cross-region raw data
    - Courier assignment regional isolation correctly analyzed
    - trade_offs includes 3-region operational overhead
    - Degraded EU service during outage designed

  partial:
    - Regional isolation mentioned but global dashboard design incomplete
    - Data residency addressed for GDPR but not CCPA (or vice versa)
    - Operational overhead mentioned
    - Disaster recovery incomplete

  fail:
    - Single global database with all data
    - Cross-region data replication designed
    - Data residency requirements not addressed
    - Global dashboard requires cross-region raw data access
