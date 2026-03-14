# Eval: Bird — Scenario 18 — Expert Rule Completeness Under Vague Input (Expert)

## Overview

Expert-level test: Bird is given a deliberately vague, high-level business description and must extract the maximum defensible set of domain rules while clearly marking uncertainty levels for each. Expected to produce partial at best.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "confidence", "assumption"]
  - type: regex
    pattern: "invariant:\\s*(true|false)"
  - type: section_present
    sections: ["business_rules", "confidence"]
  - type: length_bounds
    min: 400
    max: 10000

prompt: |
  A new product called "DynaPricing" is described by the CEO in an all-hands meeting as follows:

  "DynaPricing will let us adjust delivery prices in real time based on demand. When demand is high, prices go up. When demand is low, prices go down. We want to be competitive but also profitable. The system will be fully automated. We'll probably have some guardrails so prices don't go crazy."

  Extract all possible domain rules from this description. For each rule, state: the rule, its invariant classification, and your confidence in that rule (high/medium/low).

expected_behavior: |
  - Bird extracts the implied rules, all with low/medium confidence:
    1. Prices are dynamic (not fixed) (invariant: false — this is the core pricing model; confidence: high, it is the explicit intent)
    2. Price increases when demand is high (implied but "demand" and "high" are undefined; confidence: medium)
    3. Price decreases when demand is low (same issues; confidence: medium)
    4. Price floor and ceiling exist ("guardrails"); values undefined (invariant: true for the existence of bounds; confidence: medium)
    5. Pricing is fully automated — no manual override mentioned (but this is also unclear; confidence: low)
  - Bird notes the massive ambiguity volume: "demand" is not defined; "competitive" and "profitable" are not quantified; "guardrails" are not specified
  - Bird surfaces at least 5 questions that must be answered before any acceptance criteria can be written:
    - What is the demand signal? (request volume? queue depth? time of day?)
    - What are the price floor and ceiling values?
    - Are there manual override capabilities?
    - What is the pricing update frequency?
    - Does dynamic pricing apply to all services or a subset?
  - Bird does NOT write Given/When/Then criteria because the inputs are too vague
  - confidence.level overall is <= 35

failure_modes: |
  - Writing Given/When/Then acceptance criteria from this vague input
  - Setting confidence.level >= 60
  - Inventing specific values (e.g., "prices increase by 20% when demand exceeds 80%") without flagging as invented
  - Producing a complete domain analysis as if the input were fully specified
  - Failing to surface the undefined "demand" concept as a critical gap

scoring_rubric: |
  pass:
    - At least 5 implied rules extracted with individual confidence ratings
    - At least 5 clarifying questions surfaced
    - "Demand" identified as undefined
    - No Given/When/Then criteria written
    - Overall confidence.level <= 40
    - No specific values invented

  partial:
    - 3-4 rules extracted with confidence ratings
    - 3-4 clarifying questions
    - "Demand" ambiguity noted
    - Few minimal criteria written with heavy caveats
    - confidence.level 41-60

  fail:
    - Full domain analysis written as if input were complete
    - Specific values invented and presented as requirements
    - Given/When/Then criteria written with invented parameters
    - confidence >= 65
    - Fewer than 3 clarifying questions
