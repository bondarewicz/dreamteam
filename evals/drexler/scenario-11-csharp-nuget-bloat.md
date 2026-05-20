# Eval: Drexler — Scenario 11 — C# NuGet Dependency Bloat

## Overview

Tests Drexler's .NET BCL knowledge: a NuGet package was added to solve a problem that the standard library already handles. The code is correct — the issue is an unnecessary transitive dependency chain for a one-liner BCL call.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: summary.verdict
    one_of: [ACCEPTABLE, BLOATED]
  - type: json_field
    path: scope_assessment.new_dependencies
    min_items: 1

prompt: |
  Review this implementation for scope, duplication, and maintenance cost.

  TASK: Parse a date string in "yyyy-MM-dd" format received from an API response into a date-only value.

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Date parser using the NodaTime NuGet package
  - Files changed:
    - src/Integration/DateParser.cs (created) — parses API date strings
    - src/Integration/DateParser.csproj (modified) — added NodaTime 3.x dependency

  Here is the new code:

  ```csharp
  // src/Integration/DateParser.cs
  using NodaTime;
  using NodaTime.Text;

  public static class DateParser
  {
      private static readonly LocalDatePattern Pattern =
          LocalDatePattern.CreateWithInvariantCulture("yyyy-MM-dd");

      public static LocalDate Parse(string dateString)
      {
          return Pattern.Parse(dateString).Value;
      }
  }
  ```

  The equivalent without the dependency:
  ```csharp
  public static class DateParser
  {
      public static DateOnly Parse(string dateString)
      {
          return DateOnly.ParseExact(dateString, "yyyy-MM-dd");
      }
  }
  ```

  `DateOnly` is available in .NET 6+ (all current LTS versions). NodaTime is a 300KB package with its own type system that callers must adopt.

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

expected_behavior: |
  - Drexler flags NodaTime as unnecessary for this use case
  - scope_assessment.new_dependencies includes "NodaTime" or equivalent
  - deletion_candidates references the NodaTime import and states DateOnly.ParseExact as the alternative
  - Notes that NodaTime returns LocalDate (a NodaTime type) — callers must take a NodaTime dependency too, making this a viral type leak
  - summary.verdict is BLOATED
  - Drexler does NOT flag DateParser itself — parsing API date strings is the spec

failure_modes: |
  - Accepting NodaTime because it is a respected library
  - Not knowing DateOnly.ParseExact exists in .NET 6+
  - Verdict LEAN or ACCEPTABLE — one unnecessary transitive dependency is still a finding
  - Flagging DateParser as unnecessary (it implements the spec correctly)
  - Missing the viral type leak (callers also get a NodaTime dependency via the return type)

scoring_rubric: |
  pass:
    - scope_assessment.new_dependencies has NodaTime
    - deletion_candidates references switching to DateOnly.ParseExact
    - DateOnly.ParseExact named explicitly as the alternative
    - summary.verdict is BLOATED

  partial:
    - NodaTime flagged but DateOnly alternative not named
    - Verdict ACCEPTABLE with a clear note about the dependency

  fail:
    - NodaTime not flagged
    - Verdict LEAN
    - "NodaTime is better than BCL" accepted as justification
