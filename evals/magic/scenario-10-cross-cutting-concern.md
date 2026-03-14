# Eval: Magic — Scenario 10 — Cross-Cutting Concern Identification (Hard)

## Overview

Tests Magic's ability to identify a cross-cutting concern that spans multiple agent outputs and is not explicitly named by any single agent — Magic must surface it proactively in the handoff brief.

---

category: capability

prompt: |
  Bird produced domain analysis for two separate features being implemented in the same sprint:

  Feature A — Refund Processing:
  - Domain rule: All refund actions must be recorded in an audit log with actor ID, timestamp, and amount
  - Acceptance criterion: Given a refund is processed, when the audit log is queried, then the entry exists within 1 second

  Feature B — Account Suspension:
  - Domain rule: All account suspension actions must be recorded in an audit log with actor ID, timestamp, and reason
  - Acceptance criterion: Given an account is suspended, when the audit log is queried, then the entry exists within 1 second

  MJ produced architecture summaries for both features:
  - Feature A: A RefundService that calls AuditLogService.record() after processing the refund
  - Feature B: An AccountService that calls AuditLogService.record() after suspending the account
  - Both services reference the same AuditLogService but MJ has not defined its interface or storage backend

  Pippen has not submitted any output yet.

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the cross-cutting concern: both features depend on AuditLogService, which has no defined interface or storage backend
  - Magic flags this explicitly in the brief: "Cross-cutting dependency: AuditLogService is referenced by both RefundService and AccountService but has no defined interface or storage backend. Shaq cannot implement either feature correctly without knowing the AuditLogService contract."
  - Magic does NOT invent the AuditLogService interface
  - Magic escalates to MJ (or Coach K for routing): AuditLogService interface definition is a prerequisite
  - The brief includes both features' domain rules and ACs
  - The brief notes that Pippen's output is missing but does not block synthesis of the available content (logging/metrics gaps will need Pippen's review before deploy)
  - A blocker is clearly labeled in the brief: Shaq must not implement until AuditLogService is defined

failure_modes: |
  - Producing a brief that treats each feature independently without noting the shared AuditLogService dependency
  - Inventing an AuditLogService interface (e.g., "record(actorId, timestamp, details): void")
  - Failing to flag that MJ's architecture references an undefined service
  - Treating Pippen's absence as a blocker when it is not — domain and architecture content is sufficient for the brief
  - Not labeling the AuditLogService gap as a blocker for implementation

scoring_rubric: |
  pass:
    - AuditLogService cross-cutting dependency explicitly identified and named
    - Undefined interface flagged as a blocker for implementation
    - Escalation to MJ (or Coach K) for interface definition
    - Both features' domain rules and ACs preserved
    - Pippen's absence noted but not used as a blocker for the brief
    - No invented AuditLogService interface

  partial:
    - AuditLogService dependency noted but not flagged as a blocker
    - Both features present but cross-cutting concern only mentioned in passing
    - Escalation absent but issue identified

  fail:
    - AuditLogService shared dependency not identified
    - Interface invented by Magic
    - Pippen's absence incorrectly used to block the entire brief
    - Either feature's domain rules or ACs missing
