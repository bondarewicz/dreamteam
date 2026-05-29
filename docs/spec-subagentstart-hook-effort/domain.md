# Domain: SubagentStart Hook + Coach K Orchestration via Hooks
Author: Bird (Domain Authority)
Date: 2026-05-21

## Acceptance Criteria

- **AC-1** Given a SubagentStart hook is registered with matcher for a known agent type (e.g. `bird`), When Coach K spawns Bird as a subagent via the Task tool, Then the hook fires, receives `agent_type='bird'` on stdin, and **can inject `additionalContext` only — it CANNOT change model or effort**. Those remain as set in `agents/bird.md` frontmatter.
- **AC-2** Given agent definitions have `effort:` fields in frontmatter (bird=high, mj=high, kobe=high, pippen=high, coachk=high, shaq=medium, magic=low, drexler=low), When each agent is spawned during a `/team` session, Then each agent operates at its frontmatter-defined effort level.
- **AC-3** Given a PostToolUse hook with matcher `Task` and a script that checks `tool_input.subagent_type` for `shaq`, When Shaq completes a Task call, Then the hook injects `additionalContext` telling Coach K "Shaq completed — dispatch Kobe per Phase 4 protocol". **It does NOT spawn Kobe directly** — only Coach K does that.
- **AC-4** Given Coach K has already dispatched Kobe in Phase 4 and the auto-Kobe hook also fires, Then the hook's `additionalContext` is idempotent and harmless — no duplicate Kobe is spawned.
- **AC-5** Given a PostToolUse hook on `Write|Edit` with a script that checks if `file_path` is under `<repo>/agents/`, When an agent writes to `<repo>/agents/bird.md`, Then the hook injects `additionalContext` reminding Coach K to generate a draft eval. Writes to `~/.claude/agents/*` (install copies) are silently skipped.
- **AC-6** Given a PreToolUse hook on `Write|Edit` for `~/.claude/` paths, When an agent attempts to Write to `~/.claude/agents/bird.md`, Then the hook returns `permissionDecision='deny'` with reason "Edit repo source instead. Run `bun scripts/install.ts`." Write is blocked.
- **AC-7** Given the same PreToolUse write-block hook, When an agent writes to `~/.claude/CLAUDE.md` or `~/.claude/projects/foo/memory/bar.md`, Then the hook allows the write through. These paths are user-owned, not install-managed.
- **AC-8** Given a Stop hook and a Quick Fix session with TOPIC=`payment-fix`, When the session ends, Then the hook checks `docs/spec-payment-fix/` for `intake.md, domain.md, scope.md, review.md, spec.md`. Missing files → exit code 2 with stderr listing them.
- **AC-9** Given a Stop hook and a Full Team session with TOPIC=`auth-flow`, When the session ends, Then the hook checks for `intake.md, domain.md, architecture.md, operations.md, scope.md, review.md, spec.md`. Missing files → exit code 2.
- **AC-10** Given a Stop hook and a PR Review session, When the session ends, Then the hook checks for `docs/PR-<number>-review.md`. No spec artifacts required.
- **AC-11** Given all new hooks in `scripts/hooks.json` + the existing PreToolUse `check-plan` hook, When `bun scripts/install.ts` runs, Then `~/.claude/settings.json` contains ALL hooks. No existing entries are removed or modified (add-if-missing merge).
- **AC-12** Given the per-agent effort mechanism is shipped (frontmatter `effort:` fields) and effort-related prompt reminders are removed from `commands/team.md`, When Coach K runs a `/team` session, Then agents operate at correct effort levels and behavior is identical to before.
- **AC-13** Given the auto-Kobe hook is shipped and "always dispatch Kobe after Shaq" is removed from Coach K's prompt, When Shaq completes in a Quick Fix session, Then the hook's `additionalContext` reminds Coach K who dispatches Kobe. Fix-verify loop still works.
- **AC-14** Given the write-block hook is shipped and `feedback_edit_repo_first` is removed from Coach K's prompt, When any agent writes directly to `~/.claude/agents/shaq.md`, Then the write is blocked with a redirect and the agent corrects itself.
- **AC-15** Given the Stop artifact hook is shipped and "verify spec completeness" is removed from Coach K's prompt, When a Quick Fix session ends without Magic having written `spec.md`, Then the Stop hook surfaces "Missing artifact: spec.md", Coach K sees this and re-dispatches Magic.

## Business Rules

