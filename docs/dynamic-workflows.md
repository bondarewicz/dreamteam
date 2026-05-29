# dreamteam v2 — Adopting Claude Dynamic Workflows

> **Premise:** dreamteam's orchestration (`/team`, `/eval`, autonomous mode) is encoded as
> ~1,700 lines of LLM-interpreted markdown that Coach K re-executes from memory every run.
> Claude's **Workflow tool** (deterministic JS that spawns subagents) lets us execute the
> *mechanical skeleton* as code while leaving *genuine judgment* with humans and agents.
> This document captures the full analysis, the ranked opportunities, concrete scripts, the
> hard constraints, and a phased adoption path.

---

## 0. The one-sentence thesis

`team.md` is a **deterministic skeleton wrapped around ~10 genuine judgment calls.** The
skeleton — fan-out/fan-in, JSON extraction, artifact writes, draft-eval emission, fix-verify
looping, gate rendering — is exactly what an LLM forgets under turn pressure (hence the dozen
**MANDATORY / never skip** banners) and exactly what JS never forgets. The Workflow tool's
value to dreamteam is: **make the skeleton executable, keep the judgment human/agent-owned.**

This is not a new direction. Our own roadmap docs (`team-improvement-analysis.md`,
`autonomous.md`, `harbor-comparison-future-improvements.md`, `ruflo-comparison-adoptable-ideas.md`,
`ai.md`) already describe the Workflow primitive set in prose. The tool is the runtime those
docs are asking for.

---

## 1. The defining constraint

**Workflows run in the background and cannot call `AskUserQuestion`.**

Everything below follows from this. Workflows own the *deterministic spans between* human
checkpoints; the main loop (Coach K) owns the checkpoints themselves. So we never "replace
`/team` with a workflow" — we let workflows own the mechanical work and segment at every
`AskUserQuestion`.

---

## 2. Where the tool literally applies vs. where only the patterns do

| Surface | Workflow tool usable? | Why |
|---|---|---|
| **`/team` interactive** | ✅ Yes — as *segmented* workflows | Runs in an interactive session where the tool exists; segment at each `AskUserQuestion` boundary |
| **`/team --auto`** (autonomous.md) | ✅✅ **Best fit** — one workflow, no segments | Autonomous mode *removes* the human checkpoints, so the whole 7-agent flow is one deterministic run ending in a draft PR |
| **SDD spec loop** | ✅✅ **Best first target** | `[human intake] → [agents derive] → [human sign-off]` — natural, safe workflow boundaries; `resume` makes the reject loop cheap |
| **`evals/src/cli.ts`** | ❌ No — pattern-only | Standalone `Bun.spawn("claude")` subprocess (`claude-adapter.ts`); cannot reach the in-session tool. It is *already* a hand-rolled `parallel()` / `schema` / pass@k reimplementation |

**Rule of thumb:** adopt the **tool** for orchestration (`/team`, autonomous, SDD); adopt the
**patterns** for the eval CLI (keep it headless/CI-able/reproducible).

---

## 3. Grounded findings (the convergent evidence)

Four parallel readers swept the orchestration, eval harness, agent specs, and roadmap docs.
They independently converged on the same structural thesis. Quantified pains:

- **The "raw JSON only / first char `{` / no markdown fences" convention appears ~40×** across
  `team.md` + the seven agent specs (8× in Bird alone), is purely prompt-enforced, and on any
  violation "your entire analysis is lost" (Kobe: *"piped directly to `json.loads()`"*).
