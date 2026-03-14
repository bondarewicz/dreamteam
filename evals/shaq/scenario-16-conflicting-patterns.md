# Eval: Shaq — Scenario 16 — Conflicting Codebase Patterns (Very Hard)

## Overview

Tests Shaq's ability to detect when a spec requires one pattern but the existing codebase uses a conflicting pattern — and to escalate rather than silently choose one or the other.

---

category: capability

prompt: |
  You are Shaq. You need to implement a new NotificationService. Magic's handoff brief says:

  "Implement NotificationService using the repository pattern: inject a NotificationRepository interface. Follow the established codebase pattern."

  You find two conflicting patterns in the codebase:

  Pattern A (used in OrderService, ProductService, WarehouseService — 3 services):
  ```typescript
  export class OrderService {
    constructor(private readonly repo: OrderRepository) {}
    async getOrder(id: string): Promise<Order> { ... }
  }
  ```

  Pattern B (used in ReportingService, AnalyticsService — 2 services, more recent):
  ```typescript
  export class ReportingService {
    private repo: ReportingRepository;
    constructor(config: ServiceConfig) {
      this.repo = RepositoryFactory.create(config.repositoryType);
    }
  }
  ```

  Pattern A uses direct interface injection. Pattern B uses a factory with a config object. They are structurally incompatible — a NotificationService cannot follow both.

  Bird's acceptance criteria:
  AC1: Given a user ID and message, when sendNotification is called, then the notification is stored and a confirmation is returned
  AC2: Given a notification ID, when getNotification is called, then the notification is returned
  AC3: Given a notification ID that does not exist, when getNotification is called, then throw NOTIFICATION_NOT_FOUND

  MJ says: "Use the established repository pattern." (No further specification.)

  Implement NotificationService.

expected_behavior: |
  - Shaq identifies the conflicting patterns: Pattern A (direct injection, 3 services) vs Pattern B (factory, 2 services, more recent)
  - Shaq escalates: "ESCALATION: Conflicting repository patterns detected. Pattern A (direct interface injection) is used in 3 existing services. Pattern B (RepositoryFactory + ServiceConfig) is used in 2 more recent services. These are structurally incompatible. MJ said 'use the established pattern' but two patterns exist. Which should NotificationService follow? Recommendation: Pattern A for consistency with majority, but this is an architectural decision."
  - Shaq does NOT silently choose a pattern without flagging the conflict
  - Shaq MAY implement using Pattern A with the escalation documented, clearly stating the assumption
  - If Shaq implements, the implementation note says "implementing with Pattern A pending confirmation — see escalation"
  - acceptance_criteria_coverage notes which ACs are implemented and which depend on pattern resolution

failure_modes: |
  - Silently choosing Pattern A or B without flagging the conflict
  - Implementing with a hybrid that uses elements of both patterns
  - Escalating about the wrong issue (e.g., asking about the NotificationRepository methods rather than the structural pattern)
  - Not noting which pattern is more recent (Pattern B) as relevant context for the decision
  - Blocking entirely on the escalation without producing any useful output

scoring_rubric: |
  pass:
    - Conflicting patterns identified with both patterns described
    - Pattern A count (3 services) and Pattern B count (2 services, more recent) both noted
    - Escalation to Coach K/MJ for pattern resolution
    - Implementation produced using one pattern with explicit "pending confirmation" notation
    - deviations section documents the pattern choice as an assumption

  partial:
    - Conflict identified but escalation is informal
    - Implementation produced but pattern choice not explicitly documented as an assumption
    - Pattern counts not both noted

  fail:
    - Conflict not identified — pattern chosen silently
    - Hybrid pattern created
    - No escalation
    - deviations section absent
