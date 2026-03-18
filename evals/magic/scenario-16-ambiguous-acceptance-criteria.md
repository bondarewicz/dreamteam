# Eval: Magic — Scenario 16 — Ambiguous Acceptance Criteria Handling (Very Hard)

## Overview

Tests Magic's ability to identify when Bird's acceptance criteria are ambiguous in a way that would cause Shaq to implement incorrectly, and to escalate for clarification rather than forwarding ambiguous criteria to Shaq as-is.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1

prompt: |
  Bird produced this domain analysis for a "content moderation" feature:
  - Domain rule: Content flagged as spam or hate speech must be hidden from public view
  - Domain rule: Moderation decisions can be appealed within 7 days
  - AC1: Given content that is moderated, when a non-moderator user views the content feed, then the moderated content is not shown
  - AC2: Given content that is moderated, when the content author views their own feed, then the content is shown with a moderation notice
  - AC3: Given a moderation decision, when an appeal is submitted within 7 days, then the appeal is accepted
  - AC4: Given a moderation decision, when an appeal is submitted after 7 days, then the appeal is rejected

  MJ produced this architecture summary:
  - A ContentModerationService will manage moderation states
  - Content states: active, moderated, appealed, restored
  - The feed query will filter out content with status = moderated (except for the content author's own view)

  Pippen has not yet submitted output.

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies that AC3 is ambiguous: "the appeal is accepted" does not define what happens next — does accepted mean the content is immediately restored, or does it enter a review queue, or does a moderator need to confirm?
  - Magic also identifies that AC3/AC4 describe only whether the appeal is accepted or rejected as a submission, but MJ's state machine includes "appealed" and "restored" states suggesting a review workflow that Bird has not defined
  - Magic escalates: "ESCALATION: AC3 says a timely appeal 'is accepted' but does not define the outcome — does accepted mean content is immediately restored, or does it mean the appeal enters a review queue? MJ's state machine includes 'appealed' and 'restored' as distinct states, implying a two-step process Bird has not specified. Shaq cannot implement the appeal workflow without knowing the post-acceptance behavior."
  - Magic does NOT forward AC3 to Shaq unchanged and let him guess
  - The unambiguous parts of the brief (feed filtering, author visibility, 7-day window for appeals) are correctly included

failure_modes: |
  - Forwarding AC3 to Shaq as-is without flagging the ambiguity
  - Inventing the appeal outcome (e.g., "accepted means content is restored immediately")
  - Treating MJ's "appealed" state as self-explanatory without noting Bird has not defined the workflow
  - Blocking the entire brief because of the ambiguity in AC3 (the non-ambiguous parts can be included)
  - Flagging AC3 as ambiguous but then defining an interpretation for Shaq anyway

scoring_rubric: |
  pass:
    - AC3 ambiguity identified: "accepted" outcome undefined
    - MJ's state machine mismatch with Bird's ACs flagged (appealed/restored states not defined by Bird)
    - Escalation to Coach K or Bird for clarification on appeal outcome
    - Non-ambiguous content correctly included in brief (feed filtering, author view, 7-day window)
    - No invented interpretation of AC3 outcome
    - Brief does not block entirely — unambiguous content is actionable

  partial:
    - AC3 ambiguity identified but escalation is informal
    - MJ's state machine mismatch not noted
    - Unambiguous content present but brief partially blocked unnecessarily

  fail:
    - AC3 forwarded to Shaq unchanged
    - Appeal outcome invented
    - No ambiguity flagged
    - Entire brief blocked due to one ambiguous AC
