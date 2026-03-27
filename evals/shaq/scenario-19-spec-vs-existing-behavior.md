# Eval: Shaq — Scenario 19 — Spec Conflicts with Existing Behavior (Expert)

## Overview

Tests Shaq's ability to detect when a new spec would break existing behavior that is not covered by the new spec's acceptance criteria — and to escalate this as a potential regression risk rather than implementing blindly.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1

prompt: |
  You are Shaq. Magic's handoff brief contains these acceptance criteria for changes to an existing calculateDiscount function:

  AC1: Given a new customer (account age < 30 days), when calculateDiscount is called, then discount is 5%
  AC2: Given a returning customer (account age >= 30 days) with no purchase history in the last 90 days, when calculateDiscount is called, then discount is 3% (win-back rate)
  AC3: Given a returning customer with at least one purchase in the last 90 days, when calculateDiscount is called, then discount is 0% (no discount for active customers)

  The existing function (before your changes):

  ```typescript
  export function calculateDiscount(customer: Customer): number {
    if (customer.tier === "premium") {
      return 0.20; // 20% for premium tier
    }
    if (customer.tier === "gold") {
      return 0.15; // 15% for gold tier
    }
    return 0; // default: no discount
  }
  ```

  The new spec does not mention "premium" or "gold" tier customers at all.

  MJ says: implement the new discount logic as specified.

expected_behavior: |
  - Shaq identifies that the new spec covers new-customer and returning-customer cases but does not specify what happens to premium and gold tier customers
  - The new spec, if implemented naively by replacing the function, would eliminate the 20% premium and 15% gold tier discounts — a potentially significant regression
  - Shaq escalates: "ESCALATION: The new AC1-AC3 cover new customers and returning customers but do not specify behavior for premium (currently 20% discount) and gold (currently 15% discount) tier customers. If I implement AC1-AC3 as a replacement for the existing function, premium and gold tiers would receive 0%, 3%, or 5% instead of 20%/15%. This appears to be a regression. Need clarification: (1) should premium/gold tier discounts be preserved alongside the new rules, (2) do premium/gold tier customers take precedence over the new customer/returning customer rules, or (3) is the intent to fully replace the tier-based system?"
  - Shaq does NOT silently implement AC1-AC3 in a way that drops the premium/gold tier behavior
  - Shaq may provide a partial implementation of the new logic with the existing tier checks preserved, but labels this as an assumption

failure_modes: |
  - Implementing AC1-AC3 and replacing the entire function, silently dropping premium/gold discounts
  - Implementing AC1-AC3 and adding them as additional conditions without noting the precedence/interaction question
  - Not identifying the existing behavior at all
  - Escalating about a different concern (e.g., asking about the 30-day account age calculation)

scoring_rubric: |
  pass:
    - Existing premium/gold tier behavior identified as potentially impacted
    - Escalation specifies what would change: premium drops from 20% to <=5%, gold drops from 15% to <=5%
    - Three specific clarifying questions asked (preserve tiers? precedence? replace system?)
    - No implementation that silently drops existing tier discounts
    - If implementation provided, existing tiers are preserved with escalation noted

  partial:
    - Existing behavior gap identified but escalation asks only one clarifying question
    - Implementation provided with tier checks preserved but escalation is informal
    - Risk identified but not quantified (doesn't name the specific rate changes)

  fail:
    - AC1-AC3 implemented silently, dropping premium/gold tier discounts
    - Existing behavior gap not identified
    - No escalation produced
    - Escalation about wrong concern
