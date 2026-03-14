# Eval: Pippen — Scenario 13 — Multi-Service Deployment Readiness (Hard)

## Overview

Tests Pippen's ability to assess a coordinated deployment of two interdependent services and identify the deployment ordering and rollback risks that emerge when services share a database schema change.

---

category: capability

prompt: |
  You are Pippen reviewing a coordinated deployment of two services: UserService and ProfileService. These services share the same PostgreSQL database. Here is the deployment plan:

  Schema migration (to be run before deployment):
  - Add column: users.profile_version (nullable integer, default null)
  - Add column: profiles.version (nullable integer, default null)
  - Both columns will be populated by UserService writing and ProfileService reading

  UserService changes:
  - New feature: writes profile_version to users table on every user update
  - No breaking changes to existing UserService API

  ProfileService changes:
  - New feature: reads profile_version from users table to validate profile cache freshness
  - If profile_version is null (old records not yet updated), ProfileService falls back to a full refresh

  Deployment plan:
  1. Run schema migration
  2. Deploy UserService
  3. Deploy ProfileService

  Rollback plan: "If anything breaks, rollback both services to previous images."

  Each service is independently deployed with standard observability: structured logging, /health, Prometheus metrics.

  Assess whether this deployment is operationally ready.

expected_behavior: |
  - Pippen approves the schema migration approach: nullable columns with defaults is a backward-compatible migration pattern — old service versions can still run against the new schema
  - Pippen validates the deployment ordering: migration first, then UserService, then ProfileService is correct — ProfileService reads a field that UserService writes, so UserService should be deployed first
  - Pippen identifies a gap in the rollback plan: "rollback both services to previous images" is not specific enough — what is the rollback order? Should ProfileService be rolled back before or after UserService? Does the schema need to be rolled back?
  - Pippen flags that schema rollback (dropping the columns) is NOT included in the rollback plan and would be a destructive operation if data has been written to the new columns
  - Pippen recommends a more specific rollback plan with ordering and schema rollback considerations
  - Verdict: READY WITH CAVEATS — deployment plan is sound but rollback plan needs clarification

failure_modes: |
  - Blocking the deployment because the rollback plan is vague (it is a caveat, not a hard blocker)
  - Approving the rollback plan as-is without noting the ordering and schema rollback gaps
  - Not validating the deployment ordering (migration -> UserService -> ProfileService)
  - Not recognizing the nullable columns as a backward-compatible migration pattern

scoring_rubric: |
  pass:
    - Deployment ordering validated as correct (migration -> UserService -> ProfileService)
    - Nullable column migration recognized as backward-compatible
    - Rollback plan gap identified: missing order and schema rollback consideration
    - Schema rollback as destructive operation noted
    - Verdict is READY WITH CAVEATS (not NOT READY — the deployment plan itself is sound)

  partial:
    - Deployment ordering validated but rollback plan gaps only partially identified
    - Schema rollback issue identified but deployment ordering not assessed
    - Verdict correct

  fail:
    - Deployment blocked as NOT READY due to rollback plan vagueness (overcorrection)
    - Deployment ordering not validated
    - Rollback plan gaps not identified
    - Verdict is READY with no caveats
