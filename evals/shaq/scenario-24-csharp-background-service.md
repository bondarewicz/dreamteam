# Eval: Shaq — Scenario 24 — C# BackgroundService with Graceful Shutdown

## Overview

Tests Shaq's ability to implement a .NET BackgroundService that correctly handles CancellationToken for graceful shutdown, processes work without async void, and handles exceptions without crashing the host.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 80

prompt: |
  Bird has defined these acceptance criteria for an invoice processing background service:

  AC1: THE SYSTEM SHALL dequeue invoices from IInvoiceQueue and process each via IInvoiceProcessor.ProcessAsync
  AC2: WHEN the CancellationToken is cancelled (host shutdown), THE SYSTEM SHALL stop dequeuing and exit ExecuteAsync cleanly
  AC3: WHEN ProcessAsync throws for a single invoice, THE SYSTEM SHALL log the error and continue processing the next invoice (do not crash the host)
  AC4: THE SYSTEM SHALL log a structured message for each successfully processed invoice including the invoice ID
  AC5: THE SYSTEM SHALL NOT use async void anywhere

  MJ has specified:
  - Inherit from BackgroundService
  - IInvoiceQueue has: ValueTask<InvoiceId> DequeueAsync(CancellationToken ct)
  - IInvoiceProcessor has: Task ProcessAsync(InvoiceId id, CancellationToken ct)
  - ILogger<InvoiceProcessingService> for logging
  - Register as a hosted service in DI

  Implement this feature. Produce your full output schema.

expected_behavior: |
  - ExecuteAsync loops calling DequeueAsync with stoppingToken
  - Loop exits cleanly when stoppingToken is cancelled (OperationCanceledException caught and not rethrown, or CancellationToken.IsCancellationRequested checked)
  - Each ProcessAsync call is awaited — no fire-and-forget, no async void
  - Per-invoice try/catch: ProcessAsync exceptions are caught, logged with structured data (InvoiceId), processing continues to next invoice
  - OperationCanceledException from ProcessAsync is NOT swallowed — it should propagate (or re-check cancellation status)
  - Success log includes InvoiceId as a structured field: _logger.LogInformation("Processed invoice {InvoiceId}", id)
  - No async void anywhere in the implementation
  - Tests cover AC1-AC5 including: cancellation stops the loop (AC2), exception on one invoice doesn't stop processing (AC3)
  - confidence.level >= 80

failure_modes: |
  - Using async void for the processing dispatch (violates AC5)
  - Swallowing OperationCanceledException from DequeueAsync (loop never exits on shutdown)
  - Catching Exception globally and re-throwing, which crashes the host on any error (violates AC3)
  - Not passing stoppingToken to ProcessAsync (violates CancellationToken propagation)
  - Logging invoice ID with string interpolation instead of structured logging: _logger.LogInformation($"Processed {id}") — no structured field
  - Tests covering only AC1 (happy path processing)

scoring_rubric: |
  pass:
    - await ProcessAsync (not fire-and-forget, not async void)
    - stoppingToken propagated to both DequeueAsync and ProcessAsync
    - Per-invoice exception handling: catch, log, continue
    - OperationCanceledException from shutdown not swallowed — loop exits cleanly
    - Structured logging with InvoiceId as a field
    - AC1-AC5 covered in tests
    - confidence.level >= 80

  partial:
    - async Task used correctly throughout
    - stoppingToken not propagated to ProcessAsync
    - Exception handling correct but 1-2 ACs missing from tests

  fail:
    - async void used anywhere
    - CancellationToken not handled — service runs forever on shutdown
    - Single Exception catch rethrows and crashes the host
    - acceptance_criteria_coverage absent
