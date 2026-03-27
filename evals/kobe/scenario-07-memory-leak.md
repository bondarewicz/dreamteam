# Eval: Kobe — Scenario 07 — Memory Leak in Event Listener (Capability)

## Overview

Tests Kobe's ability to identify a memory leak caused by event listeners that are never removed, which would cause increasing memory usage over time in a long-running Node.js process.

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
  Review the following Node.js TypeScript code for a courier location update handler:

  ```typescript
  class CourierTracker {
    private courierId: string;
    private ws: WebSocket;

    constructor(courierId: string, ws: WebSocket) {
      this.courierId = courierId;
      this.ws = ws;
      this.setupListeners();
    }

    private setupListeners(): void {
      this.ws.on('message', (data: string) => {
        const location = JSON.parse(data);
        this.updateLocation(location);
      });

      this.ws.on('error', (err: Error) => {
        console.error(`Courier ${this.courierId} error:`, err);
      });
    }

    private updateLocation(location: { lat: number; lng: number }): void {
      db.couriers.updateLocation(this.courierId, location.lat, location.lng);
    }
  }
  ```

  A new CourierTracker is created for each courier connection. Couriers frequently disconnect and reconnect (average session: 5 minutes). The service has been running for 3 months and memory usage has been steadily increasing.

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the memory leak: when a WebSocket connection closes, the CourierTracker object holds a reference to the ws object via the closure in the event listeners; if the ws object is not garbage collected (because the listeners hold a reference back), the CourierTracker instance leaks
  - More specifically: there is no cleanup mechanism — no `close` event listener that removes the `message` and `error` listeners, and no way to destroy the CourierTracker when the connection closes
  - This is a Critical finding: memory leaks in a long-running server that creates new objects per connection (couriers connecting/disconnecting every 5 minutes) will exhaust memory over time — consistent with the "memory usage increasing over 3 months" symptom
  - Fix: add a `close` event handler that calls `ws.removeAllListeners()` or removes specific listeners; or implement a `dispose()` method called when the connection closes
  - Kobe also notes: `JSON.parse(data)` without a try/catch will throw on malformed input and crash the listener — this is at least an Important finding
  - safe_to_deploy is false

failure_modes: |
  - Not identifying the memory leak (attributing the increasing memory to other causes)
  - Classifying memory leak as Important instead of Critical (a production server running out of memory is Critical)
  - Missing the JSON.parse without error handling
  - Not identifying the missing close/cleanup handler as the root cause
  - Proposing a vague fix ("add cleanup")

scoring_rubric: |
  pass:
    - Memory leak identified as Critical with mechanism explained (no close handler, listener retention)
    - Specific fix: close event handler calling removeAllListeners or specific removal
    - JSON.parse without try/catch noted (Important or lower)
    - safe_to_deploy false
    - Connection with the "steadily increasing memory" symptom made

  partial:
    - Memory leak identified but mechanism vague
    - Fix proposed but not specific
    - JSON.parse issue not noted

  fail:
    - Memory leak not identified
    - safe_to_deploy true
    - Root cause misidentified (e.g., "it's the database calls")
    - No cleanup fix proposed
