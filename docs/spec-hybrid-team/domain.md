# Domain Analysis — Hybrid Multi-Provider `/team`

**Author:** Bird (Domain Authority) · **Date:** 2026-06-17 · **Status:** Contract for the team. One escalation (delegated-turn fidelity per role) — see Escalations.

## Bounded Context
**`interactive-team-orchestration`** (the live `/team` SDD/quick-fix flow) — distinct from the **eval-harness** context (`evals/`). The eval context already runs all four providers single-shot and is the *reusable substrate*, not the thing being built. The eval context's "single-shot, no tools" semantics (`SINGLE_SHOT_APPEND`) are a property of the eval context, **not a law of the interactive context**; whether they may leak into interactive `/team` is the central open question (Escalations).

## Ubiquitous Language
- **Orchestrator (Coach K):** the Claude Code session running `/team`; coordinates agents, owns briefs/checkpoints/reviewer loop; runs natively on Claude Max; never delegated.
- **Agent / role:** fixed identity + output contract (Bird/MJ/Shaq/Kobe/Pippen/Magic/Drexler). Identity is provider-independent; the contract does not change with provider.
- **Agent turn:** one unit of work — brief + context in, contract-conforming result out. The atomic unit that is either run native or delegated.
- **Provider:** `claude | codex | gemini | ollama`.
- **Provider pin / tier:** the Phase-3B model spec (capability `tier` + optional per-provider `pin`) resolving via `resolveEffectiveModel`/`resolveModel`. The single routing authority.
- **Native run:** agent turn inside the orchestrator's Claude session as a subagent on Max.
- **Delegated turn:** agent turn run by spawning the provider's first-party CLI (`codex exec`, `gemini`, ollama API) via `runProviderBackend` — external process on its own sub/local.
- **Subscription auth:** Claude **Max**, ChatGPT for `codex`, Gemini CLI free tier. The only credentials ever used for their provider.
- **Metered API:** pay-per-token (Anthropic API, OpenAI API). Forbidden for `claude`/`codex`.
- **Result contract:** schema/structure + escalation protocol + confidence + role deliverables. Holds regardless of provider.
- **Orchestration semantics:** briefs, human checkpoints/approval gates, reviewer loop, inter-agent messaging via Coach K.
- **Fail-loud:** surface a provider failure as an explicit error that halts/pauses the turn; never silent substitution.

## Business Rules (invariant = must never break)
- **BR-1 [invariant]** No agent turn is billed to a metered API when a subscription/local path for its pinned provider exists (claude→Max, codex→ChatGPT CLI, gemini/ollama→CLI/local). The financial invariant the feature exists for.
- **BR-2 [invariant]** The session sets **no session-wide `ANTHROPIC_BASE_URL`**/global proxy. Orchestrator Claude calls go to Max unchanged. (A global base-url IS the ruled-out proxy.)
- **BR-3 [invariant]** The provider that executes a turn == the provider its pin/tier resolves to. No silent cross-provider execution.
- **BR-4 [invariant]** The result contract (schema, escalation, confidence) holds whether native or delegated. A delegated turn returning prose is not the same agent.
- **BR-5 [invariant]** Orchestration semantics preserved: every turn folds into the same brief→result→reviewer→checkpoint pipeline; delegated turns do not bypass human checkpoints or the reviewer.
- **BR-6 [invariant]** Coach K is always native Claude on Max; never delegated.
- **BR-7 [policy]** Provider selection governed solely by the existing tier/pin spec (reuse `resolveEffectiveModel`; no parallel routing table).
- **BR-8 [split]** On pinned-provider unavailability → **fail-loud for that turn** (default). The "no fallback onto a metered API" half is **invariant** (follows BR-1); the opt-in fallback ladder to another free/local provider is tunable policy requiring explicit opt-in.
- **BR-9 [policy]** A delegated turn receives the same brief + relevant prior-agent outputs a native subagent would (not working blind).
- **BR-10 [invariant]** A delegated turn must not pollute the repo: side-effecting runs (codex/ollama writing files) execute in an isolated sandbox dir (as the eval path does); only the contract-result folds back via the normal reviewer/checkpoint.

## Acceptance Criteria
- **AC-1** Bird→claude, MJ→codex, Kobe→gemini, Shaq→ollama: each runs on its resolved provider, zero metered-API calls.
- **AC-2** No `ANTHROPIC_BASE_URL`/proxy set; orchestrator billed to Max only.
- **AC-3** A codex-delegated turn's result validates against the agent schema + includes escalations/confidence per role — contract-identical to native.
- **AC-4** A delegated result enters the same reviewer loop + human checkpoint; no checkpoint skipped.
- **AC-5** codex pinned but CLI missing/unauthed → fail loud with provider-named actionable error; session pauses that turn; **no auto fallback to metered API**.
- **AC-6** A codex/ollama delegated turn that writes files: writes confined to isolated dir, removed after; repo untouched until reviewer/checkpoint approves.
- **AC-7** Changing an agent's tier/pin changes routing with no code edit, via the same `resolveEffectiveModel` path.
- **AC-8** A delegated turn depending on a prior agent gets the upstream artifacts + brief in its prompt.
- **AC-9** A delegated turn exceeding timeout → process killed, recorded as fail-loud timeout, surfaced for human decision, no metered re-route.

