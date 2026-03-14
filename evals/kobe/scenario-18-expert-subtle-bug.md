# Eval: Kobe — Scenario 18 — Expert Subtle Bug: Event Loop Blocking (Expert)

## Overview

Expert-level: Tests Kobe's ability to identify a subtle Node.js event loop blocking issue that would cause severe latency spikes under load, not a crash.

---

category: capability

graders:
  - type: contains
    values: ["event loop", "blocking", "safe_to_deploy"]
  - type: section_present
    sections: ["production_readiness"]
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  Review the following Node.js TypeScript endpoint that processes webhook events from the carrier API:

  ```typescript
  app.post('/webhooks/carrier', async (req, res) => {
    // Acknowledge webhook immediately
    res.status(200).send('OK');

    // Process the event
    const event = req.body;
    const deliveries = await db.deliveries.findByTrackingNumber(event.trackingNumber);

    // Build a lookup map for fast access
    const deliveryMap: Record<string, Delivery> = {};
    for (const delivery of deliveries) {
      deliveryMap[delivery.trackingNumber] = delivery;
    }

    // Parse and validate the carrier's XML payload synchronously
    const xmlData = event.rawXmlPayload; // Could be up to 2MB
    const parsed = parseXmlSync(xmlData); // Synchronous XML parsing

    // Update all matching deliveries
    for (const update of parsed.updates) {
      const delivery = deliveryMap[update.trackingNumber];
      if (delivery) {
        await db.deliveries.updateStatus(delivery.id, update.status);
      }
    }
  });
  ```

  This endpoint receives up to 200 webhooks/minute during peak hours. Produce your full output schema.

expected_behavior: |
  - Kobe identifies `parseXmlSync(xmlData)` as a Critical finding: synchronous XML parsing of payloads up to 2MB blocks the Node.js event loop. During the synchronous parsing (which may take tens to hundreds of milliseconds for 2MB), the entire Node.js process cannot handle any other requests. At 200 webhooks/minute, this creates a continuous series of event loop blocks, causing severe latency spikes for all other concurrent requests.
  - Fix: replace with async XML parsing (`await parseXml(xmlData)`)
  - Kobe identifies a secondary design issue: the webhook response is sent before processing is complete (`res.status(200).send('OK')` at the top). If the processing throws after the response, the carrier will retry the webhook (since we responded 200 but failed to process). The webhook should only respond 200 after successful processing OR the processing should be in a queue and the webhook response confirms receipt.
  - Kobe may note: no deduplication — if the carrier sends the same webhook twice, the delivery gets updated twice (idempotency concern)
  - safe_to_deploy: concern level depends on the size of webhooks in practice; the sync parsing is a definitive issue if 2MB payloads are real

failure_modes: |
  - Not identifying the synchronous XML parsing as event loop blocking
  - Identifying it only as a performance issue (Suggestion) rather than Critical for a Node.js server under load
  - Missing the early-response design issue (200 before processing complete)
  - Not recommending async parsing

scoring_rubric: |
  pass:
    - parseXmlSync identified as event loop blocking (Critical)
    - 200 webhook/minute + 2MB + sync = event loop saturation explained
    - Async parsing recommended
    - Early-response + failure inconsistency noted
    - Idempotency concern noted
    - safe_to_deploy false or conditional

  partial:
    - Sync parsing identified as a performance problem
    - Event loop blocking explained
    - Async fix recommended
    - Early-response issue not noted

  fail:
    - Sync parsing not identified
    - Performance concern not identified
    - Only async/await style issues noted
    - safe_to_deploy true
