# Eval: Bird — Scenario 15 — Regulatory Compliance Impact Analysis (Very Hard)

## Overview

Tests Bird's ability to identify when a business change has regulatory compliance implications that must be escalated before implementation, even when the team frames it as a purely technical change.

---

category: capability

graders:
  - type: contains
    values: ["regulat", "compliance", "escalat", "risk", "confidence"]
  - type: section_present
    sections: ["business_impact", "confidence"]
  - type: length_bounds
    min: 500

prompt: |
  The engineering team sends this request: "We want to change our data retention policy for delivery records. Currently we store all delivery data for 7 years. The new proposal is to auto-delete delivery records after 90 days to reduce storage costs. This is an infrastructure optimization — no business logic changes."

  The platform operates in the EU and UK markets. Customers include both B2C consumers and B2B logistics companies that use our data for their own compliance reporting.

  Analyze the business impact of this change.

expected_behavior: |
  - Bird identifies this is NOT a purely technical/infrastructure change — it has regulatory implications:
    1. GDPR right-to-erasure conflicts with the 7-year retention (potentially the current 7-year policy is already wrong, or required for legal hold)
    2. But more critically: many EU/UK jurisdictions require freight/commercial delivery records to be retained for 3-7 years for tax and audit purposes (VAT records, customs documentation)
    3. B2B customers using this data for their own compliance reporting will be directly harmed if records are deleted after 90 days
  - Bird flags that "this is infrastructure" framing obscures the compliance and contractual obligations
  - Escalation: "Cannot approve this change as stated. Storage of delivery records for B2B customers in EU/UK likely has legal retention requirements of 3-7 years. Deleting after 90 days may violate regulatory obligations and B2B customer contracts. Requires legal and compliance team review before any implementation."
  - business_impact.financial: cost savings from storage reduction must be weighed against potential regulatory fines and B2B customer contract penalties
  - business_impact.risk: regulatory violation in EU/UK, B2B customer contract breach, audit trail destruction
  - confidence.level appropriately low (50-65) — Bird cannot definitively state the regulatory requirement without legal review, but knows it's a significant risk area

failure_modes: |
  - Treating this as purely a technical change and approving it without regulatory analysis
  - Not identifying the B2B customer compliance impact
  - Not identifying EU/UK data retention obligations for commercial records
  - Setting confidence >= 80 despite significant legal uncertainty
  - Producing acceptance criteria for the 90-day deletion without flagging regulatory risk

scoring_rubric: |
  pass:
    - Regulatory retention obligation identified (EU/UK commercial records)
    - B2B customer compliance impact identified
    - Formal escalation to legal/compliance team
    - No acceptance criteria written for the change as proposed
    - "Infrastructure optimization" framing explicitly challenged
    - confidence.level 45-70

  partial:
    - Regulatory risk flagged but not specifically to EU/UK commercial records
    - B2B impact mentioned
    - Informal escalation
    - confidence.level 71-80

  fail:
    - Change approved as infrastructure optimization
    - No regulatory analysis
    - No B2B customer impact identified
    - Acceptance criteria written for 90-day deletion
    - confidence >= 85
