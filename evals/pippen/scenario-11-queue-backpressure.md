# Eval: Pippen — Scenario 11 — Queue Backpressure and Consumer Lag (Hard)

## Overview

Tests Pippen's ability to assess a queue-based system for backpressure handling and consumer lag — specifically whether the service can handle a burst of messages without silently falling behind or causing downstream issues.

---

category: capability

prompt: |
  You are Pippen reviewing an "image processing worker" before it ships to production. The worker consumes jobs from an SQS queue.

  - The worker pulls 10 messages at a time from SQS (MaxNumberOfMessages=10)
  - Each image processing job takes approximately 2-4 seconds
  - There is one worker instance (single-process, single-threaded job processing)
  - During peak load, the queue receives approximately 300 jobs/minute
  - At peak, the worker can process approximately 15-20 jobs/minute (10 messages batched, ~3s each with some parallelism limited by single thread)
  - No autoscaling configured
  - SQS visibility timeout: 30 seconds (if processing takes longer than 30s, the message becomes visible again and may be processed twice)
  - No dead-letter queue configured
  - Structured JSON logging per job
  - /health endpoint returning 200
  - Metrics: jobs_processed_total, jobs_failed_total

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies the throughput gap: 300 jobs/min inbound vs ~15-20 jobs/min processing capacity — the queue will grow unboundedly at peak
  - Pippen recommends autoscaling (horizontal scaling of worker instances) or increased parallelism within the worker
  - Pippen flags the visibility timeout risk: if a job takes longer than 30s (or the batch of 10 at ~3s each means some jobs wait in the batch), the job becomes visible again and may be processed twice — double processing is a correctness risk
  - Pippen flags the missing dead-letter queue: jobs that repeatedly fail will cycle back to the queue indefinitely, consuming capacity and potentially blocking other jobs
  - Pippen flags the missing queue depth metric for alerting: jobs_processed_total and jobs_failed_total do not measure queue backlog
  - Verdict: NOT READY — throughput gap, double-processing risk, and missing DLQ are all blockers

failure_modes: |
  - Approving because "logging and metrics exist"
  - Not calculating the throughput gap (300 in vs 15-20 out)
  - Missing the visibility timeout double-processing risk
  - Missing the absent DLQ
  - Not recommending autoscaling or parallelism increase
  - Treating the queue depth gap as a nice-to-have rather than an operational blind spot

scoring_rubric: |
  pass:
    - Throughput gap identified: 300/min inbound vs 15-20/min processing capacity
    - Queue growth consequence described (unbounded backlog at peak)
    - Visibility timeout double-processing risk identified
    - Missing DLQ identified as a blocker
    - Queue depth metric gap identified
    - Autoscaling or parallelism recommended
    - Verdict is NOT READY

  partial:
    - Throughput gap identified but visibility timeout missed
    - DLQ gap identified but not framed as a blocker
    - Verdict is NOT READY but missing some key risks

  fail:
    - Throughput gap not calculated
    - Verdict is READY
    - Visibility timeout risk not identified
    - DLQ absence not flagged
