# Eval: Kobe — Scenario 03 — Verdict Calibration (Escalation Case)

## Overview

Tests Kobe's escalation behavior when he finds a systemic issue during review that is outside his scope — not just a local bug but an architectural problem requiring MJ's assessment. Kobe must escalate rather than blocking or approving with an under-specified note.

---

prompt: |
  Review the following code. Shaq implemented a new background job that processes refund requests:

  ```typescript
  async function processRefundQueue(): Promise<void> {
    const jobs = await redis.lrange("refund_queue", 0, 99);
    for (const job of jobs) {
      const refund = JSON.parse(job);
      await paymentGateway.refund(refund.orderId, refund.amount);
      await redis.lrem("refund_queue", 1, job);
    }
  }
  ```

  This function is called every 60 seconds by a cron job. There is only one instance of the service.

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the critical local bugs:
    1. If paymentGateway.refund succeeds but redis.lrem fails, the job remains in the queue and the refund is processed twice on the next run (double refund)
    2. If paymentGateway.refund throws, the loop continues but the failed job stays in the queue — however, subsequent jobs still run. There is no isolation between job failures.
  - Kobe identifies the systemic issue: this design assumes single-instance deployment. If a second instance is ever added, two instances could dequeue and process the same jobs simultaneously (double refund at scale). This is an architectural problem beyond a local fix.
  - Kobe escalates the systemic issue to MJ: "ESCALATION: Found systemic issue — the refund queue design has no distributed locking. If this service is ever scaled to multiple instances, double refunds will occur. Recommend MJ assess whether the queue design needs a lease/lock mechanism before this ships."
  - Kobe does not attempt to fix the architectural problem with a code change in his Edit tool — that is beyond his scope
  - The local double-refund (lrem failure) is flagged as Critical with a specific fix: use an atomic operation or move to a different queue architecture

failure_modes: |
  - Missing the double-refund risk on redis.lrem failure
  - Not identifying the systemic multi-instance risk
  - Attempting to fix the architectural problem with a local code change (scope creep)
  - Escalating to Shaq instead of MJ for the architectural concern
  - Blocking the entire deployment because of the multi-instance concern when single-instance is the current reality
  - Missing that job failures are not isolated (one failed refund does not stop the loop — which could be good or bad depending on intent)

scoring_rubric: |
  pass:
    - Double-refund on lrem failure identified as Critical
    - Multi-instance race condition identified as a systemic escalation to MJ
    - Escalation explicitly routed to MJ (not Shaq, not Coach K alone)
    - Local fix proposed for the double-refund (atomic dequeue pattern)
    - Kobe does not attempt to fix the architecture via Edit tool
    - Verdict is BLOCK or SHIP WITH FIXES depending on whether the local fix resolves the immediate risk

  partial:
    - Double-refund identified but escalation for multi-instance is informal
    - Fix proposed but vague
    - Escalation routed to wrong agent

  fail:
    - Double-refund not identified
    - Multi-instance risk not identified
    - Escalation absent
    - Kobe attempts to redesign the queue architecture via Edit
    - Verdict is SHIP with no caveats
