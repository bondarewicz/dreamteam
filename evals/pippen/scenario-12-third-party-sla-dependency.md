# Eval: Pippen — Scenario 12 — Third-Party SLA Dependency Risk (Hard)

## Overview

Tests Pippen's ability to identify when a service's operational readiness is critically dependent on a third-party SLA that has not been validated, and to escalate rather than assume the dependency meets requirements.

---

category: capability

prompt: |
  You are Pippen reviewing a "KYC verification service" before it ships to production. KYC (Know Your Customer) checks are required before a user can transact on the platform. The service calls an external KYC provider (Onfido) for identity verification.

  - The service calls Onfido's API synchronously during user onboarding
  - Onfido's documented SLA: 99.9% uptime, p99 response time: 3 seconds
  - The team has NOT set up a fallback or degraded mode for Onfido unavailability
  - The service blocks user registration until the KYC check completes
  - Timeout: 5s on Onfido API call
  - No circuit breaker on Onfido
  - If Onfido is down, user registration fails with a 503
  - Structured JSON logging, /health endpoint checking Onfido reachability, metrics: kyc_checks_total, kyc_duration_histogram
  - Rollback: redeploy previous image

  The team's internal SLA is 99.95% uptime. Onfido's SLA is 99.9%.

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies the SLA math problem: Onfido's 99.9% uptime = up to 8.76 hours of downtime per year. The team's 99.95% SLA = max 4.38 hours of downtime per year. A hard dependency on a lower-SLA third party makes the team's SLA mathematically impossible to meet.
  - Pippen recommends either: (1) async KYC with users allowed to continue with restrictions while verification is pending, (2) a fallback mode when Onfido is unavailable (queue the check for retry), or (3) accept the SLA dependency and adjust the external SLA commitment
  - Pippen flags the missing circuit breaker on Onfido: without it, slow Onfido responses will exhaust the thread pool
  - Pippen notes that the /health endpoint checking Onfido means health will show unhealthy when Onfido is down — this may cause orchestrators to restart the service unnecessarily
  - Verdict: NOT READY or READY WITH CAVEATS — SLA math is a business/operational decision that must be resolved

failure_modes: |
  - Approving because observability signals are present
  - Missing the SLA math (team SLA > third-party SLA = impossible to meet)
  - Not recommending async KYC or fallback mode
  - Not flagging the circuit breaker gap
  - Missing the health check / Onfido dependency problem

scoring_rubric: |
  pass:
    - SLA math identified: 99.9% Onfido dependency makes 99.95% team SLA unachievable
    - At least two mitigation options recommended (async KYC, fallback mode, SLA revision)
    - Circuit breaker gap on Onfido identified
    - Health endpoint / Onfido coupling issue identified
    - Verdict is NOT READY or READY WITH CAVEATS with escalation to product for SLA decision

  partial:
    - SLA math identified but mitigation options sparse
    - Circuit breaker gap identified but health check issue missed
    - Verdict correct

  fail:
    - SLA math not identified
    - Verdict is READY
    - Circuit breaker and health check issues both missed
    - No mitigation options
