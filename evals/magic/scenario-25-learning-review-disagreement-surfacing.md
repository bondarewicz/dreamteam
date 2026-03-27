# Eval: Magic — Scenario 25 — Learning Review Disagreement Surfacing (Hard / Capability)

## Overview

Tests Magic's facilitation guideline about surfacing disagreements: "Surface conflicting views explicitly. Disagreement is a signal about where the system's understanding was incomplete, not evidence that one party was wrong." During this incident, Kobe and MJ held directly conflicting views on the correct recovery action during the incident itself — Kobe pushed for immediate rollback, MJ argued for a forward-fix to avoid data loss from a partially-applied migration. Both positions were technically defensible. Magic must surface both perspectives and frame the disagreement as an indicator of incomplete shared understanding, without picking a winner or assigning blame for the disagreement.

---

category: capability

graders:
  - type: contains
    values: ["Kobe", "MJ", "disagreement"]
  - type: not_contains
    values: ["should have listened", "the wrong call"]
  - type: regex
    pattern: "(incomplete|gap|unclear|no shared|not established|not defined|no pre-agreed|no agreed|absence of).{0,150}(understanding|model|protocol|agreement|criteria|framework|decision)"
  - type: field_count
    pattern: "\\*\\*[A-Za-z]"
    min: 3
  - type: length_bounds
    min: 2000

prompt: |
  Produce a learning review for the following incident. Pay particular attention to how you surface the disagreement between Kobe and MJ — frame it as a signal about the team's incomplete shared understanding, not as evidence that either party made the wrong call.

  **Incident summary**: On 2026-02-14, a database migration for the user_preferences table was applied to production during a maintenance window. The migration added a nullable JSON column and ran a backfill job to populate existing rows. The backfill ran for 11 minutes before a deadlock with a live API transaction caused it to fail at 60% completion. At this point, Kobe and MJ disagreed on the recovery path. Kobe advocated for immediate rollback; MJ advocated for a forward-fix to complete the backfill. The team ultimately rolled back, which required replaying 4 hours of accumulated preference updates from an event log. Service was degraded for 47 minutes.

  **Kobe's position during the incident**:
  "When the backfill failed mid-run, we had a partially migrated table — 40% of rows had no value in the new column. My position was rollback immediately. A known-good state is always preferable to a partially-migrated state. The API was designed to tolerate a missing column via a nullable fallback. Rolling forward with a live deadlock risk seemed dangerous — we didn't know if the deadlock was resolved or if another transaction would trigger it."

  "I also felt we didn't have a pre-agreed decision framework for 'partial migration failure during maintenance window.' We were making this call under pressure with no shared criteria for when to roll forward vs roll back."

  **MJ's position during the incident**:
  "My position was forward-fix. The 40% of rows already migrated were in a consistent state. Rolling back would require reverting those rows, which was a non-trivial operation. More importantly, the backfill was reading from an event log that was still accumulating live events — rolling back and then re-running the migration later would require replaying those 4 hours of events, which introduces its own replay correctness risk. The forward-fix was completing a known operation; rollback was introducing a new operation (event replay) that we hadn't rehearsed."

  "I agree with Kobe that we had no pre-agreed framework. We were both reasoning from first principles under pressure."

  **Bird's domain notes**:
  "The user_preferences domain rule is: preference data must be consistent per user — partial states are not permitted at the user row level. A row with no value in the new column is technically valid (nullable) but semantically ambiguous — it could mean 'user has no preference set' or 'user's preference hasn't been migrated yet.' This ambiguity was not resolved before the migration was approved."

  **Shaq's implementation notes**:
  "I ran the migration per the runbook. The backfill was a single SQL UPDATE statement against the full table with no batching — I used this approach because the table had 800k rows and the runbook didn't specify a batch size threshold. The deadlock was between the backfill UPDATE and a live API transaction doing a SELECT FOR UPDATE on the same table. In hindsight, batching would have reduced the deadlock window, but the runbook didn't mention it."

  **Pippen's operational notes**:
  "We rolled back. The event log replay took 4 hours to design and 47 minutes to execute. The replay was successful. No data was lost. However, we identified that the event log had a 4-hour gap during which events were accumulated but not yet applied — during this gap, the preference API was serving pre-migration data. We have no SLA for migration recovery time. We have no pre-agreed criteria for rollback vs forward-fix decisions."

  Produce a full learning review. Surface the Kobe/MJ disagreement as a signal about the team's incomplete shared understanding — do not resolve which position was correct.

expected_behavior: |
  - All 6 sections present
  - The disagreement between Kobe and MJ is explicitly surfaced — both positions are described accurately and attributed
  - Magic does NOT declare a winner — neither "Kobe was right" nor "MJ was right" appears
  - The disagreement is framed as evidence of an incomplete shared model: no pre-agreed rollback vs forward-fix decision criteria for partial migration failures
  - Both Kobe's reasoning (known-good state preference, deadlock risk uncertainty) and MJ's reasoning (event replay correctness risk, rollback introduces new operation) are represented accurately
  - Contributing Factors includes: no pre-agreed recovery decision framework, unbatched backfill on large table, semantic ambiguity in nullable column (Bird's domain note), no migration recovery SLA, deadlock risk not tested pre-migration
  - What We Learned includes a learning specifically about the disagreement: "We now know that [the team had no shared criteria for rollback vs forward-fix], which means [under-pressure decisions will diverge based on individual mental models]"
  - Forward Commitments include a PROCESS-tagged action: establish documented decision criteria for migration recovery scenarios
  - Preserving the Learning names a concrete artifact: migration runbook update with rollback vs forward-fix decision tree, or an ADR for migration recovery policy
  - Shaq's unbatched migration not framed as negligence — runbook didn't specify batching

failure_modes: |
  - Magic picks a winner: "Kobe was right to push for rollback" or "MJ's forward-fix reasoning was more sound"
  - Disagreement framed as a process failure (someone should have spoken up sooner / agreed faster) rather than incomplete shared understanding
  - Only one perspective (Kobe's or MJ's) represented accurately; the other summarized unfairly
  - "Should have listened to Kobe/MJ" language appears
  - Disagreement treated as evidence of poor team dynamics rather than an information gap
  - Contributing Factors omits the absence of a pre-agreed decision framework
  - Shaq's unbatched backfill framed as the primary cause without surfacing the runbook gap
  - Forward Commitments include no PROCESS action for the decision framework gap

scoring_rubric: |
  pass:
    - Both Kobe's and MJ's positions described accurately and attributed by name
    - Disagreement explicitly framed as signal of incomplete shared model (no pre-agreed criteria)
    - No winner declared — neither position is endorsed
    - "We now know that [no shared criteria], which means [under-pressure divergence]" learning present
    - PROCESS-tagged commitment to establish migration recovery decision criteria
    - Concrete artifact named in Preserving the Learning (runbook update, ADR, or decision tree) with owner
    - At least 4 contributing factors including the framework gap
    - All 6 sections present

  partial:
    - Both positions mentioned but one is described with more sympathy or detail
    - Disagreement named as a factor but not framed as an incomplete-understanding signal
    - "We now know" learning about decision criteria absent or vague
    - PROCESS commitment present but not specifically about decision criteria
    - 5 of 6 sections present

  fail:
    - Winner declared or language implying one position was correct
    - Only one perspective represented
    - Disagreement absent or framed as a personality/communication failure
    - PROCESS commitment absent
    - Preserving the Learning absent or generic
    - Fewer than 5 sections present
