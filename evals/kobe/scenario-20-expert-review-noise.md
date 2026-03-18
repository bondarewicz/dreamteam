# Eval: Kobe — Scenario 20 — Expert Review: Separating Signal from Noise (Expert)

## Overview

Expert-level: Kobe is given code with one genuine Critical finding buried among many apparent issues that are actually fine in context. Tests whether Kobe can separate real risk from noise and not be distracted by surface-level concerns.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: critical_findings
    min_items: 1
    max_items: 3
  - type: json_field
    path: production_readiness.safe_to_deploy
    equals: false

prompt: |
  Review the following TypeScript refund processing endpoint:

  ```typescript
  // This service runs as an internal-only microservice (not publicly exposed)
  // All callers are other internal services authenticated via mTLS
  // The req.user.role is set by the API gateway before this service is called

  app.post('/internal/refunds', async (req: Request, res: Response) => {
    const { orderId, amount, reason } = req.body;

    // Log request for audit
    console.log(`Refund request: ${orderId} $${amount} by ${req.user.role}`);

    // Only refund processors can issue refunds
    if (req.user.role !== 'refund_processor') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Fetch the original order
    const order = await db.orders.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Process the refund
    await paymentGateway.refund(order.paymentIntentId, amount);

    // Record in database
    await db.refunds.create({
      orderId,
      amount,
      reason,
      processedBy: req.user.id,
      processedAt: new Date()
    });

    res.json({ success: true });
  });
  ```

  Produce your full output schema.

expected_behavior: |
  - The genuine Critical finding: there is no check that `amount` does not exceed the original order amount. A refund processor can issue a refund for $1,000,000 on a $50 order. The `amount` comes directly from the request body with no validation against the original order's payment amount.
  - All of the following are NOT actual critical issues in this context:
    - `console.log` with amount — this is an internal service; logging is appropriate for audit
    - Authorization check is after request body parse — this is fine in internal services; auth is handled by mTLS + gateway
    - `req.user.role` is set by gateway — acceptable for internal service with documented architecture
    - No input sanitization on `reason` — for an internal service, this is lower priority
    - No rate limiting — internal services rely on caller control
  - Kobe correctly identifies the ONE real critical issue (no refund amount cap vs. original order) and does NOT pad with false positives from the "apparent issues" list
  - safe_to_deploy false due to the uncapped refund amount
  - Kobe's findings demonstrate signal-to-noise discipline: 1 critical, 0-1 suggestions, no invented risks

failure_modes: |
  - Missing the uncapped refund amount as the Critical finding
  - Inventing critical issues for logging, internal auth model, or role-based auth (which are fine in context)
  - Padding the review with 5+ findings when only 1 is genuinely critical
  - safe_to_deploy true (the uncapped amount is a real financial risk)
  - Flagging the internal service architecture as insecure without understanding the mTLS context

scoring_rubric: |
  pass:
    - Uncapped refund amount identified as the Critical finding
    - 0 invented critical findings for logging, auth model, or internal service patterns
    - At most 1-2 total non-Critical findings (which are arguable)
    - safe_to_deploy false
    - Review demonstrates restraint and signal-to-noise discipline

  partial:
    - Uncapped amount identified as Critical
    - 1-2 minor false positives at Important level but not Critical
    - safe_to_deploy false

  fail:
    - Uncapped amount not identified
    - Multiple invented Critical findings for non-issues
    - safe_to_deploy true
    - Review is padded with low-quality findings to appear thorough
