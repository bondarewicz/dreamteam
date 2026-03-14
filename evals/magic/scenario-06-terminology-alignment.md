# Eval: Magic — Scenario 06 — Terminology Alignment (Medium)

## Overview

Tests Magic's ability to detect and resolve terminology mismatches where Bird and MJ use different names for the same concept, and to prevent Shaq from receiving confusing or contradictory vocabulary.

---

category: regression

prompt: |
  Bird produced this domain analysis for a user authentication feature:
  - Domain rule: A "session" is valid for 30 minutes from last user activity
  - Domain rule: A "suspended account" cannot initiate a new session
  - Acceptance criterion AC1: Given an active session idle for 31 minutes, when any authenticated request is made, then a 401 is returned with error code SESSION_EXPIRED
  - Acceptance criterion AC2: Given a suspended account, when login is attempted, then a 403 is returned with error code ACCOUNT_SUSPENDED

  MJ produced this architecture summary:
  - The auth service will manage "tokens" with a sliding expiration window of 30 minutes
  - Token validation middleware will check the token's last_accessed_at field
  - Accounts with status "locked" will be rejected at the token issuance step with a 403
  - Token storage: Redis with TTL = 1800 seconds

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the terminology mismatch: Bird calls it a "session" while MJ calls it a "token"
  - Magic identifies the second mismatch: Bird calls the state "suspended" while MJ calls it "locked"
  - terminology_alignment section explicitly maps both: session = token, suspended = locked
  - Magic flags whether these are confirmed equivalents or whether clarification is needed (e.g., Bird's "session" could imply a server-side session object vs MJ's Redis-stored token)
  - The handoff brief uses consistent terminology (either aligned set or clearly defined aliases) so Shaq is not confused
  - Both ACs preserved with exact error codes (SESSION_EXPIRED, ACCOUNT_SUSPENDED)
  - Architecture implementation details included: Redis TTL 1800, last_accessed_at field, token issuance step for locked accounts

failure_modes: |
  - Producing a brief that uses "session" in domain rules and "token" in architecture guidance without bridging them
  - Omitting the suspended/locked mismatch
  - Aligning the terminology without flagging that Bird and MJ used different terms (Shaq should know these came from different vocabulary)
  - Losing the exact error codes SESSION_EXPIRED and ACCOUNT_SUSPENDED
  - Replacing "suspended" with "locked" in the domain rules without noting the change

scoring_rubric: |
  pass:
    - Both terminology mismatches identified: session/token and suspended/locked
    - terminology_alignment section maps both pairs explicitly
    - Brief uses consistent terminology with notes on origin
    - Both ACs present with exact error codes preserved
    - Architecture details (Redis TTL, last_accessed_at) included

  partial:
    - One of the two mismatches identified
    - ACs present but error codes paraphrased
    - Terminology section exists but only addresses one mismatch

  fail:
    - No terminology_alignment section
    - Brief mixes vocabularies without bridging
    - Error codes lost or changed
    - Both mismatches unaddressed
