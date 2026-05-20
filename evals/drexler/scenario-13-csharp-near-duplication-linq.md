# Eval: Drexler — Scenario 13 — C# Near-Duplication (Manual Loop vs LINQ + Existing Utility)

## Overview

Tests Drexler's ability to spot near-duplication in C# where a new manual loop reimplements logic that both LINQ's built-in methods and a pre-existing utility class already provide. Drexler must recognise semantic equivalence across different syntactic styles.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: duplication_findings
    min_items: 1

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Add a helper that truncates a log message to a maximum length, appending "..." if truncated.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: TruncateLogMessage in src/Logging/LogHelpers.cs
  - Files changed:
    - src/Logging/LogHelpers.cs (created)

  Here is the new code:

  ```csharp
  // src/Logging/LogHelpers.cs
  public static class LogHelpers
  {
      public static string TruncateLogMessage(string message, int maxLength)
      {
          if (message.Length <= maxLength)
              return message;
          return message.Substring(0, maxLength) + "...";
      }
  }
  ```

  And here is what already exists in the codebase:

  ```csharp
  // src/Common/StringExtensions.cs  (pre-existing)
  public static class StringExtensions
  {
      public static string Truncate(this string value, int maxLength, string suffix = "…")
      {
          return value.Length <= maxLength ? value : value[..maxLength] + suffix;
      }
  }
  ```

  The functions implement identical truncation logic. Differences are cosmetic: method name, suffix character (`...` vs `…`), and the pre-existing version is an extension method with a configurable suffix.

  Search the repo for existing utilities. Flag near-duplicates even when names differ.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler identifies that TruncateLogMessage and StringExtensions.Truncate implement identical logic
  - duplication_findings has at least 1 entry with similarity "near" or "exact"
  - Notes the difference is cosmetic: suffix char, naming, extension vs static — not semantic
  - Recommendation: use message.Truncate(maxLength) (the extension method) instead of adding a new implementation
  - summary.verdict is BLOATED or ACCEPTABLE (BLOATED preferred)
  - Drexler does NOT flag the ellipsis difference as a correctness bug — that is Kobe's domain

failure_modes: |
  - Missing the duplication because TruncateLogMessage is in a different namespace (Logging vs Common)
  - Classifying as "partial" when the logic is semantically identical
  - Accepting the suffix character difference as justifying a new implementation
  - Flagging the `…` vs `...` difference as a correctness concern (out of scope for Drexler)

scoring_rubric: |
  pass:
    - duplication_findings has entry for TruncateLogMessage / StringExtensions.Truncate
    - similarity is "near" or "exact"
    - Recommendation points to reusing StringExtensions.Truncate extension method
    - summary.verdict is BLOATED or ACCEPTABLE

  partial:
    - Duplication found but similarity understated as "partial"
    - Recommendation vague ("consider using existing code")

  fail:
    - Duplication not found
    - Verdict LEAN
    - Different namespaces accepted as justification for a new implementation
