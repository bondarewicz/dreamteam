# Architecture: SubagentStart Hook + Coach K Orchestration via Hooks
Author: MJ (Strategic Systems Architect)
Date: 2026-05-21

## Feasibility (must read before architecture)

Per-hook feasibility verdict from Claude Code docs + source inspection:

| # | Hook | Verdict | Notes |
|---|------|---------|-------|
| 1 | SubagentStart → effort switch | **UNSUPPORTED as written** | Hook can inject `additionalContext`. Cannot change `effort` or `model` — those are set in agent frontmatter only. GH #24 needs reframing. |
| 2 | PostToolUse on `Task` (matcher `shaq`) → auto-Kobe | **PARTIAL** | Matcher matches `tool_name`, not `subagent_type`. Requires wildcard matcher + stdin inspection. Fires for ALL subagent spawns (Bird, MJ, etc.) — adds latency. Recommend defer pending empirical test of agent_type values. |
| 3 | PostToolUse on `Write\|Edit` in `agents/` → auto-draft-eval | **SUPPORTED** | Standard pattern. Script filters `file_path` from stdin. |
| 4 | PreToolUse on `Write\|Edit` into `~/.claude/` → block + redirect | **SUPPORTED** | Standard pattern. Use `permissionDecision='deny'` for clean denial. |
| 5 | Stop hook → SDD artifact completeness | **SUPPORTED** | Stop has no matcher → fast-exit guard mandatory. Needs `.workflow` marker file to know workflow type. |

**Recommendation**: ship 3, 4, 5 this session. Defer 1, 2 with follow-up issues.

## Architecture Decisions

### AD-1: Use `permissionDecision='deny'` (JSON on exit 0), not exit code 2, for PreToolUse blocking
**Rationale**: Returns structured denial Claude treats as a proper permission decision. Exit 2 surfaces as a generic hook error. The agent sees "permission denied: edit repo source instead" rather than "hook failed".

### AD-2: PostToolUse hooks use `additionalContext` injection (advisory), not blocking
**Rationale**: Blocking PostToolUse halts the workflow. For auto-draft-eval and auto-Kobe, the right action is a context nudge Coach K can act on. Coach K stays in control; hooks supply reminders.

### AD-3: Stop hook uses fast-exit guard pattern
**Rationale**: Stop fires every turn with no matcher. Sub-10ms exit when no spec session is active. Full artifact scan only when `docs/spec-<TOPIC>/` is detected via `cwd` + recent-modified heuristic. Blocking communicated via `{decision: "block", reason: "..."}` JSON.

### AD-4: Coach K writes `.workflow` marker file at session start
**Rationale**: Stop hook stdin doesn't carry workflow type. Marker file is explicit, versionable, and survives restarts. One-line addition to `commands/team.md` STEP 1b.

### AD-5: `scripts/install.ts` requires zero changes
**Rationale**: Existing Step 9 merge handles arbitrary event types via add-if-missing semantics (JSON.stringify equality). New hooks added to `scripts/hooks.json` auto-merge into `~/.claude/settings.json`.

### AD-6: All hook scripts under `scripts/hooks/`, Bun TS, follow `check-plan.ts` pattern
**Rationale**: Existing convention. Bun is confirmed available (check-plan.ts already runs). Symlinked by install.ts to `~/.claude/scripts/hooks/`.

### AD-7: `scripts/hooks/effort-map.json` ships as preparatory config
**Rationale**: Even though SubagentStart can't switch effort at runtime, an externalized effort map is the right place to declare per-agent defaults. When/if frontmatter `effort:` fields are added (the actual mechanism), this same map informs the values. Future SubagentStart hooks (logging, advisory context) can also consume it.

## Component Interactions

### Files to create
- `scripts/hooks/block-direct-claude-edit.ts` — PreToolUse on `Write|Edit`. Reads stdin, denies writes to install-managed `~/.claude/` paths, allows everything else.
- `scripts/hooks/auto-draft-eval.ts` — PostToolUse on `Write|Edit`. Reads stdin, injects `additionalContext` when `file_path` matches `<repo>/agents/*.md`.
- `scripts/hooks/stop-artifact-check.ts` — Stop hook. Fast-exit if no spec dir. Reads `.workflow` marker, checks required artifacts, blocks with reason if any missing.
- `scripts/hooks/effort-map.json` — `{"bird":"high","mj":"high","kobe":"high","pippen":"high","coachk":"high","shaq":"medium","magic":"low","drexler":"low"}`.

