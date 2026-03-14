# Eval: Kobe — Scenario 10 — Timezone Handling Bug (Hard)

## Overview

Tests Kobe's ability to identify a subtle timezone bug in date comparison logic that would produce incorrect results for users in non-UTC timezones.

---

category: capability

graders:
  - type: contains
    values: ["timezone", "UTC", "safe_to_deploy"]
  - type: section_present
    sections: ["critical_findings", "production_readiness"]
  - type: length_bounds
    min: 200
    max: 5000

prompt: |
  Review the following TypeScript function that checks if a delivery is within the allowed same-day delivery window (orders must be placed before 14:00 local time):

  ```typescript
  function isSameDayDeliveryAvailable(orderTime: Date): boolean {
    const cutoffHour = 14; // 2 PM cutoff
    const orderHour = orderTime.getHours();
    return orderHour < cutoffHour;
  }
  ```

  This function is called in a backend Node.js service. The server runs in UTC. Customers are located in London (UTC+0 in winter, UTC+1 in summer), but the platform is also being expanded to customers in New York (UTC-5 in winter, UTC-4 in summer).

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the timezone bug: `Date.getHours()` returns the hour in the LOCAL timezone of the Node.js process, which is UTC on the server. If a customer in New York places an order at 1:00 PM New York time (UTC-5), the UTC time is 6:00 PM (18:00). `getHours()` returns 18, which is >= 14, so same-day delivery would be incorrectly rejected even though the customer placed the order before the 2 PM local cutoff.
  - Conversely, a New York customer placing an order at 10:00 PM New York time (UTC-4 in summer, 02:00 UTC next day) would have `getHours()` return 2, which is < 14, incorrectly allowing same-day delivery for a very late order.
  - This is a Critical or Important finding: incorrect same-day delivery availability directly impacts customer experience and fulfillment operations
  - Fix: the cutoff comparison must use the customer's local timezone, not the server's timezone. Requires passing the customer's timezone to the function and using `Intl.DateTimeFormat` or a timezone-aware library.
  - safe_to_deploy depends on current markets: if currently London-only (UTC+0 in winter), the bug may not manifest. For multi-timezone expansion, it is a Critical issue.

failure_modes: |
  - Not identifying the timezone issue at all
  - Identifying a vague "timezone issue" without explaining the specific bug (getHours() uses server timezone)
  - Not providing a specific fix (just "handle timezones")
  - Missing that the severity depends on whether multi-timezone customers are currently served
  - safe_to_deploy true for multi-timezone deployment

scoring_rubric: |
  pass:
    - Timezone bug identified: getHours() uses server (UTC) timezone
    - Specific example given of incorrect behavior (New York customer)
    - Fix is specific: use customer's timezone for the cutoff comparison
    - Severity appropriate to context (Critical for multi-timezone, Important for London-only)
    - safe_to_deploy false for multi-timezone expansion

  partial:
    - Timezone issue identified but specific mechanism vague
    - Example of incorrect behavior given
    - Fix is "use timezone-aware library" without being more specific

  fail:
    - Timezone issue not identified
    - safe_to_deploy true for multi-timezone use
    - No specific mechanism explained
