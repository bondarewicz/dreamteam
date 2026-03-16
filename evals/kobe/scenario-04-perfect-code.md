# Eval: Kobe — Scenario 04 — Perfect Code (Negative Case)

## Overview

Tests Kobe's precision: when given genuinely correct, well-structured code with no real issues, Kobe must find zero critical findings and not pad the review with invented risks.

---

category: capability

graders:
  - type: not_contains
    values: ["severity: Critical", "BLOCK", "race condition", "injection"]
  - type: contains
    values: ["SHIP"]
  - type: section_present
    sections: ["Production"]
  - type: length_bounds
    min: 100

prompt: |
  Review the following TypeScript function that validates a courier's eligibility to accept a delivery:

  ```typescript
  interface CourierEligibility {
    isActive: boolean;
    vehicleClass: string;
    currentDeliveries: number;
    maxDeliveries: number;
    rating: number;
    minRequiredRating: number;
  }

  function isCourierEligible(
    courier: CourierEligibility,
    requiredVehicleClass: string
  ): boolean {
    if (!courier.isActive) return false;
    if (courier.vehicleClass !== requiredVehicleClass) return false;
    if (courier.currentDeliveries >= courier.maxDeliveries) return false;
    if (courier.rating < courier.minRequiredRating) return false;
    return true;
  }
  ```

  This is a pure synchronous function. It is called only with data that has already been validated at the database layer. Produce your full output schema.

expected_behavior: |
  - Kobe finds 0 Critical findings
  - Kobe may note at most 1-2 Suggestion-level observations (e.g., the function returns a boolean with no explanation of which condition failed — could be helpful for debugging, but this is a Suggestion, not a finding)
  - production_readiness verdict is SHIP or SHIP WITH MINOR NOTES
  - Kobe does NOT invent risks: "what if isActive is undefined", "what if vehicleClass is null" — the prompt states inputs are pre-validated
  - Kobe does NOT flag the absence of logging, tests, or documentation as findings
  - confidence.level >= 80

failure_modes: |
  - Any Critical or Important findings produced
  - Verdict is BLOCK or SHIP WITH FIXES
  - Invented null/undefined risks for a function with pre-validated inputs
  - Logging absence flagged as a finding
  - Test absence flagged as a Critical or Important finding

scoring_rubric: |
  pass:
    - 0 Critical findings
    - 0 Important findings
    - Verdict is SHIP or equivalent
    - No invented risks for pre-validated inputs
    - confidence.level >= 75

  partial:
    - 0 Critical but 1 Important finding that is at least arguable
    - Verdict is SHIP WITH MINOR FIXES
    - 1 minor invented risk

  fail:
    - Any Critical finding
    - Verdict is BLOCK
    - Multiple invented risks
    - Logging/test absence elevated to Important or Critical
