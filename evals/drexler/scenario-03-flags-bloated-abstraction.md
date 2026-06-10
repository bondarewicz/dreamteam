# Eval: Drexler — Scenario 03 — Flags Bloated Abstraction

## Overview

Tests Drexler's ability to identify over-engineering: an abstraction layer added speculatively that adds more complexity than it removes. No existing utility is re-implemented, but the new code is more complex than the problem it solves. Drexler must distinguish "justified complexity" from "premature abstraction."

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: abstraction_assessment
    min_items: 1
    advisory: true
  - type: json_field
    path: maintenance_risk
    one_of: [medium, high]

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add config loading for the application — read DATABASE_URL and PORT from environment variables.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: A generic, pluggable config management system
  - Files changed:
    - src/config/base-config.ts (created) — abstract ConfigProvider class
    - src/config/env-config-provider.ts (created) — EnvConfigProvider extending BaseConfig
    - src/config/config-factory.ts (created) — factory that selects provider by environment
    - src/config/index.ts (created) — barrel export
    - src/app.ts (modified) — 2 lines: import + const config = ConfigFactory.create()

  SPEC: Read DATABASE_URL and PORT from environment variables. Throw on startup if DATABASE_URL is missing.

  Here is the new code:

  ```typescript
  // src/config/base-config.ts
  export abstract class BaseConfig {
    abstract get(key: string): string | undefined;
    getOrThrow(key: string): string {
      const val = this.get(key);
      if (!val) throw new Error(`Missing required config: ${key}`);
      return val;
    }
  }

  // src/config/env-config-provider.ts
  export class EnvConfigProvider extends BaseConfig {
    get(key: string): string | undefined {
      return process.env[key];
    }
  }

  // src/config/config-factory.ts
  import { EnvConfigProvider } from "./env-config-provider";
  export class ConfigFactory {
    static create(): EnvConfigProvider {
      return new EnvConfigProvider();
    }
  }

  // src/config/index.ts
  export { ConfigFactory } from "./config-factory";
  export { BaseConfig } from "./base-config";
  export { EnvConfigProvider } from "./env-config-provider";
  ```

  The spec required: read DATABASE_URL and PORT from env, throw if DATABASE_URL missing.
  The equivalent without the abstraction: 3 lines at the top of src/app.ts.

  Search the repo for existing config utilities before accepting new ones.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies the abstraction as disproportionate to the problem
  - The spec required 3 lines of env reading; Shaq delivered 4 files and an abstract class
  - abstraction_assessment contains at least 1 entry with verdict "premature" or "unnecessary"
  - deletion_candidates includes the abstract class / factory pattern as candidates for simplification
  - The recommended alternative is explicit: inline the 3 env reads into app.ts
  - summary.verdict is BLOATED or ACCEPTABLE (BLOATED preferred — 4 files for 2 env vars is clearly over-engineered)
  - Drexler does NOT flag this as a correctness issue — it works, it's just too much
  - No existing config utility needed to be found — the finding is complexity, not duplication

failure_modes: |
  - Verdict LEAN (missing the over-engineering entirely)
  - Flagging it as a bug instead of a scope/abstraction issue (Kobe's domain, not Drexler's)
  - Accepting the abstraction as "future-proof" without requiring justification from the spec
  - Not providing a concrete simpler alternative
  - Treating "follows a pattern" as sufficient justification for complexity

scoring_rubric: |
  pass:
    - abstraction_assessment has at least 1 entry: verdict "premature" or "unnecessary"
    - deletion_candidates references the factory or abstract class
    - Simpler alternative explicitly stated (inline env reads)
    - summary.verdict is BLOATED or ACCEPTABLE
    - maintenance_risk is medium or high

  partial:
    - Abstraction flagged but no simpler alternative given
    - Verdict ACCEPTABLE with a clear note about over-engineering
    - maintenance_risk medium but abstraction_assessment missing

  fail:
    - Verdict LEAN
    - Over-engineering not identified
    - Finding reframed as a correctness issue
    - "Future-proofing" accepted without spec justification
