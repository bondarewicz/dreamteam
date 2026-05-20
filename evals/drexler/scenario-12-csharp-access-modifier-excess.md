# Eval: Drexler — Scenario 12 — C# Access Modifier Excess (public vs internal)

## Overview

Tests Drexler's understanding of C# access modifiers as an API surface concern. Unlike TypeScript where `export` is binary, C# has `internal` — types and members that are `public` but never used outside the assembly should be `internal`. Drexler must flag over-exposed types as unnecessary API surface.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: scope_assessment.new_public_apis
    min_items: 2

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Implement a pricing calculator for orders that applies volume discounts.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: PricingCalculator with full internals exposed as public
  - Files changed:
    - src/Pricing/PricingCalculator.cs (created)
    - src/Pricing/DiscountRule.cs (created)
    - src/Pricing/DiscountTier.cs (created)

  Here is the new code:

  ```csharp
  // src/Pricing/DiscountTier.cs
  public enum DiscountTier { None, Bronze, Silver, Gold }

  // src/Pricing/DiscountRule.cs
  public class DiscountRule
  {
      public int MinQuantity { get; init; }
      public decimal DiscountPercent { get; init; }
      public DiscountTier Tier { get; init; }
  }

  // src/Pricing/PricingCalculator.cs
  public class PricingCalculator
  {
      public static readonly IReadOnlyList<DiscountRule> DefaultRules = new[]
      {
          new DiscountRule { MinQuantity = 10,  DiscountPercent = 0.05m, Tier = DiscountTier.Bronze },
          new DiscountRule { MinQuantity = 50,  DiscountPercent = 0.10m, Tier = DiscountTier.Silver },
          new DiscountRule { MinQuantity = 100, DiscountPercent = 0.15m, Tier = DiscountTier.Gold   },
      };

      public decimal Calculate(decimal unitPrice, int quantity)
      {
          return unitPrice * quantity * (1 - GetDiscount(quantity));
      }

      public decimal GetDiscount(int quantity)
      {
          return DefaultRules
              .Where(r => r.MinQuantity <= quantity)
              .OrderByDescending(r => r.MinQuantity)
              .FirstOrDefault()?.DiscountPercent ?? 0m;
      }

      public DiscountTier GetTier(int quantity)
      {
          return DefaultRules
              .Where(r => r.MinQuantity <= quantity)
              .OrderByDescending(r => r.MinQuantity)
              .FirstOrDefault()?.Tier ?? DiscountTier.None;
      }
  }
  ```

  The public contract needed is: `PricingCalculator.Calculate(unitPrice, quantity)`. Nothing else is called outside the assembly. `GetDiscount`, `GetTier`, `DiscountRule`, `DiscountTier`, and `DefaultRules` are all public but are internal implementation details.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler flags the over-exposed surface: GetDiscount, GetTier, DiscountRule, DiscountTier, and DefaultRules are all public but internal-only
  - scope_assessment.new_public_apis lists at least 2 of: GetDiscount, GetTier, DiscountRule, DiscountTier, DefaultRules
  - deletion_candidates recommends changing these to internal (not deleting them — they are used internally)
  - Drexler notes that public DefaultRules lets callers mutate or depend on the rule set — encapsulation risk
  - summary.verdict is BLOATED or ACCEPTABLE
  - Drexler does NOT flag Calculate — it is the specified public entry point

failure_modes: |
  - Accepting public as a safe default ("public doesn't hurt")
  - Not knowing that C# internal is the correct modifier for assembly-private types
  - Flagging Calculate as excessive (it is the required public API)
  - Verdict LEAN when 4 unnecessary public types/members exist
  - Not noting the DefaultRules mutability/encapsulation risk

scoring_rubric: |
  pass:
    - scope_assessment.new_public_apis has at least 2 unnecessary public items
    - deletion_candidates recommends internal (not deletion) for the helper types/methods
    - Calculate NOT flagged as excessive
    - summary.verdict is BLOATED or ACCEPTABLE

  partial:
    - Only 1 unnecessary public member flagged
    - Verdict ACCEPTABLE with clear note

  fail:
    - No unnecessary public members identified
    - Verdict LEAN
    - "public is fine by default" accepted
    - Calculate flagged as excessive
