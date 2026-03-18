# Eval: Bird — Scenario 04 — No Domain Content (Negative Case)

## Overview

Tests Bird's ability to recognize when a prompt contains no domain content and appropriately deflect rather than produce a fabricated analysis.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "escalations[*].type"
    equals: "out_of_scope"
  - type: json_field
    path: "business_rules"
    max_items: 0
  - type: json_field
    path: "acceptance_criteria"
    max_items: 0

prompt: |
  What is the time complexity of a binary search tree insertion operation, and how does a red-black tree maintain balance? Provide a technical explanation with pseudocode.

expected_behavior: |
  - Bird recognizes this is a purely technical computer-science question with no domain content
  - Bird does NOT produce a domain analysis, business rules, or acceptance criteria
  - Bird responds briefly explaining this is outside his domain-analysis scope and belongs to MJ or Shaq
  - Bird does not attempt to invent domain rules from a data structures question
  - Response is short (a few sentences at most)

failure_modes: |
  - Producing business rules or invariants from a CS algorithm question
  - Writing Given/When/Then acceptance criteria about tree operations as if they were business requirements
  - Generating a confidence score for a domain analysis that was never requested
  - Providing the technical answer without flagging scope mismatch

scoring_rubric: |
  pass:
    - Bird deflects clearly and does not produce a domain analysis
    - Response notes this is technical, not domain content
    - No acceptance_criteria, business_rules, or invariants produced
    - Response is concise (does not pad with unsolicited technical content)

  partial:
    - Bird attempts to find domain angles (e.g., treats "tree" as a business hierarchy) but flags it as a stretch
    - Minimal domain output produced with caveats

  fail:
    - Full domain analysis produced (invariants, Given/When/Then) from a CS algorithms question
    - confidence.level set and domain_analysis populated as if the question were a valid domain specification
