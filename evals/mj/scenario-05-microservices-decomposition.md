# Eval: MJ — Scenario 05 — Microservices Decomposition (Capability)

## Overview

Tests MJ's ability to recommend a correct service decomposition strategy, identifying which capabilities should be separate services and which should remain together, with justification.

---

category: capability

graders:
  - type: contains
    values: ["trade_off", "risk", "flexibility", "bounded context"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 500

prompt: |
  A courier platform currently has a monolithic backend. The team (8 engineers) wants to move to microservices. The platform has these capabilities:

  - Order placement and management
  - Courier assignment and routing
  - Real-time courier location tracking (updates every 10 seconds per courier, 500 active couriers)
  - Customer notifications (email, SMS, push)
  - Payment processing and refunds
  - Customer account management

  Requirements:
  - The location tracking component handles 5,000 writes/sec at peak
  - Payment processing has strict consistency requirements
  - The team has operated a monolith for 3 years — moderate operational maturity
  - Target: reduce deployment coupling (can deploy payment changes without touching location tracking)

  Design the service decomposition. Use your full output schema.

expected_behavior: |
  - MJ recommends decomposing into at most 4-5 services, not 6+ (one per capability is over-engineering for an 8-person team)
  - Recommended decomposition acknowledges:
    1. Location Tracking is correctly identified as a separate service due to its extreme write volume (5,000 writes/sec requires different storage/infrastructure than transactional data)
    2. Payment is correctly identified as separate due to strict consistency requirements and PCI compliance boundary
    3. Notifications is a strong candidate for separation (high outbound volume, different SLA)
    4. Order + Courier Assignment can reasonably stay together initially (closely coupled domain operations)
    5. Customer Account management may stay in a "core" service initially
  - trade_offs explicitly addresses: increased operational overhead per service; distributed tracing complexity; team skill requirements
  - risks includes: premature decomposition creating more coupling problems; distributed transactions if Order and Courier Assignment are separated incorrectly
  - MJ explicitly advises against making every capability its own service (that would be 6 services for 8 engineers — too high an operational burden)
  - implementation_guidance recommends a strangler fig pattern for the migration, not a big bang rewrite

failure_modes: |
  - Recommending 6 separate services (one per capability) without acknowledging the team size constraint
  - Not identifying Location Tracking's special write-volume requirement
  - Not separating Payment (consistency + PCI boundary)
  - Missing the distributed transaction risk if tightly coupled domains are incorrectly split
  - Recommending a big bang rewrite instead of strangler fig

scoring_rubric: |
  pass:
    - 3-5 services recommended with justification
    - Location Tracking and Payment correctly identified as separation candidates
    - Team size constraint factored (not one service per capability)
    - Strangler fig migration pattern recommended
    - trade_offs includes operational overhead and distributed tracing
    - risks includes distributed transaction problem

  partial:
    - 3-5 services recommended but justification thin
    - Either Location Tracking or Payment correctly identified (not both)
    - Migration approach present but not strangler fig specifically
    - risks section present but thin

  fail:
    - 6+ services recommended without acknowledging team constraint
    - Location Tracking and Payment not distinguished from other capabilities
    - No migration approach
    - trade_offs missing sacrifices
