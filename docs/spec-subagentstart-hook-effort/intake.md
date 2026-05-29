## Intake: Move Coach K Orchestration Into Hooks
Date: 2026-05-21
Author: Łukasz Bondarewicz
Status: Confirmed by Łukasz Bondarewicz
Tracker: GitHub issue #24 (https://github.com/bondarewicz/dreamteam/issues/24) + 4 hook candidates from `docs/ruflo-comparison-adoptable-ideas.md`

## Problem Statement
Coach K currently relies on prompt instructions to enforce orchestration rules (draft eval generation, no-direct-edit of `~/.claude/`, post-Shaq review, session-end synthesis, per-agent effort). Prompt-based rules are hopes, not guarantees. Move those rules into Claude Code hooks so the harness enforces them deterministically — and rebuild around SDD artifacts (the retro flow is gone, `docs/spec-<TOPIC>/` is the new finish line).

## What Success Looks Like
A `scripts/hooks.json` that registers up to five hooks, each backed by a Bun TypeScript script under `scripts/hooks/`, installed via `scripts/install.ts`:

1. **SubagentStart → effort switch (GH #24)** — when a subagent is spawned, set its effort/model per agent-type mapping.
2. **PostToolUse on `Task` (matcher `shaq`) → auto-spawn Kobe review** — Coach K can no longer "forget" the review step.
3. **PostToolUse on `Write|Edit` inside `agents/` → auto-generate draft eval** — turns `feedback_draft_evals_mandatory` from a prompt rule into a harness guarantee.
4. **PreToolUse on `Write` into `~/.claude/` → block + redirect** — enforces `feedback_edit_repo_first`. Tells the agent to edit repo source and re-run install.
5. **Stop hook → SDD artifact completeness check** (replaces the dropped retro hook). When a `/team` session ends, verify that `docs/spec-<TOPIC>/` contains the expected artifacts for the workflow that ran (intake.md + domain.md + architecture.md + scope.md + review.md + spec.md for Full Team; intake.md + domain.md + scope.md + review.md + spec.md for Quick Fix). If any required artifact is missing, surface a hard error naming the missing file so Magic re-runs synthesis rather than silently letting an incomplete spec ship.

Each hook ships with: a feasibility note (does Claude Code support the event today?), a Bun TS implementation, a unit test where possible, and a one-line entry in README/`scripts/hooks.json`.

## Out of Scope
- Implementing effort switching upstream in Claude Code itself.
- Rewriting agent definitions to drop pinned `model:` lines (the SubagentStart hook supplements, not replaces, model pinning until proven).
- Bringing back the retro flow — `docs/spec-<TOPIC>/` is the artifact set we care about now.
- Per-prompt dynamic effort switching (only at subagent spawn time).
- Cost/telemetry dashboard for hook firings.
- Rewriting the existing PreToolUse check-plan hook (it stays as-is; new hooks merge into the same `scripts/hooks.json`).
- Building any of the other ruflo-comparison ideas (security agent, TDD state machine, `/verify`, named pipelines).

## Open Questions
1. **Which hook events does Claude Code actually expose today?** Must be answered first via Context7 / official docs. Specifically: does `SubagentStart` exist? does `Stop` exist? what payloads do they pass (agent name, session ID, tool input)? If any event does not exist, that hook is deferred — surface it in the spec rather than guess.
2. **Effort mapping per agent.** Bird/MJ/Kobe/Drexler/Pippen → high? Magic → low? Shaq → medium? Coach K → high? Need concrete defaults backed by what each role actually does.
3. **Where does the effort mapping live?** In the hook script, or as a separate `scripts/hooks/effort-map.json` so it can be tuned without code edits?
4. **Auto-Kobe after Shaq — full review or "quick check" mode?** Full review duplicates Coach K's Phase 4. Maybe the hook just enqueues a Kobe task instead of spawning it directly.
5. **Stop hook artifact check — which artifacts are required per workflow?** Need a clean mapping from workflow type (Quick Fix vs Full Team) to required `docs/spec-<TOPIC>/*.md` files. Probably encoded as data so it survives commands/team.md edits.
6. **`~/.claude/` write-block scope.** Block every write, or only writes to paths the install script manages (agents/, commands/, scripts/, settings.json)? Too broad and we block legitimate user edits to `~/.claude/CLAUDE.md`.

## Constraints
- New scripts must be Bun TypeScript (`.ts`), not shell.
- Never edit `~/.claude/` files directly — edit repo source and run `scripts/install.ts` to sync.
- Any agent definition change must be validated by evals with `--trials 3` before shipping.
- New hooks must coexist with the existing `PreToolUse` check-plan hook in `scripts/hooks.json` — merge, not replace.
- Each hook script must exit non-zero with a useful stderr message when it wants to block. Hooks that fail silently are worse than no hook.
- If a hook event is not available in Claude Code today, the spec must say so explicitly and either defer that hook or propose a fallback event — no implementations against imaginary APIs.
