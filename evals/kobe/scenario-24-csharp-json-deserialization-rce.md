# Eval: Kobe — Scenario 24 — C# JSON.NET TypeNameHandling RCE

## Overview

Tests Kobe's ability to identify a remote code execution vulnerability via JSON.NET `TypeNameHandling.All` on user-controlled input. This is a well-documented CVE class (e.g., CVE-2017-9424 pattern) — accepting arbitrary `$type` fields allows an attacker to instantiate any class on the server.

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
  - type: json_field
    path: confidence.level
    min: 85
    advisory: true

prompt: |
  Review the following C# ASP.NET Core endpoint for a workflow automation feature:

  ```csharp
  [HttpPost("workflow/execute")]
  public IActionResult ExecuteWorkflow([FromBody] string workflowJson)
  {
      var settings = new JsonSerializerSettings
      {
          TypeNameHandling = TypeNameHandling.All,
          TypeNameAssemblyFormatHandling = TypeNameAssemblyFormatHandling.Full
      };

      var workflow = JsonConvert.DeserializeObject<WorkflowDefinition>(workflowJson, settings);
      _workflowEngine.Execute(workflow);
      return Ok(new { status = "started" });
  }
  ```

  The endpoint is public-facing. `workflowJson` comes directly from the HTTP request body. Produce your full output schema.

expected_behavior: |
  - Kobe identifies TypeNameHandling.All on user-controlled input as Critical (STOP_SHIP)
  - Explains the attack: an attacker sends JSON with a `$type` field pointing to a .NET class with dangerous side effects in its constructor or setter (e.g., System.Windows.Data.ObjectDataProvider, FileInfo, or any class that executes code on deserialization)
  - Notes that TypeNameAssemblyFormatHandling.Full makes this worse — it resolves the full assembly path, giving the attacker access to all loaded assemblies
  - Fix options ranked: (1) remove TypeNameHandling entirely and use discriminated unions/explicit type fields; (2) implement a strict SerializationBinder whitelist; (3) switch to System.Text.Json which does not support TypeNameHandling by default
  - production_readiness.safe_to_deploy is false
  - confidence.level >= 90 (this is a definitively known vulnerability class)

failure_modes: |
  - Not recognizing TypeNameHandling.All as a security vulnerability
  - Classifying as Important rather than Critical for a public-facing endpoint
  - Proposing input sanitization as the fix (not effective — the issue is in the deserializer itself)
  - Not knowing the SerializationBinder mitigation
  - Missing that TypeNameAssemblyFormatHandling.Full compounds the risk
  - Recommending TypeNameHandling.Auto instead of TypeNameHandling.None (Auto is also vulnerable)

scoring_rubric: |
  pass:
    - TypeNameHandling.All identified as Critical / STOP_SHIP
    - Attack vector explained ($type field / arbitrary class instantiation)
    - Fix removes TypeNameHandling or adds a strict SerializationBinder whitelist
    - safe_to_deploy false
    - confidence.level >= 85

  partial:
    - Vulnerability identified but classified as Important not Critical
    - Fix is correct (remove TypeNameHandling) but attack not explained
    - safe_to_deploy false

  fail:
    - TypeNameHandling.All not flagged as a vulnerability
    - safe_to_deploy true
    - Input sanitization proposed as the fix
    - confidence.level < 80