### Files to modify
- `scripts/hooks.json` — add 3 new hook entries alongside existing `check-plan`.
- `commands/team.md` — add `.workflow` marker file write at STEP 1b. Optionally remove the prompt rules now enforced by hooks (keep as `[Enforced by hook: ...]` documentation per Bird's recommendation).

### Files NOT to modify
- `scripts/install.ts` — existing merge logic handles new hooks. Zero changes.
- Agent definitions (`agents/*.md`) — no changes this session. (Effort frontmatter is a separate decision pending user input on Hook 1.)

## Hook I/O Contracts

```
PreToolUse block-direct-claude-edit:
  stdin:  {tool_name, tool_input:{file_path,content}, hook_event_name:"PreToolUse", cwd, session_id}
  stdout: {hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny"|"allow", permissionDecisionReason:"..."}}
  exit:   0 (decision via JSON)

PostToolUse auto-draft-eval:
  stdin:  {tool_name, tool_input:{file_path}, tool_output, hook_event_name:"PostToolUse"}
  stdout: {hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:"..."}} or empty
  exit:   0

Stop stop-artifact-check:
  stdin:  {hook_event_name:"Stop", cwd, stop_reason, session_id, stop_hook_active}
  stdout: {decision:"block", reason:"Missing artifacts: ..."} or empty
  exit:   0
```

## Non-Functional Requirements

- **Performance**: Stop hook < 10ms when no spec dir active. PreToolUse hooks < 50ms. PostToolUse hooks < 100ms.
- **Reliability**: Try/catch wrapper around every hook script. Crashes write to stderr, exit appropriately (fail-closed for PreToolUse deny hooks, fail-open for advisory hooks).
- **Observability**: Each hook writes a one-line action log to stderr (`[block-direct-claude-edit] denied: ~/.claude/agents/bird.md`). Surfaces in Claude Code debug log.
- **Idempotency**: Auto-Kobe and auto-draft-eval are pure context injections — duplicate firings are harmless.
- **Backward compat**: Existing `check-plan` hook is untouched. Existing settings.json hooks preserved by add-if-missing merge.

## Trade-offs

- **Exit 0 + JSON decision** beats exit 2 + stderr for PreToolUse: structured semantics > generic error. Cost: slightly more complex hook script (must output valid JSON).
- **Defer Hooks 1 & 2** beats forced implementation: avoids shipping broken hooks against unverified API. Cost: those two prompt rules remain hopes for now.
- **Advisory PostToolUse** beats blocking: doesn't interrupt flow. Cost: Coach K can theoretically ignore the reminder (not a hard guarantee).
- **Scope ~/.claude/ block to install-managed paths** beats blocking all writes: doesn't break auto-memory or user CLAUDE.md edits. Cost: more complex path matching in script.

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| R1 | SubagentStart `agent_type` may not carry `subagent_type` value from Task calls (Hook 1, 2 deferred for this reason) | High | 15-min empirical test as follow-up: log payload, inspect values. |
| R2 | Stop hook performance tax on every turn | Medium | Fast-exit guard. Sub-10ms when no spec dir present. |
| R3 | Hook script crashes silently if Bun missing | Medium | Try/catch + stderr. Bun confirmed available via existing check-plan.ts. |
| R4 | `~/.claude/settings.json` accumulates stale entries when hooks removed | Low | Document `--clean` flag for install.ts (follow-up issue). |
| R5 | Two hooks for same event (check-plan + new) — interaction | Low | Confirmed compatible: both run, write-block can deny regardless of check-plan. |

## Implementation Order

1. **Hook 4 (block-direct-claude-edit)** — highest value, simplest, well-understood mechanism.
2. **Hook 3 (auto-draft-eval)** — medium complexity, clear contract.
3. **Hook 5 (stop-artifact-check)** — highest complexity (fast-exit, workflow marker, artifact map).
4. **`scripts/hooks/effort-map.json`** — pure config, ships as preparatory infra.
5. **`commands/team.md`** — add `.workflow` marker write at STEP 1b. Update prompt rules with `[Enforced by hook: ...]` annotations.
6. **Defer**: Hook 1 (SubagentStart effort) and Hook 2 (auto-Kobe) → new follow-up issues.

## Open Architecture Questions

1. **`if` field syntax for path filtering** — Claude Code docs hint at `Write(~/.claude/*)` glob-style `if` predicate. If it works, can simplify Hook 4 to declarative config. Needs verification.
2. **Stop hook on subagent stop vs session stop** — `stop_hook_active` flag inspection. Confirm semantics with empirical test.
3. **`scripts/install.ts` `--clean` flag for hook removal** — out of scope this session; tracking issue.
