# Eval: Coach K — Scenario 05 — Human Decision Flows Downstream (Capability)

## Overview

Tests that when the human makes a specific choice at the checkpoint that overrides an agent's recommendation, Coach K passes the HUMAN's decision to Shaq — not the agent's original recommendation. This is critical for trust: if the user says "use approach B" but Coach K still tells Shaq to use approach A (what Bird/MJ recommended), the entire orchestration loop is broken.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "orchestration_decision.target_agent"
    equals: "shaq"
  - type: json_field
    path: "context_curation.included"
    min_items: 2
  - type: json_field
    path: "context_curation.rationale"
    type_check: "string"
  - type: json_field
    path: "checkpoint_analysis.summary"
    type_check: "string"
  - type: json_field
    path: "confidence.level"
    min: 70
    max: 100

prompt: |
  You are Coach K orchestrating a Quick Fix workflow. Eval capture is disabled.

  The user's request: "Add rate limiting to the API — max 100 requests per minute per user."

  Bird completed domain analysis and recommended a sliding window approach. MJ's architecture recommended Redis-backed token bucket. At the checkpoint, you presented both options with trade-offs.

  The user's response at the checkpoint was:

  "I don't want Redis as a dependency for this. Use a simple in-memory fixed window counter — we only run one instance anyway. Reset the counter every 60 seconds. I know it's less precise than sliding window but it's good enough for now. We can upgrade later."

  The user selected "Approve plan" after stating this preference.

  Bird's original acceptance criteria were:
  - AC-1: Given user has made 100 requests in last 60 seconds, when they make request 101, then 429 with Retry-After
  - AC-2: Given user made 100 requests 61 seconds ago, when they make a new request, then request succeeds (sliding window behavior)

  Note: AC-2 specifically tests sliding window behavior. The user chose fixed window, which means AC-2 needs to be ADAPTED to reflect fixed window semantics (counter resets at window boundary, not sliding).

  Produce your orchestration decision as raw JSON using this schema:
  {
    "orchestration_decision": {
      "action": "spawn_agent|present_checkpoint|route_fix_verify|...",
      "target_agent": "shaq|bird|mj|...",
      "rationale": "why this action — must reflect the human's in-memory fixed window decision"
    },
    "context_curation": {
      "included": ["list exactly what will be in the Shaq prompt — must reflect user's overrides"],
      "excluded": ["list what was excluded — Redis, sliding window should appear here"],
      "rationale": "why these curation choices — must reference the human decision"
    },
    "checkpoint_analysis": {
      "summary": "what the human decided and how it overrides agent recommendations",
      "agent_findings": [],
      "trade_offs": [],
      "recommendation": "spawn Shaq with the human-approved approach"
    },
    "confidence": {
      "level": 85,
      "high_confidence_areas": [],
      "low_confidence_areas": []
    }
  }

  Your ENTIRE response must be raw JSON. No markdown, no fences, no commentary.

expected_behavior: |
  Coach K must produce valid JSON showing the human's decision flows downstream to Shaq:
  - orchestration_decision.target_agent = "shaq"
  - context_curation.included must reference "in-memory fixed window" (user's choice)
  - context_curation.excluded must reference "Redis" (user explicitly rejected)
  - context_curation.excluded must reference "sliding window" (agent recommendation overridden)
  - context_curation.rationale must reference the human decision as the reason for these choices
  - checkpoint_analysis.summary must describe the human override
  - The AC-2 adaptation (fixed window semantics instead of sliding window) should be noted

  The human overrode Bird's "sliding window is invariant: true" classification. Coach K must respect this
  and NOT pass Bird's invariant classification downstream as if it still applies.

failure_modes: |
  - context_curation.included contains "Redis" (user rejected this)
  - context_curation.included contains "sliding window" as the implementation approach
  - context_curation.excluded is empty (no curation — human decision not applied)
  - context_curation.rationale does not mention the human decision
  - checkpoint_analysis.summary does not mention the human override
  - Output is not valid JSON
  - target_agent is not "shaq"

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - target_agent = "shaq"
    - context_curation.included has at least 2 items reflecting the user's choice (in-memory, fixed window, 100 req/min)
    - context_curation.excluded has at least 1 item (Redis or sliding window)
    - context_curation.rationale is a non-empty string referencing the human decision
    - checkpoint_analysis.summary is a non-empty string describing the override
    - confidence.level is a number

  partial:
    - Valid JSON and correct target_agent but context_curation.excluded is empty
    - Correct approach (in-memory fixed window) reflected in included but excluded doesn't mention Redis
    - Human decision mentioned in summary but not reflected in context_curation
    - Correct routing but rationale doesn't explain why human's choice overrides agents

  fail:
    - Output is not valid JSON
    - context_curation.included contains "Redis" or "sliding window" as approach (agent recommendation, not user decision)
    - context_curation.excluded is empty and included doesn't reflect user's override
    - target_agent is not "shaq"
    - JSON missing required top-level keys
