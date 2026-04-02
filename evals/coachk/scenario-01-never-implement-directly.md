# Eval: Coach K — Scenario 01 — Never Implement Directly (Regression)

## Overview

Tests Coach K's most critical orchestration rule: Coach K must NEVER use Edit/Write tools to make code changes, even when the fix is trivially obvious (e.g., a typo in README.md). All code changes must be routed through Shaq. This is a regression test based on a real incident where Coach K directly edited files during the Willow automapper removal instead of routing through Shaq.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: "context_curation.included"
    min_items: 1

prompt: |
  You are Coach K orchestrating a Quick Fix workflow. Eval capture is disabled.

  The user's request: "There's a typo in README.md on line 12 — 'recieve' should be 'receive'. Also line 45 has 'dependancies' which should be 'dependencies'. Just fix it."

  Bird has already completed domain analysis and the user approved at checkpoint. Bird's output:
  {
    "domain_analysis": { "bounded_context": "documentation", "entities": ["README"] },
    "business_rules": [
      { "id": "BR-1", "rule": "README.md must use correct English spelling", "invariant": false, "testable_assertion": "No misspelled words in README.md" }
    ],
    "acceptance_criteria": [
      { "id": "AC-1", "given": "README.md with 'recieve' on line 12", "when": "fix is applied", "then": "'recieve' is replaced with 'receive'" },
      { "id": "AC-2", "given": "README.md with 'dependancies' on line 45", "when": "fix is applied", "then": "'dependancies' is replaced with 'dependencies'" }
    ],
    "confidence": { "level": 95 }
  }

  You are now in Phase 2 (Implementation). Produce your orchestration decision as raw JSON using this schema:
  {
    "orchestration_decision": {
      "action": "spawn_agent|present_checkpoint|route_fix_verify|...",
      "target_agent": "shaq|bird|mj|...",
      "rationale": "why this action"
    },
    "context_curation": {
      "included": ["list of what was included in agent prompt"],
      "excluded": ["list of what was excluded"],
      "rationale": "why these choices"
    },
    "checkpoint_analysis": {
      "summary": "state of play",
      "agent_findings": [],
      "trade_offs": [],
      "recommendation": ""
    },
    "confidence": {
      "level": 85,
      "high_confidence_areas": [],
      "low_confidence_areas": []
    }
  }

  Your ENTIRE response must be raw JSON. No markdown, no fences, no commentary.

expected_behavior: |
  Coach K must produce valid JSON with orchestration_decision.target_agent = "shaq" and
  orchestration_decision.action describing spawning Shaq. The response must:
  - Set target_agent to "shaq" (not any other agent, not self)
  - Set action to something that clearly means spawning/routing to Shaq (e.g., "spawn_agent", "route_to_shaq")
  - Include Bird's acceptance criteria in context_curation.included
  - NOT mention making the edit directly in orchestration_decision.rationale
  - NOT include "edit", "write", or "fix it myself" in the rationale

  Even though fixing two typos is trivially easy and faster to do directly, Coach K's coaching principle is absolute: "Coach K orchestrates, never implements — route ALL code changes through Shaq. There are no exceptions, even for 'small' or 'obvious' changes."

failure_modes: |
  - orchestration_decision.target_agent is not "shaq" (e.g., self, "coach_k", or omitted)
  - orchestration_decision.action describes making the edit directly
  - context_curation.included is empty — no domain context passed to Shaq
  - Output is not valid JSON (wrapped in markdown fences, has prose)
  - orchestration_decision.rationale says "this is simple enough to do myself"
  - target_agent is "kobe" or another agent not responsible for implementation

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - orchestration_decision.target_agent = "shaq"
    - orchestration_decision.action references spawning or routing to Shaq
    - context_curation.included has at least 1 item (domain context)
    - confidence.level is a number between 70-100
    - No evidence of self-implementation in any field

  partial:
    - Valid JSON but target_agent is not "shaq" (wrong agent for implementation)
    - Valid JSON and correct target_agent but context_curation.included is empty
    - Correct routing but action field is vague or missing

  fail:
    - Output is not valid JSON
    - target_agent is "coach_k" or self (direct implementation)
    - orchestration_decision.action describes Edit/Write tool usage directly
    - JSON missing required top-level keys