- **`evals/src/json-extract.ts`** is a dedicated **3-tier fallback parser** (direct parse →
  strip ```` ```json ```` fences → brace-depth scanner) that exists *only* to recover from that
  convention being violated.
- **`team.md` has a whole "AGENT OUTPUT VALIDATION" section** (lines 1333-1357): eyeball the
  JSON, re-launch on non-compliance, **2 retries then manually strip**.
- **Draft-eval emission is the single most-repeated mechanical step** (~12 near-identical
  counter+mkdir+template-fill+write blocks) and is flagged in memory as
  `feedback_draft_evals_mandatory` — *"never skip"* because skipping is the default.
- **The fix-verify loop has no max-iteration bound** ("repeat from step 2 … skipping
  verification is NOT allowed") — it can loop forever or exit early with unverified fixes.
- **`TOPIC`, `SPEC_DIR`, `DRAFT_COUNTER`, `LINEAR_REF`, `SESSION_WORKTREE`** are pseudo-bash
  variables "initialized once" but actually carried in the LLM's working memory across the whole
  session — vulnerable to context compaction and long loops.
- **Coach K's own spec warns it to STOP research at ~70% turn budget** — structurally
  incentivizing it to cut exactly the late-session MANDATORY steps (spec sign-off, memory
  harvest, production gate).
- **The single-judge eval scorer has one retry and no self-consistency** — a flaky judge call
  maps straight to `fail`, conflating *judge* noise with *agent* noise in pass^N stats.
- **`pass^N` / `pass@N` / flaky-count are NOT computed in the harness** — only per-scenario
  `flaky` / `pass_hat_k` — so the ship metric is reconstructed downstream, out of sync with the
  docs' decision table.

Roadmap docs that *already ask for this*:
- **team-improvement-analysis #1:** *"Natural language handoffs are the #1 cause of multi-agent
  failure"* → typed contracts → the **`schema` option**.
- **team-improvement-analysis #5:** *"run Bird and MJ concurrently"* (~90% fan-out time cut) →
  **`parallel()`**.
- **autonomous.md:** checkpoint-replacement gate table, fix-verify max-2-rounds, cost ceiling,
  worktree-cleanup-on-abort, audit log, PR-body template → a **pipeline with gates + capped loop
  + `finally` cleanup + `budget`**.
- **ruflo-comparison:** *"convert prompts-I-hope-Claude-obeys into harness guarantees"* +
  *"`team.md` is 1,212 lines"* → workflow makes the skeleton executable.
- **shaq-optimization Lever 3:** *"`files_changed` is mechanical — automate from `git diff`"* →
  deterministic post-step.
- **ai.md:** the **Opus-vs-Sonnet structured-output regression** that shipped to prod — *"exactly
  the kind of failure a real eval suite would have caught."*

---

## 4. Ranked opportunities

### ① The `schema` option — highest leverage, lowest effort
`agent(prompt, {agentType: 'kobe', schema: KOBE_SCHEMA})` forces structured output validated at
the tool layer with auto-retry. In one move it deletes:
- the ~40 "raw JSON only / no fences" instructions,
- the "AGENT OUTPUT VALIDATION → 2-retry-then-strip" section,
- `json-extract.ts` tiers 2 & 3,
- the mid-orchestration parse-failure risk where Coach K hand-extracts JSON to write artifacts.

It composes with `agentType`, which **preserves each agent's pinned model + tool allowlist from
frontmatter** — so eval-baseline reproducibility is intact. Directly addresses
team-improvement #1 and the `ai.md` structured-output regression.

### ② Autonomous mode as one clean workflow
`autonomous.md`'s entire wishlist *is* the primitive set:
- checkpoint-replacement gates (`confidence ≥ 70 AND no contradictions AND no open escalations`)
  → **deterministic branch predicates** over typed output
- fix-verify "max 2 rounds then abort" → **loop-until-clean with a hard cap**
- cost ceiling (~30 min / max iterations) → **`budget.remaining()` + counters**
- worktree-cleanup-on-abort → a **`finally`-style guaranteed step**
- the audit log it needs → the workflow run journal + `log()`

### ③ `parallel()` for Phase 1 (Bird ∥ MJ)
team-improvement #5 wants it; today only Phase 4 is parallel. `parallel()` *is* the barrier — no
more "Wait for both to complete" enforced by LLM memory.

### ④ Fix-verify as `loop-until-clean`
A JS `while` with a typed predicate (`Kobe SHIP && Pippen != NOT READY && Drexler != BLOATED`)
and a hard cap fixes both the unbounded-loop and early-exit failure modes, and auto-emits the
per-round draft evals.

### ⑤ Deterministic post-steps for the bookkeeping the LLM forgets
Draft-eval emission, the 5 SDD artifact writes, and `files_changed` from `git diff --stat`
(shaq-optimization Lever 3 — recovers ~10-15 of Shaq's capped 100 turns) all become JS that runs
after each `agent()` resolves.

### ⑥ Agents already map onto the quality patterns
- **Kobe = adversarial-verify** (find what breaks)
- **Drexler = completeness / deletion critic**
- **Bird + MJ = multi-modal parallel analysis**
- **Phase-4 trio = judge panel**
- **Eval scoring = multi-judge panel** instead of single-judge-one-retry → separates judge noise
  from agent noise in pass^N stats; add **`loop-until-stable`** to automate the
  "iterate-until-stable then `--trials N`" loop `eval-workflow.md` describes manually.

---

## 5. Concrete: autonomous `/team` as a workflow

```javascript
export const meta = {
  name: 'team-auto',
  description: 'Autonomous Dream Team: analysis → impl → review panel → draft PR',
  phases: [
    { title: 'Analyze' }, { title: 'Implement' }, { title: 'Review' }, { title: 'Synthesize' },
  ],
}

// Schemas transcribed 1:1 from agents/*.md "Output Contract" — enums already spelled out there.
const KOBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'critical_findings', 'production_readiness', 'confidence'],
  properties: {
    summary: { type: 'object', additionalProperties: false, required: ['verdict', 'one_liner'],
      properties: { verdict: { enum: ['SHIP', 'SHIP WITH FIXES', 'BLOCK'] }, one_liner: { type: 'string' } } },
    critical_findings: { type: 'array', maxItems: 3, items: { type: 'object' /* title, risk, severity, location, fix… */ } },
    production_readiness: { type: 'object', properties: { safe_to_deploy: { type: 'boolean' } /* + breaking_changes flags */ } },
    confidence: { type: 'object' /* level + assumptions */ },
  },
}
// DREXLER_SCHEMA.summary.verdict ∈ ['LEAN','ACCEPTABLE','BLOATED']
// PIPPEN_SCHEMA.operational_readiness.verdict ∈ ['READY','READY WITH CAVEATS','NOT READY']
// BIRD_SCHEMA / MJ_SCHEMA / SHAQ_SCHEMA / MAGIC_SCHEMA … likewise from their specs.

