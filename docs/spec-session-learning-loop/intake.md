# Intake — Session Learning Loop (Tier 2)

**Author:** Łukasz (head coach) · **Status:** draft for sign-off · **Topic slug:** `session-learning-loop`

## Problem

We grade sessions but don't *learn* from them. `SessionEnd → session-eval-hook.ts → Coach K judge → web DB` already scores each real Claude Code session against a rubric. That signal dies in the dashboard — nothing turns it into reusable guidance that improves the *next* session. The result: the same mistakes recur, and accumulated know-how lives only in `MEMORY.md` prose, not as measured, reviewable units.

## Goal

Close the loop: **observe → analyze → instinct → inject → promote**, with the analyzer grounded in our LLM judge (the thing competitors lack). Each session's graded signals should distill into small, reviewable **instincts** that are fed back into future sessions — measured, capped, and self-correcting.

## Current state (build on, don't rebuild)

- `scripts/hooks.json` — `PreToolUse(Edit|Write)→check-plan.ts`, `SessionEnd→session-eval-hook.ts`.
- `scripts/session-eval-hook.ts` — detached, cost-guarded SessionEnd worker; reuses web judge + SQLite.
- `web/src/session-judge.ts` — Coach K judge over the transcript; editable, versioned, calibratable.
- `web/src/db.ts` — SQLite (bun:sqlite), source of truth for the web views.
- Raw signals already exist in Claude Code's on-disk transcript (`~/.claude/projects/<proj>/<session>.jsonl`).

## Locked design decisions (head coach)

1. **Raw-signal source = the existing transcript** (read on demand, as the judge already does). No separate `observations.jsonl` capture hook unless the analyzer provably needs structure the transcript can't give.
2. **Instinct storage = the SQLite DB** (queryable, joins with sessions/scores, powers the web view) — not flat YAML files.

## Hard constraints

- **Privacy / confidentiality (non-negotiable):** transcripts may contain **client-confidential content**. Instincts must be **generalizable patterns only** — never client names, code, paths, or domain specifics. Everything stays **local** (`~/.dreamteam`); nothing is ever pushed or sent externally. A scrub/guard step is mandatory.
- **Cost-guarded + off-by-default:** mirror the existing hook (env toggle, excluded projects, min-activity threshold, dedup by version, detached worker — never block session exit, never burn Opus inline).
- **Capped injection:** a hard max (~6) high-confidence instincts at SessionStart; budget-safe.
- **Self-correcting:** the analyzer prompt is itself a calibration scenario graded vs golden labels (extends the judge-calibration pattern), so the loop doesn't just reinforce itself.
- **No new public surface.** Local only.

## Acceptance criteria (sketch — Bird to formalize)

- A graded session yields ≥0 **atomic instincts**: `id · trigger · confidence(0.3–0.9) · domain · scope(project|global) · evidence · TTL(30d)`.
- Instincts are extracted only for patterns with **≥3 occurrences** (no one-off noise).
- A new `SessionStart` path injects instincts with `confidence ≥ 0.7`, **capped at 6**, project-over-global dedup.
- Promotion: same instinct in **≥2 projects @ avg ≥0.8 → global**; unreviewed instincts TTL-prune at 30 days.
- The scrub guard provably drops any instinct containing client-identifying content.
- Off by default; one env var enables; never delays session exit; never pushes.

## Out of scope

- Real-time/inline learning during a session (this is retrospective, SessionEnd→SessionStart).
- Replacing the existing judge/scoring (we extend it).
- Any external/cloud component.

## Open questions for the team

- **Bird:** what makes an instinct *correct* vs noise? The invariant that guarantees no client data leaks?
- **MJ:** analyzer as a second judge pass vs a distinct analyzer; where instinct extraction runs (in the SessionEnd worker?); DB schema for instincts.
- **Pippen:** failure modes of a hook that injects context at every SessionStart (latency, bad-instinct poisoning, runaway growth).
- **Drexler:** is Phase 1 (any explicit capture) even needed, or is the transcript enough? Cut anything that isn't.
- **Kobe:** how a poisoned transcript (prompt injection) could reprogram the analyzer or plant a malicious instinct → and the gate against it.
