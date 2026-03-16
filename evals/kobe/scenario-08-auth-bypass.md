# Eval: Kobe — Scenario 08 — Authentication Bypass (Capability)

## Overview

Tests Kobe's ability to identify an authentication bypass vulnerability where the authorization check is performed after data access, allowing unauthorized data retrieval.

---

category: capability

graders:
  - type: contains
    values: ["auth", "Critical", "BLOCK", "bypass", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: field_count
    pattern: "(?i)(severity|critical).{0,20}(critical|severity)"
    min: 1
  - type: length_bounds
    min: 200

prompt: |
  Review the following TypeScript API handler for fetching an order:

  ```typescript
  async function getOrder(
    req: Request,
    res: Response
  ): Promise<void> {
    const orderId = req.params.orderId;
    const userId = req.user?.id;

    // Fetch the order first
    const order = await db.orders.findById(orderId);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // Check authorization
    if (order.customerId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(order);
  }
  ```

  This endpoint is public-facing. Produce your full output schema.

expected_behavior: |
  - Kobe identifies the primary Critical finding: `req.user?.id` uses optional chaining — if no authentication middleware is present (or if the middleware fails), `userId` will be `undefined`. An unauthenticated request will have `userId = undefined`. The authorization check `order.customerId !== userId` will be `order.customerId !== undefined`, which is always true, so the 403 will fire. BUT — the order is fetched from the database before the check. If the check returns 403 but the order was already read, this is a timing issue.
  - More critically: if `order.customerId` somehow equals `undefined` (e.g., a data entry error), the auth check passes and an unauthenticated user gets the order.
  - The real Critical finding: there is no explicit null/undefined check on `userId` before proceeding. If the auth middleware is misconfigured or skipped, an unauthenticated user can probe orders — even if they get 403, they can infer whether an orderId exists (no order = 404, forbidden order = 403, timing attack on data existence).
  - Kobe identifies the IDOR (Insecure Direct Object Reference) risk: the authorization is on customerId match, but there is no check that the orderId is valid before issuing 403 vs. 404 — this exposes order ID enumeration.
  - Fix: check that userId is not null/undefined before any database access; apply authorization before data retrieval
  - safe_to_deploy is false

failure_modes: |
  - Missing the undefined userId risk (optional chaining on req.user)
  - Not identifying the IDOR enumeration risk (403 vs. 404 leaks order existence)
  - Missing that authorization should happen before data access
  - Classifying these as Important rather than Critical for a public-facing auth endpoint
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - req.user?.id optional chaining risk identified (unauthenticated userId = undefined)
    - Authorization before data access principle stated
    - IDOR order enumeration risk noted
    - Critical severity and BLOCK verdict
    - safe_to_deploy false

  partial:
    - Auth bypass via undefined userId identified
    - Authorization order mentioned
    - IDOR not identified
    - Critical severity

  fail:
    - Auth bypass not identified
    - safe_to_deploy true
    - Only style findings produced
    - Not classified as Critical