phase('Analyze')
const [domain, arch] = await parallel([                       // team-improvement #5: Bird ∥ MJ
  () => agent(birdPrompt, { agentType: 'bird', schema: BIRD_SCHEMA, label: 'bird' }),
  () => agent(mjPrompt,   { agentType: 'mj',   schema: MJ_SCHEMA,   label: 'mj' }),
])
writeArtifact('domain.md', domain); writeArtifact('architecture.md', arch)   // deterministic post-step (⑤)

// autonomous.md gate — deterministic predicate, no human:
if (domain.confidence.level < 70 || arch.confidence.level < 70 || hasOpenEscalations(domain, arch))
  return abortWithPartialPR('low confidence / open escalation', { domain, arch })

phase('Implement')
const brief = await agent(magicHandoffPrompt(domain, arch), { agentType: 'magic', schema: HANDOFF_SCHEMA })
let impl = await agent(shaqPrompt(brief), { agentType: 'shaq', schema: SHAQ_SCHEMA, label: 'shaq' })

phase('Review')
let round = 0
while (round++ < 2) {                                         // fix-verify, HARD cap (④)
  if (budget.total && budget.remaining() < 80_000) break      // cost ceiling (②)
  const [kobe, pippen, drexler] = await parallel([            // adversarial judge panel (⑥)
    () => agent(kobePrompt(impl),    { agentType: 'kobe',    schema: KOBE_SCHEMA }),
    () => agent(pippenPrompt(impl),  { agentType: 'pippen',  schema: PIPPEN_SCHEMA }),
    () => agent(drexlerPrompt(impl), { agentType: 'drexler', schema: DREXLER_SCHEMA }),
  ])
  writeArtifacts({ kobe, pippen, drexler })                   // review.md / operations.md / scope.md
  const clean = kobe.summary.verdict === 'SHIP'
    && pippen.operational_readiness.verdict !== 'NOT READY'
    && drexler.summary.verdict !== 'BLOATED'                  // Drexler wins on BLOATED (autonomous.md)
  if (clean) break
  impl = await agent(shaqFixPrompt({ kobe, pippen, drexler }), { agentType: 'shaq', schema: SHAQ_SCHEMA })
}

phase('Synthesize')
const summary = await agent(magicSynthPrompt(/* … */), { agentType: 'magic', schema: SYNTH_SCHEMA })
return buildDraftPR(summary, impl)                            // typed → fixed PR template (autonomous.md 127-172)
```

**What changed vs. the markdown:** the `parallel()` barriers can't be short-circuited; the loop
cannot run unbounded or exit with unverified fixes; draft evals / artifacts / `files_changed` are
written by code that can't forget; the JSON-fence convention is gone; `domain.confidence.level`
is authoritative program state, not a number carried in LLM memory across 1,700 lines.

---

## 6. Concrete: interactive `/team` segmented around checkpoints

Because workflows can't call `AskUserQuestion`, Coach K (main loop) owns the gates; each
deterministic span is a workflow:

```
Coach K: intake draft + AskUserQuestion (confirm intent)        ← main loop
   └─ Workflow("team-analyze")  → Bird ∥ MJ, write domain.md/architecture.md, draft evals
