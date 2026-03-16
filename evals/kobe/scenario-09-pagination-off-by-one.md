# Eval: Kobe — Scenario 09 — Pagination Off-by-One (Hard)

## Overview

Tests Kobe's ability to identify a subtle off-by-one error in pagination that would cause the last item of each page to be silently skipped in some query configurations.

---

category: capability

graders:
  - type: contains
    values: ["off-by-one", "pagination", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: length_bounds
    min: 200

prompt: |
  Review the following TypeScript pagination implementation for an order history endpoint:

  ```typescript
  async function getOrderHistory(
    customerId: string,
    page: number,
    pageSize: number
  ): Promise<Order[]> {
    const offset = page * pageSize;
    const orders = await db.query(
      `SELECT * FROM orders
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, pageSize, offset]
    );
    return orders;
  }
  ```

  The API documentation states that pages are 1-indexed (page=1 is the first page).

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the off-by-one: the offset is calculated as `page * pageSize`, but if the API is 1-indexed (page=1 is the first page), then page=1 should give offset=0. The current formula gives page=1 -> offset=pageSize, which skips the first page of results entirely. Page 1 returns the same data as what should be page 2.
  - This is an Important or Critical finding: customers using page=1 never see their most recent orders; results are off by exactly one page for every query.
  - Fix: `const offset = (page - 1) * pageSize;`
  - Kobe may note a secondary finding: no validation that `page >= 1` or `pageSize > 0` — a caller sending page=0 or page=-1 would produce a negative offset (which PostgreSQL treats as 0, but this is a silent edge case).
  - safe_to_deploy false
  - confidence.level >= 80

failure_modes: |
  - Not identifying the off-by-one (missing the 1-indexed API contract vs. the 0-indexed formula)
  - Identifying an off-by-one but in the wrong direction (saying page=0 is the issue when the spec says 1-indexed)
  - Classifying as Suggestion instead of Important/Critical
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - Off-by-one identified correctly (1-indexed API with 0-indexed formula)
    - Correct fix stated: (page - 1) * pageSize
    - Severity is Important or Critical
    - safe_to_deploy false
    - Input validation gap (page < 1) noted as secondary finding

  partial:
    - Off-by-one identified but fix is approximate
    - Correct direction of the error
    - safe_to_deploy false

  fail:
    - Off-by-one not identified
    - safe_to_deploy true
    - Only style/type annotation findings produced
    - Wrong direction of error
