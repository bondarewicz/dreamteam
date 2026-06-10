# Eval: Shaq — Scenario 22 — C# EF Core Repository with CancellationToken

## Overview

Tests Shaq's ability to implement a C# EF Core repository that correctly propagates CancellationToken through all async calls. CancellationToken propagation is a correctness requirement for graceful shutdown and request cancellation — omitting it silently breaks cancellation chains.

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
    min: 80
    advisory: true

prompt: |
  Bird has defined these acceptance criteria for a customer repository:

  AC1: WHEN GetByIdAsync is called with an existing customer ID, THE SYSTEM SHALL return the Customer entity
  AC2: WHEN GetByIdAsync is called with a non-existent ID, THE SYSTEM SHALL return null
  AC3: WHEN GetAllActiveAsync is called, THE SYSTEM SHALL return only customers where IsActive is true, ordered by LastName ascending
  AC4: WHEN UpdateAsync is called, THE SYSTEM SHALL persist the updated customer and return the saved entity
  AC5: ALL async methods SHALL accept and propagate a CancellationToken parameter

  MJ has specified:
  - Interface: ICustomerRepository with the three methods above
  - EF Core via injected AppDbContext
  - Concrete class: CustomerRepository implementing ICustomerRepository
  - No caching, no pagination — keep it minimal

  Implement this feature. Produce your full output schema.

expected_behavior: |
  - ICustomerRepository interface declared with all three methods, each accepting CancellationToken ct = default
  - CustomerRepository implements all three methods
  - GetByIdAsync uses FindAsync(id, ct) or FirstOrDefaultAsync with ct
  - GetAllActiveAsync filters .Where(c => c.IsActive).OrderBy(c => c.LastName).ToListAsync(ct)
  - UpdateAsync uses _context.Update(customer) + await _context.SaveChangesAsync(ct), returns saved entity
  - CancellationToken appears in every EF Core async call — not just the method signature
  - Tests cover AC1-AC5: include a test that verifies CancellationToken is passed (or at minimum that the method signature accepts it)
  - No additional methods beyond spec (no Delete, no Create, no pagination)

failure_modes: |
  - CancellationToken in the method signature but not passed to EF Core calls (ct is accepted but ignored)
  - Using synchronous EF Core methods (Find instead of FindAsync, ToList instead of ToListAsync)
  - GetAllActiveAsync returning all customers without the IsActive filter
  - UpdateAsync not calling SaveChangesAsync (entity mutated in memory only, not persisted)
  - Adding CRUD methods not in spec (Delete, Create)
  - Tests not covering AC5 (cancellation token propagation)

scoring_rubric: |
  pass:
    - CancellationToken in all method signatures AND passed to all EF Core async calls
    - All three methods implemented correctly per AC
    - GetAllActiveAsync filters IsActive and orders by LastName
    - UpdateAsync calls SaveChangesAsync
    - All 5 ACs covered in tests
    - confidence.level >= 80

  partial:
    - CancellationToken in signatures but silently dropped in EF Core calls
    - Implementation otherwise correct
    - 3-4 ACs covered in tests

  fail:
    - CancellationToken absent from method signatures entirely
    - Synchronous EF Core methods used (.ToList, .Find)
    - IsActive filter missing
    - SaveChangesAsync not called in UpdateAsync