Coach K: present checkpoint + AskUserQuestion (Approve plan?)    ← main loop
   └─ Workflow("team-build-review") → Shaq → review panel → fix-verify loop
Coach K: spec sign-off + AskUserQuestion (matches intent?)      ← main loop
```

This makes "never skip the checkpoint" **structural** — a checkpoint is a hard segment boundary,
not a prose note the LLM may drop under turn pressure.

---

## 7. Concrete: SDD as a workflow (the best first target)

SDD is already shaped `[human intake] → [agents derive] → [human sign-off]`. The middle is what
the workflow owns; the bookends stay in the main loop.

| SDD step | Owner | Why |
|---|---|---|
| **Intake authoring** (draft + confirm) | Main loop (`AskUserQuestion`) | Human is author of intent — the soul of SDD. Never automate. |
| **Agents derive** (domain/arch/ops/scope/review → spec) | **One workflow** | Pure derivation from the contract. |
| **Spec sign-off** | Main loop (`AskUserQuestion`) | Human confirms shipped == intended. Never automate. |

### "Until satisfactory" is *two* loops

- **Agent-judged satisfactory** → owned *inside* the workflow as a deterministic predicate:
  fix-verify clean, all confidence ≥ threshold, **Magic's `contradictions[]` empty**, and a
  **completeness critic** passes. The completeness critic is the highest-value SDD addition: an
  `agent()` that checks `spec.md` against `intake.md` ("is every acceptance criterion and open
  question addressed?") *before the human ever sees it* → sign-off passes first-time far more
  often.
- **Human-judged satisfactory** → the sign-off. A **workflow boundary**; the reject→re-synthesize
  loop is orchestrated from the main loop.

### `resumeFromRunId` makes the reject loop cheap

When the human rejects the spec as *inaccurate*, don't re-run Bird/MJ/Shaq/Kobe — **resume from
Magic's synthesis step**; everything before returns from cache, only synthesis re-runs:

```javascript
// main loop (Coach K) — owns the human bookends
const intake = await draftAndConfirmIntake()      // AskUserQuestion: human authors intent
let runId = null, correction = null

