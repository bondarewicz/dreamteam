# Eval: Kobe — Scenario 25 — C# Sync-Over-Async Thread Pool Starvation

## Overview

Tests Kobe's ability to identify sync-over-async (.Result / .GetAwaiter().GetResult()) in an ASP.NET Core controller. This pattern blocks thread pool threads and causes thread pool starvation under load — a production reliability issue, not just a style concern.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: critical_findings
    min_items: 1
    advisory: true
  - type: json_field
    path: production_readiness.safe_to_deploy
    equals: false

prompt: |
  Review the following C# ASP.NET Core controller action that generates a CSV report:

  ```csharp
  [HttpGet("reports/{id}/export")]
  public IActionResult ExportReport(int id)
  {
      var report = _reportService.GenerateAsync(id).Result;
      var csv    = _exportService.ToCsvAsync(report).GetAwaiter().GetResult();

      return File(Encoding.UTF8.GetBytes(csv), "text/csv", $"report-{id}.csv");
  }
  ```

  `GenerateAsync` queries the database and runs aggregation logic (~500ms average). `ToCsvAsync` serialises the result (~100ms). The endpoint is called up to 80 times per minute during end-of-month reporting periods. Produce your full output schema.

expected_behavior: |
  - Kobe identifies sync-over-async (.Result and .GetAwaiter().GetResult()) as Critical
  - Explains the thread pool starvation mechanism: each blocked call holds a thread pool thread for 600ms; at 80 req/min and 600ms duration, ~80 threads are simultaneously blocked, exhausting the default thread pool minimum thread count
  - Notes that ASP.NET Core uses the thread pool for request handling — when threads are exhausted, new requests queue and latency spikes
  - Fix: make the action `async Task<IActionResult>` and await both calls — zero thread blocking, all I/O-bound waits released back to the thread pool
  - May note that GetAwaiter().GetResult() also re-throws exceptions without AggregateException wrapping (minor correctness note vs the main problem)
  - production_readiness.safe_to_deploy false

failure_modes: |
  - Accepting .Result because "it works in tests" (tests run with small concurrency)
  - Classifying as a style issue rather than Critical reliability risk
  - Proposing increasing the thread pool size as the fix (palliative, not a fix)
  - Missing the thread pool starvation mechanism entirely
  - Not noting that the async methods should be awaited rather than blocked on

scoring_rubric: |
  pass:
    - .Result and GetAwaiter().GetResult() identified as Critical
    - Thread pool starvation mechanism explained (blocked threads under concurrent load)
    - Fix is async Task<IActionResult> + await (not thread pool tuning)
    - safe_to_deploy false

  partial:
    - Sync-over-async flagged but described only as a deadlock risk (not thread starvation)
    - Fix correct but mechanism not explained
    - safe_to_deploy false

  fail:
    - .Result accepted as equivalent to await
    - Classified as Important or style issue only
    - safe_to_deploy true
    - Thread pool starvation not identified