- **BR-1** SubagentStart hooks **CANNOT** change effort or model. Model and effort are set exclusively via agent frontmatter (`model:` and `effort:` fields). Hook output schema has no field to override either. (Confirmed from Claude Code source.)
- **BR-2** Per-agent effort configuration belongs in agent frontmatter, not in a runtime hook. The SubagentStart hook's only role is advisory context injection.
- **BR-3** PostToolUse matcher matches `tool_name` only. Content-based filtering (e.g., `subagent_type='shaq'`, or `file_path` under `agents/`) must be done inside the hook script after parsing stdin JSON.
- **BR-4** PreToolUse hooks can block tool execution via JSON output `{permissionDecision: "deny", permissionDecisionReason: "..."}` on exit 0. Exit code 2 also blocks.
- **BR-5** Stop hooks fire at the end of EVERY agent turn. For session-end artifact checks, the script must distinguish session-level Stop from subagent-level stop via `stop_hook_active` flag.
- **BR-6** The `~/.claude/` write-block must scope to install-managed paths only: `agents/*.md`, `commands/*.md`, `scripts/*.ts`, `settings.json`. Must allow: `CLAUDE.md`, `projects/**`, `memory/**`, `settings.local.json`, `plugins/**`, `backup-*/`.
- **BR-7** Auto-Kobe-after-Shaq must NOT spawn Kobe directly from the hook. The hook can only inject `additionalContext`. Coach K stays the single orchestrator.
- **BR-8** Stop hook artifact map must be workflow-aware: Quick Fix = `{intake, domain, scope, review, spec}`. Full Team = `{intake, domain, architecture, operations, scope, review, spec}`. PR Review = `{PR-<N>-review.md}`.
- **BR-9** New hooks must coexist with the existing `check-plan` PreToolUse hook — `install.ts` uses add-if-missing semantics.
- **BR-10** Draft-eval auto-generation only fires for writes to `<repo>/agents/*.md`, never `~/.claude/agents/*.md`.
- **BR-11** All hook scripts must be Bun TypeScript under `scripts/hooks/`.

## Must-Never-Break Invariants

1. **Existing `check-plan` PreToolUse hook keeps working.** New hooks are additive, never replace.
2. **`~/.claude/CLAUDE.md`, `~/.claude/projects/**`, `~/.claude/memory/**` must remain writable.** Auto-memory and user-edited CLAUDE.md depend on it.
3. **Coach K stays the single orchestrator.** No hook spawns agents directly — hooks can only inject context that Coach K acts on.
4. **Hook failure must be observable, not silent.** Crashed hook scripts must print to stderr. PreToolUse hooks fail-closed (block); PostToolUse and Stop hooks fail-open (continue).
5. **No hook may be built against an unverified Claude Code API.** If feasibility is uncertain, defer the hook and document it.

## Edge Cases

- **Hook script crashes** → PreToolUse: fail-closed (block, surface error). PostToolUse / Stop: fail-open (log error, continue).
- **Agent type not in effort mapping** → Fail-open, log warning, agent uses frontmatter default.
- **Concurrent SubagentStart for Bird + MJ** → Each invocation is its own process, no shared state, no race.
- **`install.ts` not run, hook scripts missing** → Claude Code logs hook execution error and continues. Workflow degrades to prompt-based rules (fallback).
- **Stop hook fires mid-session** (subagent stops, not session stop) → Script reads `stop_hook_active`, skips artifact check for non-session stops.
- **PostToolUse Task fires for non-Shaq Tasks** (Bird, MJ, Magic) → Script parses stdin, exits 0 silently if `subagent_type !== 'shaq'`.
- **PostToolUse Write|Edit fires for non-agent files** (e.g. `src/app.ts`) → Script checks `file_path`, exits 0 silently if not under `agents/`.
- **Write-block on `Edit` to `~/.claude/agents/bird.md`** → Matcher must be `Write|Edit`, script checks path regardless of tool.
- **Stop hook can't determine workflow** → Coach K writes `.workflow` marker file to spec directory at session start. Stop hook reads it.
- **Two hooks fire for same event (check-plan + write-block)** → Both run. If write-block denies, write is blocked regardless of check-plan.
- **Malformed stdin JSON** → Script catches parse error, fail-open with stderr warning.
- **Spec directory doesn't exist when Stop fires** → Hook scans for `docs/spec-*/` recently modified, reports critical failure if TOPIC unrecoverable.

## Open Domain Questions Escalated

1. **Hook 1 (SubagentStart effort switch)**: Cannot be built as worded in GH #24. Options:
   - **A (recommended)**: Add `effort:` to agent frontmatter. SubagentStart hook becomes optional advisory logging.
   - **B**: SubagentStart hook injects effort-appropriate text instructions ("be thorough", "be concise"). Effort still static.
   - **C**: Defer entirely until Claude Code adds runtime effort switching.
2. **Stop hook workflow context**: Coach K writes `.workflow` marker file (recommended) vs infer from artifacts vs env var.
3. **Auto-Kobe wiring**: Use both PostToolUse `Task` (Quick Fix) and `TaskCompleted` (Full Team) — register both hooks each filtering to Shaq.
4. **Prompt rule removal vs fallback**: Keep prompt rules with `[Enforced by hook: ...]` markers for documentation + graceful degradation.
