# Intake: schema-enforcement

Date: 2026-05-29
Author: Łukasz Bondarewicz
Status: Confirmed by Łukasz Bondarewicz
Tracker: none

## Problem Statement

The Dream Team currently enforces structured output through prompt convention — every
agent md file (and Coach K's team.md) carries "safety guard" reminders like _"Respond with
raw JSON only. First character { last character }. No markdown fences"_, and Coach K
re-validates each agent's output and retries on deviation. I want to remove those
markdown-embedded safety guards and instead enforce a real JSON schema per agent, so output
shape is consistent and we stop losing eval scenarios to formatting deviations (markdown
fences, prose preambles, mixed payloads).

## What Success Looks Like

- Each agent has a typed output contract (JSON schema) enforced at a boundary the model
  cannot talk its way around — not a prompt reminder.
- The "raw JSON only / no fences" guard text is removed from agent md files and team.md, OR
  reduced to the point it no longer carries correctness weight.
- Eval failures caused by output-format deviation (fences, preambles) drop toward zero.
- Reproducible evals, per-agent model pinning, and per-agent tool restrictions are preserved.

## Out of Scope

- Rewriting the agents' actual reasoning/role content (Bird stays Bird).
- Changing eval _scenarios_ or scoring rubrics themselves (beyond removing format-deviation
  as a failure mode).
- Abandoning the Claude Code CLI for the raw Anthropic API (token-level constrained decoding
  via `output_config.format`) — noted as a possible future, not this work.
- A big-bang migration of all agents at once.

## Open Questions

- Does `--json-schema` + `--output-format json` behave as the doc claims (validate-and-retry,
  not constrained decoding)? What is the exact failure `subtype` string?
- Does dispatching agents as `claude -p` subprocesses (instead of the Task tool / agent-teams)
  break the orchestration properties we rely on: shared session context, `/team` interactive
  UX, `memory: user` cross-session learning for Kobe/Magic?
- Can the existing `Task`-tool-based orchestration keep its structured-output guarantees some
  other way (e.g. a post-Task validation layer that is code, not prompt text), avoiding the
  process-boundary rewrite entirely?
- Is the right scope "schema enforcement at the boundary" or "schema enforcement AND switch
  the dispatch mechanism"? These are separable decisions.

## Constraints

- Must keep `--model` pinning per agent (eval reproducibility).
- Must keep per-agent tool restrictions (mirrors frontmatter `Tools`).
- No agent commits or pushes to git.
- New scripts must be Bun TypeScript, not shell.
- `--bare` strips MCP servers (Context7/Miro/Honeycomb) — real `/team` runs need them; eval
  runs may want the clean baseline. Decision is per-context.
