# Eval: MJ — Scenario 13 — Multi-System Integration Design (Hard)

## Overview

Tests MJ's ability to design an integration layer between multiple external systems with incompatible data models, identifying the data ownership, transformation, and failure handling challenges.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: risks
    min_items: 1

prompt: |
  A logistics platform needs to integrate with three external systems simultaneously:

  System A — ERP (SAP): receives confirmed orders as XML files via SFTP every 15 minutes
  System B — Carrier API (DHL): REST API, webhook callbacks for shipment status updates, 500ms max response time per webhook
  System C — Analytics Platform: requires a real-time event stream of all order and delivery events (Kafka)

  The logistics platform's internal events are: OrderPlaced, OrderConfirmed, ShipmentCreated, DeliveryAttempted, DeliveryCompleted, DeliveryFailed.

  Design the integration architecture. Use your full output schema.

expected_behavior: |
  - MJ identifies that each integration has different characteristics requiring different patterns:
    1. SAP (SFTP/XML/batch): adapter pattern; transform internal events into XML batch files; schedule SFTP push on 15-minute cadence; idempotency via file-level checksums or sequence IDs
    2. DHL (webhook/REST): webhook receiver that must respond within 500ms — no synchronous processing; must queue incoming webhooks and process asynchronously; DHL webhook retries if no 200 response
    3. Analytics Kafka: internal event bus; all domain events published to Kafka topics; Analytics platform is a consumer
  - MJ identifies a data transformation layer: internal events must be mapped to SAP's expected XML format and to Kafka's schema — this transformation logic must not live in each service
  - risks: SAP integration point failure (SFTP unreachable) silently drops 15-minute batch; DHL webhooks failing to receive 200 in time will cause retries and potential duplicate processing; Kafka consumer lag if analytics platform is slow
  - MJ raises idempotency for DHL webhooks: the same status update may arrive multiple times via retry — the receiver must deduplicate
  - flexibility_points: adding new integrations (e.g., FedEx) should only require a new adapter, not changes to internal systems
  - implementation_guidance: recommends building a dedicated integration layer (not embedding integration logic in the Order or Shipment services)

failure_modes: |
  - Embedding integration logic in the domain services
  - Not addressing the DHL 500ms webhook response requirement
  - Missing idempotency for DHL webhook retries
  - Not distinguishing the three integration patterns (batch, event-driven, stream)
  - Missing the SAP silent-failure risk (failed SFTP not detected until SAP complains)

scoring_rubric: |
  pass:
    - Three distinct integration patterns identified and designed correctly
    - DHL webhook async processing and 500ms constraint addressed
    - DHL webhook idempotency addressed
    - SAP silent failure risk identified
    - Dedicated integration layer recommended
    - flexibility_points: new integrations via new adapters

  partial:
    - Two of three patterns correctly identified
    - DHL constraint mentioned but not fully designed
    - Idempotency mentioned
    - Dedicated layer recommended but not fully justified

  fail:
    - Integration logic in domain services
    - DHL 500ms constraint not addressed
    - No idempotency consideration
    - No risk for silent SAP failures
