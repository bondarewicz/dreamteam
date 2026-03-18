# Eval: Bird — Scenario 16 — Cross-Domain Integration Rules (Very Hard)

## Overview

Tests Bird's ability to analyze a feature that requires two previously separate domain contexts to share state, and to identify the resulting data ownership and consistency questions.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 2
  - type: json_field
    path: "business_rules[*].invariant"
    type_check: "boolean"
  - type: json_field
    path: "business_rules[*].invariant_justification"
    type_check: "string"
  - type: json_field
    path: "escalations"
    min_items: 1
  - type: json_field
    path: "domain_analysis.bounded_context"
    type_check: "string"

prompt: |
  Two existing bounded contexts:

  Context A — Warehouse Management:
  - A Product has a StockLevel (integer, >= 0)
  - StockLevel decreases when items are picked for an order
  - StockLevel increases when items are received from suppliers
  - Invariant: StockLevel cannot go below 0

  Context B — Sales / Order Management:
  - An Order can contain multiple OrderLines
  - An OrderLine references a Product by ID and a Quantity
  - Orders are placed by customers without checking Context A

  New feature request: "When a customer places an order, we want to automatically block it if stock is insufficient. The sales team should see a 'stock available' indicator in real time."

  Analyze the domain implications of this integration.

expected_behavior: |
  - Bird identifies the core domain problem: Order Management currently has no dependency on Warehouse Management. Adding real-time stock checks creates a coupling between two previously independent contexts.
  - Bird identifies the data ownership question: Who owns the "available stock" concept? Currently Warehouse owns StockLevel. If Sales checks stock, does it read from Warehouse (cross-context read) or does Warehouse publish stock events for Sales to consume?
  - Bird identifies the consistency model question: If two customers place orders simultaneously for the last item, a real-time check at order placement does not guarantee stock will still be available when the order is processed — this is a classic TOCTOU (time-of-check-time-of-use) problem that Bird must flag for MJ
  - business_rules identifies:
    1. New cross-context invariant: Order cannot be confirmed if stock is insufficient (invariant: true for the integration)
    2. Stock reservation vs. stock check: does placing the order reserve stock, or only check it? (This is undefined and must be escalated)
  - Bird surfaces the missing rule: "Does placing an order reserve stock? Without a reservation mechanism, two simultaneous orders could both pass the stock check but only one can be fulfilled."
  - Escalation to MJ for the architectural question of how the contexts communicate

failure_modes: |
  - Treating this as a simple "add a stock check before order placement" with no context-coupling analysis
  - Missing the TOCTOU problem
  - Not identifying who owns the "available stock" concept
  - Not identifying that the current domain model has no stock reservation mechanism
  - Writing acceptance criteria that presuppose a reservation mechanism without flagging it's undefined

scoring_rubric: |
  pass:
    - Context coupling explicitly identified as a domain model change
    - Data ownership question raised (who owns "available stock")
    - TOCTOU/simultaneous-order race condition identified
    - Stock reservation vs. check distinction surfaced
    - Escalation to MJ for architectural coupling pattern
    - New cross-context invariant stated

  partial:
    - Context coupling noted
    - TOCTOU mentioned but not fully explained
    - Reservation question hinted at
    - MJ escalation informal

  fail:
    - Simple stock check implemented without coupling analysis
    - TOCTOU not identified
    - Data ownership not questioned
    - No escalation
    - Acceptance criteria written that silently resolve undefined questions
