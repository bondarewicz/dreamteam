# Eval: Kobe — Scenario 15 — Concurrency Bug in Async JavaScript (Very Hard)

## Overview

Tests Kobe's ability to identify a subtle concurrency bug in JavaScript async code where parallel execution creates a shared-state mutation problem.

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
  Review the following TypeScript code that processes multiple deliveries in parallel for a batch update operation:

  ```typescript
  async function processBatchDeliveries(deliveryIds: string[]): Promise<BatchResult> {
    const results: BatchResult = {
      processed: 0,
      failed: 0,
      errors: [],
    };

    await Promise.all(
      deliveryIds.map(async (id) => {
        try {
          await processDelivery(id);
          results.processed++;
        } catch (err) {
          results.failed++;
          results.errors.push({ id, error: err.message });
        }
      })
    );

    return results;
  }
  ```

  This function is called with batches of up to 500 deliveries. Produce your full output schema.

expected_behavior: |
  - Kobe identifies the concurrency bug: `results.processed++` and `results.failed++` are not atomic operations in JavaScript. While JavaScript is single-threaded, the `++` operator is a read-modify-write that occurs in the same event loop tick — however, this is NOT the actual problem here. The actual problem is subtler: `results.errors.push()` is safe, but the counter increments (`results.processed++`, `results.failed++`) CAN be incorrect if the async callbacks execute in a context where the engine interleaves.
  - More accurately: in JavaScript, `++` on a shared integer within Promise.all callbacks IS actually safe because JavaScript is single-threaded and callbacks execute one at a time. However, Kobe should identify a different risk: with 500 concurrent promises (Promise.all with 500 items), all 500 database operations are initiated simultaneously. This can:
    1. Exhaust the database connection pool (if pool size < 500, many queries will queue or timeout)
    2. Create a thundering herd on the external processDelivery service
  - Fix: use a concurrency-limited batch processor (process N at a time, e.g., using p-limit or a manual batching loop)
  - Kobe may also note: `err.message` is TypeScript-unsafe (err is `unknown` in strict mode); `errors.push({ id, error: (err as Error).message })` is the safe pattern
  - safe_to_deploy: concern is the connection pool exhaustion with 500 parallel DB calls

failure_modes: |
  - Inventing a "shared state race condition" that doesn't actually exist in single-threaded JavaScript (false positive)
  - Missing the real problem: 500 simultaneous database calls exhausting the connection pool
  - Not identifying the need for concurrency limiting with large batches
  - safe_to_deploy true without noting the connection pool risk

scoring_rubric: |
  pass:
    - 500 simultaneous DB calls / connection pool exhaustion identified as the real risk
    - Concurrency limiting recommended (p-limit or manual batching)
    - Does NOT invent a non-existent shared-state race condition for JS single-threaded model
    - TypeScript err.message type safety noted
    - safe_to_deploy false or conditional (depends on connection pool size)

  partial:
    - Connection pool exhaustion identified
    - Concurrency limiting mentioned
    - May have one minor incorrect concern about JS concurrency model

  fail:
    - Invents a JavaScript "race condition" on integer increment that doesn't exist
    - Connection pool exhaustion not identified
    - safe_to_deploy true
    - No concurrency limiting recommendation
