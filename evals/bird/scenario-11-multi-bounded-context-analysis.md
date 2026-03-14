# Eval: Bird — Scenario 11 — Multi-Bounded-Context Analysis (Hard)

## Overview

Tests Bird's ability to identify when a single business scenario spans multiple bounded contexts and map which rules belong to which context, including cross-context data contracts.

---

category: capability

graders:
  - type: contains
    values: ["bounded context", "invariant", "Given", "When", "Then"]
  - type: section_present
    sections: ["domain_analysis", "business_rules", "acceptance_criteria"]
  - type: field_count
    pattern: "bounded.context"
    min: 2
  - type: length_bounds
    min: 500
    max: 10000

prompt: |
  A logistics platform's product team describes a new feature called "Smart Route Optimization":

  "When a driver starts their shift, the system automatically assigns them an optimized route based on all pending deliveries in their zone. The route must be recalculated if: a new delivery is added in their zone, a delivery is marked as failed, or the driver manually deviates from the suggested route. Customers are notified when their delivery enters the 'next 3 stops' window. Drivers cannot be assigned deliveries outside their licensed vehicle class (a motorcycle driver cannot be assigned a freight shipment). The estimated time per delivery stop is 4 minutes but can be overridden by the operations team per zone."

  Produce a full domain analysis. Pay special attention to identifying bounded contexts and which rules belong to each context.

expected_behavior: |
  - domain_analysis identifies at least 3 bounded contexts:
    1. Route Management (route assignment, recalculation, optimization)
    2. Delivery Lifecycle (pending, failed, completed states)
    3. Driver Management (vehicle class, zone assignment)
    4. Customer Notifications (optional to name separately or fold into Delivery)
  - Bird correctly assigns rules to contexts — e.g., vehicle class restriction belongs to Driver Management, not Route Management
  - Cross-context rules are called out explicitly: "The route recalculation trigger depends on state changes in the Delivery Lifecycle context — these contexts must share a data contract"
  - business_rules identifies:
    1. Vehicle class constraint on delivery assignment (invariant: true)
    2. Route recalculation triggers (invariant: true — system must always recalculate on these events)
    3. "Next 3 stops" notification window (invariant: false — configurable threshold)
    4. 4-minute default stop time (invariant: false — overridable policy)
  - Bird surfaces the cross-context dependency as an integration point for MJ
  - At least 4 Given/When/Then acceptance criteria

failure_modes: |
  - Treating all rules as a single flat list without identifying contexts
  - Missing the vehicle class constraint as a cross-context dependency
  - Marking the configurable stop time or notification window as invariant: true
  - Not identifying that route recalculation is event-driven across context boundaries
  - Fewer than 3 bounded contexts identified

scoring_rubric: |
  pass:
    - At least 3 bounded contexts identified and named
    - Cross-context dependencies explicitly identified as integration points
    - Correct invariant classification for vehicle class rule (true) and stop time (false)
    - At least 4 Given/When/Then acceptance criteria
    - Route recalculation triggers correctly enumerated

  partial:
    - 2 bounded contexts identified
    - Cross-context dependency mentioned but not formally analyzed
    - Invariant classification mostly correct (1 error)
    - 3 acceptance criteria

  fail:
    - No bounded context identification (flat list of rules)
    - Cross-context dependency missed
    - Fewer than 2 acceptance criteria
    - Vehicle class constraint missing
