# ADR: Use PostgreSQL Advisory Locks for Nightly Batch Job Coordination

**Status:** Accepted
**Date:** 2026-03-19
**Deciders:** MJ (Strategic Systems Architect)

## Context

The nightly reconciliation batch job was previously running on a single node with no coordination mechanism. The system is being expanded to a multi-node deployment and needs to guarantee that exactly one node executes the batch job per night.

The system already runs PostgreSQL as its primary datastore.

## Decision

Use PostgreSQL session-level advisory locks (`pg_try_advisory_lock`) to coordinate the nightly batch job across nodes. The node that acquires the lock runs the job; all other nodes skip execution for that cycle.

## Rationale

- **No new infrastructure.** PostgreSQL is already in the stack. Advisory locks are a built-in primitive -- no additional service to deploy, monitor, or maintain.
- **Sufficient for the workload.** The job runs once per night from a single coordinator node. Advisory locks handle this level of contention trivially.
- **Simple failure semantics.** If the coordinator crashes, the database connection drops, and the session-level lock is automatically released. No manual cleanup is needed.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| **Redis SETNX** | Introduces a new infrastructure dependency (Redis) solely for lock management. Operationally heavier for a single nightly job. |
| **ZooKeeper** | Significant operational complexity for a coordination need this simple. Overkill. |
| **Custom heartbeat table in PostgreSQL** | Requires application-level TTL/expiry logic, polling, and cleanup. More code to write and maintain than advisory locks for the same outcome. |

## Trade-offs and Risks

- **Lock visibility.** Advisory locks are not visible outside the database (no dashboard, no CLI query beyond `pg_locks`). Operators must query `pg_locks` directly to inspect lock state.
- **No TTL-based expiration.** If a node holds a connection open but stalls (zombie process, network partition that keeps the TCP session alive), the lock persists until the connection is truly closed. For a nightly job with low blast radius, this is acceptable.
- **Session scope.** The lock is tied to the database session, not to a logical timeout. Teams must ensure the batch job's database connection is configured with reasonable TCP keepalive and statement timeout settings so stale sessions are reaped.

## Consequences

- Each node attempts `SELECT pg_try_advisory_lock(<lock_key>)` at the scheduled batch time. The node that returns `true` proceeds; others log a skip and exit.
- Monitoring should include an alert if no node successfully completes the batch job within the expected window (guards against all-nodes-skip scenarios, e.g., key mismatch).
- If the system later requires sub-second coordination, high-frequency locking, or cross-service distributed locks, this decision should be revisited in favor of a dedicated coordination service.