## Edge Cases & Failure-Domain Rules
- Pinned provider unavailable → fail-loud (BR-8); claude/codex never fall back to their metered API; falling a non-claude agent back to Claude-on-Max is a BR-3 fidelity violation → disallowed as automatic default, only explicit opt-in to another sub/local provider.
- Mid-session provider death → completed turns stand; affected turn fails loud; orchestrator offers human choice (retry/skip/manual re-pin); no silent downgrade.
- Delegated turn returns prose, not schema-valid JSON → BR-4 contract failure (a fail); retry/repair allowed; never pass malformed downstream.
- Delegated turn writes files → sandbox-isolate (BR-10).
- Provider exposes fewer models than tier expects (codex ChatGPT = gpt-5.5/gpt-5.4-mini only) → existing `TIER_DEFAULTS` handles it; not an error.
- All non-claude down → claude-pinned agents still run native; non-claude fail loud; report a partial team, don't crash.
- Cost reporting: delegated sub/local turns are `cost_usd: 0` — **correct** (subscription is the payment). Do NOT wire a metered API for accurate dollar figures (violates BR-1).

## Business Impact
- **Financial:** ROI = "use 4 paid subscriptions, zero incremental metered spend." A BR-1/BR-2 violation converts fixed cost → variable metered billing. Correctness is dollar-denominated.
- **Operational:** reuse of `provider-backends.ts` + tier/pin = low maintenance (one routing authority). New surface = external process management (spawn/timeout/sandbox/auth-state) — a real new failure domain (Pippen).
- **User:** heterogeneous team without auth juggling or surprise bills; failure must be legible (fail-loud, provider-named) or trust is lost.
- **Risk:** highest risk is *silent* divergence (wrong provider / metered leak / skipped checkpoint). Every invariant is oriented to make divergence loud.

## Stakeholders
user (subscription owner; bears all metered-leak risk — primary protected party); orchestrator/Coach K (new dispatch+fold-back duty); non-Claude-pinned agents (contract must survive delegation; plan-mode/messaging directives may be unsatisfiable off-Claude); downstream agents (depend on BR-4); provider subscriptions (only their own CLI/auth used).

## Escalations
**Type: ambiguity.**

### ESCALATION-1 — Is single-shot delegation domain-correct for *every* role, or do some roles REQUIRE live multi-turn tool use?
The agent prompts (e.g. `shaq.md`) **mandate** `EnterPlanMode`, tool use, an approval loop, inter-agent messaging. The eval path **neutralizes** all of that with `SINGLE_SHOT_APPEND`. That neutralization is defensible in the eval context (you want a gradable artifact); it is **not obviously defensible interactively**, where plan-approval + the reviewer loop are part of what makes output *correct* (BR-5).
- **Reading A:** single-shot delegation OK for all roles; orchestrator supplies plan/approval/reviewer governance *around* the turn. Analysis/spec roles (Bird, MJ, Kobe, Magic, Drexler) plausibly satisfy their contract this way.
- **Reading B:** implementation/verification roles (esp. **Shaq**, anything iterating Read/Write/Bash against the real repo) may not be "correct" as a single shot — their contract assumes iterative tool use + an approval checkpoint before writing.

**Options:** A) accept single-shot for all; B) classify roles (analysis→single-shot OK, impl/verify→live multi-turn or claude-native); C) phase it — ship A for analysis roles now, defer impl-role delegation behind B until live multi-turn delegation is proven.
**Recommendation: C.** Single-shot is domain-correct for analysis/spec roles today; for impl/verify roles do not assert correctness until MJ + Kobe confirm a delegated turn honors plan-approve-before-write (BR-5) + the reviewer loop; until then keep them claude-native or behind explicit opt-in. **MJ (architecture) + Kobe (risk) must finalize this per-role.**

## Confidence
**55** — financial/auth invariants (BR-1/2/3/6) + routing reuse (BR-7) ~85; capped at 55 by ESCALATION-1 (per-role fidelity changes the acceptance bar for impl/verify agents; unresolvable without MJ+Kobe).
**Assumptions:** Gemini CLI free tier + ChatGPT-authed codex are non-metered (intake); the eval `SINGLE_SHOT_APPEND` is an eval-context behavior, NOT assumed valid interactively without resolving ESCALATION-1; timeout thresholds are tunable policy (Pippen).
