# Eval: Kobe — Scenario 23 — C# HttpClient Socket Exhaustion

## Overview

Tests Kobe's ability to identify the `new HttpClient()` per-call anti-pattern. The code looks idiomatic — it uses `using` for cleanup — but `HttpClient` with `using` causes socket exhaustion under load because TCP sockets enter TIME_WAIT and are held by the OS after disposal.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: critical_findings
    min_items: 1
  - type: json_field
    path: production_readiness.safe_to_deploy
    equals: false

prompt: |
  Review the following C# service that calls an external shipping rate API:

  ```csharp
  public class ShippingRateService
  {
      private readonly IConfiguration _config;

      public ShippingRateService(IConfiguration config)
      {
          _config = config;
      }

      public async Task<decimal> GetRateAsync(string origin, string destination, decimal weightKg)
      {
          using var client = new HttpClient();
          client.BaseAddress = new Uri(_config["ShippingApi:BaseUrl"]);
          client.DefaultRequestHeaders.Add("X-Api-Key", _config["ShippingApi:Key"]);

          var response = await client.GetAsync(
              $"rates?from={origin}&to={destination}&weight={weightKg}");
          response.EnsureSuccessStatusCode();

          var result = await response.Content.ReadFromJsonAsync<RateResponse>();
          return result!.Rate;
      }
  }
  ```

  This service is called on every checkout request. The platform processes ~150 checkouts per minute during peak hours. Produce your full output schema.

expected_behavior: |
  - Kobe identifies `new HttpClient()` per call as Critical — the classic socket exhaustion pattern
  - Explains that `using` disposes the HttpClient but the underlying TCP socket enters TIME_WAIT (OS-held for ~4 minutes by default), exhausting the ephemeral port range under load
  - Notes that at 150 req/min and 4-minute TIME_WAIT, ~600 sockets accumulate — typically exceeding the ephemeral port range or connection limits
  - The fix is `IHttpClientFactory`: register `services.AddHttpClient<ShippingRateService>()` and inject `HttpClient` via constructor — IHttpClientFactory manages socket lifecycle with connection pooling
  - May note secondary issue: the API key read from IConfiguration on every call (minor, not the focus)
  - production_readiness.safe_to_deploy false — will cause SocketException under peak load

failure_modes: |
  - Accepting the code because `using` is present (treating disposal as socket release)
  - Not knowing the IHttpClientFactory fix — recommending making HttpClient a singleton field instead (partially fixes socket exhaustion but causes DNS staleness issue)
  - Classifying as Important rather than Critical given the explicit 150 req/min load context
  - Not explaining the TIME_WAIT mechanism
  - Missing that this is a well-documented .NET anti-pattern

scoring_rubric: |
  pass:
    - new HttpClient() per call identified as Critical
    - TIME_WAIT / socket exhaustion mechanism explained
    - Fix is IHttpClientFactory (not singleton HttpClient field)
    - safe_to_deploy false

  partial:
    - Socket exhaustion identified
    - Fix is singleton HttpClient (mitigates but introduces DNS staleness — acceptable partial credit)
    - safe_to_deploy false

  fail:
    - using accepted as sufficient cleanup
    - safe_to_deploy true
    - Socket exhaustion not identified
