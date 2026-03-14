# Eval: Pippen — Scenario 18 — Chaos Engineering Assessment (Expert)

## Overview

Tests Pippen's ability to assess a service's resilience by reasoning through what would happen under various failure injection scenarios — predicting failure modes before they occur in production.

---

category: capability

prompt: |
  You are Pippen performing a pre-production chaos engineering assessment for a "payment processing service". Before running actual chaos tests, you must predict the failure modes and assess whether the service is likely to survive the following failure injections:

  Service configuration:
  - Calls Stripe API for payment processing
  - Calls a fraud detection service (internal) before every payment
  - Fraud detection service timeout: 2s; no circuit breaker
  - Stripe API timeout: 10s; circuit breaker with 5-failure threshold, 60s reset
  - Database: PostgreSQL for transaction records, connection pool of 10, no connection retry
  - Worker threads: 20 (can handle 20 concurrent payment requests)
  - Metrics: payments_total, stripe_api_duration_histogram, fraud_check_duration_histogram

  Failure scenarios to assess:
  A. Fraud detection service goes down (returns 503) for 5 minutes
  B. Database connection pool exhaustion (all 10 connections occupied for 30 seconds)
  C. Stripe API latency increases to 8 seconds (within timeout but very slow) for 10 minutes
  D. Network partition between payment service and Stripe (complete loss) for 2 minutes

  For each scenario, predict the failure mode and assess survivability.

expected_behavior: |
  - Scenario A: No circuit breaker on fraud detection — all requests will block for 2s waiting for the timeout, then fail. At 20 concurrent workers, the service will queue up and response time spikes to 2s+. Service survives but is degraded; recommend circuit breaker and fallback (allow payment with enhanced monitoring or soft-allow). Pippen correctly notes this is NOT a service crash but a sustained performance degradation.
  - Scenario B: With only 10 connections and no retry, 10+ concurrent requests will receive immediate connection errors. Pippen predicts burst of 500 errors lasting until connections free. Correctly identifies that 20 workers with 10 connections means under load, roughly half of requests could be blocked waiting for connections at any time.
  - Scenario C: At 8s per Stripe call with 20 workers, the service can only process 2-3 payments/minute (20 workers / 8s = 2.5/sec theoretical). Queue builds up. Stripe circuit breaker at 5 failures won't trip because requests are succeeding (slowly), not failing. Pippen identifies that slow-but-successful calls won't trigger the circuit breaker — the circuit breaker is not protecting against latency degradation.
  - Scenario D: Stripe requests fail fast (connection refused / timeout if network is partitioned). Circuit breaker trips after 5 failures. After tripping, subsequent requests fail fast (no 10s wait). Service should recover quickly when network restores. This is the best-handled scenario.
  - Verdict: Service is NOT resilience-ready for Scenarios A, B, and C without changes.

failure_modes: |
  - Assessing each scenario as "will cause failures" without predicting the specific failure mode
  - Missing that Scenario C (slow but successful) will not trip the circuit breaker
  - Missing the connection pool math for Scenario B (20 workers, 10 connections = contention under load)
  - Treating Scenario D as catastrophic when the circuit breaker handles it well
  - Not providing specific resilience improvements for each scenario

scoring_rubric: |
  pass:
    - Scenario A: no circuit breaker = sustained 2s timeout degradation, specific fix recommended
    - Scenario B: connection pool math showing contention at load, burst of 500 errors predicted
    - Scenario C: slow-but-successful calls don't trip circuit breaker identified as a resilience gap
    - Scenario D: circuit breaker correctly assessed as effective for this case
    - Specific improvements for each failing scenario
    - Verdict: NOT resilience-ready for A, B, C

  partial:
    - Three of four scenarios assessed correctly
    - Scenario C circuit breaker gap identified or Scenario B math done, but not both
    - Specific improvements present

  fail:
    - All scenarios assessed as "will cause failures" without differentiating severity
    - Scenario C circuit breaker gap not identified
    - Scenario D treated as equally bad as A/B/C
    - No connection pool math for Scenario B
