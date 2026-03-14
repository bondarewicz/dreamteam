# Eval: Magic — Scenario 07 — Three-Agent Synthesis (Medium)

## Overview

Tests Magic's ability to synthesize three complete agent outputs — Bird, MJ, and Pippen — into a coherent handoff brief that preserves domain rules, architecture decisions, and operational requirements without losing any input.

---

category: capability

prompt: |
  Bird produced this domain analysis for a "price recalculation" feature:
  - Domain rule: The final price is base price minus applicable discounts, floored at $0.01 (price cannot be zero or negative)
  - Domain rule: Bulk discounts apply when quantity >= 10 (10% off)
  - Acceptance criterion AC1: Given quantity=10 and base price=$5.00, when recalculate is called, then final price=$4.50
  - Acceptance criterion AC2: Given quantity=9 and base price=$5.00, when recalculate is called, then final price=$5.00 (no discount)
  - Acceptance criterion AC3: Given a discount that would reduce price to $0.00, then final price is $0.01

  MJ produced this architecture summary:
  - Implement recalculatePrice(quantity: number, basePrice: number): number in a pure TypeScript function
  - No external dependencies
  - The function should be stateless and deterministic

  Pippen produced this operational note:
  - The recalculatePrice function will be called from a high-traffic pricing endpoint (estimated 500 req/sec peak)
  - No external calls or I/O — acceptable for inline execution
  - A unit test suite is required; no integration tests needed for a pure function
  - Add JSDoc comment documenting the $0.01 floor behavior for on-call engineers

  Produce a handoff brief for Shaq.

expected_behavior: |
  - handoff_brief includes all four sources: Bird's domain rules and ACs, MJ's architecture, Pippen's operational notes
  - domain_rules section preserves both rules: floor at $0.01, bulk discount at quantity >= 10
  - All 3 ACs preserved with exact values
  - architecture_guidance specifies the TypeScript function signature and stateless constraint
  - operational_notes section (or equivalent) includes: high-traffic context, JSDoc requirement, unit tests only
  - Pippen's note about JSDoc documenting the $0.01 floor is passed to Shaq as an explicit requirement (not optional)
  - No invented information from any source

failure_modes: |
  - Omitting Pippen's operational notes entirely (only synthesizing Bird + MJ)
  - Treating the JSDoc requirement as optional ("nice to have")
  - Losing AC3 (the $0.01 floor case which is the hardest edge case)
  - Dropping the exact quantity boundary (>= 10) and replacing with "large orders"
  - Merging Bird's floor rule into the architecture section without labeling it as a domain invariant

scoring_rubric: |
  pass:
    - All three input sources represented in the brief
    - All 3 ACs present with exact values
    - Pippen's operational notes explicitly included (JSDoc requirement, high-traffic context, unit tests only)
    - $0.01 floor labeled as a domain invariant
    - Quantity boundary >= 10 preserved exactly

  partial:
    - Bird and MJ synthesized but Pippen's notes partially included
    - ACs present but one edge case (AC3) missing
    - JSDoc mentioned but not marked as explicit requirement

  fail:
    - Pippen's output absent from brief
    - AC3 (floor case) missing
    - JSDoc absent or listed as optional
    - Quantity boundary imprecise
