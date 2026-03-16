# Eval: MJ — Scenario 19 — Contradictory Architecture Requirements (Expert)

## Overview

Expert-level: MJ is given architecture requirements that contain genuine technical contradictions that cannot all be satisfied simultaneously. MJ must identify which requirements conflict and escalate, not silently compromise.

---

category: capability

graders:
  - type: contains
    values: ["contradict", "conflict", "escalat", "cannot satisfy", "trade_off"]
  - type: section_present
    sections: ["risks"]
  - type: length_bounds
    min: 400

prompt: |
  The architecture requirements for a new payment processing service:

  1. All payment data must be encrypted at rest using customer-managed encryption keys (CMK)
  2. The service must be able to process payments within 50ms P99 (including encryption/decryption)
  3. All payment operations must be fully auditable — every field access must be logged
  4. The service must work offline (if external key management service is unavailable, payments must still process)
  5. Encryption keys must be rotated every 30 days and rotation must not require a maintenance window

  Analyze these requirements and design the architecture.

expected_behavior: |
  - MJ identifies the contradictions:
    - Requirements 1 and 4 conflict: customer-managed encryption keys (CMK) typically depend on an external key management service (AWS KMS, HashiCorp Vault). If the KMS is unavailable (requirement 4 scenario), keys cannot be retrieved and encryption/decryption cannot proceed — payments cannot be processed.
    - Requirements 2 and 3 may conflict: logging every field access adds I/O on the critical path; at 50ms P99, synchronous audit logging of every field access may be too slow; requires async logging but then audit log is not real-time
  - MJ escalates: "Requirements 1 and 4 are contradictory. CMK requires access to an external key store; offline operation means the key store is unavailable. You must choose: either accept that offline operation is not supported when the key store is unavailable, or use a key caching strategy (which introduces key compromise risk if the cache is compromised). This is a security policy decision that cannot be resolved architecturally alone."
  - MJ also flags: "Requirement 3 (every field access logged) combined with requirement 2 (50ms P99) requires async audit logging, which means the audit log is eventual — not real-time. This should be accepted explicitly by the security team."
  - MJ does NOT silently resolve the CMK/offline conflict by choosing one side
  - If MJ proposes options, they are clearly labeled as options with their trade-offs

failure_modes: |
  - Silently implementing key caching without flagging the security trade-off
  - Not identifying that CMK requires an external service
  - Not identifying the audit logging vs. latency tension
  - Designing a system that claims to satisfy all 5 requirements without acknowledging the conflicts
  - confidence.level >= 70 despite the contradictions

scoring_rubric: |
  pass:
    - CMK/offline conflict explicitly identified and escalated
    - Audit logging vs. latency tension identified
    - No design produced that claims to satisfy all 5 requirements
    - If options proposed, each includes trade-off
    - Security team escalation explicitly stated

  partial:
    - One of the two conflicts identified
    - Escalation informal
    - A design proposed with the unresolved conflict acknowledged as a caveat

  fail:
    - Both conflicts missed
    - Full design produced claiming to satisfy all requirements
    - Key caching silently used without flagging security trade-off
    - No escalation
