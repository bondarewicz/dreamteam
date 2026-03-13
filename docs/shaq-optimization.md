# Shaq Optimization: Faster Delivery Without Adding Coders

## Context

Evaluated whether adding 1-2 more coder agents alongside Shaq would improve delivery speed. Conclusion: **optimizing Shaq's pipeline yields ~1.4-1.5x capacity with zero coordination cost**, while a second coder gives 2x raw capacity minus significant coordination overhead (splitting, merging, conflict resolution).

## Platform Constraint: maxTurns Cap

Claude Code enforces a hard ceiling of **100 turns** for agents. You cannot set it higher.

| Agent | maxTurns | Rationale |
|-------|----------|-----------|
| Shaq | 100 | Maxed out — implementation needs the most turns |
| Bird | 50 | Analysis/domain work — reads and reasons, rarely hits limit |
| MJ | 50 | Architecture design — same pattern as Bird |
| Kobe | 50 | Quality review — focused review scope |
| Pippen | 50 | Stability review — focused review scope |
| Magic | 50 | Synthesis — summarizes, doesn't write large codebases |

Since Shaq is already at the platform cap, the only way to increase his effective output is to make each turn count more — which is what the three levers below address.

## Current Turn Allocation (estimated, out of 100 turns)

| Activity | Turns | % |
|----------|-------|---|
| Team protocol (read tasks, check blockers, read messages) | ~5 | 5% |
| Plan mode (research codebase, write plan, wait for approval) | ~15-25 | 15-25% |
| Codebase exploration (Glob, Grep, Read to find patterns) | ~10-15 | 10-15% |
| Actual code writing + tests | ~40-50 | 40-50% |
| Output schema (structured summary, AC coverage, confidence) | ~10-15 | 10-15% |

Only ~40-50% of turns go to actual implementation. The rest is coordination, research, and reporting.

## Three Levers

### Lever 1: Richer handoff briefs from Magic

Shaq spends 10-15 turns exploring the codebase to find patterns even after receiving Magic's handoff brief. If Magic's brief included:
- Exact file paths of similar implementations to follow
- Snippets of existing patterns (not just "follow existing patterns")
- The test framework and helpers already in use, with examples

This could recover **10+ turns** — a 20-25% boost to implementation capacity.

**Change:** In `magic.md` — add to the handoff brief format: "Include 2-3 existing file paths that demonstrate the patterns Shaq should follow, with relevant code snippets"

### Lever 2: Pre-resolved ambiguity from Bird

Every escalation costs turns on both sides — Shaq pauses, messages Coach K, Coach K routes to Bird, answer comes back. If Bird's acceptance criteria were more exhaustive upfront (explicitly covering edge cases Shaq commonly escalates on), mid-implementation stalls are eliminated.

**Change:** In `bird.md` — add: "For each acceptance criterion, explicitly cover the most likely edge case as a sub-criterion"

### Lever 3: Reduce the output schema tax

Shaq's required output schema (`implementation_summary`, `acceptance_criteria_coverage`, `tests`, `deviations`, `confidence`) costs ~10-15 turns to write. Options:
- **Automate parts of it** — a post-implementation script that generates `files_changed` and `acceptance_criteria_coverage` from git diff + test output, so Shaq just fills in judgment calls
- **Defer non-critical sections** — `deviations` and `confidence` are important, but `files_changed` is mechanical and could be inferred

**Change:** In `team.md` — have Coach K pass `git diff --stat` output into Magic's synthesis so `files_changed` is auto-populated rather than Shaq manually listing it

## Why Not a Second Coder

| Scenario | Agents | Coordination overhead | Net speed |
|----------|--------|-----------------------|-----------|
| Current (1 Shaq) | 1 | Zero | Baseline |
| 2 coders, dependent work | 2 | High (splitting, merging, conflict resolution) | **Slower** |
| 2 coders, independent work | 2 | Medium (splitting, parallel review) | ~1.3-1.5x |
| 2 coders, mechanical refactor | 2 | Low (file-level splitting) | ~1.7x |

A second coder only helps with truly independent workstreams (e.g., "build the API" and "build the CLI" simultaneously with zero shared files). This requires a splitter step, worktree isolation, a merge step, and updated review flow — significant orchestration complexity for marginal gain on most tasks.

## Status

- [ ] Lever 1: Update magic.md handoff brief format
- [ ] Lever 2: Update bird.md acceptance criteria depth
- [ ] Lever 3: Auto-populate files_changed in team.md
- [ ] Measure turn usage before/after on a real `/team` run
