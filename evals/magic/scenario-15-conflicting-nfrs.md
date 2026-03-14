# Eval: Magic — Scenario 15 — Conflicting Non-Functional Requirements (Very Hard)

## Overview

Tests Magic's ability to detect and escalate when two agents have specified non-functional requirements that directly conflict with each other — not a domain contradiction but a performance vs reliability trade-off that requires a decision.

---

category: capability

prompt: |
  Bird produced this domain analysis for a "real-time leaderboard" feature:
  - Domain rule: Leaderboard rankings must reflect score changes within 100 milliseconds of the score event
  - Domain rule: Leaderboard data must be consistent — no stale reads that show a player at a rank they no longer hold
  - AC1: Given a score update, when the leaderboard is queried within 100ms, then the updated rank is shown

  MJ produced this architecture summary:
  - Use Redis Sorted Sets for the leaderboard (O(log N) updates)
  - All reads will go through a CDN cache layer (Fastly) with a TTL of 30 seconds for scalability at peak load
  - The CDN cache is required to handle 50,000 concurrent viewers during live events

  Pippen produced this operational note:
  - At 50,000 concurrent viewers, without CDN caching the Redis instance would be overwhelmed — CDN cache is a hard operational requirement
  - With 30s CDN TTL, reads may be up to 30 seconds stale — this violates Bird's 100ms consistency requirement

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the conflict: Bird requires 100ms consistency, but MJ's CDN cache (30s TTL) and Pippen's operational requirement create a scenario where reads can be 30 seconds stale
  - Pippen has already identified this conflict — Magic must surface it, not paper over it
  - Magic escalates to Coach K: "ESCALATION: Bird requires leaderboard data to be consistent within 100ms of score changes. MJ's CDN cache (30s TTL) is required for 50,000 concurrent viewer scalability per Pippen's assessment. These requirements are incompatible as specified. Options: (1) reduce CDN TTL to near-zero (eliminates scalability benefit), (2) relax Bird's 100ms rule to tolerate CDN TTL, (3) serve live participants from uncached Redis and viewers from CDN with different consistency guarantees. Need resolution before Shaq can implement."
  - Magic provides at least 3 concrete resolution paths
  - No brief produced that asks Shaq to implement both constraints simultaneously

failure_modes: |
  - Producing a brief that includes both the 100ms rule and the 30s CDN cache without flagging the contradiction
  - Telling Shaq to "use Redis for writes and CDN for reads" without addressing that this violates the 100ms consistency rule
  - Treating Pippen's note as just an operational concern rather than a conflict indicator
  - Producing a brief that drops Bird's 100ms rule and only includes MJ's CDN architecture
  - Fewer than 2 resolution paths proposed

scoring_rubric: |
  pass:
    - Conflict between 100ms consistency and 30s CDN TTL explicitly named
    - All three agents' positions attributed: Bird (100ms rule), MJ (30s CDN for scalability), Pippen (CDN required for load)
    - Escalation to Coach K with at least 3 resolution paths
    - No brief produced that asks Shaq to implement both constraints
    - Resolution paths are concrete and distinct

  partial:
    - Conflict identified but fewer than 3 resolution paths
    - Two of three agents' positions cited
    - Escalation to Coach K but question imprecise

  fail:
    - Conflict not identified
    - Brief produced with both constraints as in-scope (100ms rule + 30s CDN)
    - Bird's rule dropped silently
    - No resolution paths
    - Escalation absent
