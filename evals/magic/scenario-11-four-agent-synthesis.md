# Eval: Magic — Scenario 11 — Four-Agent Synthesis (Hard)

## Overview

Tests Magic's ability to synthesize outputs from all four peer agents (Bird, MJ, Pippen, Kobe) into a single coherent handoff brief, preserving each agent's distinct contribution without losing or conflating information.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: handoff_brief.domain_rules
    min_items: 1

prompt: |
  Four agents have submitted outputs for the "rate limiting" feature.

  Bird (domain analysis):
  - Domain rule: API rate limit is 100 requests per 60-second rolling window per API key
  - Domain rule: Exceeding the limit returns HTTP 429 with a Retry-After header indicating seconds until the window resets
  - AC1: Given 100 requests in 60 seconds, the 101st request returns 429 with Retry-After header
  - AC2: Given 60 seconds have elapsed since the first request in the window, the limit resets and the next request succeeds

  MJ (architecture):
  - Implement rate limiting using a sliding window counter in Redis
  - Key pattern: rate_limit:{api_key}:{window_start_unix}
  - Each key has a TTL of 60 seconds
  - The middleware will run before all authenticated routes

  Pippen (operational readiness):
  - Redis availability is critical — rate limiter must fail open (allow requests) if Redis is unavailable
  - Add metric: rate_limit_exceeded_total (counter) and redis_unavailable_total (counter)
  - The Retry-After value must be computed as TTL of the current window key, not a fixed value

  Kobe (code review):
  - Reviewed MJ's sliding window design: the key pattern uses window_start_unix which could allow a burst at the window boundary — recommend using a true sliding window with sorted sets instead
  - Flagged that the "fail open" behavior from Pippen must be explicitly tested

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Brief includes contributions from all four agents with clear attribution
  - domain_rules section: rate limit parameters (100 req/60s), 429 response with Retry-After
  - architecture_guidance section: Redis sliding window, key pattern, TTL, middleware placement
  - operational_notes section: fail-open behavior, two required metrics, dynamic Retry-After computation
  - review_notes section (or equivalent): Kobe's concern about window boundary burst, recommendation for sorted set approach, and the requirement to explicitly test fail-open
  - Shaq is given a clear implementation task with all four perspectives integrated
  - Kobe's sorted set recommendation is framed as a recommendation, not as a mandate (Magic preserves the distinction between MJ's decision and Kobe's suggestion)

failure_modes: |
  - Omitting Kobe's review notes entirely
  - Conflating Kobe's recommendation with MJ's architecture decision (presenting sorted sets as the chosen approach when MJ chose sliding window counter)
  - Losing Pippen's fail-open requirement
  - Losing the dynamic Retry-After computation requirement
  - Dropping AC2 (window reset case)

scoring_rubric: |
  pass:
    - All four agents' contributions represented with attribution
    - Kobe's sorted set recommendation present and labeled as a recommendation, not the chosen approach
    - Pippen's fail-open behavior and both metrics included
    - Dynamic Retry-After computation explicitly stated
    - Both ACs present with correct values
    - Review notes distinct from architecture guidance

  partial:
    - Three of four agents' contributions present
    - Kobe's recommendation present but conflated with MJ's decision
    - ACs present but one missing or imprecise

  fail:
    - Two or more agents' contributions missing
    - Kobe's notes absent
    - Fail-open behavior absent
    - ACs absent or incorrect
