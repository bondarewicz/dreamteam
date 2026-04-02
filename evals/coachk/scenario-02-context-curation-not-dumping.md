# Eval: Coach K — Scenario 02 — Context Curation for Shaq (Capability)

## Overview

Tests that Coach K curates a focused domain brief for Shaq rather than dumping Bird's entire verbose output. The Quick Fix Context Rule states: "Shaq gets a focused brief with only the domain rules, acceptance criteria, and terms needed for implementation." This scenario provides a large Bird output with many irrelevant sections and tests whether Coach K distills it to what Shaq actually needs.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "orchestration_decision.target_agent"
    equals: "shaq"
  - type: json_field
    path: "context_curation.included"
    min_items: 2
  - type: json_field
    path: "context_curation.excluded"
    min_items: 1
  - type: json_field
    path: "context_curation.rationale"
    type_check: "string"
  - type: json_field
    path: "confidence.level"
    min: 70
    max: 100

prompt: |
  You are Coach K orchestrating a Quick Fix workflow. Eval capture is disabled.

  The user's request: "Add a /health endpoint to the API that returns { status: 'ok' } with a 200 response."

  Bird has completed domain analysis. Here is Bird's FULL output (note: it is intentionally verbose with sections irrelevant to implementation):

  {
    "domain_analysis": {
      "bounded_context": "API infrastructure",
      "entities": ["HealthEndpoint", "APIRouter", "HTTPResponse"],
      "ubiquitous_language": [
        { "term": "health check", "definition": "An endpoint that returns service liveness status" },
        { "term": "readiness probe", "definition": "An endpoint that returns whether the service can accept traffic" },
        { "term": "liveness probe", "definition": "An endpoint that returns whether the service process is running" },
        { "term": "startup probe", "definition": "An endpoint that returns whether the service has completed initialization" },
        { "term": "circuit breaker", "definition": "A pattern that prevents cascading failures by short-circuiting requests to failing dependencies" },
        { "term": "bulkhead", "definition": "A pattern that isolates failures in one part of the system from affecting others" },
        { "term": "sidecar", "definition": "A container that runs alongside the main application container" },
        { "term": "service mesh", "definition": "Infrastructure layer that handles service-to-service communication" }
      ],
      "strategic_context": "Health endpoints are a foundational infrastructure concern. In microservice architectures, health checks enable orchestration platforms (Kubernetes, ECS) to manage service lifecycle. The broader pattern includes liveness, readiness, and startup probes, each serving different orchestration needs. Industry standards like OpenTelemetry health check protocol and Spring Boot Actuator provide reference implementations."
    },
    "business_rules": [
      { "id": "BR-1", "rule": "The /health endpoint must return HTTP 200 with body { \"status\": \"ok\" }", "invariant": true, "testable_assertion": "GET /health returns 200 with JSON body containing status='ok'" },
      { "id": "BR-2", "rule": "The /health endpoint must respond within 100ms under normal conditions", "invariant": false, "testable_assertion": "GET /health responds in < 100ms" },
      { "id": "BR-3", "rule": "The /health endpoint must not require authentication", "invariant": true, "testable_assertion": "GET /health without auth headers returns 200, not 401/403" },
      { "id": "BR-4", "rule": "Future readiness probes should check database connectivity", "invariant": false, "testable_assertion": "N/A - future work" },
      { "id": "BR-5", "rule": "Health endpoints in microservice architectures typically follow the OpenTelemetry health check protocol", "invariant": false, "testable_assertion": "N/A - informational" }
    ],
    "acceptance_criteria": [
      { "id": "AC-1", "given": "The API is running", "when": "GET /health is called", "then": "Response status is 200 and body is { \"status\": \"ok\" }" },
      { "id": "AC-2", "given": "The API is running", "when": "GET /health is called without auth headers", "then": "Response status is 200 (no 401/403)" },
      { "id": "AC-3", "given": "The API is running", "when": "GET /health is called", "then": "Response Content-Type is application/json" }
    ],
    "edge_cases": [
      { "id": "EC-1", "description": "What if the database is down? Should /health still return 200? (Yes - liveness, not readiness)" },
      { "id": "EC-2", "description": "What if the /health path conflicts with an existing route?" },
      { "id": "EC-3", "description": "What about HEAD /health requests? Should they be supported?" },
      { "id": "EC-4", "description": "In a blue-green deployment, health checks determine traffic routing. A flapping health endpoint could cause cascading deployment failures across the fleet." }
    ],
    "confidence": { "level": 88, "assumptions": ["Simple liveness check, not readiness", "No dependency checks needed"] }
  }

  The user has approved Bird's analysis at the checkpoint. Produce your orchestration decision and context curation as raw JSON using this schema:
  {
    "orchestration_decision": {
      "action": "spawn_agent|present_checkpoint|route_fix_verify|...",
      "target_agent": "shaq|bird|mj|...",
      "rationale": "why this action"
    },
    "context_curation": {
      "included": ["list of what was included in the Shaq prompt"],
      "excluded": ["list of what was excluded and why"],
      "rationale": "why these curation choices"
    },
    "checkpoint_analysis": {
      "summary": "state of play",
      "agent_findings": [],
      "trade_offs": [],
      "recommendation": ""
    },
    "confidence": {
      "level": 85,
      "high_confidence_areas": [],
      "low_confidence_areas": []
    }
  }

  Your ENTIRE response must be raw JSON. No markdown, no fences, no commentary.

expected_behavior: |
  Coach K must produce valid JSON showing a curated context_curation that:
  - Includes BR-1 (return 200 with status ok) and BR-3 (no auth required) — the implementation-relevant invariants
  - Includes AC-1, AC-2, AC-3 — the acceptance criteria
  - Includes "health check" term from ubiquitous_language — relevant to implementation
  - Excludes BR-4 (future readiness probes — out of scope) in context_curation.excluded
  - Excludes BR-5 (OpenTelemetry reference — informational) in context_curation.excluded
  - Excludes irrelevant ubiquitous_language terms (sidecar, service mesh, circuit breaker, bulkhead)
  - Excludes strategic_context paragraph about microservice architectures
  - Excludes EC-4 (blue-green deployment cascading failures — not relevant to simple endpoint)
  - Sets target_agent to "shaq"
  - Has a rationale explaining the curation logic

failure_modes: |
  - Output is not valid JSON
  - context_curation.excluded is empty (no curation happened — everything was dumped)
  - context_curation.included references "BIRD OUTPUT" verbatim (full dump, no curation)
  - BR-4 (future readiness probes) appears in context_curation.included as a requirement
  - target_agent is not "shaq"
  - context_curation.rationale is missing or empty

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - target_agent = "shaq"
    - context_curation.excluded has at least 1 item (showing actual curation happened)
    - context_curation.included has at least 2 items referencing the relevant rules/ACs
    - context_curation.rationale is a non-empty string
    - confidence.level is a number

  partial:
    - Valid JSON and correct target_agent but context_curation.excluded is empty
    - Curates somewhat but excluded list doesn't mention BR-4 or irrelevant terms
    - included and excluded both present but rationale is missing

  fail:
    - Output is not valid JSON
    - target_agent is not "shaq"
    - context_curation.included says "Bird's complete output" (full dump)
    - Both included and excluded are empty arrays
    - JSON missing required top-level keys
