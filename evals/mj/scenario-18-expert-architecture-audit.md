# Eval: MJ — Scenario 18 — Expert Architecture Audit (Expert)

## Overview

Expert-level: MJ is given an architecture that has multiple subtle problems — not obvious anti-patterns but design choices that will cause pain at scale. Expected to partially pass.

---

category: capability

graders:
  - type: contains
    values: ["trade_off", "risk", "bottleneck", "coupling"]
  - type: section_present
    sections: ["risks"]
  - type: length_bounds
    min: 500
    max: 10000

prompt: |
  Review the following architecture and identify all risks, hidden coupling, and future scalability problems:

  Architecture:
  - Single PostgreSQL instance with connection pool of 100 connections
  - 8 microservices, each with its own connection pool (12 connections each = 96 connections total, near the limit)
  - All services use synchronous HTTP calls; the longest call chain is: API Gateway -> Order Service -> Courier Service -> Carrier API -> Notification Service
  - User authentication uses a shared Redis cache that all services hit for session validation on every request
  - Deployments: all 8 services are deployed together via a single CI/CD pipeline (one deployment = all services)
  - Logs: each service writes logs to a shared NFS mount

  Produce a full architecture audit.

expected_behavior: |
  - MJ identifies all 5 hidden problems:
    1. Connection pool near-exhaustion: 96 of 100 connections used by 8 services; adding the 9th service, or scaling to 2 instances of any service, will exceed the connection limit and cause connection errors
    2. Synchronous call chain depth: a 5-hop synchronous chain (Gateway -> Order -> Courier -> Carrier API -> Notification) means total latency is the sum of all hops; one slow hop blocks the entire chain; one failure anywhere in the chain fails the entire request
    3. Redis as shared session cache is a single point of failure: if Redis goes down, all 8 services cannot authenticate any request simultaneously
    4. Shared CI/CD pipeline destroys microservices deployment independence: the primary benefit of microservices (independent deployment) is negated; a bad deployment of one service requires rolling back all services
    5. NFS log mount: NFS is slow for concurrent writes; 8 services writing logs simultaneously can cause I/O contention; NFS mount failure makes all services lose logging simultaneously (hidden shared dependency)
  - MJ prioritizes: connection pool near-exhaustion is most immediate (next scaling event will trigger this); shared CI/CD is the most impactful fix for developer velocity
  - trade_offs for fixing each issue
  - MJ does NOT recommend all fixes simultaneously for a small team — proposes a sequenced plan

failure_modes: |
  - Missing the connection pool exhaustion problem (it requires doing the math: 8 × 12 = 96)
  - Missing the NFS log mount as a shared dependency
  - Missing that the shared CI/CD pipeline defeats the purpose of microservices
  - Not prioritizing the risks (treating all as equally urgent)
  - Missing the synchronous chain depth as a reliability risk

scoring_rubric: |
  pass:
    - All 5 problems identified
    - Connection pool math performed (96 of 100)
    - NFS as hidden shared dependency identified
    - Shared CI/CD identified as defeating microservices benefit
    - Prioritized remediation plan
    - trade_offs for each fix

  partial:
    - 3-4 problems identified
    - Connection pool problem identified (even without exact math)
    - Prioritization present but not for all items
    - trade_offs thin

  fail:
    - Fewer than 3 problems identified
    - Connection pool exhaustion not identified
    - NFS and CI/CD problems missed
    - No prioritization