while (true) {
  // Inject `correction` ONLY into Magic's synthesis prompt → the Bird/MJ/Shaq/Kobe agent()
  // calls stay byte-identical, so resume cache-hits them and ONLY Magic re-runs.
  const { runId: rid, spec } = await Workflow({
    name: 'sdd-derive', args: { intake, correction }, resumeFromRunId: runId,
  })
  runId = rid

  const answer = await AskUserQuestion("Does spec.md match what you wanted?",
    ['Approve', 'Approve with notes', 'Reject — scope drift', 'Reject — spec inaccurate'])

  if (answer.startsWith('Approve')) { markFinal(); break }
  if (answer === 'Reject — spec inaccurate') correction = await getCorrection()  // → only Magic re-runs
  if (answer === 'Reject — scope drift')   { /* surface gap; may resume from the diverging agent */ }
}
```

**Cache mechanics:** resume keys on `(prompt, opts)` per `agent()` call. Inject the human's
correction *only* into the synthesis agent's prompt, so the prefix stays identical → Bird/MJ/
Shaq/Kobe cache-hit, only Magic re-runs. The expensive agent work runs once; rejection costs one
Magic call, not a full re-run. That is "until satisfactory" made cheap.

### Multi-author property survives
Each `agent({schema})` returns a typed object → a deterministic writer projects it into that
agent's artifact file (preserving structure/voice) → Magic reads all artifacts and synthesizes.
Passing `intake.md` as the workflow's `args` means **every agent provably derives from the same
contract** — stronger than today's per-agent context curation, which can drift. Magic's
"preserve voice vs normalise terminology" and contradiction *detection* stay judgment (`agent()`
calls); only the gates on their outputs are deterministic.

---

## 8. The eval harness — patterns, not the tool

`cli.ts` stays a standalone CLI (its value is headless/CI/reproducible; it can't call the
in-session tool). Borrow three patterns:
- **Structured output at the `claude -p` layer** → delete `json-extract.ts` tiers 2-3 and the
  scorer retry.
- **Multi-judge panel** instead of single-judge-one-retry → pass^N stops conflating judge noise
  with agent noise.
- **`loop-until-stable`** automating "iterate until single-trial stable, then `--trials N`."
- **Compute `pass^N` / `pass@N` / flaky-count in the assembler** so the FinalResult JSON carries
  the exact ship metrics, instead of reconstructing them downstream.

(Optional later: an interactive `/eval` *workflow* variant for in-session runs, separate from the
CI CLI.)

---

## 9. Hard constraints (do not skip)

1. **`AskUserQuestion` = hard workflow boundary.** Segment interactive `/team` and the SDD
   sign-off; only autonomous mode is a single uninterrupted workflow.
2. **Inter-agent messaging doesn't survive fan-out.** Today Bird *messages* MJ mid-flight (Team
   Protocol). In `parallel()` they run fully independent and Magic reconciles after — arguably
   cleaner, but a real behavior change. Keep agent-teams for cases where mid-flight cross-talk
   genuinely matters; choose deliberately.
3. **Parallel file-mutation.** Shaq (writes) and Kobe (has `Edit`) must never be in the *same*
   `parallel()`. Keep reviewers read-only in the panel; route all fixes through Shaq (the "Coach
   K never implements" rule already mandates this). Use `isolation: 'worktree'` only if writers
   are ever parallelized.
4. **Distribution.** A reusable workflow ships as a script in the repo and is launched by the
   command; confirm the install path (`scripts/install.ts`) places it where the `/team` command
   can reference it. (Open question — see §11.)

---

## 10. What to preserve (the philosophy)

- **"Config, not a framework"** (`ruflo-comparison`) — the Workflow tool *is* Anthropic's
  runtime, so a ~150-line script replaces 1,700 lines of prose **without us maintaining an
  orchestration engine.** Adopting it is consistent with, not a betrayal of, this principle.
- **Human as final arbiter** — workflows automate derivation and agent-judged convergence; they
  never author the intake and never grant the sign-off. The founding tension *"You vs Agents:
  author of intent vs authors of artifacts"* stays exactly where it is.
- **Built-in tension** — Drexler's deletion-bias, Bird's "escalate don't guess," Kobe vs Shaq are
  *judgment* nodes; they remain `agent()`/human steps. The workflow removes only the bookkeeping,
  never the disagreement.

---

## 11. Adoption path (narrow first)

1. **`schema` on one agent** (Kobe — cleanest contract) in a throwaway workflow. Confirm
   `agentType: 'kobe'` resolves against the installed registry and validates. Immediately deletes
   fence-handling for that agent. *Lowest risk, immediate payoff.*
2. **The fix-verify loop** as a standalone workflow — bounded, no internal human checkpoint if
   pre-authorized "Send all to Shaq". Showcases `parallel()` + `loop-until-clean` + deterministic
   draft evals.
3. **SDD derivation + sign-off loop** (§7) — the best first *full* target; `resume` makes the
   reject loop cheap and the two human bookends give safe boundaries.
4. **Autonomous mode** (`/team --auto`, §5) — cleanest single-workflow fit.
5. **Segment interactive `/team`** (§6) last — most coordination work, but by then patterns 1-4
   are proven.

---

## 12. Open questions / risks

- **Workflow distribution in the install model.** How does a reusable named workflow ship with a
  config that installs into `~/.claude`? Confirm whether the `/team` command launches an inline
  script, a `scripts/`-shipped `.js`, or a `.claude/workflows/` entry, and wire `install.ts`
  accordingly.
- **`agentType` + pinned models.** Verify a workflow-spawned `agentType: 'bird'` honors the
  `model:` frontmatter (load-bearing for eval reproducibility) rather than inheriting the
  main-loop model.
- **`schema` vs Magic's dual mode.** Magic's learning-review mode emits markdown prose, not JSON.
  The orchestrator must deterministically select the mode and **omit** `schema` for prose runs.
- **Token cost of fan-out.** `parallel()` is cheaper in wall-clock but not in tokens; pair with
  `budget` ceilings (already planned for autonomous mode) so fan-out doesn't surprise on cost.
- **Eval CLI ≠ tool.** Resist migrating the headless CLI onto the in-session tool; keep them
  separate and only share patterns.

---

*Generated from a 4-reader parallel analysis of `commands/team.md`, `agents/*.md`, `evals/src/*`,
and the roadmap docs (`ai.md`, `autonomous.md`, `team-improvement-analysis.md`,
`shaq-optimization.md`, `harbor-comparison-future-improvements.md`,
`ruflo-comparison-adoptable-ideas.md`).*
