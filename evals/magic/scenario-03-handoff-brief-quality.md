# Eval: Magic — Scenario 03 — Handoff Brief Quality (Escalation Case)

## Overview

Tests Magic's ability to detect when an upstream agent's output is incomplete or missing, and to block rather than synthesize with insufficient inputs. Magic must not produce a brief based on partial information.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: escalations
    min_items: 1
  - type: json_field
    path: handoff_brief
    exists: false
  - type: json_field
    path: confidence.level
    max: 50

prompt: |
  You are Magic. Your task is to produce a handoff brief for Shaq for a new "courier availability" feature.

  You have received:
  - Bird's analysis: (task status is "completed" but you have not received the actual output)
  - MJ's architecture: "Use a Redis sorted set keyed by region. Couriers write their availability as a score (unix timestamp of last heartbeat). Consumers query by region and filter by freshness threshold."

  Produce the handoff brief for Shaq.

expected_behavior: |
  - Magic detects that Bird's output is missing — the task shows "completed" but no actual domain rules or acceptance criteria were received
  - Magic escalates: "ESCALATION: Bird's task shows completed but I have not received his output. MJ's architecture references courier availability rules (freshness threshold) that require domain definition. Cannot produce a complete handoff brief without Bird's acceptance criteria and domain rules. Blocking until Bird's output is available."
  - Magic does NOT produce a handoff brief using only MJ's output
  - Magic does NOT invent domain rules ("the freshness threshold is probably 30 seconds") to fill the gap
  - Magic does NOT forward MJ's output directly as if it were a complete brief

failure_modes: |
  - Producing a handoff brief that contains only MJ's Redis architecture with no domain context — Shaq would have no acceptance criteria to implement against
  - Inventing domain rules to fill Bird's gap (e.g., "freshness threshold of 30 seconds" as if it were Bird's rule)
  - Noting Bird is missing but proceeding anyway "so Shaq can start on the technical parts"
  - Not checking whether Bird's actual deliverable exists before starting synthesis

scoring_rubric: |
  pass:
    - Bird's missing output explicitly detected
    - Formal escalation that stops synthesis
    - No handoff brief produced
    - Escalation clearly states what is missing (domain rules, acceptance criteria) and why it matters
    - Does not invent domain content

  partial:
    - Missing output detected but escalation is informal (noted in output, not a formal stop)
    - Partial brief produced with explicit "DO NOT implement until Bird's output received" instruction
    - No invented domain rules

  fail:
    - Missing output not detected
    - Handoff brief produced with only MJ's content
    - Domain rules invented to fill Bird's gap
    - Shaq routed to proceed with partial information
