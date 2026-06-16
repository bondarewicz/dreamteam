# Eval: Pippen — Scenario 21 — C# CancellationToken Not Propagated (Graceful Shutdown Gap)

## Overview

Tests Pippen's ability to identify missing CancellationToken propagation as an operational readiness gap. When a background service doesn't propagate the shutdown token, SIGTERM causes the host to wait for the timeout (default 5s) and then force-kill — potentially mid-transaction or mid-message-processing.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a C# background service that processes shipment events from a message queue. Here is the implementation summary:

  - Service inherits BackgroundService and overrides ExecuteAsync(CancellationToken stoppingToken)
  - Dequeues shipment events in a while loop: `while (!stoppingToken.IsCancellationRequested)`
  - DequeueAsync is called WITHOUT the stoppingToken: `var evt = await _queue.DequeueAsync()`
  - Database writes via EF Core SaveChangesAsync are called WITHOUT the stoppingToken: `await _context.SaveChangesAsync()`
  - HTTP calls to a downstream notification service use a hardcoded 30s timeout with no CancellationToken
  - The service is deployed on Kubernetes with a terminationGracePeriodSeconds of 10

  Other aspects:
  - Structured logging with Serilog on all events (including failure cases)
  - Retry logic with Polly on the downstream notification call
  - Health check endpoint present and includes queue connectivity check
  - Metrics exported for processing rate and error rate

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies CancellationToken not propagated to DequeueAsync and SaveChangesAsync as a readiness blocker
  - Explains: on Kubernetes SIGTERM, stoppingToken is cancelled, but DequeueAsync and SaveChangesAsync continue running — the host waits 10s (terminationGracePeriodSeconds) then force-kills, potentially interrupting a DB write mid-transaction
  - Pippen flags this as NOT READY or READY WITH BLOCKERS — not a minor caveat
  - Correctly praises what IS present: structured logging, retry logic, health check, metrics
  - Does NOT invent gaps in logging or metrics — those are explicitly present
  - Recommends passing stoppingToken to all async calls in the processing loop

failure_modes: |
  - Marking the service READY despite the CancellationToken gap
  - Treating CancellationToken omission as a minor style note rather than a shutdown-correctness issue
  - Not connecting the missing CancellationToken to the 10s terminationGracePeriodSeconds (force-kill risk)
  - Fabricating gaps in logging or metrics that are explicitly stated as present
  - Not explaining the mid-transaction risk on force-kill

scoring_rubric: |
  pass:
    - operational_readiness.deployment_ready is false (or equivalent NOT READY verdict)
    - CancellationToken omission identified as a blocker
    - Mid-transaction / force-kill risk explained
    - Logging, retry, health check, metrics confirmed as present (no fabricated gaps)
    - Fix: pass stoppingToken to DequeueAsync and SaveChangesAsync

  partial:
    - CancellationToken gap identified but classified as a caveat rather than a blocker
    - Verdict READY WITH CAVEATS with clear note about graceful shutdown
    - Force-kill risk not fully explained

  fail:
    - operational_readiness.deployment_ready true despite the CancellationToken gap
    - CancellationToken omission not identified
    - Fabricated gaps in observability that are explicitly present
