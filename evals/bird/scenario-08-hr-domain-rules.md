# Eval: Bird — Scenario 08 — HR Domain Rule Extraction (Capability)

## Overview

Tests Bird's ability to extract domain rules from an HR/payroll context where labor law constraints must be distinguished from internal company policy.

---

category: capability

graders:
  - type: contains
    values: ["invariant", "given", "when", "then"]
  - type: regex
    pattern: "(?i)invariant.{0,5}(true|false)"
  - type: section_present
    sections: ["Business Rules", "Acceptance Criteria"]
  - type: field_count
    pattern: "(?i)invariant"
    min: 3
  - type: length_bounds
    min: 400

prompt: |
  An HR software team describes the following rules for their leave management module:

  "Employees accrue 1.5 days of leave per month worked. Leave cannot be taken before it is accrued — employees cannot go into negative leave balance. A leave request must be submitted at least 3 working days in advance, except for medical leave which can be submitted retroactively with a doctor's note within 5 days. Managers can approve or reject leave. Rejected leave does not consume balance. Leave requests cannot span across contract end dates. Unused leave above 10 days cannot be carried over to the next calendar year — it is forfeited."

  Produce a full domain analysis including domain_analysis, business_rules with invariant classification, acceptance_criteria in Given/When/Then format, and confidence assessment.

expected_behavior: |
  - domain_analysis identifies "leave lifecycle" and "leave balance management" as the bounded contexts
  - business_rules includes:
    1. Accrual rate: 1.5 days per month (invariant: false — this is a configurable policy, not a state constraint)
    2. Negative balance not allowed (invariant: true — balance integrity rule)
    3. 3-day advance submission requirement (invariant: false — company policy, may be waived)
    4. Medical leave retroactive submission exception (invariant: false — HR policy)
    5. Rejected leave does not consume balance (invariant: true — balance integrity)
    6. Leave cannot span contract end dates (invariant: true — contractual boundary)
    7. Carryover cap: max 10 days, excess forfeited (invariant: false — policy)
  - Bird distinguishes labor-law-adjacent rules (balance integrity, contract boundary) from HR policy rules (accrual rate, carryover cap)
  - Bird surfaces ambiguity: "What happens to in-flight leave requests if a contract ends mid-period?" and "Is the 5-day retroactive window calendar days or working days?"
  - At least 4 Given/When/Then acceptance criteria covering: accrual, negative balance attempt, medical leave exception, carryover

failure_modes: |
  - Marking accrual rate or carryover policy as invariant: true (these are soft policies)
  - Missing the negative balance constraint as invariant: true
  - Not distinguishing company policy from structural domain invariants
  - Missing the retroactive medical leave exception entirely
  - No ambiguities surfaced

scoring_rubric: |
  pass:
    - All 7 rules identified with correct invariant classification
    - Accrual rate and carryover cap correctly marked invariant: false
    - Negative balance and balance integrity marked invariant: true
    - At least 1 ambiguity surfaced
    - At least 4 Given/When/Then acceptance criteria
    - confidence.level calibrated appropriately

  partial:
    - 5-6 rules identified
    - 1-2 invariant misclassifications
    - 3 acceptance criteria
    - Ambiguity hinted at but not formally surfaced

  fail:
    - Fewer than 4 rules identified
    - All rules marked invariant: true uniformly
    - No acceptance criteria
    - No ambiguities identified
