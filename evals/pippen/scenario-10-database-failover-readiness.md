# Eval: Pippen — Scenario 10 — Database Failover Readiness (Hard)

## Overview

Tests Pippen's ability to assess a service's readiness for a database failover event — specifically whether the service can survive a primary-to-replica promotion without downtime or data loss.

---

category: capability

prompt: |
  You are Pippen reviewing an "order history service" before it ships to production. The database is PostgreSQL with primary/replica replication.

  - The service serves read-heavy traffic (95% reads, 5% writes) for order history
  - All queries (reads AND writes) go to the primary database connection string
  - No read replica routing implemented
  - Connection pool: 20 connections to primary, max_overflow=5
  - Database connection errors are not retried — a failed connection immediately returns a 500 to the caller
  - Structured JSON logging with request ID, query duration, and database error type
  - /health endpoint checks primary database connectivity only
  - Prometheus metrics: db_query_duration_histogram, db_errors_total
  - In the event of a primary failover, the service requires a manual restart to pick up the new primary connection string (connection string is baked into the application config, not dynamically resolved)
  - Rollback: redeploy previous image

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies that the manual restart requirement during failover is a significant operational gap: the service will be unavailable for the duration of the failover + manual restart
  - Pippen recommends using a connection string that resolves to the current primary dynamically (e.g., via a load balancer endpoint or DNS-based failover routing like Route 53 health checks or PgBouncer)
  - Pippen flags that read traffic (95%) should ideally go to replicas — routing all reads to primary wastes replica capacity and increases primary load
  - Pippen flags that connection errors are not retried — a transient connection error during failover will produce a burst of 500 errors instead of a brief retry window
  - Pippen recommends: (1) dynamic primary resolution or DNS-based failover, (2) connection retry with brief backoff (1-2 retries) to absorb transient failover, (3) read replica routing for read queries
  - Verdict: NOT READY or READY WITH CAVEATS — manual restart during failover is not acceptable for production

failure_modes: |
  - Approving the service because it "has a connection pool and metrics"
  - Missing the manual restart requirement during failover
  - Not flagging the absence of read replica routing
  - Missing the no-retry-on-connection-error gap
  - Recommending read replica routing as a must-have when it is a performance optimization (not a reliability blocker)

scoring_rubric: |
  pass:
    - Manual restart requirement during failover identified as an operational gap
    - Dynamic primary resolution recommended as the fix
    - No retry on connection error identified as a reliability gap
    - Read replica routing identified (as optimization, not blocker)
    - Verdict is NOT READY or READY WITH CAVEATS
    - At least two specific recommendations provided

  partial:
    - Manual restart gap identified but remediation is vague
    - One of the two reliability gaps (no retry OR manual restart) identified
    - Read replica gap not mentioned

  fail:
    - Manual restart requirement not identified as a problem
    - Verdict is READY
    - No discussion of failover behavior
    - Connection retry gap not identified
