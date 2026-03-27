# Eval: Shaq — Scenario 05 — API Endpoint Implementation (Medium)

## Overview

Tests Shaq's ability to implement a REST API endpoint with input validation, error handling, and tests that cover both success and error paths precisely as specified.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 80

prompt: |
  Bird has defined these acceptance criteria for a PATCH /users/{id}/email endpoint:

  AC1: Given a valid user ID and a valid new email address, when PATCH /users/{id}/email is called, then the user's email is updated and a 200 response with the updated user object is returned
  AC2: Given a valid user ID and an email that is already in use by another user, when PATCH /users/{id}/email is called, then a 409 is returned with error code EMAIL_ALREADY_IN_USE
  AC3: Given a valid user ID and an invalid email format (e.g., "not-an-email"), when the endpoint is called, then a 400 is returned with error code INVALID_EMAIL_FORMAT
  AC4: Given a user ID that does not exist, when the endpoint is called, then a 404 is returned with error code USER_NOT_FOUND
  AC5: Given a valid request where the new email is the same as the current email, when the endpoint is called, then a 200 is returned with no change made (idempotent)

  MJ says: implement as an Express.js handler function. Use a UserRepository with methods: findById(id), findByEmail(email), updateEmail(id, email). The repository is injected.

  Implement the endpoint handler and tests.

expected_behavior: |
  - Handler correctly maps all five ACs to their HTTP response codes and error codes
  - AC2 check (email in use) calls findByEmail and checks if the result is a different user
  - AC3 uses a simple email regex or format validator — does not use an external library
  - AC5 handles same-email case: if findByEmail returns the same user ID, returns 200 without calling updateEmail
  - Tests cover all 5 ACs with explicit test case names
  - No external validation library introduced (MJ did not approve one)
  - acceptance_criteria_coverage maps each AC to a test name
  - files_changed lists the handler file and test file

failure_modes: |
  - AC5 not handled: same email causes 409 (EMAIL_ALREADY_IN_USE) because findByEmail returns a match
  - AC2 and AC5 conflated: the code treats any email match as a conflict without checking if it's the same user
  - Tests cover only AC1 and AC4
  - External validation library (e.g., joi, zod) introduced for AC3
  - Error codes missing from responses (just HTTP status codes without the code field)

scoring_rubric: |
  pass:
    - All 5 ACs implemented correctly with correct HTTP codes and error codes
    - AC5 same-email idempotency correctly handled (distinct from AC2 conflict check)
    - No external dependencies for validation
    - Tests cover all 5 ACs
    - acceptance_criteria_coverage maps all 5 ACs to tests

  partial:
    - 4 of 5 ACs implemented, AC5 idempotency case the likely gap
    - Tests cover 3-4 ACs
    - acceptance_criteria_coverage partially complete

  fail:
    - AC5 treated as AC2 (same email returns 409)
    - Tests cover only happy path
    - Error codes absent from responses
    - External validation library introduced
    - acceptance_criteria_coverage absent
