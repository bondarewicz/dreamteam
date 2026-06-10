# Domain: schema-enforcement
Author: Bird (Domain Authority)
Date: 2026-05-29

## Acceptance Criteria

- **AC-1** — Given an agent is dispatched, When it completes, Then its output is valid JSON
  parseable by `JSON.parse()` with zero pre-processing and conforms to the agent's schema.
- **AC-2** — Given an agent produces non-conforming output, When the enforcement layer detects
  it, Then the agent is auto-retried (bounded, ~2) and on exhaustion a **typed error** is
  returned, never silent data loss.
- **AC-3** — Given the safety-guard text exists in agent md / team.md, When enforcement is proven,
  Then that text is removed or demoted to a non-load-bearing comment.
- **AC-4** — Given an eval scenario runs, When output is collected, Then `json_valid` passes on
  raw output without needing the json-extract tolerance layer's fence-strip / brace-scan tiers.
- **AC-5** — Given Shaq runs under schema enforcement, When he implements, Then he can still call
  Edit/Write during execution AND his **final** response validates. Only the final response is
  validated, not intermediate tool calls.
- **AC-7** — Given schema retry exhaustion, Then the failure surfaces a typed error with agent
  name, scenario, and the raw non-compliant output preserved.
- **AC-11** — Given enforcement is live, When comparing eval pass rates before/after, Then
  format-deviation failures drop to zero AND content-quality scores do not regress.
- **AC-12** — Given the human triggers `/team`, Then AskUserQuestion checkpoints, approve/reject
  gates, and spec sign-off all still work — enforcement is invisible to the human.

(Full set AC-1..AC-12 in Bird's output; the above are the load-bearing ones.)

## Business Rules

| ID | Rule | Invariant? | Option 2 as written |
|----|------|-----------|---------------------|
| BR-1 | Every final output parseable as JSON, first `{` last `}` | YES | preserves |
| BR-2 | Eval reproducibility via per-agent `--model` pinning | YES | preserves |
| BR-3 | Per-agent tool restrictions (`--allowedTools` mirrors frontmatter) | YES | preserves |
| BR-4 | No agent commits/pushes to git | YES | preserves |
| BR-5 | Fix-verify loop mandatory; Coach K never fixes code directly | YES | at risk (loses agent-teams messaging) |
| BR-6 | **Schema enforcement and dispatch mechanism are SEPARABLE decisions** | principle | conflates them |
| BR-8 | Subagent path gives shared session context (MCP, CLAUDE.md, hooks) | no | **breaks** under claude -p |
| BR-9 | Full Team uses agent-teams TaskGet/SendMessage messaging | no | **breaks** (no messaging in subprocess) |
| BR-10 | Coach K curates context per agent | YES | preserves (maps to per-agent brief) |
| BR-11 | `/team` interactive UX must remain functional | YES | **at risk** under full subprocess rewrite |
| BR-12 | File-writing agents (Shaq, Magic) keep Edit/Write during execution | YES | preserves IF only final response validated |

## Invariants — What Must Never Break

Valid-JSON-out (BR-1), eval reproducibility (BR-2), tool restrictions (BR-3), git safety (BR-4),
fix-verify loop (BR-5), context curation (BR-10), interactive `/team` UX (BR-11), and file-writing
agents' tool access during execution (BR-12).

## Edge Cases

- **Schema retry exhaustion** → typed error, not empty data; Coach K decides retry-simpler /
  fallback-unstructured / abort.
- **Shaq's files persist even if final JSON fails validation** → retry must reference written
  files, not rewrite them. Never conflate tool-call output with final response.
- **Magic's manifest references a `spec_path` that doesn't exist** → schema validates structure;
  artifact existence is still Coach K's check.
- **`--bare` strips MCP** → Shaq loses Context7. Per-context flag: `--bare` for evals, not for
  interactive runs.
- **Inter-agent messaging lost under claude -p** → Phase 1 concurrent Bird↔MJ handoff must be
  redesigned from pull (inbox) to push (Coach K injects context).
- **memory:user lost under `--bare`** → Kobe/Magic cross-session learning gone in eval path
  (acceptable — eval runs should be stateless) but must be preserved interactively.

## Open Domain Questions

1. **Scope ambiguity (escalated):** is the intent schema-enforcement-only, or enforcement AND a
   dispatch-mechanism switch? Bird recommends **Option C (Hybrid)**: separate them.
2. Do Option 2's simplified Zod schemas drop fields the eval graders currently check
   (`confidence.level`, `business_rules[*].invariant`, `escalations[*].type`)? Bird recommends:
   keep full schema shape but mark deep fields `.optional()`.

## Confidence

Bird: **55/100** — capped by the unresolved scope ambiguity in intake and the unverified
`--json-schema` mechanics. High confidence on the invariants; low confidence on which mechanism
is intended.
