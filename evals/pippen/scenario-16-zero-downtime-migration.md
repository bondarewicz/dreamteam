# Eval: Pippen — Scenario 16 — Zero-Downtime Migration Readiness (Very Hard)

## Overview

Tests Pippen's ability to assess whether a data migration plan is safe to execute with zero downtime, identifying the specific failure modes that would cause data loss or service interruption.

---

category: capability

prompt: |
  You are Pippen reviewing a zero-downtime migration plan for a "user preferences" feature. The migration moves user preferences from a JSON blob column in the users table to a dedicated user_preferences table.

  Migration plan:
  Step 1: Add user_preferences table (no data, just schema)
  Step 2: Deploy new application code that writes preferences to BOTH users.preferences_json AND user_preferences table (dual-write)
  Step 3: Run backfill job: copy existing preferences from users.preferences_json to user_preferences for all existing users
  Step 4: Deploy new application code that reads preferences from user_preferences only (stops reading from users.preferences_json)
  Step 5: Stop dual-write — write only to user_preferences
  Step 6 (future): Drop the users.preferences_json column

  Service details:
  - Multiple instances of the application run simultaneously (horizontal scaling, 3 instances)
  - The deployment in Step 4 is a rolling deployment — instances update one at a time
  - No feature flag to coordinate the read source switch across all instances simultaneously
  - Backfill job has no progress tracking or resumability
  - No validation step to confirm backfill completeness before Step 4

  Assess the migration plan's operational readiness.

expected_behavior: |
  - Pippen identifies the rolling deployment race condition in Step 4: during the rolling update, some instances will read from users.preferences_json (old code) and some from user_preferences (new code). If a user's preferences were written before the backfill was complete, they may see stale data depending on which instance handles their request.
  - Pippen flags the missing validation before Step 4: there is no check to confirm that the backfill completed successfully and all records exist in user_preferences before switching reads
  - Pippen flags the non-resumable backfill: if the backfill job fails midway (e.g., OOM or timeout), it must restart from the beginning — for a large table this could take significant time
  - Pippen recommends: (1) a validation query to confirm backfill completeness before Step 4, (2) a feature flag or config value to coordinate the read source switch atomically across all instances, (3) backfill progress tracking with resumability (e.g., cursor-based batching)
  - Verdict: NOT READY or READY WITH CAVEATS — the plan has a correctness gap at Step 4

failure_modes: |
  - Approving the migration plan as-is
  - Missing the rolling deployment race condition in Step 4
  - Not flagging the missing backfill validation before Step 4
  - Recommending a complete migration halt instead of specific fixes (overcorrection)
  - Not identifying the non-resumable backfill as a risk for large tables

scoring_rubric: |
  pass:
    - Rolling deployment race condition at Step 4 identified
    - Missing backfill validation before Step 4 identified
    - Non-resumable backfill identified as a risk
    - Specific recommendations: validation query, feature flag for read source, resumable backfill
    - Verdict is NOT READY or READY WITH CAVEATS

  partial:
    - Two of three gaps identified
    - Recommendations present for identified gaps
    - Verdict correct

  fail:
    - Migration plan approved as-is
    - Step 4 race condition not identified
    - Backfill validation gap not identified
    - No specific recommendations
