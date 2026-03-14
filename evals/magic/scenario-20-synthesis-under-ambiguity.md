# Eval: Magic — Scenario 20 — Synthesis Under Deep Ambiguity (Expert)

## Overview

Tests Magic's ability to produce a maximally useful partial brief when inputs are deeply ambiguous — distinguishing what can be stated with confidence from what cannot, calibrating uncertainty explicitly, and not blocking Shaq entirely on ambiguities that do not affect the core implementation.

---

category: capability

prompt: |
  Bird produced a domain analysis that is intentionally vague:
  - "The reporting feature should give users visibility into their usage"
  - "Reports should be downloadable"
  - "Users should be able to filter by time period"
  - No acceptance criteria provided. No specific metrics named. No format specified.

  MJ produced this architecture summary:
  - A ReportingService will aggregate usage data from the events table
  - Reports will be generated as CSV and PDF
  - Time-based filtering will use start_date and end_date parameters
  - The service will expose GET /reports with query parameters: format (csv|pdf), start_date, end_date

  Pippen produced this operational note:
  - Report generation for large date ranges may be slow — consider async generation with a job ID returned immediately
  - No SLA has been defined for report generation time

  Produce a handoff brief for Shaq with calibrated confidence indicators on each section.

expected_behavior: |
  - Magic produces a partial brief with explicit confidence indicators per section
  - High-confidence sections (from MJ + Pippen): API endpoint (GET /reports), format parameter (csv|pdf), date range parameters, async generation recommendation
  - Low-confidence or undefined sections: which usage metrics are included in the report, what "usage" means (API calls? storage? active users?), no acceptance criteria from Bird
  - Magic does NOT invent metrics or acceptance criteria
  - Magic identifies what Shaq CAN implement immediately (the API endpoint structure, format parameter handling, date range filtering) without Bird's specifics
  - Magic identifies what Shaq CANNOT implement without Bird's input (report content — what data fields to include)
  - Brief includes an explicit escalation for Bird's missing acceptance criteria, framed as a partial blocker rather than a full blocker
  - The escalation does not prevent Shaq from starting on the API scaffolding

failure_modes: |
  - Inventing metrics or report content to fill Bird's gap (e.g., "reports include: API calls, storage used, active sessions")
  - Blocking Shaq entirely because Bird's output is vague
  - Forwarding Bird's vague language to Shaq unchanged ("give users visibility into their usage")
  - Not distinguishing between high-confidence and low-confidence sections
  - Treating Pippen's async generation note as optional when it is operationally important

scoring_rubric: |
  pass:
    - Brief explicitly distinguishes high-confidence and low-confidence sections
    - High-confidence section: API endpoint, format, date range parameters
    - Low-confidence section: report content/metrics — explicitly flagged as undefined
    - Partial escalation to Bird for missing acceptance criteria
    - Shaq can begin API scaffolding — escalation is partial, not a full block
    - No invented report content
    - Pippen's async generation recommendation included as an explicit note

  partial:
    - Confidence calibration present but not systematically applied to all sections
    - Missing content flagged but Shaq either fully blocked or not given actionable starting point
    - Async generation note present

  fail:
    - Report content invented
    - Bird's vague language forwarded unchanged
    - Shaq fully blocked due to Bird's vagueness
    - No confidence calibration
    - Async generation note absent
