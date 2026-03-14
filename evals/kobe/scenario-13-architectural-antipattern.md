# Eval: Kobe — Scenario 13 — Architectural Anti-Pattern in Code Review (Hard)

## Overview

Tests Kobe's ability to identify that a code-level pattern is a symptom of an architectural problem and escalate it correctly to MJ rather than attempting to fix it locally.

---

category: capability

graders:
  - type: contains
    values: ["escalat", "MJ", "architectural", "safe_to_deploy"]
  - type: section_present
    sections: ["critical_findings", "production_readiness"]
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  Review the following TypeScript code in the Order Service:

  ```typescript
  // In Order Service - order.service.ts
  import { Pool } from 'pg';

  // Direct connection to Courier Service database
  const courierDb = new Pool({
    host: process.env.COURIER_DB_HOST,
    database: 'courier_db',
    user: process.env.COURIER_DB_USER,
    password: process.env.COURIER_DB_PASSWORD,
  });

  async function assignCourierToOrder(orderId: string): Promise<void> {
    // Read directly from courier service's database
    const availableCouriers = await courierDb.query(
      `SELECT * FROM couriers WHERE status = 'available' AND zone = $1`,
      [await getOrderZone(orderId)]
    );

    if (availableCouriers.rows.length === 0) {
      throw new Error('No couriers available');
    }

    const courier = availableCouriers.rows[0];
    await db.orders.update(orderId, { courierId: courier.id, status: 'assigned' });
  }
  ```

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the critical architectural anti-pattern: the Order Service is directly connecting to the Courier Service's database. This creates tight coupling at the data layer — the Courier Service cannot change its schema without breaking the Order Service.
  - This is an architectural issue that Kobe escalates to MJ: "ESCALATION: Found architectural anti-pattern — Order Service directly queries Courier Service's database. This violates service isolation. The Courier Service should expose an API for querying available couriers; the Order Service should call that API. Recommend MJ assess the inter-service communication pattern."
  - Kobe also identifies a local Critical finding: there is no locking/reservation mechanism — two simultaneous assignCourierToOrder calls for orders in the same zone could both select the same courier (race condition)
  - Kobe does NOT attempt to fix the architectural problem via a local code change — he escalates to MJ
  - safe_to_deploy false

failure_modes: |
  - Missing that the Order Service is directly accessing the Courier Service's database
  - Not escalating the architectural violation to MJ (trying to fix it locally instead)
  - Missing the race condition in courier selection
  - Escalating to the wrong agent (Coach K instead of MJ)
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - Cross-service direct database access identified as architectural violation
    - Escalation routed to MJ with specific description
    - Race condition in courier selection also identified
    - Kobe does not attempt to rewrite the architecture
    - safe_to_deploy false

  partial:
    - Direct database access identified as a problem
    - Escalation informal or to wrong agent
    - Race condition identified
    - safe_to_deploy false

  fail:
    - Cross-service direct DB access not identified as architectural issue
    - No escalation to MJ
    - safe_to_deploy true
    - Kobe attempts to "fix" it locally
