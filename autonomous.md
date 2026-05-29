# Autonomous Team Mode — Research & Design Notes

Planning doc for `/team --auto`: intake.md as input, GitHub PR as output, `/pull-request` as the final guard. Not yet implemented — this is the research-first pass.

## Premise

Today `/team` is interactive: multiple `AskUserQuestion` checkpoints between phases (intake confirmation, Phase 2 approval, fix-verify triage, spec sign-off). Autonomous mode removes those checkpoints and runs start-to-finish, producing a draft PR the human reviews instead.

Why this is valuable:
- Author intake.md, fire `/team --auto`, walk away, return to a PR
- Async work — like Devin, Copilot agent, Codex Cloud
- Multiple workstreams in parallel without babysitting each
- Issue/ticket → PR pipeline

Why this is dangerous:
- Removes the checkpoints that catch drift early
- If Bird gets acceptance criteria wrong, you find out at PR review (expensive)
- If MJ picks the wrong architecture, you find out at PR review
- Scope drift compounds; Drexler catches it in the spec but if scope is wrong from intake, no one fixes it
- "Agents do whatever they want until you stop them" failure mode

## State of the art (industry scan)

| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| **Devin** (Cognition) | Task description | PR | Closest comparable. Mixed quality at scale — high-profile failures. Long-running, costly. |
| **GitHub Copilot agent / Workspace** | Issue | PR (draft) | Recently GA. Tight GitHub integration. Single-agent under the hood. |
| **Codex Cloud** (OpenAI) | Task | PR | Async coding agent, branch-based. |
| **OpenHands / OpenDevin** | Task | Various | Open-source Devin clone. |
| **Claude Code background mode** | Prompt | Files in worktree | Primitive — uses `run_in_background` parameter on agents, not PR-shaped. |
| **Aider `--auto-commits`** | Local edits | Commits | Semi-autonomous, no PR loop. |
| **Sweep AI** | GitHub issue | PR | Defunct/pivoted. Pattern existed. |

**Common shape:** task → branch → code → PR-as-output.
**Common failure mode:** silent drift from intent because no one checked between steps.

## What dreamteam already has that helps

- **SDD intake.md** — a real input contract, not a vague task description. Most autonomous tools take a paragraph; dreamteam has a structured spec the human authored.
- **Worktree infrastructure** — `scripts/worktree-create.ts` + `scripts/worktree-cleanup.ts` already isolate runs.
- **Multi-agent review** — Kobe + Pippen + Drexler catch what one agent misses. Devin and Copilot agent have one reviewer (themselves).
- **Drexler's deletion bias** — counters the scope-bloat failure mode common in autonomous tools.
- **Production Safety Gate** (`commands/team.md` line ~1584) — risk classification + pre-push checklist + breaking-change detection. Most of the PR-quality logic is already written; it just gets gated by `AskUserQuestion` today.
- **Magic synthesis** — produces the final spec which becomes the PR body naturally.

## What's missing

1. **`/pull-request` command** — doesn't exist yet
2. **Autonomous mode trigger** — `/team` is interactive; no `--auto` flag or `/team-auto` command
3. **Decision policies for replaced checkpoints** — every interactive checkpoint today (`AskUserQuestion`) needs a non-interactive fallback policy: "what would Coach K decide if no human were here?"
4. **Abort conditions** — when does the autonomous run give up and surface vs keep trying?
5. **PR body template** — needs to package all SDD artifacts + agent confidence + risk gate into a PR description
6. **Cost ceiling** — no current hard limit on turns/wall-clock per session
7. **Audit log** — every Coach K decision in autonomous mode needs to be reviewable post-hoc

## Design decisions to make before any code

These are forks-in-the-road, not implementation details.

### 1. Trigger model

| Option | Pros | Cons |
|--------|------|------|
| CLI only (`/team --auto`) | Simplest, user-initiated, runs in current shell | No true async — terminal must stay open |
| CLI + GitHub webhook (issue labeled `dreamteam:auto` → run) | True async, integrates with existing workflow | Requires server/runner; auth complexity |
| CLI + scheduled (cron-fire on intake files in a queue dir) | Batch processing of multiple specs | Operational complexity (queue management) |

**Recommendation: start CLI-only.** Webhooks add infra complexity that's separable.

### 2. Where intake.md comes from

| Option | Pros | Cons |
|--------|------|------|
| Must be human-authored offline first (SDD Model C) | High bar prevents the most common failure mode | Friction — human must write intake before invoking |
| Coach K can draft from one-liner if intake missing | Lower bar, faster to invoke | Drift risk — AI-drafted intake interpreted by AI = compounded interpretation errors |

