# Eval: Shaq — Scenario 23 — C# Value Object (Money)

## Overview

Tests Shaq's ability to implement a C# value object with proper equality semantics, operator overloads, and currency mismatch protection. Value objects in C# require explicit IEquatable<T> implementation and GetHashCode — the default reference equality is wrong for value semantics.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: acceptance_criteria_coverage
    min_items: 1
  - type: json_field
    path: confidence.level
    min: 85

prompt: |
  Bird has defined these acceptance criteria for a Money value object:

  AC1: WHEN two Money instances have the same Amount and Currency, THE SYSTEM SHALL consider them equal (== and .Equals)
  AC2: WHEN adding two Money values with the same Currency, THE SYSTEM SHALL return a new Money with the summed Amount
  AC3: WHEN adding two Money values with different Currencies, THE SYSTEM SHALL throw InvalidOperationException
  AC4: WHEN subtracting Money values with different Currencies, THE SYSTEM SHALL throw InvalidOperationException
  AC5: Currency SHALL be a 3-character ISO 4217 code; THE SYSTEM SHALL throw ArgumentException on construction if the currency is not exactly 3 characters

  MJ has specified:
  - Immutable C# record or sealed class — your choice
  - Amount: decimal (not double — avoid floating-point precision loss)
  - Currency: string, stored uppercase
  - Operator overloads: + and - for same-currency arithmetic
  - No external dependencies

  Implement this feature. Produce your full output schema.

expected_behavior: |
  - Money is immutable — implemented as a record or a sealed class with readonly properties
  - IEquatable<Money> implemented (or record equality handles it): two Money instances with same Amount and Currency are equal
  - GetHashCode overridden consistently with Equals
  - + operator: returns new Money(Amount + other.Amount, Currency) when currencies match, throws InvalidOperationException otherwise
  - - operator: same pattern
  - Constructor validates Currency.Length == 3, throws ArgumentException if not; stores Currency.ToUpperInvariant()
  - Amount uses decimal, not double or float
  - Tests cover all 5 ACs including the exception cases
  - confidence.level >= 85

failure_modes: |
  - Using double or float for Amount (floating-point precision loss on financial calculations)
  - Forgetting to override GetHashCode when overriding Equals (violates the contract)
  - Currency comparison is case-sensitive when it should normalise to uppercase
  - Not throwing on currency mismatch — silently using the left operand's currency
  - AC5 validation missing — accepting any string as currency
  - Mutable properties (public setters on Amount or Currency)
  - Tests covering only AC1 (equality) and AC2 (addition), missing exception cases

scoring_rubric: |
  pass:
    - decimal for Amount (not double)
    - Equals + GetHashCode both overridden (or record equality used correctly)
    - + and - throw InvalidOperationException on currency mismatch
    - Constructor validates 3-char Currency and normalises to uppercase
    - Immutable (no public setters)
    - All 5 ACs covered in tests
    - confidence.level >= 85

  partial:
    - decimal used, equality correct, operators correct
    - AC5 validation missing or Currency not uppercased
    - 3-4 ACs covered in tests

  fail:
    - double or float for Amount
    - Equals overridden but GetHashCode not overridden
    - Currency mismatch silently ignored
    - Mutable properties
