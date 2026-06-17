# Architecture — Hybrid Multi-Provider `/team`

**Author:** MJ (Strategic Systems Architect) · **Date:** 2026-06-17 · **Status:** Design; resolves Bird's ESCALATION-1 with a per-role verdict + phasing. **Confidence: 80.**

## 0. Executive Summary
The hybrid is **one seam, not a subsystem**. `/team` already separates *who runs a turn* (Coach K's orchestration) from *how a turn executes* (the `Task`/`Agent` tool → Claude subagent), but the "how" is hardwired to Claude. The eval harness independently proved the other "how" — `runProviderBackend` driving codex/gemini/ollama on native auth. Build = introduce an **`AgentTurn` seam with two implementations** (native subagent / delegated CLI), have Coach K pick by reading `resolveEffectiveModel(agent)`, and **fold the delegated structured result into the existing brief→result→reviewer→checkpoint pipeline unchanged**. No `ANTHROPIC_BASE_URL`, ever — delegation spawns a sibling process on its own auth.

## 1. Where Delegation Hooks Into `/team`
**The seam already exists:** Coach K never executes agent work — every turn is a `Task({subagent_type})` or `Agent({name,team_name})` call. Everything around it (briefs, checkpoints, reviewer loop, spec writes, draft evals) operates on a *structured result*, not on how it was produced. Today there's exactly one execution implementation.

**Routing decision (per agent, immediately before each spawn) — the existing authority, no parallel table (BR-7):**
```
route(agent):
  model = resolveEffectiveModel(agent)            // agent-runner.ts
  {provider, modelId} = parseProvider(model)      // provider-backends.ts
  provider == "claude" → NATIVE (Task/Agent subagent on Max)   // BR-2, BR-6
  else                 → DELEGATED(provider, modelId)
```
Coach K is the live Claude session → never routed, always Max-native (BR-6). Claude-pinned agents stay native (BR-2). Delegation spawns a sibling process on its own auth — never a base-url redirect. Re-pinning frontmatter changes routing with zero code edits (AC-7).

**Command flow:** `commands/team.md` is a playbook; the hook is a new § "Provider Routing" Coach K consults before each spawn + a thin `team-dispatch.ts` Bun helper he `Bash`-invokes for non-claude turns. Quick Fix / PR Review: per-spawn decision, results fold in as today. Full Team: delegated turns can't join the message bus → Coach K proxies (§3.4).

## 2. The Agent-Turn Interface
```
TurnRequest = { agent, prompt /*brief+context, BR-9*/, scenarioId, timeoutMs }
              // provider/modelId resolved INTERNALLY from agent spec (BR-7)
TurnResult  = { agent, provider, modelId, output /*contract JSON*/, ok, error?,
                artifactsDir? /*sandbox, BR-10*/, trace, cost_usd:0, durationMs, tokens }
```
| Impl | When | Mechanism | Status |
|---|---|---|---|
| `NativeSubagentTurn` | provider==claude | the live session's `Task`/`Agent` subagent on Max — realized *by Coach K in-session* (plan mode, bus, live-repo all work) | exists (it IS `/team` today) |
| `DelegatedCliTurn` | codex/gemini/ollama | wraps `runProviderBackend(...)` | executor exists; needs thin interactive wrapper |

The asymmetry is deliberate: native is realized by Coach-K-in-session (can't be a Bun call); delegated is a spawned process. The interface is shared *vocabulary*, not a runtime polymorphic dispatcher.

**Reused verbatim (Drexler confirm, do NOT rebuild):** `runProviderBackend`+`runOllama`/`runGemini`/`runCodex` (native structured output, codex sandbox cwd, timeout-kill, `buildTrace`); `resolveEffectiveModel`+`parseProvider`+`resolveModel`/`TIER_DEFAULTS`; `getAgentJsonSchema`/`getAgentStrictJsonSchema`/`stripNulls`.
**Added (smallest-first, §6):** `team-dispatch.ts` (interactive wrapper = interactive-context analog of eval's `runAgentScenario`); a **role-aware** interactive `SINGLE_SHOT_APPEND` (global eval version is wrong for Shaq); `team.md` routing + fold-back playbook. Nothing in the eval harness changes; `team-dispatch.ts` *imports from* `provider-backends.ts`.

## 3. Fold-Back (pipeline cannot tell native from delegated — BR-4/BR-5)
- **3.1 Brief in (BR-9/AC-8):** Coach K writes the *same* curated brief to a file, passes path to `team-dispatch.ts` as `prompt`. Brief is built *before* the native-vs-delegated decision → execution-mode-independent.
- **3.2 Contract out (BR-4/AC-3) — validation gate:** `team-dispatch.ts` runs the role's Zod schema *before* `ok:true`. Valid→folds in identically. Prose/malformed→`ok:false`→Coach K's existing AGENT OUTPUT VALIDATION retry (≤2). Empty/error→fail-loud. **Validation in code, not LLM eyeballing** (BR-4 is an invariant).
- **3.3 Reviewer loop + checkpoints (BR-5/AC-4):** operate on `TurnResult.output` — untouched. Checkpoints are Coach K's `AskUserQuestion` in the live session regardless of where the turn ran → no delegated turn can bypass one (it has no path to drive the flow).
- **3.4 Message-bus gap (Full Team):** delegated processes can't join the bus → **Coach K proxies** (reads delegated result, injects findings into the next brief). Effect: delegated Full Team turns are sequential-with-proxy, not peer-concurrent (Pippen note). Bus-bridge for external procs rejected (large surface).
- **3.5 Fail-loud (BR-8/AC-5/AC-9):** CLI missing/unauthed/timeout → `ok:false`+provider-named error → Coach K pauses, `AskUserQuestion` (retry/skip/manual re-pin). **No auto fallback to metered API** (BR-1); non-claude→claude fallback is a BR-3 violation → explicit opt-in only. Completed turns stand.
- **3.6 Sandbox surfacing (BR-10/AC-6) — the one deliberate behavior change:** eval's `runCodex` `rm`s its tmp cwd in `finally` (good for grading, fatal for review). Interactive keeps the sandbox under a **session-scoped path** (`$SESSION_WORKTREE/.dt-delegated/<agent>-<id>/`), returns `artifactsDir`, computes a diff/manifest, surfaces it to reviewer+checkpoint; **only on approval** are files promoted to the worktree. Cleaned at session cleanup, not per-turn. → parameterize teardown, don't fork the executor.

## 4. ESCALATION-1 Resolution
**Decisive fact (confirmed via codex CLI docs):** `codex exec` is single-shot (one prompt→internal loop→last message, no approval interrupt), **but codex supports live multi-turn** via `codex exec resume` / `thread/resume` (app-server JSON-RPC) / TS+Python SDK `resumeThread()`+`thread.run()`. **Gemini CLI and ollama have no first-party agentic multi-turn-resume primitive.**

| Role | Contract nature | Single-shot correct? | Verdict |
|---|---|---|---|
| Bird, MJ, Kobe, Pippen, Drexler | one-shot analytical artifact (JSON); plan-mode/messaging not load-bearing for correctness; brief can inline needed context | **Yes** | single-shot delegation OK any provider, Phase 1 |
| Magic | synthesis over provided outputs; no repo mutation | **Yes** | single-shot OK, Phase 1 |
| Shaq | iterative Read/Write/Bash gated by plan-approve-before-write (BR-5); correctness depends on the approval checkpoint | **No (single-shot)** | claude-native default; codex-resume Phase 2 opt-in; gemini/ollama disallowed |

**Phasing (Bird's Option C, made concrete):**
- **Phase 1 (ship now, covers AC-1/3/4/7/8):** analysis/synthesis roles delegate single-shot on any provider (role-aware neutralizer applied to them only). **Shaq pinned non-claude → fail loud**: "live multi-turn delegation not yet enabled; re-pin to claude or wait for Phase 2." No silent single-shot, no silent metered fallback.
- **Phase 2 (opt-in, when proven):** `CodexLiveTurn` via `codex exec resume`: turn 1 = plan (no writes) → Coach K plan-approval checkpoint → resume to apply writes in session sandbox → resume for build/test. **Kobe+MJ must jointly validate (eval, 3 trials) that resume pauses for approval before any write lands** before enabling.
- **Phase 3/never-by-default:** gemini/ollama Shaq disallowed (no resume → can't honor BR-5 live); only explicit human opt-in accepting reduced-fidelity single-shot impl, flagged as such.

## 5. Trade-offs & Second-Order Effects
- **Context hand-off:** single-shot delegated turn gets exactly the brief, can't "go look" → brief quality is load-bearing; inline *more* context for delegated than native. Analysis roles safe (input specifiable); Shaq's input is the live evolving repo (not).
- **No shared session state:** delegated turns are **pure functions of their brief** — reliance on ambient session state is a design error. Causes the bus-proxy degradation (3.4).
- **Worktree:** sandbox lives **inside** `$SESSION_WORKTREE/.dt-delegated/` (not `os.tmpdir()`) so concurrent sessions don't collide and cleanup ties to `worktree-cleanup.ts`. Staging area only; never touches tracked files pre-approval. Add `.dt-delegated/` to ignore.
- **Boundaries (rigid on purpose):** (1) routing authority is singular (`resolveEffectiveModel`); (2) **no `ANTHROPIC_BASE_URL` ever** — this is the line between "hybrid" and the ruled-out "proxy"; (3) process mgmt owned by `team-dispatch.ts`, not hand-rolled Bash; (4) contract validation in code; (5) sandbox confinement.

## 6. Build Surface (smallest-first; design only)
- **S1** `commands/team.md` § Provider Routing (playbook): `route(agent)`, per-spawn decision, fail-loud `AskUserQuestion`, Phase-1 Shaq-must-be-claude guard.
- **S2** `evals/src/team-dispatch.ts` (new): `runDelegatedTurn(agent, briefFile, opts)→TurnResult`; imports `runProviderBackend`; adds role-aware append (S4), Zod validation (3.2), session-scoped sandbox + diff (3.6), provider-named fail-loud; CLI entry for `Bash`.
- **S3** `provider-backends.ts` (additive): `runCodex`/`runOllama` accept optional `workDir`+`keepWorkDir`; eval callers keep ephemeral default unchanged.
- **S4** role-aware interactive append (in S2 or tiny module): neutralizer for analysis/synthesis roles only; never for Shaq.
- **S5** `commands/team.md` fold-back protocol (playbook): brief-in, Zod-gate retry reuse, bus-proxy rule, sandbox-diff→reviewer/checkpoint→approved promotion.
- **S6** `.dt-delegated/` ignore + `worktree-cleanup.ts` hook.
- **S7 (Phase 2, deferred, opt-in):** `CodexLiveTurn` via `codex exec resume`/`thread/resume` implementing plan→approve→write→test; **gated by Kobe+MJ eval (3 trials) proving approval-before-write.**

Changed existing: `provider-backends.ts` (S3 additive only), `commands/team.md` (playbook), `worktree-cleanup.ts` (S6). Untouched: `resolveEffectiveModel`, `model-tiers.ts`, schemas, eval CLI.

## 7. Risks
- **critical** single-shot Shaq silently ships under-governed code (BR-5) → Phase 1 hard-blocks non-claude Shaq fail-loud; codex-Shaq gated behind proven approval-before-write.
- **critical** metered-API leak via misconfig → boundary #2; `team-dispatch.ts` asserts no `ANTHROPIC_BASE_URL`; rely on native subscription auth (no key flags); Pippen pre-flight auth-mode check.
- **high** delegated prose breaks downstream (BR-4) → Zod gate + retry.
- **high** sandbox files leak/lost before review (BR-10) → S3 session dir + S6 ignore + diff-then-approve.
- **medium** Full Team bus-proxy serialization → document expectation, Pippen timeouts.
- **medium** codex resume writes before orchestrator interrupts (Phase 2) → Kobe+MJ gate before S7.

## 8. Open items for the team
- **Kobe:** risk-validate the Phase-2 codex-resume approval interrupt (the one place single-shot→multi-turn could leak an un-approved write).
- **Pippen:** timeout thresholds, provider auth-mode pre-flight (assert subscription not metered), mid-session-death UX.
- **Drexler:** confirm `runProviderBackend` reused not forked; S3 stays additive; smallest-version check.
- **Bird:** confirm the per-role split satisfies the BR-4/BR-5 fidelity bar for impl/verify roles.

---

## REVISION (post-review reviewer loop) — MJ, confidence 78
Kobe refuted §4's Phase-2 mechanism against live `codex-cli 0.140.0`; all four corrections accepted.

**§4.1/§4.3 corrected — Phase-2/S7 = read-only-turn-1 (OS-enforced gate):** `codex exec` writes within a turn (gated only by `--sandbox`); `on-request` approval is model-discretionary with no channel for a separate-process orchestrator; `codex exec resume` has no stop-before-write flag → "plan turn then resume to write" is unenforceable. Corrected: **turn 1 `--sandbox read-only`** (model physically cannot write → emits a plan; read-only is fine because turn 1's deliverable IS the plan) → Coach K approval checkpoint → **separate turn 2 `--sandbox workspace-write`** into the session sandbox (writeability is the *consequence* of approval, not codex self-gating) → normal sandbox-diff/reviewer/promotion. **Gate (blocks S7):** instrumented eval watching the sandbox for ANY write during turn 1 must show non-empty approvable plan + **zero turn-1 writes, 3/3 trials**; a 2/3 keeps S7 disabled. Kobe owns write-detection instrumentation. Phase 3 (gemini/ollama Shaq) unchanged — disallowed (no enforceable write gate).

**§4.2 corrected — single-shot caveat:** analysis roles are NOT unconditionally pure functions of a brief ("pure" is an isolation property, not a sufficiency one). Single-shot delegation is domain-correct only when (a) the brief fully inlines the artifact under review AND (b) no live verification is required. Else: claude-native, or a guarded append — *"Assert only what is present in this brief; if a conclusion requires reading the repo or running a command you cannot do here, state it as a limitation and lower confidence — do not assert it as verified."*

**Build surface additions:**
- **S2 (hardened contract gate):** before `ok:true` — non-emptiness of required deliverables; cited-path-exists (`fs.existsSync` on any path the result claims to have read); confidence-cap (escalating result can't claim high confidence); `cost_usd:0` is **set by the dispatcher after auth is proven**, never read from the child (unfalsifiable otherwise).
- **S2a (new, blocks all delegation):** scrub child env (strip `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_*`/target `*_API_KEY`) before `Bun.spawn` so a metered key can't leak even if present → CLIs fall back to subscription/local (BR-1 enforced by env construction); positive subscription pre-flight per used provider, fail-loud if not subscription/local (AC-5).
- **S6a (new, small):** host-scoped ollama advisory lock (`~/.claude/dt-ollama.lock`) held for a delegated ollama call; a 2nd concurrent `/team` session waits (bounded by timeout) then fails loud ("ollama busy"), never races into OOM. Serializes only ollama, host-scoped (the daemon is host-shared); codex/gemini unaffected.

**Net:** Phase 1 unaffected, ships. Phase 2 now mechanically sound (OS-sandbox gate vs. refuted model-gate) but **correctly remains disabled pending the instrumented 3/3 gate** — unproven, not merely deferred.

---

## REVISION 2 (post context7 — Phase 3 overturned) — MJ, confidence 80
The user pushed back on "gemini/ollama Shaq disallowed"; context7 confirmed both have enforceable plan gates. "Disallowed" conflated "no agentic-resume primitive" with "no write gate" — the gate doesn't need resume, it needs a write-INCAPABLE plan phase, which all three have.

**Unifying principle:** Claude Shaq already runs plan→approve→implement (EnterPlanMode → review → go-ahead → write). Every non-claude provider gets the SAME governance (Coach K's existing plan-approval checkpoint + reviewer loop) wired to that provider's NATIVE plan primitive. **One checkpoint path, N plan primitives** — provider differences live only in how the plan phase is made write-incapable.

Shared two-phase mapping (all four providers): **Plan** (write-incapable, reads, emits plan) → *gate* (Coach K AskUserQuestion — the same checkpoint Claude Shaq hits today) → **Implement** (writes into `$SESSION_WORKTREE/.dt-delegated/...`) → sandbox-diff → reviewer → approved promotion.

Per-provider plan primitive (the only variable):
- **codex** → plan = `--sandbox read-only` (OS-enforced write-incapable) → implement = `--sandbox workspace-write`.
- **gemini** → plan = `--approval-mode plan -p` (Plan Mode TOML policy admits only readOnlyHint tools → no writes) → implement = `--approval-mode auto_edit` (or `--yolo`), cwd = session sandbox.
- **ollama** → plan = orchestrator tool-loop with ONLY read tools registered (ollama has no fs; it emits tool_calls, WE execute → withhold write tools) → implement = re-enter loop with Write/Bash enabled, confined to `.dt-delegated`. Strongest gate by construction (write capability is ours to withhold).

Drops "disallowed". BR-5 honored on all three — each plan phase is *physically* write-incapable, not prompt-instructed.

**Build surface (Shaq paths, all gated Phase 2/3):**
- **S7 (codex)** — read-only turn 1 → checkpoint → workspace-write turn 2. Small (sandbox-mode flip on existing runCodex).
- **S8 (gemini)** — two scriptable invocations: `--approval-mode plan` → checkpoint → `--approval-mode auto_edit` (cwd=sandbox). Small-med (an `--approval-mode` param + execute cwd on runGemini). `--acp` live loop DEFERRED (stateful protocol, bigger; two-phase already satisfies the gate).
- **S9 (ollama) — biggest single piece, ships last.** Orchestrator tool-loop in team-dispatch: (1) tool-execution loop (send→receive tool_calls→execute→feed back→repeat); (2) sandboxed Read/Grep/Write/Bash impls, every path confined to `.dt-delegated` (reject traversal/absolute escape), Bash cwd-pinned + scrubbed env (S2a); (3) approval-gated tool registry (plan=read-only tools; implement adds Write/Bash post-checkpoint); (4) loop bounds (max iters, per-call+total timeout). Confine to Read/Grep/Write/Bash — not a general tool framework (Drexler). S6a ollama host-lock matters more (S9 holds the daemon longer).

**Per-provider gate proof (Kobe; 3/3 trials, blocks that provider's Shaq):**
- codex — read-only turn 1 yields approvable plan AND filesystem watcher records ZERO writes during turn 1.
- gemini — `--approval-mode plan` yields approvable plan AND ZERO writes during the plan invocation (proves the TOML policy actually blocks writes, not that the model chose not to).
- ollama — gate is constructive, so proof targets OUR loop: assert plan-phase registry has no Write/Bash, instrument the dispatcher to fail if it ever executes a write/bash tool-call pre-approval, AND prove path-confinement (out-of-sandbox Write/Bash rejected). For ollama the risk is in our code, not the model.

**Sequencing:** codex → gemini → ollama — by least-new-code-we-own + strongest-externally-enforced-gate (codex gate = OS; gemini = provider policy; ollama = our code). ollama ships last because a bug in our loop is the failure mode.

**Phase 1 unchanged** (analysis single-shot + Shaq claude-native). This is the Phase 2/3 Shaq roadmap, now real and gated for all three providers.