**Recommendation: autonomous mode requires pre-existing intake.md.** No drafting. If it doesn't exist, refuse with "run interactive `/team` first to author intake."

### 3. Checkpoint replacement policy

Each current interactive checkpoint needs a decision rule for autonomous mode:

| Today's checkpoint | Autonomous replacement |
|--------------------|------------------------|
| STEP 1b intake confirmation | Skip — intake.md must pre-exist |
| Phase 2 user approval (after Bird + MJ + Magic brief) | Proceed if: all agent confidence ≥ 70 AND Magic flagged no contradictions AND no Bird escalations open |
| Fix-verify triage (after reviewers find issues) | Auto-route to Shaq; max 2 rounds; abort if findings remain |
| Eval gate (after evals run) | Skip in autonomous mode (or run async, attach result to PR) |
| Spec sign-off (after Magic synthesis) | Skip — the PR review IS the sign-off |

### 4. `/pull-request` — what does it do?

| Option | Pros | Cons |
|--------|------|------|
| New standalone command | Reusable for interactive `/team` too (currently `gh pr create` is manual); single source of PR-creation logic | More code surface to maintain |
| Inline in autonomous flow only | Less surface area | Duplicates Production Safety Gate logic; not reusable |

**Recommendation: new standalone command.** Reusable, single source of truth.

Responsibilities of `/pull-request <topic>`:
- Read `docs/spec-<topic>/spec.md` (must exist — produced by Magic at Phase 5)
- Run Production Safety Gate from `commands/team.md`
- Verify git state (clean working tree, branch exists, no uncommitted changes outside spec dir)
- Build the PR body template (see PR Body Template section below)
- Run `gh pr create --draft` with the structured body
- Return the PR URL

### 5. Abort vs partial-PR

When something goes wrong (Kobe BLOCK after 2 fix rounds, Drexler BLOATED after cleanup, escalation no one can resolve):

| Option | Pros | Cons |
|--------|------|------|
| Hard abort: write `docs/autonomous-abort-<topic>.md` with diagnostics, no PR | Clean — nothing dubious lands on GitHub | Human has to dig into a local file to see what happened |
| Partial draft PR with `[BLOCKED]` label and full diagnostic in body | Visible — human sees it in PR list immediately | Pollutes PR list with broken PRs |

**Recommendation: partial draft PR.** A PR you can look at beats a directory of artifacts you have to investigate. Use a label (`dreamteam:blocked`) for filtering.

### 6. Cost ceiling

Hard limits to enforce in autonomous mode:
- **Max turns per agent** — already exists per agent (Coach K 50, Magic 30, etc.)
- **Max fix-verify iterations** — suggest 2
- **Max wall-clock per run** — suggest 30 min (configurable)
- **Max $ per run** — harder, Claude Code doesn't expose token costs cleanly. Skip for v1, add later.

## PR Body Template (draft)

```markdown
# <Topic title from intake.md>

## Intent (from intake.md)
<Problem Statement from intake.md — human-authored, source of truth>

## What was built
<Magic's executive summary>

## Acceptance Criteria
<From spec-<topic>/spec.md — Bird's AC with pass/fail per agent>

## Agent verdicts
- Bird: confidence <N>%, <escalations or none>
- MJ: confidence <N>%, <escalations or none>
- Shaq: implementation complete, <test coverage>
- Kobe: <LGTM | SHIP WITH FIXES | BLOCK> — <one-line summary>
- Pippen: <READY | READY WITH CAVEATS | NOT READY> — <one-line summary>
- Drexler: <LEAN | ACCEPTABLE | BLOATED> — <one-line summary>

## Risk classification
<🟢 LOW | 🟡 MEDIUM | 🔴 HIGH | ⛔ CRITICAL> — from Production Safety Gate

## Pre-push checklist
[paste the filled checklist from Production Safety Gate]

## Outstanding risks
<from Kobe + Pippen, unresolved findings>

## Coach K decision log (autonomous mode only)
<every decision Coach K made in lieu of human approval, with rationale>

## Artifacts
- [intake.md](docs/spec-<topic>/intake.md)
- [domain.md](docs/spec-<topic>/domain.md)
- [architecture.md](docs/spec-<topic>/architecture.md)
- [operations.md](docs/spec-<topic>/operations.md)
- [scope.md](docs/spec-<topic>/scope.md)
- [review.md](docs/spec-<topic>/review.md)
- [final spec](docs/spec-<topic>/spec.md)

---
🤖 Generated by dreamteam autonomous mode
```

