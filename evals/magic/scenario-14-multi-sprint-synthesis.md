# Eval: Magic — Scenario 14 — Multi-Sprint Synthesis (Very Hard)

## Overview

Tests Magic's ability to synthesize a brief that spans two sprints of work, correctly identifying what is in scope now vs deferred, and preventing Shaq from over-building in the current sprint.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: handoff_brief.domain_rules
    min_items: 1

prompt: |
  Bird produced this phased domain analysis:

  Sprint 1 (current):
  - Feature: Basic webhook delivery
  - Domain rule: A webhook is delivered via HTTP POST to the subscriber's registered URL
  - Domain rule: Delivery is considered successful if the subscriber responds with HTTP 2xx within 5 seconds
  - AC1: Given a webhook event, when delivered to a subscriber URL, then the POST is made with the event payload as JSON body
  - AC2: Given the subscriber responds 200 OK, then delivery is marked as "delivered"
  - AC3: Given the subscriber responds 503, then delivery is marked as "failed"

  Sprint 2 (deferred — do NOT implement yet):
  - Feature: Webhook retry with exponential backoff
  - Domain rule: Failed deliveries are retried up to 3 times with backoff: 1 min, 5 min, 30 min
  - Domain rule: After 3 failures, the webhook subscription is suspended

  MJ produced this architecture summary (covers both sprints):
  - Sprint 1: WebhookDeliveryService with deliver(event, subscriberUrl): DeliveryResult
  - Sprint 1: DeliveryResult has status: "delivered" | "failed" and http_status_code field
  - Sprint 2: WebhookRetryScheduler using a job queue (BullMQ) — do not implement in Sprint 1
  - MJ note: "Sprint 1 should deliver the basic service. Leave extension points but do not implement retry logic."

  Produce a handoff brief for Shaq for Sprint 1 only.

expected_behavior: |
  - Brief is clearly scoped to Sprint 1 only
  - domain_rules section contains only Sprint 1 rules (HTTP POST, 2xx = delivered, 5s timeout)
  - acceptance_criteria contains only AC1, AC2, AC3
  - architecture_guidance covers: WebhookDeliveryService, DeliveryResult type, 5-second timeout
  - Brief explicitly tells Shaq NOT to implement retry logic — this is deferred to Sprint 2
  - Sprint 2 content is acknowledged but clearly labeled as out of scope: "Sprint 2 retry logic (BullMQ, backoff schedule) is deferred — do not scaffold, stub, or implement in Sprint 1"
  - MJ's "leave extension points" guidance is passed to Shaq as a design note (not ignored)

failure_modes: |
  - Including Sprint 2 retry logic in the brief as in-scope
  - Telling Shaq to "stub out" or "scaffold" the retry scheduler in Sprint 1
  - Omitting the 5-second timeout requirement from Sprint 1
  - Losing AC3 (failure case)
  - Not explicitly telling Shaq that retry is deferred
  - Dropping MJ's "leave extension points" design guidance

scoring_rubric: |
  pass:
    - Brief scoped to Sprint 1 only, clearly labeled
    - Sprint 2 content acknowledged and explicitly excluded with instruction to Shaq
    - All three ACs present
    - 5-second timeout included
    - "Leave extension points" guidance from MJ passed to Shaq
    - No retry logic in implementation guidance

  partial:
    - Brief mostly Sprint 1 but Sprint 2 retry logic mentioned without clear exclusion
    - ACs present but 5-second timeout missing
    - Extension points guidance absent

  fail:
    - Sprint 2 retry logic included as in-scope
    - Shaq directed to scaffold or stub retry in Sprint 1
    - AC3 missing
    - No sprint scoping in brief
