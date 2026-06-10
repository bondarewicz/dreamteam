# Eval: Kobe — Scenario 21 — C# async void Fire-and-Forget

## Overview

Tests Kobe's ability to identify the `async void` anti-pattern in a C# background service. The method appears safe — it has a try/catch — but `async void` makes it impossible to await, swallows unhandled exceptions in edge cases, and provides no backpressure to the caller.

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
  Review the following C# background service for a logistics platform:

  ```csharp
  public class OrderProcessor : BackgroundService
  {
      private readonly IOrderQueue _queue;
      private readonly IOrderService _orderService;
      private readonly ILogger<OrderProcessor> _logger;

      public OrderProcessor(IOrderQueue queue, IOrderService orderService, ILogger<OrderProcessor> logger)
      {
          _queue = queue;
          _orderService = orderService;
          _logger = logger;
      }

      protected override async Task ExecuteAsync(CancellationToken stoppingToken)
      {
          await foreach (var orderId in _queue.ReadAllAsync(stoppingToken))
          {
              ProcessOrderAsync(orderId);
          }
      }

      public async void ProcessOrderAsync(Guid orderId)
      {
          try
          {
              await _orderService.ProcessAsync(orderId);
          }
          catch (Exception ex)
          {
              _logger.LogError(ex, "Failed to process order {OrderId}", orderId);
          }
      }
  }
  ```

  `ProcessAsync` makes database writes and publishes events to a message broker. Produce your full output schema.

expected_behavior: |
  - Kobe identifies `async void` as a Critical finding
  - Explains that `async void` cannot be awaited — ProcessOrderAsync runs fire-and-forget with no backpressure
  - Explains that if ProcessAsync throws before the first await (synchronously), the exception propagates to the synchronization context and crashes the process, bypassing the catch block
  - Notes that `ExecuteAsync` dispatches all queue messages immediately with no flow control — a burst of 10,000 messages launches 10,000 concurrent tasks
  - Fix: change `async void` to `async Task`, and `await ProcessOrderAsync(orderId)` in the loop (or use a semaphore for concurrency limiting)
  - production_readiness.safe_to_deploy is false (data loss risk on exception + no backpressure)

failure_modes: |
  - Not identifying async void as a problem because the try/catch looks correct
  - Missing that the catch block does not protect against synchronous exceptions thrown before the first await
  - Not noting the unbounded concurrency (no backpressure on queue burst)
  - Classifying as Important rather than Critical given data-write context
  - Recommending `Task.Run(async () => ...)` as the fix (still fire-and-forget)

scoring_rubric: |
  pass:
    - async void identified as Critical
    - At least one of: cannot be awaited, exception bypass, or no backpressure explained
    - Fix is `async Task` + `await` (not Task.Run)
    - safe_to_deploy false

  partial:
    - async void flagged but classified Important not Critical
    - Fix correct but only one consequence explained

  fail:
    - async void not flagged
    - try/catch accepted as making it safe
    - safe_to_deploy true
