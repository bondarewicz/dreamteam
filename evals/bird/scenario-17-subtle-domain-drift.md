# Eval: Bird — Scenario 17 — Subtle Domain Drift via Terminology Shift (Very Hard)

## Overview

Tests Bird's ability to detect that a feature description uses the same business terms as existing domain concepts but subtly changes their meaning, creating domain drift that would break existing invariants.

---

category: capability

graders:
  - type: contains
    values: ["domain drift", "terminolog", "invariant", "conflict"]
  - type: section_present
    sections: ["domain_analysis", "business_rules"]
  - type: length_bounds
    min: 400
    max: 8000

prompt: |
  Existing domain definition (established and in use):
  "A 'confirmed' order has been paid and is queued for fulfillment. A confirmed order is immutable."

  New feature request:
  "Add a 'confirmed' status to quotes. When a sales agent confirms a quote, it should move to 'confirmed' status, meaning the customer has verbally agreed to the terms but payment has not yet occurred."

  Analyze this feature request.

expected_behavior: |
  - Bird detects the domain drift: the term "confirmed" is being applied to a Quote with a different semantic meaning than in the Order domain — Quote "confirmed" means verbal agreement without payment, while Order "confirmed" means paid
  - Bird identifies this as a terminology collision: using the same status name with different semantic meanings in two contexts will cause confusion for developers, operators, and integration partners
  - Bird does NOT simply accept the new usage — he flags the risk: "The term 'confirmed' in the Order domain means 'paid and immutable.' Applying the same term to a Quote to mean 'verbal agreement, not yet paid' creates a domain terminology conflict. Developers and operators will use these concepts inconsistently."
  - Bird recommends that the Quote status be given a distinct name: "accepted" or "quote_accepted" rather than "confirmed"
  - Bird identifies that if the quote flows into an order, there must be a clear transition where Quote:confirmed becomes Order:pending (not Order:confirmed) — the payment step cannot be skipped
  - At least 2 Given/When/Then acceptance criteria for the transition from quote to order

failure_modes: |
  - Accepting "confirmed" for quotes without noting the terminology collision with Order "confirmed"
  - Writing acceptance criteria that allow a "confirmed" quote to become a "confirmed" order without a payment step
  - Not recommending a distinct name for the quote status
  - Missing the payment-step bypass risk in the order lifecycle

scoring_rubric: |
  pass:
    - Terminology collision identified explicitly
    - Recommendation for distinct name for quote status (e.g., "accepted")
    - Payment-bypass risk in quote-to-order flow identified
    - At least 2 Given/When/Then criteria for the quote-to-order transition
    - Domain drift clearly explained

  partial:
    - Collision mentioned but not deeply analyzed
    - Distinct name suggested but not explained why
    - Quote-to-order transition mentioned but incomplete

  fail:
    - "confirmed" accepted for quotes without any naming concern
    - No payment bypass risk identified
    - Acceptance criteria conflate the two uses of "confirmed"
    - No recommendation for distinct terminology
