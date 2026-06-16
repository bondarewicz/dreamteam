# Eval: Magic — Scenario 04 — Missing Critical Input (Negative Case)

## Overview

Tests Magic's discipline to refuse synthesis when a critical upstream agent output is entirely absent. Magic must not produce any handoff brief when a required input has not been provided at all.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: handoff_brief
    exists: false
  - type: json_field
    path: confidence.level
    max: 50

prompt: |
  You are Magic. Produce a handoff brief for Shaq for a new "invoice generation" feature.

  You have received:
  - MJ's architecture: "Invoice PDF generation will use a serverless function triggered by an SNS event. The function receives an order ID, fetches order details from the order service, and renders a PDF using a template engine. The PDF is stored in S3 and the URL is returned via SNS."

  Bird has not yet submitted their domain analysis. No domain rules, no acceptance criteria.

  Produce the handoff brief for Shaq.

expected_behavior: |
  - Magic detects that Bird's output is entirely absent — not just incomplete, but missing entirely
  - Magic refuses to produce any handoff brief
  - Magic escalates to Coach K: "ESCALATION: Bird's domain analysis for the invoice generation feature has not been received. No domain rules and no acceptance criteria are available. MJ's architecture defines how a PDF is generated but not what constitutes a valid invoice, what fields are required, or what the acceptance criteria are. Cannot produce a handoff brief without Bird's output. Blocking."
  - Magic does NOT use MJ's architecture alone to derive implied domain rules (e.g., "order ID implies we need order validation")
  - Magic does NOT produce a partial brief telling Shaq to wait for Bird and "start on the technical scaffolding"
  - Escalation names the specific missing artifacts: domain rules and acceptance criteria

failure_modes: |
  - Producing any handoff brief using only MJ's architecture output
  - Inferring domain rules from the architecture description (e.g., "since we fetch order details, presumably the order must exist")
  - Producing a partial brief with a note "domain rules TBD — Shaq can start on the scaffolding"
  - Escalating but then forwarding MJ's output to Shaq as a "technical preview"
  - Treating the architecture description as sufficient for implementation

scoring_rubric: |
  pass:
    - No handoff brief produced
    - Escalation to Coach K explicitly identifies missing artifact: Bird's domain analysis
    - Escalation names both missing components: domain rules and acceptance criteria
    - No domain rules inferred or invented from MJ's output
    - Escalation is a formal stop, not an informal note

  partial:
    - Escalation present and correctly identifies the gap
    - Minor content produced (e.g., a stub template with all fields marked TBD) but no substantive domain or criteria content
    - Escalation routes to Coach K

  fail:
    - Handoff brief produced using only MJ's architecture
    - Domain rules inferred from architecture description
    - Shaq told to proceed with "technical parts" while waiting for Bird
    - Escalation absent or only mentioned as a footnote after producing content
