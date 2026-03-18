# Eval: Pippen — Scenario 19 — Security-Operational Gap (Expert)

## Overview

Tests Pippen's ability to identify operational security gaps — specifically, configurations that are fine for development but create security or compliance risks in production, which are within Pippen's operational readiness scope even if they are not purely observability issues.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing an "admin API" service before it ships to production. The admin API allows internal employees to manage user accounts, view transaction history, and issue manual refunds.

  - Authentication: Bearer token, validated against an internal identity provider
  - Authorization: All authenticated requests have full access to all admin operations — no role-based access control (RBAC)
  - Audit logging: logs "Admin action performed" with timestamp and actor_id, but does NOT log which specific operation was performed or which user was affected
  - Rate limiting: none
  - PII in logs: the full transaction record (including customer name, address, card last 4) is logged on every transaction lookup
  - Health check: /health returns 200 always
  - Metrics: requests_total, request_duration_histogram
  - Error handling: unhandled exceptions return a 500 with a full Java stack trace in the response body
  - The API is accessible from the public internet (not VPN-only)

  Assess operational readiness from Pippen's perspective.

expected_behavior: |
  - Pippen identifies the audit log gap as a compliance risk: logging "admin action performed" without specifying the operation or affected entity makes audit trails useless for compliance investigations
  - Pippen flags that PII (customer name, address, card last 4) in logs creates a data exposure risk — log aggregators become a PII store which may violate retention policies
  - Pippen flags that full stack traces in 500 responses expose internal implementation details and can assist attackers
  - Pippen flags that no rate limiting on an admin API exposed to the public internet is a brute-force / credential stuffing risk
  - Pippen notes the stub /health endpoint (always returns 200) as a gap
  - Pippen escalates the public internet exposure as an infrastructure concern: an admin API should typically be VPN-only or require additional network-level controls — this requires a decision beyond Pippen's authority
  - Verdict: NOT READY — multiple operational security gaps are blockers

failure_modes: |
  - Approving because authentication exists
  - Missing the audit log gap (logging action without operation or affected entity)
  - Missing the PII-in-logs risk
  - Not flagging stack traces in 500 responses
  - Not escalating the public internet exposure as requiring an infrastructure decision
  - Treating all gaps as Pippen's call to mandate (e.g., mandating RBAC when that is a product/security team decision)

scoring_rubric: |
  pass:
    - Audit log gap identified: operation and affected entity not logged
    - PII-in-logs risk identified
    - Stack trace in 500 responses identified as information disclosure
    - Rate limiting absence on public-facing admin API identified
    - Public internet exposure escalated (not unilaterally mandated by Pippen)
    - Verdict is NOT READY

  partial:
    - Three of five operational security gaps identified
    - Public internet exposure noted but not escalated appropriately
    - Verdict is NOT READY

  fail:
    - Verdict is READY because authentication exists
    - Audit log gap and PII-in-logs both missed
    - Stack trace risk not identified
    - Public internet exposure not flagged
