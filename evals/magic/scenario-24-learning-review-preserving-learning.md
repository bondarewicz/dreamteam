# Eval: Magic — Scenario 24 — Learning Review Preserving Learning (Medium / Capability)

## Overview

Tests the quality of Magic's "Preserving the Learning" section. The spec requires naming concrete artifacts with owners — not generic recommendations. This scenario involves an architecture decision made by MJ (event-sourced order state) that interacted poorly with a domain rule enforced by Bird (order state transitions must be synchronous for regulatory audit). Magic must identify what should be codified so the learning survives team turnover: specifically an ADR, a domain rule update, and a Kobe review checklist item. Graders verify artifact types are named with concrete owners.

---

category: capability

graders:
  - type: contains
    values: ["ADR", "Bird", "Kobe"]
  - type: regex
    pattern: "(ADR|Architecture Decision Record).{0,120}(MJ|Magic|owner|Owned)"
  - type: not_contains
    values: ["write better documentation", "improve communication", "be more careful"]
  - type: field_count
    pattern: "Artifact"
    min: 2
  - type: length_bounds
    min: 2000

prompt: |
  Produce a learning review for the following incident, with particular depth in the "Preserving the Learning" section. Name specific artifacts, their content, and their owners.

  **Incident summary**: On 2026-01-19, an audit by the FCA (Financial Conduct Authority) flagged that 6 weeks of order state transition records were non-compliant with COBS 11.2A audit trail requirements. The compliance gap was caused by a mismatch between MJ's event-sourced order state architecture and Bird's domain rule requiring synchronous, immediately-durable state transitions for regulatory purposes.

  **MJ's architecture decision (4 months before incident)**:
  "I designed order state transitions using an event-sourcing pattern. State changes are written to an event log and projected into the read model asynchronously. This gives us replay capability and decouples write and read concerns. I wrote ADR-014 for this decision. The event log is the source of truth. Projection lag is typically under 200ms."

  "I was not aware that 'immediately durable' in Bird's domain rule meant synchronous commitment to a regulatory-grade store. I understood 'durable' in the database durability sense (fsync'd to disk), which the event log satisfies."

  **Bird's domain rule (pre-existing, from domain model)**:
  "COBS 11.2A requires that order state transitions for regulated instruments be recorded in a manner that is immediately durable and queryable by regulators within 24 hours of the transition. The domain rule is: each state transition must be committed to the compliance record store before the transition is confirmed to the client."

  "This rule was documented in the domain model under 'Regulated Instruments — Audit Requirements'. It was not surfaced during MJ's ADR-014 review. I did not participate in the ADR review because I was not tagged as a reviewer. Kobe's review checklist does not include a step to tag Bird for domain model compliance review on architecture decisions."

  **Kobe's review notes**:
  "I reviewed ADR-014 for architectural soundness — event sourcing is well-understood and the pattern is appropriate. I did not evaluate whether the asynchronous projection model was compatible with Bird's regulatory domain rules. My review checklist covers: scalability, failure modes, operational complexity, security. It does not include: regulatory compliance, domain rule compatibility."

  **Pippen's operational notes**:
  "The 200ms projection lag was not a practical problem in normal operation. During an audit query window, regulators queried state records within seconds of transitions occurring. In 4 cases, the projection had not yet completed, returning stale state to the audit query. Audit trail completeness monitoring was not in place — we found out during the FCA review, not through alerting."

  Produce a full learning review. In the "Preserving the Learning" section, identify specific artifacts that would ensure this class of mismatch cannot recur silently — name each artifact, its content, and its owner.

expected_behavior: |
  - All 6 sections present
  - Preserving the Learning section names at least 3 concrete artifacts:
      (1) An ADR update or amendment to ADR-014 documenting the synchronous commitment requirement — owned by MJ
      (2) A domain rule update to Bird's model making the "synchronous commitment before client confirmation" rule explicit in a format that surfaces during architecture reviews — owned by Bird
      (3) A Kobe review checklist item: "For any architecture decision touching order state or regulated instruments, tag Bird for domain model compliance review" — owned by Kobe
  - Each artifact has a named owner (not "the team" or "someone")
  - Each artifact has a concrete description of its content, not just its type
  - Contributing Factors includes: Bird not tagged for ADR review, Kobe's checklist gap, terminology mismatch ("immediately durable" meaning), no audit trail completeness monitoring
  - What We Learned includes a learning about how domain rules and architecture decisions can diverge silently without a linking review step
  - Tone does not blame MJ for not knowing Bird's regulatory rule, or Bird for not reviewing an ADR they weren't tagged on
  - Forward Commitments include at least one PROCESS tag (the checklist/review process fix)

failure_modes: |
  - Preserving the Learning section is generic ("write better docs", "improve communication")
  - Artifact owners are "the team" or unnamed
  - Fewer than 2 artifacts named in Preserving the Learning
  - ADR amendment not mentioned
  - Kobe's review checklist gap not surfaced as something to codify
  - Bird's domain rule update not mentioned as an artifact
  - Tone blames MJ for the architecture choice or Bird for not being proactive
  - Preserving the Learning conflated with Forward Commitments — no distinction between "what we'll do" and "what we'll codify for future teams"

scoring_rubric: |
  pass:
    - Preserving the Learning section present with at least 3 named artifacts
    - Each artifact has: type (ADR/domain rule/checklist), content description, named owner
    - ADR update/amendment for ADR-014 present with MJ as owner
    - Domain rule update present with Bird as owner
    - Kobe review checklist item present with Kobe as owner
    - Contributing Factors includes Kobe's checklist gap and the terminology mismatch
    - At least one PROCESS-tagged Forward Commitment
    - Tone is non-prosecutorial

  partial:
    - Preserving the Learning present with 2 artifacts
    - One artifact lacks named owner or content description
    - Kobe's checklist gap surfaced but not named as an artifact to codify
    - PROCESS commitment present but vague

  fail:
    - Preserving the Learning absent or entirely generic
    - Fewer than 2 artifacts named
    - No owners specified for artifacts
    - ADR update, domain rule update, and review checklist all absent
    - Tone blames MJ or Bird
