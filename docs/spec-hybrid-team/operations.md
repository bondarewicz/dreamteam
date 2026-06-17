# Operations — Hybrid Multi-Provider `/team`
**Author:** Pippen · **Date:** 2026-06-17 · **Confidence: 78.** Verdict: **READY WITH CAVEATS — Phase 1**, 5 ship-blockers.

## 0. New failure domain
Hybrid adds a 2nd execution failure domain: short-lived external CLI processes on separate auth. The eval harness manages it for grading but its posture is WRONG for interactive in 3 ways: (1) auth detection treats a metered key as valid; (2) sandbox teardown `rm`s in `finally`; (3) failures are recorded, not surfaced.

## 1. Timeouts (matrix, not one global)
`timeoutMs` already exists. Defaults `base(provider) × roleClass` in team-dispatch.ts; env + per-pin override.
- codex: analysis 240s / impl 600s · gemini: 120s / disallowed · ollama: 300s / disallowed · claude: native, no kill.
- Ping pre-flight stays 45s (different thing). Ollama cold-start: warmup `/api/chat` at pre-flight OR first turn ×1.5.
- Timeout = fail-loud (AC-9), no auto-retry, no metered re-route. Kill process *group* then SIGKILL after 2s grace; log "would-not-die".
- Config: `TURN_TIMEOUTS[provider][roleClass]` + `DT_TURN_TIMEOUT_MS[_<PROVIDER>]` env + optional frontmatter `timeoutMs`.

## 2. Auth-mode pre-flight — the BR-1 guard (CRITICAL)
`doctor.ts` computes codex auth as `exists(~/.codex) || OPENAI_API_KEY || CODEX_API_KEY` — **backwards for interactive**: presence of `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY` is exactly what silently meters (CLIs prefer key over login). New `assertSubscriptionAuth(provider)` in team-dispatch, run before each delegated turn + at session start:
- codex: REFUSE if `OPENAI_API_KEY`/`CODEX_API_KEY` set (even if login also present — ambiguous precedence unsafe); REQUIRE `~/.codex/auth.json` ChatGPT login.
- gemini: REFUSE if `GEMINI_API_KEY`/`GOOGLE_API_KEY`; REQUIRE `~/.gemini` OAuth.
- claude: REFUSE if `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` (BR-2, hard session-start abort — first line, before routing).
- ollama: local, liveness only.
**Refuse, don't warn** (a warning scrolled past = a metered bill). Reuse `provider-ping.ts` round-trip as liveness half (once per used provider at start). Extend `ProviderCheck` with `authMode: subscription|metered|local|unknown` so /admin/providers + the guard share one truth.

## 3. Mid-session death UX
Signatures team-dispatch must distinguish (recovery differs): never-started (127/PATH) · unauthed · timeout · crash (OOM — ollama!) · empty/prose (Zod-invalid) · ollama-down (ECONNREFUSED :11434).
Coach K surfaces provider-named, signature-specific msg via `AskUserQuestion`. State preserved: completed turns stand; brief file persists (retry/re-pin reuse it); **sandbox KEPT on failure** for debugging; no half-applied repo (promotion only on approval → death always recoverable to "before this turn"). Menu: retry / skip (partial team) / manual re-pin (conscious, never auto) / abort. Never offered: metered fallback, silent Shaq single-shot.

## 4. Observability
Reuse `buildTrace` (native+delegated look identical in viewer). Gaps to add to `TurnResult` + per-session `.dt-delegated/turns.jsonl`: routing provenance (agent→resolved model→which config layer won — #1 "behaved oddly" cause); authMode used (per-turn BR-1 proof); failure-signature enum + exit code + **last 2KB stderr** (currently discarded — has "login expired"/OOM); sandbox manifest/diff; timeout-fired/would-not-die; brief hash+size (detect "worked blind"). External telemetry out of scope (local dev tool); JSONL is the right tier.

## 5. Bus-proxy serialization
Delegated Full Team turns are sequential-with-proxy (Coach K reads result, injects findings into next brief), not peer-concurrent. Bites: latency stacks ~Σ(timeouts) → **mandate per-turn heartbeat** ("starting <agent> on <provider> ≤<timeout>") or user kills a healthy session; no mid-turn cross-talk (fidelity reduction, document it); Coach-K fan-in is a serialization point → cap brief size, curated findings not transcripts. Native claude agents still use the bus → mixed teams have two interaction models. Don't parallelize delegated turns in Phase 1 (sandbox-collision/resource surface).

## 6. Gaps MJ/Bird under-specified
- Sandbox lifecycle: keep-on-failure carve-out; cleanup on ALL exit paths incl abort/crash; `doctor` orphan-sweep of old `.dt-delegated/`; `**/.dt-delegated/` in .gitignore (lives in worktree now).
- **Cross-session ollama OOM blast radius** (→ MJ): ollama is a single shared local server; two sessions loading big models OOM-kill `ollama serve`, killing BOTH sessions. Document as serialized shared resource + doctor warning (don't over-engineer).
- Partial-team **coverage manifest**: Magic's synthesis must carry a first-class section — which agents ran/on which provider/which skipped+why. Silent omission = trust failure.
- Promotion atomicity: copy sandbox→worktree temp-then-rename; interruption leaves worktree unchanged + sandbox intact. Log as discrete event.
- Provider version drift: capture `codex`/`gemini` `--version` at pre-flight (CLIs update independently, can silently break delegated turns).

## 7. Ship-blockers (Phase 1)
1. `assertSubscriptionAuth` refusal guard (§2). 2. `ANTHROPIC_BASE_URL` session-start abort (§2). 3. fail-loud `AskUserQuestion` per signature (§3). 4. sandbox keep-on-failure + promote-only-on-approval + `.dt-delegated/` ignored. 5. stderr+signature+authMode logging (§4). Should-have: heartbeat, coverage manifest, version capture, ollama warmup.
**Escalations:** → MJ cross-session ollama OOM; → Kobe promotion atomicity + codex key-AND-login precedence; → Coach K confirm JSONL is the observability ceiling.
