# Eval: Magic — Scenario 19 — Circular Dependency in Agent Outputs (Expert)

## Overview

Tests Magic's ability to detect a circular dependency buried across three agent outputs, where each agent's design assumes the other has solved a problem, creating a situation where no agent has actually defined the foundational piece.

---

category: capability

prompt: |
  Three agent outputs for the "tenant isolation" feature in a multi-tenant SaaS system:

  Bird (domain analysis):
  - Domain rule: All data access must be scoped to the authenticated tenant. No cross-tenant data leakage is permitted.
  - Domain rule: Tenant context is established at the API gateway before any service is called
  - AC1: Given a request authenticated as Tenant A, when data is queried, then only Tenant A's data is returned
  - Note: Bird assumes MJ will define how tenant context is propagated to downstream services

  MJ (architecture):
  - Tenant context will be propagated via a TenantContext object injected into each service
  - The TenantContext will be populated from the JWT claim "tenant_id" in the incoming request
  - Note: MJ assumes Pippen will define the operational requirements for TenantContext propagation (e.g., how it flows through async jobs and background workers)

  Pippen (operational readiness):
  - Tenant context must be present on all log lines for audit compliance
  - Background workers must inherit tenant context from the job payload
  - Note: Pippen assumes Bird has defined what happens when tenant context is missing or invalid — Pippen is treating "tenant context always present" as a given

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the circular dependency: Bird assumes MJ defines context propagation, MJ assumes Pippen defines async/background requirements, Pippen assumes Bird defines error handling for missing/invalid context
  - The foundational gap: nobody has defined what happens when tenant context is missing or invalid — the error handling and validation logic has been assumed by all three agents
  - Magic escalates: "ESCALATION: Circular assumption detected across three agent outputs. Bird assumes MJ defines tenant context propagation. MJ assumes Pippen defines async context requirements. Pippen assumes Bird defines invalid/missing context handling. No agent has defined: (1) what constitutes valid tenant context, (2) what error is returned when context is missing/invalid, (3) how async jobs handle context inheritance failures. Cannot produce a complete handoff brief until these foundational behaviors are defined."
  - Magic describes what IS defined (JWT claim source, log line requirement, background job inheritance intent) separately from what is undefined
  - No brief produced that asks Shaq to "figure out the missing pieces"

failure_modes: |
  - Missing the circular dependency and synthesizing as if all three outputs are self-contained
  - Identifying the gap but only noting one of the circular references rather than the full chain
  - Inventing the missing behavior (e.g., "return 401 when context is missing")
  - Routing to Shaq to define the missing behavior
  - Partial brief that accurately describes the defined parts but fails to flag the circular assumption

scoring_rubric: |
  pass:
    - Circular dependency chain described: Bird -> MJ -> Pippen -> Bird assumption loop
    - Foundational gap named: missing/invalid tenant context handling is undefined
    - All three specific gaps named: valid context definition, error response, async failure handling
    - Escalation to Coach K with all three gaps described
    - What IS defined correctly summarized separately
    - No invented error handling behavior

  partial:
    - Circular dependency partially identified (two of three links)
    - Gap identified but not all three specific unknowns named
    - Escalation present

  fail:
    - Circular dependency not detected
    - Brief produced synthesizing all three outputs as complete
    - Missing behavior invented
    - Shaq directed to handle the undefined cases
