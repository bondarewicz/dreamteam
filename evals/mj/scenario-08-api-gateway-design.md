# Eval: MJ — Scenario 08 — API Gateway Design (Capability)

## Overview

Tests MJ's ability to design an API gateway layer including authentication, rate limiting, and routing — identifying the gateway's responsibilities versus what should remain in downstream services.

---

category: capability

graders:
  - type: contains
    values: ["API gateway", "rate limit", "authentication", "trade_off", "risk"]
  - type: section_present
    sections: ["trade_offs", "risks", "implementation_guidance"]
  - type: length_bounds
    min: 500
    max: 8000

prompt: |
  A logistics platform exposes APIs to three types of consumers:
  1. Mobile app (customer-facing): needs authentication, rate limiting (100 req/min per user)
  2. Partner integrations (B2B): needs API key authentication, higher rate limits (1,000 req/min per partner), webhook delivery
  3. Internal services: no authentication needed but must be isolated from external traffic

  The current setup has no API gateway — each service handles auth and rate limiting independently. The team has inconsistent auth implementations across services.

  Design the API gateway architecture. Use your full output schema.

expected_behavior: |
  - MJ recommends an API gateway handling: authentication (JWT for mobile, API key for partners), rate limiting per consumer type, routing to downstream services
  - MJ correctly identifies that internal service traffic should bypass the gateway or use a separate internal gateway (not share the public gateway)
  - trade_offs: gateway as a potential single point of failure; operational overhead of gateway configuration; latency added per hop (typically 1-5ms)
  - MJ identifies what must NOT be in the gateway: business logic, data transformation beyond minor field mapping, complex authorization rules (these belong in downstream services)
  - risks: gateway misconfiguration exposing internal services; gateway becoming a bottleneck under high load; vendor lock-in if using a managed gateway service
  - flexibility_points: adding new consumer types or rate limit tiers without changing downstream services
  - rigidity_points: if the gateway routes by URL path, renaming service endpoints requires gateway config changes
  - implementation_guidance addresses: technology options (Kong, AWS API Gateway, nginx with lua, custom); recommendation based on team size/complexity

failure_modes: |
  - Putting business logic in the gateway
  - Not separating internal service traffic from external
  - Missing gateway as a single point of failure risk
  - Recommending a specific commercial product without discussing the build vs. buy trade-off
  - Failing to address the webhook delivery requirement for partner integrations

scoring_rubric: |
  pass:
    - Authentication per consumer type designed correctly
    - Internal traffic separation addressed
    - Business logic explicitly excluded from gateway
    - SPOF risk identified
    - Webhook delivery for partners addressed
    - flexibility_points and rigidity_points present
    - Technology recommendation with build/buy consideration

  partial:
    - Auth and rate limiting correctly designed
    - Internal traffic separation mentioned but not fully designed
    - SPOF mentioned
    - Webhook requirement addressed
    - Technology guidance vague

  fail:
    - Business logic placed in gateway
    - No separation of internal traffic
    - SPOF not mentioned
    - Webhook requirement ignored
    - No implementation guidance
