# Eval: MJ — Scenario 02 — System Health Diagnosis (Edge Case)

## Overview

Tests MJ's hypothesis-driven diagnosis methodology on a degraded system. The scenario includes multiple plausible causes; MJ must distinguish symptoms from root causes and avoid confirming the first hypothesis without evidence.

---

category: regression

graders:
  - type: contains
    values: ["hypothesis", "N+1", "external API", "observability", "tracing"]
  - type: section_present
    sections: ["risks"]
  - type: field_count
    pattern: "hypothesis\\|H[0-9]"
    min: 3
  - type: length_bounds
    min: 400

prompt: |
  A logistics API has been experiencing increasing response times over the past two weeks. The team reports:
  - P99 latency increased from 200ms to 1800ms
  - The increase happened gradually, not after a deployment
  - Database query times look normal in the dashboard
  - The service handles ~10,000 requests/day
  - The service queries three external APIs: a geocoding service, a carrier rates API, and a payment gateway
  - No errors are being reported — requests succeed, just slowly

  Diagnose the likely root causes. Use your full output schema. Form and evaluate multiple hypotheses before concluding.

expected_behavior: |
  - MJ forms at least 3 distinct hypotheses before recommending investigation steps:
    H1: External API degradation (one of the three APIs slowed down)
    H2: Connection pool exhaustion causing queuing (gradual increase fits this pattern)
    H3: Memory leak or GC pressure on the service itself
    H4: N+1 query pattern emerging as data volume grew (even if per-query times look normal, query COUNT may have increased)
  - MJ explicitly distinguishes symptom (slow responses) from candidate root causes
  - MJ identifies that "database query times look normal" rules out direct DB slowness but does NOT rule out N+1 (total query count could be the issue)
  - MJ recommends specific investigation steps with reasoning: check external API latency distributions (not averages), check connection pool metrics, check query count per request over time
  - risks section notes that without distributed tracing, root cause cannot be confirmed — flags this as an observability gap
  - MJ does not pick a single root cause without evidence; he produces a prioritized list of hypotheses to verify

failure_modes: |
  - Picking one hypothesis (e.g., "it's the database") and presenting it as the answer without acknowledging alternatives
  - Accepting "database query times look normal" as conclusively ruling out all database-related causes (misses N+1 pattern)
  - Not mentioning external API degradation given three external APIs are present
  - Producing generic recommendations ("add caching", "optimize queries") without tying them to specific hypotheses
  - Missing the observability gap (no distributed tracing means root cause is unconfirmable without additional instrumentation)
  - Failing to note that gradual increase over two weeks is a diagnostic signal (suggests load growth or leak, not deployment regression)

scoring_rubric: |
  pass:
    - At least 3 distinct hypotheses formed before recommendations
    - N+1 query pattern identified as plausible despite "normal query times" dashboard
    - External API degradation hypothesis included
    - Specific investigation steps tied to specific hypotheses
    - Observability gap (missing distributed tracing) explicitly flagged
    - Gradual increase pattern used as a diagnostic signal
    - No single root cause declared without evidence

  partial:
    - 2 hypotheses formed
    - Investigation steps present but not tied to specific hypotheses
    - N+1 mentioned but not explained
    - Observability gap mentioned implicitly

  fail:
    - Single root cause declared without evidence
    - N+1 pattern not considered
    - External API degradation not considered despite 3 external APIs
    - Generic recommendations without hypothesis-to-action mapping
    - Observability gap not mentioned
