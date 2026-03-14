# Eval: Shaq — Scenario 15 — Performance-Critical Implementation (Very Hard)

## Overview

Tests Shaq's ability to implement a feature where performance is explicitly specified as an acceptance criterion, and to recognize when a naive implementation would fail the performance AC and choose an appropriate algorithm or data structure.

---

category: capability

prompt: |
  Bird has defined these acceptance criteria for a findDuplicateOrderIds function:

  AC1: Given a list of order IDs (strings), when findDuplicateOrderIds is called, then it returns a list of IDs that appear more than once in the input
  AC2: Given a list with no duplicates, when findDuplicateOrderIds is called, then it returns an empty array
  AC3: Given a list of 1,000,000 order IDs where approximately 1% are duplicates, when findDuplicateOrderIds is called, then it completes in under 100ms on modern hardware
  AC4: Given a list with multiple duplicates, the returned list contains each duplicate ID exactly once (not once per occurrence)
  AC5: Given an empty list, when findDuplicateOrderIds is called, then it returns an empty array

  MJ says: implement as a TypeScript function findDuplicateOrderIds(orderIds: string[]): string[]. No external dependencies.

  Note from MJ: a naive O(n²) comparison-based approach will fail AC3. Choose an appropriate algorithm.

  Implement the function and tests.

expected_behavior: |
  - Implementation uses an O(n) algorithm: a Map or Set to count occurrences in a single pass
  - AC3's performance requirement is acknowledged in the implementation notes or confidence section
  - AC4 ensures each duplicate is returned only once (not once per occurrence — deduplicated result)
  - Tests cover: list with duplicates (AC1), no duplicates (AC2), empty list (AC5), list with the same ID 3+ times (AC4 edge case — should appear once in output)
  - Shaq explains in the implementation or notes why O(n) was chosen (referencing AC3)
  - The confidence section notes that AC3 cannot be verified by a unit test — it is a runtime characteristic

failure_modes: |
  - O(n²) implementation (nested loops comparing every pair) — fails AC3 for large inputs
  - Returning duplicates multiple times (e.g., if "X" appears 3 times, returning "X" twice) — fails AC4
  - Tests that do not cover AC4 edge case (ID appearing 3+ times)
  - Not acknowledging the O(n) requirement or why the algorithm was chosen
  - Not noting that AC3 requires a runtime test, not a unit test

scoring_rubric: |
  pass:
    - O(n) algorithm: Map/Set used for frequency counting
    - AC4 correctly returns each duplicate exactly once
    - Tests cover AC4 edge case (ID appearing 3+ times, returned once)
    - Notes that O(n²) was explicitly rejected due to AC3
    - Confidence section notes AC3 requires runtime validation
    - acceptance_criteria_coverage maps all 5 ACs

  partial:
    - O(n) algorithm used but AC4 edge case not tested
    - Performance choice explained but confidence note on AC3 absent
    - Tests cover AC1, AC2, AC5 but not AC4 edge case

  fail:
    - O(n²) implementation
    - Duplicates returned multiple times (AC4 wrong)
    - Tests only cover AC1 and AC2
    - Performance AC3 not discussed or acknowledged
    - acceptance_criteria_coverage absent
