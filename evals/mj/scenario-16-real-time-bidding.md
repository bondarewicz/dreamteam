# Eval: MJ — Scenario 16 — Real-Time Bidding Architecture (Very Hard)

## Overview

Tests MJ's ability to design a system with extreme latency requirements (sub-100ms for an auction cycle), which forces hard architectural choices about data locality, computation model, and consistency.

---

category: capability

graders:
  - type: contains
    values: ["latency", "trade_off", "risk", "in-memory", "timeout"]
  - type: section_present
    sections: ["trade_offs", "risks", "implementation_guidance"]
  - type: length_bounds
    min: 600
    max: 10000

prompt: |
  A courier marketplace wants to build a real-time courier bidding system:

  - When an order is placed, the system sends the job to all eligible couriers simultaneously
  - Couriers (via mobile app) have 15 seconds to accept or the job is auto-assigned to the highest-rated available courier
  - During the 15-second window, courier bids (accepting the job) must be processed in real time
  - The system must handle 500 simultaneous active bid windows (500 orders in the bidding phase at once)
  - The first courier to accept wins — acceptance is atomic (two couriers cannot both accept the same job)
  - Average courier pool per zone: 30 couriers

  Design the bidding system architecture. Use your full output schema.

expected_behavior: |
  - MJ identifies the core technical constraint: atomic acceptance of a job by exactly one courier requires a synchronization primitive (cannot be solved by optimistic updates alone)
  - MJ recommends in-memory state for active bid windows (Redis or in-process state) rather than database-first for sub-second consistency
  - Atomic acceptance: MJ recommends a distributed lock or Redis SET NX (set if not exists) as the acceptance primitive — first courier to SET NX wins; subsequent attempts see the key already set
  - 15-second window management: each bid window is a time-bounded state; Redis TTL or in-process timer with fallback auto-assignment
  - Fallback auto-assignment: when timer expires, if no bid received, highest-rated available courier is selected
  - trade_offs: in-memory state is not durable — if the server holding the bid state crashes, that bid window is lost; must decide between durability (write to DB on each bid) vs. latency (keep in memory)
  - risks: Redis becoming a single point of failure for all bid windows; clock skew between the 15-second timer and courier mobile apps; hot key problem if one Redis shard handles all bid windows for a popular zone
  - MJ does NOT recommend a naive database-first approach (inserting each bid acceptance into PostgreSQL would be too slow for atomic acceptance under load)

failure_modes: |
  - Recommending database-first approach for atomic acceptance (INSERT with unique constraint) without acknowledging the latency implication
  - Not identifying the atomic acceptance problem
  - Missing the hot key / Redis scalability problem
  - Missing the durability vs. latency trade-off for in-memory state
  - Not addressing what happens when the timer expires (fallback auto-assignment)

scoring_rubric: |
  pass:
    - Atomic acceptance problem identified and solved (Redis SET NX or equivalent)
    - In-memory state recommended with durability trade-off acknowledged
    - Fallback auto-assignment on timer expiry designed
    - Hot key risk for Redis identified
    - trade_offs includes durability vs. latency

  partial:
    - Atomic acceptance identified and approximately solved
    - In-memory approach mentioned
    - Fallback present
    - Hot key not mentioned

  fail:
    - Database-first approach recommended without latency caveat
    - Atomic acceptance problem not identified
    - No fallback auto-assignment designed
    - No in-memory state consideration
