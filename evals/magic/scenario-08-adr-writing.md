# Eval: Magic — Scenario 08 — ADR Writing (Medium)

## Overview

Tests Magic's ability to produce a well-formed Architecture Decision Record (ADR) from MJ's architecture decision, capturing the context, decision, consequences, and alternatives considered.

---

category: capability

prompt: |
  MJ produced this architecture decision note:
  - Decision: Use PostgreSQL advisory locks (pg_try_advisory_lock) for distributed coordination of the nightly batch job instead of a separate Redis-based lock service.
  - Rationale: The system already runs PostgreSQL; adding Redis solely for lock management introduces a new infrastructure dependency. Advisory locks are sufficient for the expected load (one batch job per night, single coordinator node).
  - Trade-offs: Advisory locks are not visible outside the database and don't support TTL-based expiration. If the coordinator crashes mid-batch, the lock will be held until the session ends (connection drop releases the lock). This is acceptable given the low frequency of the job.
  - Alternatives considered: Redis SETNX, ZooKeeper, a custom heartbeat table in PostgreSQL.
  - Context: The nightly reconciliation job was previously running on a single node with no coordination. The system is being expanded to multiple nodes and needs to ensure only one node runs the batch job per night.

  Write an ADR for this decision.

expected_behavior: |
  - ADR is structured with standard sections: Title, Status, Context, Decision, Consequences, Alternatives Considered
  - Title is concise: something like "Use PostgreSQL Advisory Locks for Batch Job Coordination"
  - Status is set to a reasonable value (e.g., "Accepted" or "Proposed")
  - Context section accurately describes the problem: multi-node expansion, need for single-coordinator guarantee
  - Decision section names the chosen approach: pg_try_advisory_lock, and briefly states the rationale (no new infra dependency)
  - Consequences section covers BOTH the benefit (no Redis dependency) AND the risk (crash during batch leaves lock held until connection drop)
  - Alternatives Considered section lists all three alternatives MJ mentioned: Redis SETNX, ZooKeeper, PostgreSQL heartbeat table
  - No invented information (e.g., Magic should not add "we also evaluated etcd" if MJ did not mention it)
  - ADR is self-contained and readable without the source material

failure_modes: |
  - Omitting the crash-recovery risk from Consequences (this is critical operational context)
  - Listing fewer than all three alternatives MJ mentioned
  - Inventing alternatives not mentioned by MJ
  - Context section that doesn't explain why coordination is needed (just says "we chose advisory locks")
  - Status field missing
  - ADR that reads as a copy of MJ's notes rather than a structured decision record

scoring_rubric: |
  pass:
    - All standard ADR sections present: Title, Status, Context, Decision, Consequences, Alternatives Considered
    - Crash-recovery lock behavior explicitly described in Consequences
    - All three alternatives listed (Redis SETNX, ZooKeeper, heartbeat table)
    - Context explains the multi-node expansion problem
    - No invented information
    - ADR is readable as a standalone document

  partial:
    - Most ADR sections present but one missing (e.g., no Status or no Alternatives)
    - Crash-recovery risk mentioned but not clearly explained
    - Two of three alternatives listed

  fail:
    - ADR sections absent or unstructured
    - Crash-recovery risk omitted from Consequences
    - Fewer than two alternatives listed
    - Invented context or alternatives
