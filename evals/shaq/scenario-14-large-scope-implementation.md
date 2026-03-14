# Eval: Shaq — Scenario 14 — Large-Scope Feature Implementation (Very Hard)

## Overview

Tests Shaq's ability to implement a larger feature (4+ files, 8+ acceptance criteria) while maintaining clean separation of concerns and ensuring all acceptance criteria map to tests.

---

category: capability

prompt: |
  Magic has delivered this handoff brief for a "subscription management" feature.

  Acceptance criteria:
  AC1: Given a user ID and plan ID, when createSubscription is called, then a new subscription is created with status "active" and stored
  AC2: Given a subscription ID, when getSubscription is called, then the subscription is returned
  AC3: Given a subscription ID that does not exist, when getSubscription is called, then throw SUBSCRIPTION_NOT_FOUND
  AC4: Given an active subscription, when cancelSubscription is called, then the status changes to "cancelled" and the cancellation date is set to now
  AC5: Given a cancelled subscription, when cancelSubscription is called, then throw SUBSCRIPTION_ALREADY_CANCELLED
  AC6: Given a subscription with status "active", when renewSubscription is called, then the renewal_date is updated to now + 30 days
  AC7: Given a subscription with status "cancelled", when renewSubscription is called, then throw CANNOT_RENEW_CANCELLED
  AC8: Given a user ID, when listSubscriptions is called, then all subscriptions for that user are returned (active and cancelled)

  MJ says:
  - Files: src/subscriptions/subscription.ts (type), src/subscriptions/subscription-repository.ts (interface), src/subscriptions/subscription-service.ts (class), src/subscriptions/subscription-service.test.ts (tests)
  - Use AppError from src/shared/app-error.ts (existing) for all errors
  - Date operations: use Date.now() for current timestamp
  - renewSubscription adds exactly 2592000000 ms (30 days in ms) to Date.now()
  - No external dependencies

  Implement the feature.

expected_behavior: |
  - All 4 files created with correct paths and naming
  - Subscription type includes: id, userId, planId, status ("active" | "cancelled"), createdAt, renewalDate, cancelledAt (optional)
  - SubscriptionRepository interface has: save, findById, findByUserId methods
  - SubscriptionService injects SubscriptionRepository via constructor
  - All 8 ACs implemented with exact error codes
  - renewSubscription uses Date.now() + 2592000000 (not a different number)
  - Tests mock the repository, cover all 8 ACs with explicit test names
  - acceptance_criteria_coverage maps all 8 ACs to test names
  - files_changed lists all 4 files with purpose

failure_modes: |
  - Missing cancelledAt field on the Subscription type (AC4 requires it)
  - AC5 not implemented (cancelling an already-cancelled subscription)
  - AC7 not implemented (renewing a cancelled subscription)
  - renewSubscription using a different number of ms than 2592000000
  - Tests not covering AC5, AC6, AC7 (edge cases around state transitions)
  - Only 2-3 files created instead of 4

scoring_rubric: |
  pass:
    - All 4 files created with correct paths
    - All 8 ACs implemented with exact error codes
    - renewSubscription uses exactly 2592000000 ms
    - cancelledAt field present on type
    - Tests cover all 8 ACs
    - acceptance_criteria_coverage maps all 8 ACs
    - files_changed lists all 4 files

  partial:
    - All 4 files created; 6-7 ACs implemented
    - Tests cover 6-7 ACs
    - renewSubscription duration correct

  fail:
    - Fewer than 4 files
    - 5 or fewer ACs implemented
    - Tests cover only happy paths (AC1, AC2, AC4, AC6, AC8)
    - cancelledAt field missing
    - acceptance_criteria_coverage absent
