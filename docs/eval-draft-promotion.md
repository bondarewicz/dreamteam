# Eval Draft Promotion (Step B) — Design Notes

> **Team-scenario promotion is retired (2026-06-16).** Team evals (`/team` orchestration
> re-runs) have been retired as a quality signal — a re-run has no live message bus, so it
> isn't like-for-like with a real session. `/team` quality is now measured by **session evals**
> (retrospective LLM-judge over the real recorded trace) — see `docs/session-evals-design.md`.
> The team scenarios and team draft template referenced below now live under
> `evals/.archive/team/` and are not run. The **per-agent** half of this doc still applies.

Status: **proposed / not built**. Picked out of the draft-template investigation (2026-05-29).
Step A (point `/team` at the dreamteam repo so the template is always found and drafts
are written back to `evals/<agent>/drafts/`) is **done**. This doc captures the remaining
piece: turning a captured draft into a *runnable* eval scenario.

---

## The gap

Drafts and runnable scenarios are different file shapes, and the runner only reads the
latter. Today the conversion is a manual rewrite.

| | Draft (what `/team` writes) | Runnable scenario (what the runner reads) |
|---|---|---|
| Per-agent | `evals/draft-template.md` — prose `## Prompt sent` / `## Agent output` | `prompt: \|`, `category:`, `graders:`, title `# Eval: <Agent> — <Name> (<Type>)` |
| Team | `evals/team-draft-template.md` — prose `coach_k_prompt_<agent>`, `<agent>_reference_output`, `human_decisions:` | `phase_N_agent`, `phase_N_prompt`, `phase_N_graders`, `pipeline_expected_behavior/failure_modes/scoring_rubric` |

Two hard constraints, confirmed in code:

1. **Parser only understands the machine format.** `parseTeamScenario` (`evals/src/scenario-parser.ts:174`)
   keys off `phase_N_agent` / `phase_N_prompt` / `pipeline_*`. The orphan team draft template uses
   `coach_k_prompt_*` — it will not parse even when fully filled in.
2. **Discovery only sees `scenario-*.md`.** `evals/src/discovery.ts:93` filters
   `f.startsWith("scenario-") && f.endsWith(".md")`. Files named `draft-*.md` are invisible to the
   runner by design. Promotion must rename `draft-*` → `scenario-NN-*`.

Reference runnable examples (now archived — retired team evals):
`evals/.archive/team/scenario-01-automapper-removal.md`,
`evals/.archive/team/scenario-02-eval-typescript-migration.md`.

## "Both templates" is sound — and the bus is a non-issue

The runner already supports both modes: `runAgentScenario` (individual) and `runTeamScenario`
(team) in `evals/src/agent-runner.ts`. So keeping **both** a per-agent and a team template is
backed by existing machinery; the only missing link is promotion.

The "eval has no bus, agents can't communicate" worry does **not** block team evals. In eval mode
each phase is an isolated `claude -p --agent X` process (`agent-runner.ts:100`); there is no live
bus. Team evals sidestep this by **reconstruction, not live orchestration**:

- Each `phase_N_prompt` is statically baked with whatever context that agent needs (inline code,
  prior findings). The live session's inter-agent communication is *frozen into the scenario at
  capture time*.
- `human` phases are fixtures, not runs (`agent-runner.ts:267`).
- Scoring is holistic: after all phases run, the combined outputs go to a single **Coach K judge**
  with the `pipeline_*` rubric (`evals/src/scorer.ts:78`).

**Known limitation to accept:** because phase prompts are static, the team eval does *not*
dynamically test cross-agent propagation. If eval-run Bird produces garbage in phase 1, phase-3
Shaq still receives the good hardcoded prompt. The team eval tests each phase against frozen inputs
plus a holistic rubric — a reasonable approximation, not a true live integration test. A real bus
would be required for that, and is out of scope.

## Proposed: `scripts/promote-draft.ts`

A Bun TS script (per repo convention — no shell) that transforms a reviewed draft into a runnable
scenario. LLM-assisted where judgement is needed (graders, expected_behavior), mechanical elsewhere.

```
bun scripts/promote-draft.ts <path-to-draft.md> [--scenario-num NN]
```

Behaviour:

1. **Detect kind** — per-agent (`draft-template` shape) vs team (`team-draft-template` shape).
2. **Reformat to the machine schema:**
   - Per-agent → `# Eval: <Agent> — <Name> (<Type>)`, `category:`, `prompt: |`, `graders:`,
     optional `expected_behavior:` / `failure_modes:` / `scoring_rubric:`.
   - Team → `phase_N_agent` / `phase_N_prompt` / `phase_N_reference_output` / `phase_N_graders`
     per phase (map `coach_k_prompt_<agent>` → `phase_N_prompt`, `<agent>_reference_output` →
     `phase_N_reference_output`, `human_decisions` → a `human` fixture phase), plus
     `pipeline_expected_behavior` / `pipeline_failure_modes` / `pipeline_scoring_rubric` from the
     draft's `expected_behavior` / `failure_modes` / `scoring_rubric`.
3. **Synthesise graders** the draft lacks (at minimum `json_valid`; suggest `json_field` checks
   from the captured output structure). Leave as a reviewable proposal — graders are the contract.
4. **Place + rename** into `evals/<agent>/scenario-NN-<topic>.md` (or `evals/team/`), choosing the
   next free `NN`. `draft-` → `scenario-` is the rename that makes discovery pick it up.
5. **Leave the draft** in place (or move to an `evals/<agent>/drafts/promoted/` archive) so the
   provenance trail survives.

Open questions to decide at build time:
- Should promotion be its own script or a verb on the `eval` skill (`/eval promote <draft>`)?
- Auto-pick `category` (happy-path / edge-case / regression) from the draft, or always ask?
- How much grader synthesis is safe to automate vs. always human-confirmed? (Lean: propose, never
  finalise — graders define pass/fail.)

## What Step A already solved (context)

`/team` now resolves `DREAMTEAM_ROOT` from `~/.claude/dreamteam/repo-root` (written by
`scripts/install.ts`) and uses it for both the template read (`$DRAFT_TEMPLATE`) and the draft
write dir (`${DREAMTEAM_ROOT}/evals/<agent>/drafts/`). So drafts now land directly in the dreamteam
checkout from any repo — no cross-repo copy. Promotion (this doc) is the only remaining manual step
between a `/team` session and a runnable eval.

## Loose end: the orphan template

`evals/team-draft-template.md` is currently unreferenced (added in commit `1aee691` "Team Eval V2",
never wired up). The "keep both" decision means it should become the canonical capture format for
team sessions — i.e. `/team` should write a team-level draft from it at session end, in addition to
the per-agent drafts. That wiring is a sibling task to the promoter and is not yet done.
