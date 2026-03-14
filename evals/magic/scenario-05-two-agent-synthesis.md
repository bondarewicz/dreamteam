# Eval: Magic — Scenario 05 — Two-Agent Synthesis (Medium)

## Overview

Tests Magic's ability to synthesize two agent outputs with clear, compatible content into a well-structured handoff brief. Both Bird and MJ have provided complete outputs with no contradictions.

---

category: regression

prompt: |
  Bird produced this domain analysis for a "loyalty points" feature:
  - Domain rule: A customer earns 1 point per dollar spent (rounded down to the nearest integer)
  - Domain rule: Points expire after 12 months of account inactivity (no purchase in 12 months)
  - Acceptance criterion AC1: Given a purchase of $47.80, when earnPoints is called, then 47 points are earned (floor rounding)
  - Acceptance criterion AC2: Given a purchase of $0.99, when earnPoints is called, then 0 points are earned
  - Acceptance criterion AC3: Given an account with no purchase in the last 12 months, when checkExpiry is called, then all points are marked expired

  MJ produced this architecture summary:
  - The loyalty points module will expose two functions: earnPoints(customerId, purchaseAmount) and checkExpiry(customerId)
  - earnPoints will use Math.floor for rounding
  - checkExpiry will compare last_purchase_date against the current date minus 365 days
  - No external dependencies; pure TypeScript functions in a loyalty.ts module

  Produce a handoff brief for Shaq.

expected_behavior: |
  - handoff_brief.recipient is "Shaq"
  - task_context summarizes the loyalty points feature: earning and expiry logic
  - domain_rules section contains both rules: 1 pt/dollar (floor rounded) and 12-month inactivity expiry
  - architecture_guidance contains: earnPoints and checkExpiry signatures, Math.floor usage, date comparison approach, file location (loyalty.ts)
  - acceptance_criteria preserves all three ACs with exact values ($47.80 -> 47, $0.99 -> 0, 12-month expiry)
  - terminology_alignment notes that Bird says "12 months of account inactivity" and MJ says "365 days" — Magic should flag whether these are equivalent or whether leap years matter
  - No information invented that was not in the source outputs

failure_modes: |
  - Dropping AC2 ($0.99 -> 0 points) which tests the floor edge case
  - Omitting the 365-day vs 12-months terminology note
  - Losing the "no purchase in 12 months" wording and replacing with vague "inactive accounts"
  - Inventing additional context (e.g., "points can be redeemed for discounts") not mentioned by either agent
  - Missing architecture details (e.g., not mentioning loyalty.ts as the target file)

scoring_rubric: |
  pass:
    - All three ACs present with exact values preserved
    - Both domain rules present
    - Both architecture functions referenced (earnPoints, checkExpiry) with implementation notes
    - 365-day vs 12-month terminology flagged even if not resolved
    - No invented information

  partial:
    - All three ACs present but exact values paraphrased loosely
    - One domain rule missing or imprecise
    - Terminology alignment absent but no fabricated content

  fail:
    - One or more ACs missing
    - Both domain rules absent or merged inaccurately
    - Architecture guidance missing function signatures
    - Invented domain rules or features added
