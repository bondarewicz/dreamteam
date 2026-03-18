# Eval: Magic — Scenario 21 — Learning Review Structure (Happy Path / Regression)

## Overview

Tests that Magic produces all 6 required sections of a learning review when given a well-documented incident with complete agent outputs available. A cache invalidation change deployed by Shaq — reviewed and approved by Kobe — served stale product prices for 20 minutes. This is the baseline regression test: given a clean incident with no ambiguity, Magic must produce the full narrative structure correctly.

---

category: regression

graders:
  - type: contains
    values: ["Contributing Factors", "contributing factor"]
  - type: field_count
    pattern: "\\*\\*[A-Za-z]"
    min: 4
  - type: contains
    values: ["PREVENT", "DETECT"]
  - type: not_contains
    values: ["root cause"]
  - type: length_bounds
    min: 2000

prompt: |
  Produce a learning review for the following incident.

  **Incident summary**: On 2026-03-12, Shaq deployed a cache invalidation change to the product pricing service. The change was code-reviewed and approved by Kobe. A misconfigured TTL override in the new invalidation logic caused the Redis cache to retain stale price entries for products in the "seasonal" category. Customers purchasing seasonal items saw prices from the previous day's promotional batch. The issue affected 847 transactions over 20 minutes before Pippen's alerting picked up the price divergence anomaly and the deployment was rolled back.

  **Shaq's deployment notes**:
  "Deployed pricing-service v2.4.1 at 14:22 UTC. The PR changed how TTL is computed for category-specific cache entries. Instead of reading TTL from the category config, the new code passes TTL directly from the call site. I tested this in staging with the 'standard' category — seasonal products were not in the staging fixture set. Rollback completed at 14:42 UTC."

  **Kobe's review notes**:
  "Reviewed PR #1847. The TTL logic change looked correct for the standard product path. I verified the unit tests passed. The seasonal category has its own TTL override in CategoryConfig — I did not check whether the new call-site TTL pattern was wired to read that override. Approved."

  **Bird's domain notes (post-incident)**:
  "The seasonal pricing category has a domain rule: TTL must not exceed 15 minutes during active promotional windows. This rule exists because promotional prices are time-sensitive. This rule lives in the CategoryConfig enum but was not reflected in any acceptance criterion for the cache invalidation ticket. The ticket was scoped as a 'performance optimization' not a 'pricing rule change', so I was not consulted during spec."

  **Pippen's operational notes**:
  "Price divergence alert fired at 14:38 UTC — 16 minutes after deployment. Alert threshold is a 5% divergence between the pricing-service response and the source-of-truth price feed. The 20-minute window includes the 4 minutes between detection and completed rollback. We have no automated test that compares category-specific cache TTLs against the CategoryConfig domain rules."

  Produce a full learning review for this incident.

expected_behavior: |
  - All 6 sections present: Situation Snapshot, The Timeline as It Was Lived, Contributing Factors, What We Learned, Forward Commitments, Preserving the Learning
  - Situation Snapshot: 2-4 sentences covering goal (cache perf optimization), who was involved (Shaq, Kobe, Pippen, Bird), impact (847 transactions, 20 minutes, stale seasonal prices)
  - Timeline: reconstructed in experienced order — ticket scoped without Bird, Shaq tests staging with wrong fixture, Kobe reviews without checking seasonal TTL override, deployment, detection at 14:38, rollback at 14:42
  - Contributing Factors: at least 4 separate factors — (1) staging fixture missing seasonal products, (2) ticket scoped as perf optimization excluding Bird, (3) CategoryConfig TTL rule not reflected in acceptance criteria, (4) no automated test for category TTL compliance, (5) Kobe's review scope did not cover alternate category paths
  - What We Learned: at least 2 learnings in "We now know that X, which means Y" format
  - Forward Commitments: at least 3 actions with type tags (PREVENT, DETECT, MITIGATE, or PROCESS) and named owners
  - Preserving the Learning: names at least one concrete artifact (e.g., acceptance criterion template for cache changes, domain rule added to Bird's model, Kobe review checklist item for TTL compliance)
  - "root cause" (singular) does NOT appear — multiple contributing factors used instead
  - Tone is curious and non-prosecutorial — Shaq, Kobe, Bird actions described as reasonable given their information

failure_modes: |
  - Any of the 6 required sections missing
  - "root cause" appears (singular root cause framing)
  - What We Learned section uses "what went wrong" framing instead of durable insight format
  - Forward Commitments are vague (e.g., "be more careful with cache changes") with no owner or type tag
  - Tone is accusatory toward Shaq or Kobe
  - Staging fixture gap mentioned but not identified as a contributing factor
  - Bird's non-involvement treated as negligence rather than a scoping decision
  - "We now know" format not used in What We Learned section
  - Preserving the Learning is generic ("write better tests") with no named artifact or owner

scoring_rubric: |
  pass:
    - All 6 sections present
    - At least 4 contributing factors identified separately
    - At least 2 learnings in "We now know that X, which means Y" format
    - At least 3 forward commitments with type tags and named owners
    - At least 1 concrete artifact named in Preserving the Learning
    - "root cause" (singular) absent
    - Tone is non-prosecutorial throughout

  partial:
    - 5 of 6 sections present
    - Fewer than 4 contributing factors, or factors listed as a single paragraph rather than separately
    - "We now know" format used but fewer than 2 learnings
    - Forward commitments present but missing type tags or owners
    - Preserving the Learning present but generic

  fail:
    - Fewer than 5 sections present
    - "root cause" (singular) appears
    - What We Learned absent or uses "what went wrong" framing
    - Forward Commitments absent or entirely vague
    - Tone is accusatory toward any named agent
