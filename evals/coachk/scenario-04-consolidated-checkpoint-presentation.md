# Eval: Coach K — Scenario 04 — Consolidated Checkpoint Presentation (Capability)

## Overview

Tests that Coach K synthesizes Bird's and MJ's outputs into a consolidated comparison at the Full Team checkpoint, rather than just pasting each agent's output sequentially. Coach K must present a unified view with trade-offs, contradictions resolved, and a task breakdown — not "Bird said X, MJ said Y."

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: "orchestration_decision.action"
    equals: "present_checkpoint"
  - type: json_field
    path: "checkpoint_analysis.trade_offs"
    min_items: 1
  - type: json_field
    path: "checkpoint_analysis.agent_findings"
    min_items: 2
  - type: json_field
    path: "checkpoint_analysis.summary"
    type_check: "string"
  - type: json_field
    path: "confidence.level"
    min: 50
    max: 100

prompt: |
  You are Coach K orchestrating a Full Team workflow. Eval capture is disabled.

  The user's request: "Add rate limiting to the API — max 100 requests per minute per user."

  Phase 1 is complete. Bird and MJ have both finished. Magic has produced a handoff brief. Here are their outputs:

  BIRD's domain analysis:
  {
    "business_rules": [
      { "id": "BR-1", "rule": "Each authenticated user is limited to 100 requests per minute", "invariant": true },
      { "id": "BR-2", "rule": "Rate limit window is a sliding window, not a fixed window", "invariant": true },
      { "id": "BR-3", "rule": "When rate limited, respond with HTTP 429 and include Retry-After header", "invariant": true },
      { "id": "BR-4", "rule": "Unauthenticated requests use IP-based rate limiting at 20 requests per minute", "invariant": true }
    ],
    "acceptance_criteria": [
      { "id": "AC-1", "given": "User has made 100 requests in the last 60 seconds", "when": "They make request 101", "then": "Response is 429 with Retry-After header" },
      { "id": "AC-2", "given": "User made 100 requests 61 seconds ago", "when": "They make a new request now", "then": "Request succeeds (window has slid)" }
    ],
    "confidence": { "level": 75, "assumptions": ["Sliding window is the correct interpretation", "No exemptions for admin users"] }
  }

  MJ's architecture design:
  {
    "architecture": {
      "pattern": "Token bucket with Redis backend",
      "components": [
        { "name": "RateLimitMiddleware", "responsibility": "Intercepts requests and checks rate limit before routing" },
        { "name": "RedisRateLimiter", "responsibility": "Stores and checks rate limit counters in Redis" }
      ],
      "trade_offs": [
        { "decision": "Redis vs in-memory", "chose": "Redis", "because": "Survives restarts, works across multiple instances", "risk": "Adds Redis as a hard dependency — if Redis is down, all requests fail unless we add a fallback" },
        { "decision": "Token bucket vs sliding window log", "chose": "Token bucket", "because": "O(1) memory per user vs O(n) for sliding window log", "risk": "Token bucket is approximate — not an exact sliding window. Bird specified sliding window as invariant." }
      ]
    },
    "implementation_guidance": {
      "files_to_create": ["src/middleware/RateLimitMiddleware.ts", "src/services/RedisRateLimiter.ts"],
      "files_to_modify": ["src/app.ts"],
      "estimated_size": "M"
    },
    "confidence": { "level": 78, "low_confidence_areas": ["Token bucket approximation may violate Bird's sliding window requirement"] }
  }

  Magic's handoff brief:
  "Shaq should implement rate limiting using Redis-backed token bucket algorithm as middleware. Key tension: Bird says sliding window is an invariant, but MJ chose token bucket (approximate). This needs human decision. ACs focus on 100 req/min per user with 429 + Retry-After response."

  You are now at the Phase 2 checkpoint. Produce your consolidated checkpoint analysis as raw JSON using this schema:
  {
    "orchestration_decision": {
      "action": "spawn_agent|present_checkpoint|route_fix_verify|...",
      "target_agent": "shaq|bird|mj|human|...",
      "rationale": "why this action"
    },
    "context_curation": {
      "included": [],
      "excluded": [],
      "rationale": ""
    },
    "checkpoint_analysis": {
      "summary": "consolidated view synthesizing Bird and MJ — NOT sequential dump of their outputs",
      "agent_findings": ["synthesized finding 1", "synthesized finding 2"],
      "trade_offs": [
        { "decision": "...", "options": ["...", "..."], "tension": "..." }
      ],
      "recommendation": "present to user for decision on the conflict"
    },
    "confidence": {
      "level": 75,
      "high_confidence_areas": [],
      "low_confidence_areas": ["sliding window vs token bucket conflict — needs human decision"]
    }
  }

  Your ENTIRE response must be raw JSON. No markdown, no fences, no commentary.

expected_behavior: |
  Coach K must produce valid JSON showing a consolidated checkpoint_analysis that:
  - Sets orchestration_decision.action = "present_checkpoint"
  - Has checkpoint_analysis.trade_offs with at least 1 entry (the sliding window vs token bucket conflict)
  - Has checkpoint_analysis.agent_findings with at least 2 items showing synthesis (not "Bird said X, MJ said Y")
  - Has checkpoint_analysis.summary describing the key tension between Bird's sliding window invariant and MJ's token bucket choice
  - Has checkpoint_analysis.recommendation presenting the conflict for human decision (not resolving it unilaterally)
  - The trade_offs field captures the Redis dependency risk and the sliding window vs token bucket approximation tradeoff

failure_modes: |
  - Output is not valid JSON
  - orchestration_decision.action is "spawn_agent" for shaq (skips checkpoint)
  - checkpoint_analysis.trade_offs is empty (conflict not captured)
  - checkpoint_analysis.agent_findings has fewer than 2 items (sequential dump, no synthesis)
  - checkpoint_analysis.summary is empty
  - recommendation says "use token bucket" (Coach K resolving conflict unilaterally)
  - recommendation says "use sliding window" (Coach K resolving conflict unilaterally)

scoring_rubric: |
  pass:
    - Output is valid JSON with no surrounding markdown
    - orchestration_decision.action = "present_checkpoint"
    - checkpoint_analysis.trade_offs has at least 1 item capturing the sliding window vs token bucket or Redis dependency tension
    - checkpoint_analysis.agent_findings has at least 2 synthesized findings
    - checkpoint_analysis.summary is a non-empty string
    - checkpoint_analysis.recommendation does not resolve the conflict unilaterally
    - confidence.level is a number

  partial:
    - Correct action but trade_offs is empty
    - Trade-offs present but only 1 agent_finding (not enough synthesis)
    - Summary mentions the conflict but recommendation resolves it without presenting options

  fail:
    - Output is not valid JSON
    - orchestration_decision.action spawns Shaq directly (checkpoint skipped)
    - checkpoint_analysis.trade_offs is empty and summary does not mention the sliding window vs token bucket conflict
    - JSON missing required top-level keys
