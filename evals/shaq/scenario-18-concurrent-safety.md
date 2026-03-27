# Eval: Shaq — Scenario 18 — Concurrent Safety Implementation (Expert)

## Overview

Tests Shaq's ability to implement code with correct concurrent safety semantics — specifically recognizing when a check-then-act pattern creates a race condition and implementing an appropriate fix.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1

prompt: |
  Bird has defined these acceptance criteria for a reserveSeat function:

  AC1: Given a seat that is available, when reserveSeat is called, then the seat is marked as reserved and the reservation is returned
  AC2: Given a seat that is already reserved, when reserveSeat is called, then throw SEAT_ALREADY_RESERVED
  AC3: Given two concurrent calls to reserveSeat for the same seat, when both calls complete, then exactly one succeeds and one throws SEAT_ALREADY_RESERVED — no double reservations
  AC4: Given a seat that does not exist, when reserveSeat is called, then throw SEAT_NOT_FOUND

  MJ says: implement reserveSeat(seatId: string, userId: string, db: Database): Promise<Reservation>. The Database interface has:
  - findSeat(seatId: string): Promise<Seat | null>
  - updateSeatStatus(seatId: string, status: string, userId: string, expectedCurrentStatus: string): Promise<boolean> — returns true if the update succeeded (optimistic locking: only updates if current status matches expectedCurrentStatus), false if the seat status has changed since the read

  Implement the function and tests.

expected_behavior: |
  - Implementation uses the optimistic locking pattern: read seat status, attempt update with expectedCurrentStatus = "available", check return value
  - If updateSeatStatus returns false, throw SEAT_ALREADY_RESERVED (another concurrent request reserved it first)
  - AC3 is handled by the optimistic lock: exactly one concurrent caller will get true from updateSeatStatus; the other will get false
  - Tests cover: AC1 (available seat, update returns true), AC2 (reserved seat, findSeat returns reserved status), AC3 (simulated race: update returns false after a successful read), AC4 (seat not found)
  - Shaq recognizes in notes/confidence that AC3 cannot be fully tested with unit tests alone — it requires a race condition test or integration test
  - No naive check-then-act pattern without optimistic locking

failure_modes: |
  - Naive implementation: findSeat, check status is "available", then update without optimistic locking — this has a race condition window
  - Not using the expectedCurrentStatus parameter of updateSeatStatus
  - Not throwing SEAT_ALREADY_RESERVED when updateSeatStatus returns false
  - Not testing the AC3 case (update returns false = concurrent reservation)
  - Not acknowledging that AC3 requires more than a unit test to fully verify

scoring_rubric: |
  pass:
    - Optimistic locking used: updateSeatStatus called with expectedCurrentStatus = "available"
    - False return from updateSeatStatus correctly throws SEAT_ALREADY_RESERVED
    - AC3 test: mock updateSeatStatus returning false after successful findSeat
    - AC4 tested: findSeat returns null -> SEAT_NOT_FOUND
    - Notes or confidence section acknowledges AC3 requires integration/concurrency testing
    - acceptance_criteria_coverage maps all 4 ACs

  partial:
    - Optimistic locking used but AC3 test not present
    - Correct pattern but notes don't mention the concurrency testing limitation
    - 3 of 4 ACs tested

  fail:
    - Naive check-then-act without optimistic locking
    - expectedCurrentStatus parameter not used
    - AC3 not tested or tested incorrectly
    - Race condition acknowledged but not addressed in implementation
