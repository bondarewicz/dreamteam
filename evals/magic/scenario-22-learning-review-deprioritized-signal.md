# Eval: Magic — Scenario 22 — Learning Review Deprioritized Signal (Medium / Capability)

## Overview

Tests Magic's handling of a deprioritized safety signal per the facilitation guideline: "Describe the deprioritization decision honestly — what trade-off was being made, what information was available, why the priority call made sense at the time. Do not treat deprioritization as negligence in hindsight." Bird flagged a data validation concern during spec; it was explicitly deprioritized by the team to meet a sprint deadline; Shaq implemented without it; and invalid data passed through causing a downstream integrity failure. Magic must reconstruct why deprioritization made sense at the time AND surface it as a contributing factor without treating it as negligence.

---

category: capability

graders:
  - type: not_contains
    values: ["should have validated", "negligence", "should have known", "ignored Bird"]
  - type: contains
    values: ["depriori"]
  - type: contains
    values: ["TD-291"]
  - type: field_count
    pattern: "\\*\\*[A-Za-z]"
    min: 3
  - type: length_bounds
    min: 2000

prompt: |
  Produce a learning review for the following incident.

  **Incident summary**: On 2026-02-28, the Invoicing Service began writing malformed invoice records to the database. The root cause was that supplier_id values were accepted as free-text strings from an external webhook, and some suppliers were sending numeric IDs formatted as floats (e.g., "12345.0" instead of "12345"). The invoice records were written successfully but a downstream reconciliation job that does exact-string matching on supplier_id failed silently for 3 days, producing a £47,000 discrepancy in the monthly reconciliation report.

  **Bird's original spec note (6 weeks before incident)**:
  "supplier_id should be treated as an opaque string identifier per the domain model. However, I flagged during spec review that the external webhook does not guarantee format consistency — I've seen suppliers send integer, float, and zero-padded variants. I recommended a normalisation step (strip trailing zeros, enforce integer string format) before persistence. I noted this as a data quality risk with medium priority."

  **Coach K's prioritisation decision (6 weeks before incident)**:
  "Bird's normalisation recommendation is logged as tech debt item TD-291. We're deprioritising it this sprint — the webhook integration is behind schedule and adding normalisation logic would push the go-live date by 3 days. The risk is accepted: the webhook provider has confirmed their current production system sends integer-formatted IDs. We will address TD-291 in the next sprint."

  **Shaq's implementation notes**:
  "Implemented webhook ingestion per the spec. supplier_id accepted as string and persisted directly. I was aware of TD-291 but it was marked out-of-scope for this sprint. I did not add normalisation because it was explicitly deprioritised."

  **Bird's post-incident note**:
  "The webhook provider's production system does send integer IDs. However, they recently onboarded a new sub-provider whose system generates float-formatted IDs. The change was not announced. TD-291 would have caught this but it was sitting in the backlog."

  **Pippen's operational notes**:
  "The reconciliation job logs a WARNING for unmatched supplier_ids but does not alert. The warning volume was low enough that it was below the manual review threshold. The discrepancy was caught by the finance team during month-end close, not by automated monitoring."

  Produce a full learning review for this incident.

expected_behavior: |
  - All 6 sections present
  - Contributing Factors section treats the deprioritisation decision as one factor among several — not as the singular cause
  - The deprioritisation is described in context: the reason it made sense (webhook provider confirmed integer IDs, sprint deadline pressure, explicit team decision), not as negligence
  - The review does NOT say Bird's recommendation was "ignored" or that the team "should have" implemented it — instead it describes what was known at the time and why the call was reasonable
  - Other contributing factors surface independently: unannounced sub-provider onboarding, reconciliation job silent-fail behavior (WARNING not ALERT), no process for tracking when tech debt assumptions become invalid
  - What We Learned includes a learning about how assumptions underlying deprioritised items can become stale — framed as a system property, not a blame assignment
  - "Given what we knew" or equivalent framing used when describing the deprioritisation decision
  - Forward Commitments include at least one PROCESS tag addressing how tech debt items with live assumptions are tracked
  - Tone does not assign blame to Bird (for raising and then the team ignoring), Shaq (for implementing without validation), or Coach K (for the prioritisation decision)

failure_modes: |
  - Framing the deprioritisation as negligence or as a mistake Bird or Coach K made
  - Using "should have known" or "should have validated" without replacing with the spec-prescribed framing
  - Treating TD-291 as the single root cause
  - Not surfacing the silent-fail reconciliation job as a contributing factor
  - Not surfacing the unannounced sub-provider change as a contributing factor
  - What We Learned section says "always implement data validation" as a blanket rule — this ignores the legitimate prioritisation context
  - Describing Bird's original flag as having been "ignored"
  - Forward Commitments address only "add normalisation" without addressing the assumption-tracking process gap

scoring_rubric: |
  pass:
    - Deprioritisation described as a reasonable trade-off given what was known at the time
    - At least 4 contributing factors identified: deprioritisation (in context), sub-provider onboarding without notice, silent-fail reconciliation, no assumption-staleness tracking
    - "Given what we knew" or equivalent framing used for the deprioritisation factor
    - No language framing deprioritisation as negligence or Bird's flag as having been ignored
    - Forward Commitments include a PROCESS action for tracking tech-debt assumptions
    - What We Learned is framed as durable insights, not blame

  partial:
    - Deprioritisation named as a factor but tone slips into "should have" framing
    - Fewer than 4 contributing factors
    - Forward Commitments address data validation but not the assumption-tracking process gap
    - "Given what we knew" framing absent

  fail:
    - Deprioritisation framed as negligence
    - "should have known" or "should have validated" present without replacement framing
    - Only 1-2 contributing factors identified
    - Bird, Shaq, or Coach K singled out as primarily responsible
    - Forward Commitments entirely absent or limited to "do the tech debt item"
