# Eval: MJ — Scenario 14 — Anti-Pattern Detection in Existing Architecture (Very Hard)

## Overview

Tests MJ's ability to audit an existing architecture description, identify multiple anti-patterns, and produce a prioritized remediation plan.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: risks
    min_items: 3

prompt: |
  Review the following architecture that was built organically over 3 years:

  - The Order Service has a shared database with the Courier Service (both read and write to the same PostgreSQL instance with different schema prefixes)
  - The Notification Service is called synchronously by 5 different services (Order, Courier, Payment, Customer, Reporting)
  - The Customer Service exposes a single /api/v1/everything endpoint that returns the full customer record including payment methods, order history, addresses, and preferences
  - Background jobs are implemented as REST API endpoints ("/api/v1/jobs/process-refunds") that are called by a cron job via HTTP
  - The Reporting Service reads directly from the Order Service's database tables (not its API)

  Identify all anti-patterns present and produce a prioritized remediation plan. Use your full output schema.

expected_behavior: |
  - MJ identifies all 5 anti-patterns:
    1. Shared database between Order and Courier: violates service isolation; any schema change to the shared DB can break both services; tight coupling defeats microservices benefits
    2. Synchronous fan-in to Notification Service: 5 services calling Notification synchronously means any Notification slowness cascades to all 5 callers; Notification is a synchronous bottleneck
    3. God endpoint (/api/v1/everything): overly broad endpoint; callers cannot request only what they need; network payload is unnecessarily large; breaks principle of least privilege for data
    4. REST endpoints as background jobs: using HTTP for job triggering is fragile (HTTP timeout, job re-entrancy if cron fires while previous run is still executing); jobs should be managed by a proper queue or scheduler
    5. Direct cross-service database reads (Reporting reads Order DB): tightest possible coupling; Reporting will break on any Order schema change
  - MJ prioritizes remediation by risk:
    - Immediate (highest risk): shared database and direct DB reads (these block safe deployment of either service)
    - Short-term: REST-based background jobs (operational reliability risk)
    - Medium-term: synchronous Notification fan-in (reliability risk under load)
    - Longer-term: god endpoint (performance/security risk but not immediately breaking)
  - trade_offs: fixing the shared database requires a significant migration and may involve building new APIs between Order and Courier

failure_modes: |
  - Missing the direct cross-service DB read anti-pattern
  - Missing the REST-as-job-trigger anti-pattern
  - Not prioritizing remediation (treating all anti-patterns as equally urgent)
  - Proposing a full rewrite instead of incremental remediation
  - Not identifying why shared databases defeat microservices benefits

scoring_rubric: |
  pass:
    - All 5 anti-patterns identified by name
    - Prioritized remediation plan (not all equally urgent)
    - Shared database and direct DB reads identified as highest risk
    - REST-based jobs identified as fragile
    - trade_offs for fixing the shared database included
    - Incremental remediation approach (not big bang rewrite)

  partial:
    - 3-4 anti-patterns identified
    - Remediation plan present but not prioritized
    - Shared database and direct DB reads identified

  fail:
    - Fewer than 3 anti-patterns identified
    - No prioritization
    - Big bang rewrite recommended
    - Direct DB reads not identified as anti-pattern
