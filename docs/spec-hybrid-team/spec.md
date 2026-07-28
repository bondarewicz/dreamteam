# Spec — Hybrid Multi-Provider `/team`

> **SUPERSEDED IN PART (2026-07-28):** Gemini support has been removed from the
> product. Google ended Gemini Code Assist for individuals on the `gemini` CLI
> client ("this client is no longer supported… migrate to Antigravity"), which
> broke the keyless `~/.gemini` subscription path this spec depends on. The
> supported providers are now **Claude, Codex, and Ollama**. Gemini references
> below are retained as the historical design record — they describe what was
> decided in June 2026, not current behavior.

**Tracker:** 2026-06-17 · hybrid-team · Sign-off pending
**Authors:** Bird (domain) · MJ (architecture) · Pippen (operations) · Drexler (scope) · Kobe (quality/risk) · Magic (synthesis)
**Status:** READY FOR SIGN-OFF — Phase 1. Shaq-on-any-provider gated Phase 2/3 (codex→gemini→ollama).

---

## 1. Summary & Decision

**What we are building:** hybrid provider delegation for interactive `/team`. Claude Code remains the orchestrator on Claude Max. For each agent turn, Coach K resolves the agent's pinned provider; if it is non-claude, the turn is delegated to that provider's first-party CLI (`codex exec`, `gemini`, ollama API) via `runProviderBackend`, and the structured result folds back into the unchanged reviewer/checkpoint pipeline.

**Why not proxy:** Max (Claude) and ChatGPT-Codex are subscription-only — not reachable via `ANTHROPIC_BASE_URL` or LiteLLM proxy. A session-wide `base_url` also can't route per-agent. Proxy fails constraints 1 and 2. Decision is closed.

**Phase 1 (ship):** analysis/synthesis roles delegate single-shot on any provider. Shaq stays claude-native.
**Shaq on ANY provider — unified principle** *(one checkpoint path, N plan primitives)*: each provider's native write-incapable plan mode slots into the same plan→approve→implement checkpoint we run for Claude. codex = `--sandbox read-only`; gemini = `--approval-mode plan`; ollama = orchestrator tool-loop with write tools withheld until approval. Each ships only after a 3/3 instrumented proof of no-write-before-approval. Sequence: **codex → gemini → ollama**.
- **Phase 2 — codex-Shaq: ✅ SHIPPED.** Gate cleared 3/3 (`scripts/plan-gate.ts codex`: read-only turn-1 plan, zero writes). Two-phase dispatch live; verified end-to-end (plan 0 writes → implement wrote classify.ts + test into the sandbox).
- **Phase 3 — gemini-Shaq: ✅ SHIPPED.** Gate cleared 3/3 (`scripts/plan-gate.ts gemini`). gemini's `--approval-mode plan` is NOT write-incapable headless (it wrote files 3/3) — the enforceable gate is an **OS read-only cwd + no-write framing** (writes EACCES); implement uses `--approval-mode auto_edit` in a writable sandbox. Plan-phase dispatch verified end-to-end; implement write-capability demonstrated (full two-phase dispatcher smoke pending flash-quota reset).
- **Phase 3 — ollama-Shaq: ✅ SHIPPED.** Orchestrator tool-loop (`ollama-agent.ts`): ollama emits tool_calls, we execute them. Plan phase registers READ tools only → **constructively write-incapable** (the strongest gate: no write tool exists to call); implement phase adds write/bash, sandbox-confined (path-traversal rejected, bash cwd-pinned + scrubbed env). Gate is deterministic — unit-tested (write/bash refused in plan, confinement) rather than a live trial. Plan-loop smoke verified on qwen3.6.

---

## 2. Invariants — Non-Negotiables