## Risks specific to dreamteam's flavor

1. **Multi-agent compounds latency.** 7 sessions sequentially is slow. Phase 1 and Phase 4 already run in parallel; Shaq + Magic are bottlenecks. Autonomous runs will likely be 10-30 min minimum.
2. **Coach K becomes the silent decider.** Every checkpoint replacement is a place his judgment is unchecked. Need an audit log so post-hoc review is possible — every decision must be in the PR body.
3. **Drexler vs Shaq tension goes unresolved.** Drexler says BLOATED, Shaq says it works. Today the human breaks ties. Autonomous needs a policy. **Suggest: Drexler wins on `BLOATED`** — auto-route to cleanup. Drexler is the deletion bias on purpose; if the human disagrees, they can override at PR review.
4. **Bird's "ambiguous" outputs.** Bird escalates when domain rules are unclear. Today the human resolves; autonomous can't. **Suggest: if Bird escalates, abort with partial PR** rather than guessing — the whole point of escalation is "I don't know, don't pretend I do."
5. **Magic's spec synthesis errors.** If Magic mis-synthesises (drops a section, misnormalises terminology), the PR body is wrong. Mitigation: include raw artifacts in PR as links; synthesised spec is the summary, artifacts are the source of truth.
6. **Worktree leakage.** If an autonomous run crashes mid-flight, the worktree stays around. `worktree-cleanup.ts` exists but isn't auto-invoked. Need a cleanup hook on abort.
7. **Cost surprises.** A single autonomous run with all 7 agents could cost $1-5+ in API calls (rough estimate). Multiple parallel runs compound. No current cost ceiling.

## Phasing recommendation

Don't build this all at once. Three phases shipped in order:

### Phase A — `/pull-request` standalone (1-2 sessions of work)

- New command, takes topic, reads spec, runs Production Safety Gate, creates draft PR with structured body
- Works in **interactive** `/team` first — replaces manual `gh pr create`
- Low risk; immediately useful even without autonomous mode
- Files touched: `commands/pull-request.md` (new), `scripts/install.ts` (register), maybe `commands/team.md` (point at it from Final Output)
- **Acceptance criteria:**
  - `/pull-request <topic>` creates a draft PR with the body template
  - Refuses if `docs/spec-<topic>/spec.md` is missing
  - Refuses if Production Safety Gate fails any item
  - Returns PR URL on success

### Phase B — Autonomous flag for `/team` (3-5 sessions)

- `/team --auto <topic>` (intake.md must exist)
- Replaces every `AskUserQuestion` with a decision policy from the table above
- Calls `/pull-request` at the end
- Abort-with-partial-PR on failure
- Hard limits + audit log in PR body
- Worktree-isolated by default; auto-cleanup on abort
- Files touched: `commands/team.md` (autonomous branch of the flow), `agents/coachk.md` (decision policies), maybe new `commands/team-auto.md` as a thin alias
- **Acceptance criteria:**
  - `/team --auto <topic>` runs end-to-end without prompts
  - Produces a draft PR (or partial PR if blocked)
  - Audit log of every decision is in the PR body
  - Respects cost ceiling (aborts at wall-clock limit)
  - Cleanup on abort

### Phase C — Async triggers (later, if Phase B proves out)

- GitHub webhook integration (issue labeled `dreamteam:auto` → run)
- Queue/scheduler for batch runs
- Multi-run concurrency via worktrees
- Infrastructure: probably needs a long-running daemon/runner

## Open questions for the user

1. **Do you have an existing `/pull-request` somewhere I missed**, or are we building it fresh? (Searched `commands/` — not there. Confirming.)
2. **Phase A first, or skip straight to Phase B?** (Phase A gives a reusable command even without autonomous mode; Phase B builds on it.)
3. **Abort vs partial-PR** — confirm partial draft PR with `[BLOCKED]` label is the preferred failure mode?
4. **Cost ceiling** — happy with hard turn/wall-clock limits (suggest 30 min wall-clock), or wait until you see real-world numbers first?
5. **Worktree requirement** — should autonomous mode require running from a clean worktree, or auto-create one? (Auto-create is what `scripts/worktree-create.ts` already supports.)
6. **Eval gate in autonomous mode** — run eval gate async and attach result to PR, or skip entirely?
7. **Bird escalation** — abort with partial PR (recommended) or try to resolve with "ask Bird again with more context" loop?
8. **Drexler vs Shaq tie-break** — Drexler wins on BLOATED (recommended), or attempt a 3-way Magic mediation?

## Next step

Decide on the open questions above. Pick Phase A or jump to Phase B. Then implementation can start.
