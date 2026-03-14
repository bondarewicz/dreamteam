# Eval: Bird — Scenario 19 — Multi-Jurisdiction Compliance Conflict (Expert)

## Overview

Expert-level: Bird must analyze a feature where the rules are valid in one jurisdiction but illegal in another, requiring him to produce jurisdiction-aware rules and escalate the conflict rather than proposing a single global rule set.

---

category: capability

graders:
  - type: contains
    values: ["jurisdiction", "conflict", "escalat", "compliance", "confidence"]
  - type: section_present
    sections: ["business_rules", "business_impact"]
  - type: length_bounds
    min: 500
    max: 10000

prompt: |
  A global logistics platform wants to add a "driver earnings transparency" feature:

  "Show each driver their earnings breakdown in real time: base pay, per-delivery bonus, tips, and deductions."

  The platform operates in:
  - California, USA: wage transparency is legally required; drivers are classified as employees under AB5
  - Germany: works councils (Betriebsrat) must approve changes to compensation display systems before rollout
  - Indonesia: drivers are classified as independent contractors; local law does not require pay transparency

  Analyze the domain rules for this feature.

expected_behavior: |
  - Bird identifies that there is no single global rule set — this feature has jurisdiction-specific rules:
    1. California: pay transparency is a legal requirement (invariant: true — regulatory)
    2. Germany: works council approval required before system change (invariant: true — labor law process)
    3. Indonesia: no legal requirement for transparency (invariant: false — optional feature)
  - Bird identifies the data model difference: "driver classification" differs per jurisdiction — employee (CA) vs. contractor (ID) — which affects what payroll fields are visible and applicable
  - Bird escalates: "Cannot produce a single acceptance criteria set. This feature requires jurisdiction-specific rules and the Germany rollout requires works council approval before any deployment. Legal and HR must review California and Germany requirements before implementation can proceed."
  - business_impact identifies: global rollout cannot be uniform; phased jurisdiction-specific rollout required
  - Bird surfaces a subtle trap: a feature that is mandatory in California may be prohibited from being removed globally — removing it in Indonesia to simplify the codebase could be fine legally, but removing it in California would be illegal
  - confidence.level <= 55 due to legal complexity

failure_modes: |
  - Producing a single uniform acceptance criteria set without jurisdiction-specific rules
  - Missing the Germany works council requirement
  - Not identifying driver classification differences as a data model concern
  - Setting confidence >= 70 despite multi-jurisdiction legal complexity
  - Not escalating for legal review before implementation

scoring_rubric: |
  pass:
    - Jurisdiction-specific rules identified for all 3 jurisdictions
    - Germany works council approval identified as a pre-condition
    - Driver classification data model difference identified
    - Formal escalation for legal review
    - No single global acceptance criteria set
    - confidence.level <= 60

  partial:
    - 2 of 3 jurisdictions analyzed
    - Germany requirement mentioned but not as blocking pre-condition
    - Escalation informal
    - confidence.level 61-75

  fail:
    - Single global rule set produced
    - Germany works council requirement missing
    - Jurisdiction differences not analyzed
    - confidence >= 80
    - No legal escalation
