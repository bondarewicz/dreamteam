# Eval: Shaq — Scenario 08 — Input Validator Implementation (Medium)

## Overview

Tests Shaq's ability to implement a multi-field input validator where validation rules interact — some fields are conditionally required, and validation errors should be collected (not fail-fast) and returned together.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1

prompt: |
  Bird has defined these acceptance criteria for a validateShipmentRequest function:

  AC1: Given all required fields are present and valid, when validateShipmentRequest is called, then it returns { valid: true, errors: [] }
  AC2: Given recipient_name is missing or empty, then errors contains { field: "recipient_name", code: "REQUIRED" }
  AC3: Given weight_kg is 0 or negative, then errors contains { field: "weight_kg", code: "MUST_BE_POSITIVE" }
  AC4: Given weight_kg is greater than 1000, then errors contains { field: "weight_kg", code: "EXCEEDS_MAX" }
  AC5: Given shipment_type is "express" and saturday_delivery is not provided, then errors contains { field: "saturday_delivery", code: "REQUIRED_FOR_EXPRESS" }
  AC6: Given shipment_type is "standard" and saturday_delivery is provided, then errors contains { field: "saturday_delivery", code: "NOT_APPLICABLE_FOR_STANDARD" }
  AC7: Given multiple validation failures at once (e.g., missing recipient_name AND negative weight), then ALL errors are returned together in one response (not fail-fast)

  MJ says: implement as a pure TypeScript function validateShipmentRequest(input: ShipmentRequest): ValidationResult. Input and output types are defined as needed. No external validation libraries.

  Implement the validator and tests.

expected_behavior: |
  - Function collects all errors rather than throwing on first failure
  - AC5 conditional required: saturday_delivery is required only when shipment_type === "express"
  - AC6 conditional forbidden: saturday_delivery is forbidden when shipment_type === "standard"
  - AC7 is tested with a request that has BOTH missing recipient_name AND negative weight — both error objects are present in the returned errors array
  - Tests cover all 7 ACs
  - AC5 and AC6 are tested with explicit inputs (express without saturday_delivery, standard with saturday_delivery)
  - Error objects match the exact shape: { field: string, code: string }
  - No external validation library

failure_modes: |
  - Fail-fast implementation: throws on first error instead of collecting all errors (AC7 fails)
  - AC5 conditional: saturday_delivery checked regardless of shipment_type
  - AC6 missed entirely (only AC5 tested)
  - Error objects have different shape (e.g., { message: string } instead of { field, code })
  - Tests not verifying that multiple errors are returned together (AC7 not covered)

scoring_rubric: |
  pass:
    - All 7 ACs implemented correctly
    - Collect-all errors pattern (not fail-fast)
    - AC5 and AC6 conditional validation correct and distinct
    - Error object shape exactly { field, code } for all errors
    - AC7 tested with a multi-failure request
    - acceptance_criteria_coverage maps all 7 ACs

  partial:
    - 5-6 ACs correct; AC6 or AC7 the likely gap
    - Collect-all pattern partially correct
    - Tests cover 5-6 ACs

  fail:
    - Fail-fast implementation (throws on first error)
    - AC5 and AC6 conflated or only one implemented
    - Tests cover only AC1-AC4 (happy path and simple validations)
    - acceptance_criteria_coverage absent
