# Eval: Bird — Scenario 03 — Business Impact Assessment (Escalation Case)

## Overview

Tests Bird's multi-dimensional business impact analysis and his escalation behavior when a technical change has non-obvious business consequences that require stakeholder input before proceeding.

---

category: regression

graders:
  - type: contains
    values: ["financial", "operational", "stakeholder", "confidence", "escalat"]
  - type: section_present
    sections: ["business_impact", "stakeholders_affected"]
  - type: length_bounds
    min: 400
    max: 8000

prompt: |
  The engineering team wants to change how delivery ETAs are calculated. Currently ETAs are shown as exact timestamps (e.g., "Delivery by 14:30 on Friday"). The proposal is to change to date-only windows (e.g., "Delivery by Friday").

  Analyze the business impact of this change. Use your full output schema including business_impact with all sub-fields (financial, operational, user, risk, stakeholders_affected). If any information is missing that you need to complete a confident analysis, escalate.

expected_behavior: |
  - business_impact.financial addresses revenue implications: premium delivery tiers that charge for time-specific delivery may be undermined; SLA penalties may be affected
  - business_impact.user identifies that customers expecting precise ETAs will have degraded experience; this could increase inbound support contacts
  - business_impact.operational notes that this may reduce operational pressure on the logistics team to hit exact time windows
  - business_impact.risk identifies at minimum:
    - Contractual SLA risk if existing customer contracts specify time-precise delivery guarantees
    - Competitive risk if competitors offer time windows and this is a regression
  - stakeholders_affected lists: customers (direct experience impact), operations team (reduced precision pressure), sales/account management (SLA commitments), customer support (increased contacts)
  - Bird escalates at least one question he cannot answer without more context, e.g.: "Are there existing customer contracts with time-precise SLA commitments? I cannot assess contractual risk without this."
  - confidence.level is calibrated to the information available (should be 50-75 without contract information)

failure_modes: |
  - Analyzing only the user experience dimension and missing financial/contractual risks
  - Missing the escalation for contractual SLA risk (this is a real business risk Bird cannot assess alone)
  - Listing stakeholders only as "users" without distinguishing customer types or internal teams
  - Setting confidence.level >= 85 without having contract information
  - Framing the operational benefit (reduced time pressure) without balancing it against the customer experience cost
  - No mention of competitive positioning

scoring_rubric: |
  pass:
    - All 4 business_impact sub-fields populated with substantive analysis (not one-liners)
    - stakeholders_affected lists at least 3 distinct groups with specific impact per group
    - At least 1 escalation for missing information that cannot be assumed
    - Contractual SLA risk explicitly identified
    - confidence.level <= 80 with listed assumptions
    - Competitive positioning mentioned

  partial:
    - 3 of 4 business_impact sub-fields substantively populated
    - 2 stakeholder groups identified
    - No formal escalation but assumptions listed in confidence section
    - confidence.level 80-90

  fail:
    - Only user impact analyzed
    - No stakeholder breakdown
    - No escalation and no assumptions listed
    - confidence.level >= 90
    - Contractual risk not mentioned
