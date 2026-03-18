# Eval: Magic — Scenario 17 — Architectural Drift Detection (Very Hard)

## Overview

Tests Magic's ability to detect when a new feature's architecture would silently introduce an architectural pattern inconsistent with the established system design, and to surface this as a cross-cutting concern rather than forwarding it unchallenged.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1

prompt: |
  Context: The system's established architecture uses a hexagonal (ports and adapters) design. All external integrations are accessed via adapter interfaces. This is documented in the team's ADR-002.

  Bird produced domain analysis for a "SMS notification" feature:
  - Domain rule: Critical order status changes (shipped, delivered, cancelled) must trigger an SMS notification to the customer
  - AC1: Given an order transitions to SHIPPED, when the notification service processes the event, then an SMS is sent to the customer's registered phone number
  - AC2: Given an SMS fails to deliver, then the failure is logged and the order processing continues (SMS is non-blocking)

  MJ produced architecture summary:
  - The NotificationService will directly instantiate a TwilioClient using the Twilio SDK
  - TwilioClient will be instantiated inside the NotificationService constructor: this.twilio = new TwilioClient(config.twilioAccountSid, config.twilioAuthToken)
  - The send method will call this.twilio.messages.create() directly

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies that MJ's design (directly instantiating TwilioClient inside NotificationService) violates ADR-002's hexagonal architecture pattern
  - In a hexagonal design, the TwilioClient should be injected as an adapter, not instantiated internally — this makes it untestable and couples the service to the SMS provider
  - Magic flags this as an architectural drift: "Cross-cutting concern: MJ's NotificationService design directly instantiates TwilioClient, which violates ADR-002 (hexagonal architecture — all external integrations must be accessed via injected adapter interfaces). This would make the service untestable without live Twilio credentials and couples the notification service to a specific provider."
  - Magic escalates to MJ (or Coach K) to update the design to use an SmsAdapter interface
  - The domain rules and ACs are correctly included
  - Magic does NOT block the brief entirely — the domain content is valid; the architectural concern is flagged alongside it

failure_modes: |
  - Forwarding MJ's architecture as-is without noting the hexagonal architecture violation
  - Not referencing ADR-002 when flagging the concern
  - Blocking the entire brief because of the architectural concern (domain content is still valid)
  - Flagging the concern as "just a testing concern" rather than an architectural pattern violation
  - Escalating about the wrong issue (e.g., complaining about Twilio as a choice rather than the instantiation pattern)

scoring_rubric: |
  pass:
    - ADR-002 hexagonal architecture violation identified
    - Specific violation named: direct instantiation of TwilioClient inside NotificationService
    - Consequence named: untestable without live credentials, provider-coupled
    - Escalation to MJ or Coach K to revise the design
    - Domain rules and ACs correctly included in the brief
    - Architectural concern and domain content treated as separate concerns

  partial:
    - Architectural concern identified but ADR-002 not referenced
    - Concern framed correctly but escalation missing
    - Domain content correct

  fail:
    - Architectural drift not identified
    - MJ's design forwarded to Shaq as-is
    - ADR-002 not referenced
    - Brief blocked entirely because of architectural concern (overcorrection)
