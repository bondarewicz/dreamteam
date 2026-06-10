# Eval: Shaq — Scenario 21 — C# ASP.NET Core Endpoint with State Transition Validation

## Overview

Tests Shaq's ability to implement a C# ASP.NET Core controller action with business rule enforcement. The spec defines explicit valid state transitions and error responses — Shaq must implement them precisely without adding unasked-for features, and must follow C# idioms.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
    advisory: true
  - type: json_field
    path: confidence.level
    min: 85
    advisory: true

prompt: |
  Bird has defined these acceptance criteria for an order status update endpoint:

  AC1: WHEN PATCH /orders/{id}/status is called with a valid transition, THE SYSTEM SHALL update the order status and return HTTP 200 with the updated order
  AC2: WHEN the order does not exist, THE SYSTEM SHALL return HTTP 404
  AC3: WHEN the requested transition is invalid, THE SYSTEM SHALL return HTTP 409 with a body explaining the allowed transitions from the current status
  AC4: Valid transitions are: Pending→Processing, Processing→Shipped, Shipped→Delivered only
  AC5: WHEN the request body is missing or malformed, THE SYSTEM SHALL return HTTP 400

  MJ has specified:
  - ASP.NET Core minimal API or controller — your choice
  - EF Core for persistence via injected AppDbContext
  - C# record for the request body: `UpdateStatusRequest(OrderStatus NewStatus)`
  - OrderStatus enum: Pending, Processing, Shipped, Delivered, Cancelled
  - No authentication required for this endpoint

  Implement this feature. Produce your full output schema including implementation_summary, acceptance_criteria_coverage, tests, and confidence assessment.

expected_behavior: |
  - Implementation is a C# ASP.NET Core endpoint (controller action or minimal API) with correct transition logic
  - Valid transitions enforced: only Pending→Processing, Processing→Shipped, Shipped→Delivered return 200
  - Returns 404 (NotFound) when order is not found in the database
  - Returns 409 (Conflict) with a message explaining valid transitions from the current status when an invalid transition is requested
  - Returns 400 (BadRequest) on missing/malformed request body (model validation)
  - Uses async/await correctly — all EF Core calls use `await` with `CancellationToken` passed through
  - Tests cover all 5 ACs using xUnit (or NUnit), with at least one test per AC
  - No extra endpoints, no logging beyond what the spec requires, no authentication added
  - acceptance_criteria_coverage maps AC1-AC5 to specific test names
  - confidence.level >= 85

failure_modes: |
  - Allowing Pending→Shipped directly (skipping Processing)
  - Returning 400 instead of 409 for invalid transitions
  - Not passing CancellationToken to EF Core calls
  - Using .Result or .GetAwaiter().GetResult() instead of await
  - Adding features not in spec (audit log, email notification, etc.)
  - Tests covering only the happy path (AC1) and missing error cases
  - Using synchronous EF Core methods (Find instead of FindAsync)

scoring_rubric: |
  pass:
    - All 4 valid transitions correct, no direct jumps allowed (e.g. Pending→Shipped rejected)
    - 404/409/400 responses correct per AC
    - async/await with CancellationToken throughout
    - All 5 ACs covered in tests
    - No unspecified features
    - confidence.level >= 85

  partial:
    - Transitions correct but 1-2 ACs missing from tests
    - CancellationToken absent but async/await otherwise correct

  fail:
    - Invalid transitions allowed (e.g. Pending→Shipped)
    - 409 and 400 responses swapped or missing
    - Sync-over-async (.Result) used
    - Tests cover only AC1
    - acceptance_criteria_coverage absent
