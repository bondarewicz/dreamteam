# Eval: Magic — Scenario 09 — Subtle Contradiction Detection (Hard)

## Overview

Tests Magic's ability to detect a non-obvious contradiction where the conflict is embedded in numerical details rather than in explicit opposing statements. Magic must read carefully enough to find the inconsistency.

---

category: capability

prompt: |
  Bird produced this domain analysis for a "subscription tier" feature:
  - Domain rule: A user on the "starter" tier may have at most 3 active projects
  - Domain rule: A user on the "professional" tier may have at most 20 active projects
  - Acceptance criterion AC1: Given a starter user with 3 active projects, when createProject is called, then it is rejected with error code PROJECT_LIMIT_EXCEEDED
  - Acceptance criterion AC2: Given a professional user with 19 active projects, when createProject is called, then it succeeds
  - Acceptance criterion AC3: Given a professional user with 20 active projects, when createProject is called, then it is rejected with error code PROJECT_LIMIT_EXCEEDED

  MJ produced this architecture summary:
  - The project service will enforce limits using a ProjectLimitGuard class
  - Starter tier limit is enforced at 5 projects
  - Professional tier limit is enforced at 20 projects
  - Limits are configured as constants: STARTER_LIMIT = 5, PROFESSIONAL_LIMIT = 20

  Synthesize these outputs into a handoff brief for Shaq.

expected_behavior: |
  - Magic detects the contradiction: Bird says starter tier limit is 3 projects, but MJ says STARTER_LIMIT = 5
  - Magic quotes both positions precisely: Bird's rule ("at most 3 active projects") and MJ's constant (STARTER_LIMIT = 5)
  - Magic does NOT average the two values or use either value as correct without escalation
  - Magic escalates to Coach K: "ESCALATION: Bird defines the starter tier limit as 3 projects. MJ's architecture sets STARTER_LIMIT = 5. These are inconsistent. Cannot produce a handoff brief with an incorrect limit constant. Need Bird or MJ to confirm the correct limit."
  - If a brief is produced, the starter limit field is marked as CONTESTED/BLOCKED
  - AC1 is noted as dependent on the resolution (since it tests the 3-project boundary)
  - The professional tier (20 projects) is NOT blocked — both agree on that value

failure_modes: |
  - Missing the contradiction and producing a brief with either 3 or 5 as the starter limit
  - Noting both values as "options" without escalating (leaving Shaq to pick)
  - Averaging: producing a brief that says "approximately 3-5 projects"
  - Blocking the professional tier limit unnecessarily (both agree it is 20)
  - Escalating about the wrong issue (e.g., complaining about the tier names instead of the limit value)

scoring_rubric: |
  pass:
    - Contradiction explicitly identified: starter limit is 3 (Bird) vs 5 (MJ)
    - Both values quoted precisely from their source agents
    - Escalation routed to Coach K for resolution
    - Professional tier (20 projects) correctly noted as uncontested
    - No brief produced that commits to either incorrect starter value
    - AC1 flagged as dependent on resolution

  partial:
    - Contradiction identified but escalation is informal or imprecise
    - Both values mentioned but not clearly attributed to agents
    - Professional tier correctly handled

  fail:
    - Contradiction not detected
    - Brief produced with starter limit set to 3 or 5 without flagging the discrepancy
    - Escalation covers the wrong issue
    - Professional tier incorrectly blocked as well
