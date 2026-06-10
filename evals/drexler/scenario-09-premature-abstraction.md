# Eval: Drexler — Scenario 09 — Premature Abstraction (Gold Plating)

## Overview

Tests Drexler's ability to identify over-engineering: a multi-class plugin architecture introduced for a task that required a single function. The implementation works correctly — the problem is the abstraction layer has no second use case and adds four times the code for zero additional capability.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: abstraction_assessment.over_abstracted
    equals: true
  - type: json_field
    path: deletion_candidates
    min_items: 1
    advisory: true

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Format a number as a USD currency string (e.g., 1234.5 → "$1,234.50").

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Pluggable currency formatter system with registry and strategy pattern
  - Files changed:
    - src/formatting/CurrencyFormatter.ts (created) — abstract base class
    - src/formatting/USDFormatter.ts (created) — USD strategy implementation
    - src/formatting/FormatterRegistry.ts (created) — registry with register/get
    - src/formatting/index.ts (created) — wires registry, exports formatCurrency

  Here is the new code:

  ```typescript
  // src/formatting/CurrencyFormatter.ts
  export abstract class CurrencyFormatter {
    abstract format(amount: number): string;
  }

  // src/formatting/USDFormatter.ts
  import { CurrencyFormatter } from "./CurrencyFormatter";

  export class USDFormatter extends CurrencyFormatter {
    format(amount: number): string {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);
    }
  }

  // src/formatting/FormatterRegistry.ts
  import { CurrencyFormatter } from "./CurrencyFormatter";

  export class FormatterRegistry {
    private formatters = new Map<string, CurrencyFormatter>();

    register(key: string, formatter: CurrencyFormatter): void {
      this.formatters.set(key, formatter);
    }

    get(key: string): CurrencyFormatter {
      const f = this.formatters.get(key);
      if (!f) throw new Error(`No formatter registered for: ${key}`);
      return f;
    }
  }

  // src/formatting/index.ts
  import { FormatterRegistry } from "./FormatterRegistry";
  import { USDFormatter } from "./USDFormatter";

  const registry = new FormatterRegistry();
  registry.register("usd", new USDFormatter());

  export function formatCurrency(amount: number, currency = "usd"): string {
    return registry.get(currency).format(amount);
  }
  ```

  The equivalent that satisfies the spec:
  ```typescript
  export function formatUSD(amount: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }
  ```

  Only one currency (USD) is used anywhere in the codebase. No other formatter will be registered. The registry, abstract class, and strategy pattern exist solely for a hypothetical future that is not in scope.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler flags the 4-file plugin architecture as over-abstraction for a single-currency use case
  - abstraction_assessment.over_abstracted is true
  - abstraction_assessment.rationale explains: one concrete use case, no registered second formatter, hypothetical extensibility
  - deletion_candidates includes CurrencyFormatter abstract class, FormatterRegistry, and USDFormatter class (the 3-class infrastructure)
  - summary.verdict is BLOATED
  - Drexler does NOT flag the formatCurrency function itself — it is the correct entry point
  - Drexler does NOT flag Intl.NumberFormat — it is the correct stdlib approach

failure_modes: |
  - Accepting "extensibility" or "open for extension" as justification when no second use exists
  - Not flagging the registry as unnecessary (only one formatter ever registered)
  - Treating the abstract class pattern as standard good practice rather than premature
  - Verdict LEAN or ACCEPTABLE when 4 files exist for a 1-function spec
  - Flagging Intl.NumberFormat as a dependency concern (it is stdlib)

scoring_rubric: |
  pass:
    - abstraction_assessment.over_abstracted is true
    - deletion_candidates has at least 2 of: CurrencyFormatter, FormatterRegistry, USDFormatter
    - rationale references "no second use case" or "hypothetical extensibility"
    - summary.verdict is BLOATED

  partial:
    - Over-abstraction identified but only 1 file flagged for deletion
    - Verdict ACCEPTABLE with clear note about the architecture cost

  fail:
    - abstraction_assessment.over_abstracted is false
    - "Open for extension" accepted as justification
    - Verdict LEAN
    - No deletion_candidates listed
