# Eval: Pippen — Scenario 22 — C# Missing IHealthCheck and Unstructured Logging

## Overview

Tests Pippen's ability to identify two C# .NET-specific operational gaps: (1) no IHealthCheck implementation — the health endpoint only confirms the process is alive, not that dependencies are reachable; (2) Console.WriteLine used for logging instead of ILogger<T>, losing structured log fields and Serilog/OpenTelemetry integration.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: operational_readiness.deployment_ready
    equals: false

prompt: |
  You are Pippen reviewing a newly deployed C# ASP.NET Core invoice processing API. Here is what exists:

  - GET /health returns HTTP 200 with `{ "status": "ok" }` — implemented as a minimal API endpoint, not using ASP.NET Core's IHealthCheck / AddHealthChecks() framework
  - The service connects to a SQL Server database (via EF Core) and an Azure Service Bus topic for invoice events
  - Logging is done via Console.WriteLine throughout the codebase: `Console.WriteLine($"Processing invoice {id}");`
  - The application has Serilog registered in Program.cs as the logging provider
  - Retry logic with exponential backoff on Service Bus publish failures (max 3 retries)
  - Circuit breaker on the downstream payment gateway
  - Kubernetes liveness probe points to GET /health
  - Kubernetes readiness probe also points to GET /health

  Assess whether this service is operationally ready for production.

expected_behavior: |
  - Pippen identifies two blockers:
    1. Health check does not verify SQL Server or Service Bus connectivity — the liveness and readiness probes both return 200 even if the DB is unreachable, so Kubernetes cannot detect a broken pod and will not restart or stop routing traffic to it
    2. Console.WriteLine bypasses ILogger<T> and Serilog entirely — log lines have no structured fields, no correlation IDs, no severity levels; they go to stdout but lose all observability integration
  - Recommends: implement IHealthCheck classes for SQL Server (EF Core health check via AddDbContextCheck) and Service Bus; wire with AddHealthChecks() and map to /health
  - Recommends: replace Console.WriteLine with injected ILogger<T> to get structured logging through the registered Serilog pipeline
  - Correctly identifies what IS present: retry logic, circuit breaker
  - operational_readiness.deployment_ready is false

failure_modes: |
  - Accepting GET /health returning 200 as sufficient without dependency checks
  - Not flagging Console.WriteLine as a logging problem when Serilog is registered (bypasses the pipeline)
  - Treating Console.WriteLine as equivalent to ILogger<T> because both write to stdout
  - Marking deployment_ready true because retry and circuit breaker are present
  - Fabricating missing retry/circuit breaker coverage

scoring_rubric: |
  pass:
    - operational_readiness.deployment_ready false
    - Health check gap identified: no IHealthCheck for SQL Server or Service Bus
    - Kubernetes probe consequence explained: broken DB → 200 response → no pod restart
    - Console.WriteLine bypasses ILogger<T>/Serilog identified as a logging gap
    - Retry and circuit breaker confirmed as present (no fabrication)
    - Fixes recommended: AddHealthChecks() + AddDbContextCheck, ILogger<T> injection

  partial:
    - One of the two gaps identified (health check OR logging) but not both
    - Verdict NOT READY with clear note about the identified gap

  fail:
    - deployment_ready true
    - Neither gap identified
    - Console.WriteLine accepted as equivalent to ILogger
    - Health check returning 200 accepted as sufficient