| ID | Invariant | Enforcement point |
|---|---|---|
| BR-1 | No agent turn billed to a metered API when a subscription/local path exists | `assertSubscriptionAuth` in S2a refuses before every delegated spawn; scrubbed child env |
| BR-2 | No session-wide `ANTHROPIC_BASE_URL`/proxy ever set | S2a session-start abort if `ANTHROPIC_BASE_URL` detected; delegation spawns a sibling process, never a base-url redirect |
| BR-3 | Provider executing a turn == provider its pin resolves to | `resolveEffectiveModel` is the sole routing authority; no parallel table; non-claude→claude fallback is a BR-3 violation and is never automatic |
| BR-4 | Result contract (schema, escalation, confidence) holds whether native or delegated | Hardened contract gate in S2: Zod schema + non-emptiness + cited-path-exists + confidence cap + `cost_usd:0` set by dispatcher after auth proven (never read from child) |
| BR-5 | Orchestration semantics preserved: every turn folds through brief→result→reviewer→checkpoint | Delegated results enter the same pipeline; checkpoints are Coach K `AskUserQuestion` in the live session — no delegated turn has a path to bypass them |
| BR-6 | Coach K is always native Claude on Max; never delegated | Hard-coded in routing logic; Coach K is the live session itself |
| BR-8 (partial) | Fail-loud on provider unavailability; never auto-fall-back to metered API | `AskUserQuestion` menu: retry / skip / manual re-pin / abort. No metered fallback offered. |
| BR-10 | Delegated turns must not pollute the repo | Session-scoped sandbox (`$SESSION_WORKTREE/.dt-delegated/<agent>-<id>/`); files promoted only on reviewer+checkpoint approval; sandbox kept on failure for debugging |

**Derived rule (from Kobe CRITICAL-2):** `cost_usd:0` is asserted by the dispatcher *after* subscription auth is proven, not read from the child process. A metered run returning `cost_usd:0` must be detectable — subscription auth pre-flight is the detection mechanism.

---

## 3. Design — The Hybrid Seam

**One seam, not a subsystem.** Coach K already separates who-runs-a-turn from how. The seam introduces two execution modes behind a per-turn routing decision:

```
route(agent):
  model = resolveEffectiveModel(agent)        // agent-runner.ts — sole authority
  {provider, modelId} = parseProvider(model)  // provider-backends.ts
  provider == "claude"  →  NATIVE  (Coach K Task/Agent on Max — today's /team)
  else                  →  DELEGATED(provider, modelId) via team-dispatch.ts
```

**Native:** Coach K's live `Task`/`Agent` subagent call. Plan mode, message bus, live-repo — all intact. This is `/team` today, untouched.

**Delegated:** `Bash` invocation of `team-dispatch.ts` (new). Thin interactive wrapper over the existing `runProviderBackend`. Spawns a sibling process on the provider's own auth. No `base_url`. Returns `TurnResult` JSON on stdout.

**Fold-back — the pipeline cannot distinguish native from delegated:**
- Brief in: same curated brief file, built before the routing decision (BR-9/AC-8).
- Contract out: Zod validation gate in `team-dispatch.ts` before `ok:true`; malformed → `ok:false` → Coach K retry (≤2); empty/error → fail-loud.
- Reviewer loop + checkpoints: operate on `TurnResult.output` — untouched. Delegated turns have no path to Coach K's `AskUserQuestion` → no checkpoint can be bypassed.
- Message bus (Full Team): delegated processes cannot join the bus. Coach K proxies: reads delegated result, injects curated findings into the next brief. Delegated Full Team turns are sequential-with-proxy, not peer-concurrent. This is a documented fidelity reduction, not a bug.
- Sandbox surfacing: `runCodex` keeps the session-scoped sandbox (`keepWorkDir:true`); `team-dispatch.ts` computes a diff/manifest, surfaces it to reviewer+checkpoint; files promoted only on approval.

**Single-shot caveat (from Kobe review):** analysis roles are not unconditionally pure functions of a brief. Single-shot delegation is domain-correct only when (a) the brief fully inlines the artifact under review AND (b) no live verification is required. When neither holds, keep the role claude-native or ensure the brief carries a guarded append: *"Assert only what is present in this brief; if a conclusion requires reading the repo or running a command you cannot do here, state it as a limitation and lower confidence — do not assert it as verified."*

---

