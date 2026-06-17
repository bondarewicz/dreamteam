# Scope — Hybrid Multi-Provider `/team`
**Author:** Drexler · **Date:** 2026-06-17 · **Verdict: ACCEPTABLE.** Reuse claims verified against live code. ~137 net lines, 0 deleted, 0 new deps.

## 1. Already exists — do NOT rebuild (verified)
- `runProviderBackend` (provider-backends.ts:144) — dispatch + spawn + timeout-kill + codex sandbox + gemini GEMINI_SYSTEM_MD + buildTrace + error paths. team-dispatch only adds a workDir root + keepWorkDir flag. **Don't fork.**
- `resolveEffectiveModel` (agent-runner.ts:31) — full precedence (model→provider→default), tested across 4 providers. Call verbatim.
- `parseProvider` (provider-backends.ts:34) — `"codex/gpt-5.5"`→`{provider,modelId}`.
- `getAgentJsonSchema`/`getAgentStrictJsonSchema`/`stripNulls`/`validateAgentOutput` (schemas/agent-schemas.ts) — the Zod gate. Don't write new schema utils.
- `resolveModel`/`TIER_DEFAULTS`/`parseModelSpec` (model-tiers.ts) — single routing authority (BR-7).
- `worktree-cleanup.ts` — S6 = 3-line gitignore + a note; the discard path removes the worktree incl `.dt-delegated/`. Not a new script.
- `SINGLE_SHOT_APPEND` (provider-backends.ts:58) — real but baked into runOllama/runGemini at call time (the S4 tension).

## 2. The one real risk: S3 must stay additive
`runCodex` mkdtemps in os.tmpdir + rmSync in finally. Add optional `opts?:{workDir?;keepWorkDir?}` to `runCodex` + `runProviderBackend` (pass-through to codex only). Eval callers pass nothing → unchanged. **runOllama needs no change** (HTTP, no fs side-effects); **runGemini needs no change** (sysFile already cleaned; output via stdout). Net ~+6 lines, 0 deleted. Only runCodex needs S3.

## 3. team-dispatch.ts vs runAgentScenario — keep separate
Different contexts: scenario-file-in/json-out vs brief-in/TurnResult-out; no validation vs Zod gate; eval CLI vs Bash-from-live-session. A mode flag would be more complex than two functions. Shared code is `runProviderBackend` — already the right boundary. team-dispatch ≈ 80–100 lines, calls existing fns.

## 4. Cut the ceremony
- **Drop `AgentTurn` interface as a runtime construct** — native is Coach-K-in-session (not a Bun call), delegated is Bash→team-dispatch; a class hierarchy across a boundary with no shared runtime path is ceremony. Keep `TurnResult` as a plain exported type in team-dispatch. No NativeSubagentTurn/DelegatedCliTurn classes.
- **Inline S4** (~8 lines): `INTERACTIVE_SINGLE_SHOT_APPEND` + `ANALYSIS_ROLES` set in team-dispatch; new constant (eval one says "EVAL MODE", needs interactive wording + independent lifecycle). Not a module.
- S3 confined to runCodex only.

## 5. Interactive→eval dependency edge — acceptable
`provider-backends.ts` is already a pure process-mgmt utility (no eval-specific side effects). Keep `team-dispatch.ts` in `evals/src/` (co-located). Moving provider-backends to a shared lib/ is premature — defer.

## 6. Smallest Phase 1 (delivers AC-1/3/4/7/8 + all invariants)
**New (2):** `evals/src/team-dispatch.ts` (~80–100 lines: read brief → resolveEffectiveModel+parseProvider → assert non-claude → session-scoped workDir → runProviderBackend(...,{workDir,keepWorkDir:true}) → validateAgentOutput → TurnResult; CLI entry argv[agent,briefFile,timeout?]→stdout JSON); `**/.dt-delegated/` in .gitignore.
**Modified (2):** provider-backends.ts (+6 additive); commands/team.md (playbook: § Provider Routing + § Delegated Turn Protocol + Shaq-must-be-claude guard).
**Defer:** S7 CodexLiveTurn (Phase 2, gated); non-claude Shaq; AgentTurn classes; bus bridge; S4 as module; runOllama/runGemini S3; per-agent schemas beyond Bird (add to registry as agents validated — don't block Phase 1).

## 7. Net
~137 lines added, 0 deleted, 0 new deps. New exports: `TurnResult` type + `runDelegatedTurn`. New CLI: team-dispatch (the entire external API). Maintenance risk LOW (thin orchestration over tested fns; playbook is prose).

**Tightenings:** (1) drop AgentTurn runtime construct; (2) inline S4; (3) S3 → runCodex only. ~−30 lines, no invariant touched.
