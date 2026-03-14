# Eval: Pippen — Scenario 06 — Health Check Inadequacy (Medium)

## Overview

Tests Pippen's ability to assess a health check that exists but is too shallow to serve its intended purpose — a health endpoint that always returns 200 regardless of actual service health.

---

category: capability

prompt: |
  You are Pippen reviewing an "email delivery service" before it ships to production. Here is what exists:

  - The service processes email send requests and delivers them via SendGrid API
  - Structured JSON logging with request ID, duration, status code, and error details
  - A /health endpoint that always returns 200 with the response body: {"status": "ok"}
  - The /health endpoint does NOT check SendGrid API connectivity, does NOT check the database connection (used to store delivery records), and does NOT check the internal job queue depth
  - Prometheus metrics: emails_sent_total, emails_failed_total, sendgrid_api_latency_histogram
  - Retry logic: 3 retries with exponential backoff on SendGrid API failures
  - No circuit breaker on SendGrid
  - Timeout: 10s on SendGrid API calls
  - Rollback: redeploy previous image

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies that the /health endpoint is a stub — it always returns 200 regardless of service state and checks no dependencies
  - Pippen explains the consequence: the load balancer and orchestrator will believe the service is healthy even if SendGrid is unreachable or the database is down
  - Pippen flags the absence of a circuit breaker on SendGrid as a resilience gap — without it, a slow/failing SendGrid will exhaust thread pool or connection pool resources
  - Pippen provides specific recommendations: "Add dependency checks to /health: (1) SendGrid reachability (lightweight ping), (2) database connection check, (3) optionally job queue depth threshold"
  - Pippen's verdict is NOT READY or READY WITH CAVEATS — the stub health check is a must-fix before routing live traffic through a load balancer
  - Pippen correctly notes that logging and metrics are adequate

failure_modes: |
  - Approving the service because "a /health endpoint exists"
  - Missing the consequence of the stub health check (load balancer routing to a broken service)
  - Not flagging the absent circuit breaker on SendGrid
  - Recommending circuit breaker but not flagging the health check stub as a blocker
  - Treating the health check stub as a nice-to-have improvement

scoring_rubric: |
  pass:
    - /health stub identified: always returns 200, no dependency checks
    - Consequence named: load balancer/orchestrator cannot detect service failure
    - Specific dependency checks recommended: SendGrid reachability, database connection
    - Circuit breaker absence on SendGrid flagged
    - Verdict is NOT READY or READY WITH CAVEATS
    - Logging and metrics correctly noted as adequate

  partial:
    - Health check stub identified but consequence not explained
    - Circuit breaker gap identified but health check treated as minor
    - Recommendations present but imprecise

  fail:
    - Health check approved because endpoint "exists"
    - Circuit breaker gap not identified
    - No remediation recommendations
    - Verdict is READY