## 4. Phase 1 — Build Now

### Role routing table

| Role | Provider | Execution mode | Notes |
|---|---|---|---|
| Coach K | claude (always) | Native | Never delegated (BR-6) |
| Bird, MJ, Kobe, Pippen, Drexler, Magic | any | Single-shot delegated OR native | Single-shot OK when brief inlines the artifact; otherwise native |
| Shaq | **claude only** in Phase 1 | Native | Non-claude pin → fail loud: "delegated implementation not yet enabled for `<provider>` (Phase 2/3, gated); re-pin to claude". Codex/gemini/ollama Shaq land in later gated phases (§5), not Phase 1. |

### Exact build surface (~137 net lines, 0 deleted, 0 new deps)

| Item | What | Where | Size |
|---|---|---|---|
| **S1** | `commands/team.md` § Provider Routing | Playbook: `route(agent)`, per-spawn decision, fail-loud `AskUserQuestion`, Phase-1 Shaq-must-be-claude guard | ~prose |
| **S2** | `evals/src/team-dispatch.ts` (new) | `runDelegatedTurn(agent, briefFile, opts)→TurnResult`; imports `runProviderBackend`; adds: role-aware interactive append, hardened contract gate (below), session-scoped sandbox + diff, provider-named fail-loud; CLI entry for `Bash` | ~80-100 lines |
| **S2 (hardened gate)** | In team-dispatch.ts before `ok:true` | Non-emptiness of required deliverables; `fs.existsSync` on any path the result claims to have read; confidence cap (escalating result cannot claim high confidence); `cost_usd:0` set by dispatcher after auth proven — never read from child | included above |
| **S2a** | In team-dispatch.ts, blocks all delegation | Scrub child env: strip `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_*`, target `*_API_KEY` before `Bun.spawn`; `assertSubscriptionAuth(provider)`: codex→refuse if `OPENAI_API_KEY`/`CODEX_API_KEY` set, require `~/.codex/auth.json`; gemini→refuse if `GEMINI_API_KEY`/`GOOGLE_API_KEY`, require `~/.gemini` OAuth; claude→refuse if `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` (session-start abort); ollama→liveness only | included above |
| **S3** | `provider-backends.ts` (additive only, +6 lines) | Add optional `opts?:{workDir?;keepWorkDir?}` to `runCodex` + `runProviderBackend` pass-through. Eval callers pass nothing → unchanged. `runOllama`/`runGemini` need no change. | ~+6 lines |
| **S4** | Inline in team-dispatch.ts (~8 lines) | `INTERACTIVE_SINGLE_SHOT_APPEND` constant + `ANALYSIS_ROLES` set; guards analysis/synthesis roles only; never applied to Shaq; eval `SINGLE_SHOT_APPEND` unchanged | included in S2 |
| **S5** | `commands/team.md` § Delegated Turn Protocol | Playbook: brief-in, Zod-gate retry reuse, bus-proxy rule, sandbox-diff → reviewer/checkpoint → approved promotion | ~prose |
| **S6** | `.gitignore` + `worktree-cleanup.ts` (+3 lines) | `**/.dt-delegated/` in .gitignore; `worktree-cleanup.ts` cleanup hook; exempt `.dt-delegated/` from uncommitted-changes abort check | ~+3 lines |
| **S6a** | Host-scoped ollama advisory lock | `~/.claude/dt-ollama.lock` held for duration of delegated ollama call; 2nd concurrent session waits (bounded) then fails loud ("ollama busy"); serializes only ollama | ~+10 lines in team-dispatch |

### Pippen's 5 ship-blockers (all Phase 1)

1. `assertSubscriptionAuth` refusal guard — refuses before each delegated spawn (S2a)
2. `ANTHROPIC_BASE_URL` session-start abort — first check, before any routing (S2a)
3. Fail-loud `AskUserQuestion` per failure signature — never-started / unauthed / timeout / crash / empty-Zod / ollama-down (S3, S5 playbook)
4. Sandbox keep-on-failure + promote-only-on-approval + `.dt-delegated/` ignored (S3, S6)
5. stderr + failure-signature enum + authMode logging in `.dt-delegated/turns.jsonl` (S2)

