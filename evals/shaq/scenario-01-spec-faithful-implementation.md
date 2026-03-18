# Eval: Shaq — Scenario 01 — Spec-Faithful Implementation (Happy Path)

## Overview

Tests Shaq's ability to implement a feature precisely to spec — no more, no less — with tests that cover the acceptance criteria, and a complete output schema including files_changed and acceptance_criteria_coverage.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 85

prompt: |
  Bird has defined these acceptance criteria for a weight bracket classifier:

  AC1: Given a parcel weight of 5 kg, when classifyWeight is called, then it returns "standard"
  AC2: Given a parcel weight of 10 kg, when classifyWeight is called, then it returns "heavy" (10 kg is the lower boundary of heavy — it is inclusive)
  AC3: Given a parcel weight of 50 kg, when classifyWeight is called, then it returns "freight" (50 kg is the lower boundary of freight — it is inclusive)
  AC4: Given a parcel weight of 0 kg, when classifyWeight is called, then it throws a validation error
  AC5: Given a parcel weight of 1001 kg, when classifyWeight is called, then it throws a validation error

  MJ has specified: implement as a pure function in TypeScript with no external dependencies.

  Implement this feature. Produce your full output schema including implementation_summary, acceptance_criteria_coverage, tests, and confidence assessment.

expected_behavior: |
  - Implementation is a pure TypeScript function with correct boundary logic:
    - standard: weight > 0 && weight < 10
    - heavy: weight >= 10 && weight < 50
    - freight: weight >= 50 && weight <= 1000
    - validation error: weight <= 0 OR weight > 1000
  - Tests cover all 5 acceptance criteria exactly (AC1-AC5)
  - Boundary values are tested: 10 (heavy lower bound), 49.99 or 49 (heavy upper bound), 50 (freight lower bound)
  - No external dependencies introduced
  - No additional features beyond the spec (e.g., Shaq does NOT add a "bulk" tier that was not requested)
  - acceptance_criteria_coverage maps AC1-AC5 to specific test names
  - files_changed lists the implementation file and test file with purpose
  - confidence.level >= 90 (clear spec, no ambiguity)

failure_modes: |
  - Boundary error: treating 10 kg as "standard" instead of "heavy" (off-by-one on the boundary)
  - Boundary error: treating 50 kg as "heavy" instead of "freight"
  - Missing validation for weight <= 0 (AC4 not covered)
  - Adding unrequested features (e.g., a currency calculation, a "bulk" tier)
  - Tests that only cover the happy path (AC1) and miss boundary cases
  - acceptance_criteria_coverage missing AC4 or AC5 (error cases often skipped)
  - Introducing a dependency (e.g., a validation library) not approved by MJ

scoring_rubric: |
  pass:
    - Boundaries correct: 10 is heavy, 50 is freight
    - All 5 ACs covered in tests with AC-to-test mapping in acceptance_criteria_coverage
    - No external dependencies
    - No features beyond spec
    - confidence.level >= 85

  partial:
    - Boundaries correct but tests miss 1-2 ACs
    - acceptance_criteria_coverage present but incomplete
    - No unintended features added

  fail:
    - Boundary errors on 10 or 50 kg
    - Tests cover only happy path
    - Features added beyond spec
    - acceptance_criteria_coverage absent
    - External dependency introduced without approval
