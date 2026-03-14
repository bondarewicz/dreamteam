# Eval: Magic — Scenario 12 — Stale Input Detection (Hard)

## Overview

Tests Magic's ability to detect when an agent has resubmitted an updated output that supersedes their earlier output, and to use only the most recent version rather than accidentally synthesizing from both.

---

category: capability

prompt: |
  You are Magic. You have received the following outputs for the "notification preferences" feature:

  Bird's first submission (labeled v1):
  - AC1: A user can opt out of marketing emails
  - AC2: A user can opt out of transactional emails
  - Domain rule: Transactional emails cannot be fully disabled — they are required for password resets and security alerts

  Bird's second submission (labeled v2, submitted after v1):
  - AC1: A user can opt out of marketing emails
  - AC2 REMOVED — transactional email opt-out is not permitted per legal review
  - Domain rule: Transactional emails cannot be disabled under any circumstances (legal requirement)
  - AC3 (new): Given a user who attempts to disable transactional emails via API, then a 403 is returned with error code TRANSACTIONAL_OPT_OUT_PROHIBITED

  MJ's submission:
  - The preferences API will expose PATCH /users/{id}/notification-preferences
  - Marketing email opt-out will be stored as a boolean field: marketing_emails_enabled
  - The API will validate that transactional_emails_enabled cannot be set to false — return 403 if attempted

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic uses Bird's v2 output, not v1
  - AC2 from v1 (transactional email opt-out) is NOT included in the brief
  - The brief includes the v2 AC3 with exact error code TRANSACTIONAL_OPT_OUT_PROHIBITED
  - Magic notes in the brief that AC2 was removed in v1 and superseded by v2's stronger prohibition
  - domain_rules section reflects v2: transactional emails cannot be disabled under any circumstances (legal requirement)
  - MJ's architecture aligns with v2: the 403 enforcement on transactional_emails_enabled is correctly included
  - Magic does NOT synthesize both v1 and v2 by merging AC2 from v1 with AC3 from v2

failure_modes: |
  - Including AC2 from v1 alongside AC3 from v2 (contradictory: cannot both opt-out and be prohibited)
  - Using v1's softer domain rule ("cannot be fully disabled") instead of v2's absolute prohibition
  - Not noting that v2 supersedes v1
  - Producing a brief that tells Shaq to implement transactional email opt-out capability
  - Losing AC3's exact error code

scoring_rubric: |
  pass:
    - Only v2 content used (AC1 + AC3, not AC2 from v1)
    - v2 domain rule used: absolute prohibition, legal requirement
    - AC3 present with exact error code TRANSACTIONAL_OPT_OUT_PROHIBITED
    - Note in brief that v2 supersedes v1
    - MJ's 403 enforcement aligned with v2 prohibition

  partial:
    - v2 content used for most fields but v1 AC2 accidentally included
    - v2 supersession noted but not clearly applied throughout
    - AC3 present but error code paraphrased

  fail:
    - v1 and v2 merged (AC2 and AC3 both present — contradictory)
    - v1 domain rule used (softer language)
    - No note about v2 superseding v1
    - AC3 absent or error code missing