### What is deferred (not Phase 1)

- Shaq on codex/gemini/ollama (S7/S8/S9, all gated Phase 2/3 — see §5; sequence codex→gemini→ollama)
- `AgentTurn` class hierarchy (Drexler: ceremony; dropped)
- Bus bridge for delegated turns (large surface; proxy pattern sufficient)
- S4 as a separate module (inline is simpler)
- `runOllama`/`runGemini` S3 changes (no fs side-effects; not needed)
- Per-agent schemas beyond Bird in the registry (add as agents validated — does not block Phase 1)
- Parallelizing delegated turns (sandbox-collision/resource risk; Phase 1 sequential)

---

## 5. Phase 2/3 — Gated: Shaq on ANY provider

**Unifying principle — one checkpoint path, N plan primitives.** Claude Shaq already runs plan→approve→implement (`EnterPlanMode` → review → go-ahead → write). Every non-claude provider reuses the *same* governance (Coach K's existing plan-approval checkpoint + reviewer loop) wired to that provider's **native write-incapable plan primitive**. Provider differences live only in how the plan phase is made write-incapable; the approval/reviewer machinery is identical to today. BR-5 is honored everywhere because each plan phase is *physically* write-incapable, not prompt-instructed.

Shared two-phase mapping (all four providers, Claude included): **Plan** (write-incapable, reads repo, emits plan) → *gate* (Coach K `AskUserQuestion` — the same checkpoint Claude Shaq hits today) → **Implement** (writes into the session sandbox) → sandbox-diff → reviewer → approved promotion.

| Provider | Plan primitive (write-incapable) | Implement phase | Gate enforced by | Build | Ships |
|---|---|---|---|---|---|
| **codex** | `--sandbox read-only` | `--sandbox workspace-write` turn 2 | the OS sandbox | S7 ✅ **SHIPPED** (gate 3/3) | **1st (done)** |
| **gemini** | **OS read-only cwd + no-write framing** (NOT `--approval-mode plan` — that writes anyway headless) | `--approval-mode auto_edit`, writable sandbox cwd, `GEMINI_CLI_TRUST_WORKSPACE=true` | OS read-only cwd (writes EACCES) | S8 ✅ **SHIPPED** (gate 3/3) | **2nd (done)** |
| **ollama** | orchestrator tool-loop, **only read tools registered** (ollama has no fs — it emits tool_calls, we execute) | re-enter loop with Write/Bash enabled, confined to `.dt-delegated` | **our dispatcher** (write capability is ours to withhold) | S9 ✅ **SHIPPED** (`ollama-agent.ts`; gate deterministic + unit-tested) | **3rd (done)** |

Why `codex exec resume` plan-then-write was refuted (Kobe CRITICAL-1): `codex exec` writes within a single turn; `-a on-request` is model-discretionary with no out-of-process approval channel; resume has no stop-before-write flag. The fix is OS-enforced read-only plan, not a model-trusted gate.

**Per-provider gate proof (Kobe; 3/3 trials, blocks that provider's Shaq):**
- **codex** — read-only turn 1 yields an approvable plan AND a filesystem watcher records **zero writes** during turn 1.
- **gemini** — `--approval-mode plan` yields an approvable plan AND **zero writes** during the plan invocation (proves the policy engine blocks writes, not that the model abstained).
- **ollama** — gate is constructive, so the proof targets *our loop*: assert the plan-phase registry has no Write/Bash, instrument the dispatcher to fail if it ever executes a write/bash tool-call pre-approval, AND prove path-confinement (out-of-sandbox Write/Bash rejected).

**Sequencing rationale:** ship in order of least-new-code-we-own + strongest externally-enforced gate. codex's gate is the OS; gemini's is the provider; ollama's is our code — so ollama (where a bug in *our* loop is the failure mode) ships last, after the cheaper externally-gated paths are proven.

---

## 6. Acceptance Criteria

| AC | Criterion | Given | When | Then |
|---|---|---|---|---|
| AC-1 | Each provider runs on its native auth, zero metered calls | Bird→claude, MJ→codex, Kobe→gemini, Shaq→ollama each pinned | A `/team` session runs | Each executes on resolved provider; no Anthropic/OpenAI API calls |
| AC-2 | No proxy, no base_url, orchestrator on Max | Session starts | Any delegated turn runs | `ANTHROPIC_BASE_URL` is unset; orchestrator billed to Max only |
| AC-3 | Delegated turn is contract-identical to native | A codex-delegated turn completes | Result returned | Validates against agent schema; includes escalations/confidence per role |
| AC-4 | Delegated result enters reviewer loop + checkpoint | Delegated turn returns `ok:true` | Result folded back | Same reviewer loop + human checkpoint as native; no checkpoint skipped |
| AC-5 | CLI missing/unauthed → fail loud, no metered fallback | codex pinned, CLI missing or unauthed | Turn is dispatched | Provider-named actionable error; session pauses that turn; no auto metered fallback |
| AC-6 | File writes confined to sandbox until approved | codex/ollama turn writes files | Turn runs | Writes in isolated dir; repo untouched; files promoted only on reviewer+checkpoint approval |
| AC-7 | Re-pinning frontmatter changes routing, no code edit | Agent frontmatter tier/pin changed | Next `/team` session | Routing changes via `resolveEffectiveModel`; no code edit required |
| AC-8 | Delegated turn receives upstream artifacts + brief | Delegated turn depends on prior agent output | Turn dispatched | Brief contains upstream artifacts; turn is not working blind |
| AC-9 | Timeout → fail loud, no metered re-route | Delegated turn exceeds timeout | Process killed | Recorded as fail-loud timeout; surfaced for human decision; no metered re-route |

---

## 7. Terminology

| Domain term (Bird) | Technical term (MJ/Drexler) | Definition |
|---|---|---|
| Agent turn | `TurnRequest`/`TurnResult` | One unit of work — brief + context in, contract-conforming result out |
| Native run | `NativeSubagentTurn` (conceptual only; no runtime class) | Coach K's live `Task`/`Agent` subagent call — it IS today's `/team` |
| Delegated turn | `DelegatedCliTurn` / `runDelegatedTurn` in team-dispatch.ts | Spawned external CLI process on its own auth; returns `TurnResult` JSON |
| Subscription auth | `authMode: subscription\|local` | The only valid auth modes for claude (Max), codex (ChatGPT CLI), gemini (OAuth), ollama (local) |
| Metered API | `authMode: metered` | Pay-per-token; forbidden for claude and codex; refused by `assertSubscriptionAuth` |
| Fail-loud | `ok:false` + provider-named error + `AskUserQuestion` | Surface failure explicitly; never silent substitution |
| Sandbox | `$SESSION_WORKTREE/.dt-delegated/<agent>-<id>/` | Isolated working dir for delegated file writes; staging area only |
| Orchestration semantics | brief→result→reviewer→checkpoint pipeline | The invariant pipeline that all turns must enter regardless of execution mode |

---

## 8. Resolved Escalations & Decision Log

| Item | Input | Resolution | Status |
|---|---|---|---|
| ESCALATION-1 (Bird) — single-shot fidelity per role | Bird: ambiguous whether single-shot OK for impl roles | Option C made concrete: analysis/synthesis roles single-shot OK Phase 1; Shaq claude-native Phase 1; Shaq on codex/gemini/ollama all gated Phase 2/3 (see overturn below) | Closed (MJ §4 + REVISIONS 1&2) |
| User challenge — "gemini/ollama Shaq disallowed" | User: if we run them for evals we can find a way for /team; context7 confirms native plan gates exist | **"Disallowed" overturned.** All three providers have write-incapable plan primitives (codex read-only, gemini `--approval-mode plan`, ollama withheld-write-tools). Unified under one plan→approve→implement checkpoint = Claude's. Each gated Phase 2/3 behind a 3/3 proof; sequence codex→gemini→ollama | Closed (MJ REVISION 2, context7-grounded) |
| Kobe CRITICAL-1 — Phase-2 approval-before-write fiction | `codex exec` writes within a turn; `on-request` is model-discretionary; no out-of-process approval channel | Phase-2 mechanism corrected to `--sandbox read-only` turn 1 (OS-enforced); S7 blocked until 3/3 instrumented eval gate clears | Closed (MJ REVISION, Kobe accepted) |
| Kobe CRITICAL-2 — metered-API leak vectors | Inherited env keys + config overrides bypass base_url guard | S2a: scrub child env (strip metered keys) + `assertSubscriptionAuth` positive pre-flight per provider, fail-loud | Closed (MJ REVISION) |
| Kobe CRITICAL-3 — Zod validates shape not truth | Schema-valid-but-empty; `cost_usd:0` unfalsifiable | S2 hardened gate: non-emptiness + cited-path-exists + confidence caps + `cost_usd:0` set by dispatcher after auth proven | Closed (MJ REVISION) |
| Kobe CRITICAL-1 single-shot caveat | Analysis roles not unconditionally pure functions of a brief | Single-shot valid only when (a) brief fully inlines artifact AND (b) no live verification required; else claude-native or guarded append | Closed (MJ §4.2 REVISION) |
| Drexler — AgentTurn class hierarchy | MJ proposed runtime polymorphic dispatch | Dropped: native = Coach-K-in-session (no shared runtime path with Bun); only `TurnResult` as plain exported type | Closed (scope.md §4) |
| Pippen — ollama OOM blast radius | Two sessions loading big models OOM-kill shared ollama serve | S6a advisory lock serializes ollama per host; documented as shared resource; doctor warning | Closed (MJ REVISION S6a) |
| Pippen — `JSONL` observability ceiling | Pippen asked Coach K to confirm | JSONL (`.dt-delegated/turns.jsonl`) is the right tier for a local dev tool; external telemetry out of scope | Closed (operations.md §4, confirmed in scope) |

### Still open (needs user input)

None that block Phase 1. The following are should-have before Phase 1 ships but not sign-off blockers:
- Heartbeat ("starting `<agent>` on `<provider>` ≤`<timeout>`") to prevent users killing healthy sessions with long-running turns
- Coverage manifest in Magic's synthesis output (which agents ran / on which provider / which skipped+why)
- Provider version capture (`codex --version`, `gemini --version`) at pre-flight to detect silent CLI drift
- Ollama cold-start warmup at pre-flight (`/api/chat` ping) or ×1.5 timeout multiplier on first turn

---

## 9. Sign-Off

**The user is approving:**

1. **Phase 1 scope as defined** — `team-dispatch.ts` (~100 lines) + `provider-backends.ts` (+6 additive) + `commands/team.md` playbook additions + `.gitignore` / `worktree-cleanup.ts` hook. ~137 net lines, 0 deleted, 0 new deps.

2. **Shaq stays claude-native in Phase 1.** Non-claude Shaq pin → fail loud. No exceptions.

3. **Shaq on ANY provider is gated Phase 2/3** (codex → gemini → ollama), each behind a 3/3 instrumented proof that no write occurs before approval. Unified under one plan→approve→implement checkpoint (= Claude's plan mode); each provider supplies a native write-incapable plan primitive. None ships without its gate clearing. Kobe owns the per-provider instrumentation.

4. **Nothing is permanently disallowed.** The earlier "gemini/ollama Shaq disallowed" verdict is overturned — all three have enforceable plan gates. The only permanent fixture is the orchestrator (Coach K = Claude/Max, never delegated).

5. **The financial invariant (BR-1/BR-2)** is enforced by code (env scrub + positive auth pre-flight), not configuration discipline. A misconfigured env variable cannot silently meter.

6. **No proxy, ever.** Delegation is always a sibling process on its own native auth. The line between "hybrid" and the ruled-out proxy is `ANTHROPIC_BASE_URL` — it is never set.

_Sign here: _____________ Date: 2026-06-17_
