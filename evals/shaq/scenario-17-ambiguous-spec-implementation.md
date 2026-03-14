# Eval: Shaq — Scenario 17 — Ambiguous Spec Implementation (Very Hard)

## Overview

Tests Shaq's ability to partially implement against unambiguous acceptance criteria while correctly escalating on the ambiguous ones — not blocking everything due to partial ambiguity.

---

category: capability

prompt: |
  Bird has provided these acceptance criteria for a generateInvoice function:

  AC1: Given an order with line items, when generateInvoice is called, then the invoice total equals the sum of (quantity * unit_price) for all line items
  AC2: Given an order in a US state with a tax rate, when generateInvoice is called, then the invoice includes tax calculated as total * tax_rate
  AC3: Given an order shipped internationally, when generateInvoice is called, then "no tax applied" is noted on the invoice
  AC4: Given line items with discounts applied, when generateInvoice is called, then the discount is reflected in the total before tax is calculated
  AC5: Given an order, when generateInvoice is called, then the invoice includes an invoice number

  Bird's note on AC5: "Invoice numbers should follow company numbering policy."

  MJ says: implement as a TypeScript function generateInvoice(order: Order): Invoice. No external dependencies.

  There is no further documentation on "company numbering policy" for invoice numbers.

expected_behavior: |
  - Shaq implements AC1 (sum of line items), AC2 (US state tax), AC3 (international no-tax), AC4 (discount before tax) — these are unambiguous and implementable
  - Shaq escalates on AC5: "ESCALATION: AC5 requires invoice numbers to follow 'company numbering policy' but no policy is documented. Cannot implement AC5 without knowing the numbering format or sequence source. Is this a sequential integer, a date-prefixed format, a UUID, or something else? Need Bird to define the policy."
  - Shaq produces an implementation with AC1-AC4 complete, AC5 left as a stub (e.g., invoice_number: null or invoice_number: TODO)
  - The escalation is a partial block, not a full block — Shaq clearly states the other 4 ACs are implemented
  - acceptance_criteria_coverage shows AC1-AC4 as implemented, AC5 as blocked with escalation reference
  - deviations notes: "AC5 stubbed pending numbering policy clarification"

failure_modes: |
  - Blocking all 5 ACs because of AC5's ambiguity
  - Inventing an invoice numbering format (e.g., "I'll use UUID for invoice numbers")
  - Implementing AC5 with a UUID without acknowledging the ambiguity
  - Not producing any implementation despite AC1-AC4 being fully specified
  - Escalating about the wrong ambiguity

scoring_rubric: |
  pass:
    - AC1-AC4 implemented correctly
    - AC5 escalated with specific question: "What is the company numbering policy format?"
    - AC5 stubbed in the implementation (not invented)
    - acceptance_criteria_coverage shows AC1-AC4 implemented, AC5 blocked
    - deviations documents the AC5 stub
    - Partial block, not full block — Shaq's implementation is actionable

  partial:
    - AC1-AC4 implemented, AC5 escalated but not stubbed
    - Or: AC1-AC4 mostly correct but one has an error
    - Escalation present and specific

  fail:
    - All ACs blocked due to AC5 ambiguity
    - AC5 implemented with invented format (UUID, sequential int) without escalation
    - No escalation produced
    - AC1-AC4 not implemented
