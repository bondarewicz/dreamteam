# Quality & Risk Review — Hybrid Multi-Provider `/team`
**Author:** Kobe · **Date:** 2026-06-17 · **Verdict: SHIP Phase 1 WITH FIXES. BLOCK Phase 2 / S7 as designed.**
Findings verified against live `codex-cli 0.140.0` on this machine (not from memory).

## CRITICAL-1 — Phase-2 approval-before-write is a FICTION (BR-5) → escalate to MJ
MJ's S7 ("turn 1 = plan no writes → checkpoint → resume to write") does NOT hold against the real codex CLI:
- `codex exec` runs an internal agentic loop that **writes files within a single turn**, gated only by `--sandbox`. Current `runCodex` uses `--sandbox workspace-write` *because* read-only makes implementers give up. Writes ARE the turn.
- The only approval flag `-a/--ask-for-approval on-request` is **model-discretionary** ("model decides when to ask"), not a deterministic pre-write gate. Help says use `on-request` for interactive, `never` for non-interactive. **`codex exec` is non-interactive: no TTY, no channel for Coach K (separate process) to answer an approval prompt** → it hangs to timeout or writes without asking.
- `codex exec resume --help`: **no `--ask-for-approval`, no plan-mode, no stop-before-write flag.** "Plan then resume to write" relies on prompt-instructing the model not to write — unenforceable.
**Mandate:** the only viable S7 is `--sandbox read-only` for turn 1; the gate must PROVE read-only turn 1 still yields an approvable plan, **3/3 trials with filesystem instrumentation** (not "the eval looked fine"). Until then S7 is blocked. → architectural_concern routed to MJ.

## CRITICAL-2 — Metered-API leak vectors the base_url guard misses
Inherited `OPENAI_API_KEY` → codex silently bills OpenAI on sub rate-limit; `~/.codex/config.toml` provider override; gemini free→paid fallback; BR-8 fallback ladder as latent leak. Negative base_url check insufficient. **Mandate a per-provider POSITIVE auth-mode pre-flight that fails loud unless the turn is provably on subscription/local auth, with a scrubbed child env** (strip metered keys from the spawned process env).

## CRITICAL-3 — Zod validates shape, not truth; `cost_usd:0` unfalsifiable
Schema-valid-but-empty; hallucinated `files_changed[].content` from a role with no live repo; confidence-faking; hardcoded `cost_usd:0` **cannot detect a metered leak**. Mandate: non-emptiness assertions, cited-path existence checks, confidence caps in the code gate, and `$0` asserted only after auth is proven (ties to CRITICAL-2).

## HIGH
- H-1: sandbox cleanup race + `worktree-cleanup.ts` uncommitted-changes abort tripping on `.dt-delegated/` → ignore it AND exempt from the abort check.
- H-2: timeout-kill orphans codex child writers (parent dies, child keeps writing sandbox) → process-group kill (matches Pippen §1.4).
- H-3: bus-proxy serialization degrades ADVERSARIAL reviewers (a delegated Kobe can't probe a delegated MJ mid-flight) → reviewers that need live verification should stay claude-native.

## Challenge to MJ's "safe single-shot" table
MJ/Kobe/Pippen/Drexler are **NOT pure functions of a brief** — their correctness can depend on reading the live repo + running tools. Proof: these critical findings came from running `codex --help` + reading `worktree-cleanup.ts` — a single-shot delegated reviewer would have hallucinated them. **Single-shot is safe for these roles ONLY when the brief fully inlines what's under review AND no live verification is required.** Otherwise keep them claude-native (or ensure the brief carries the full artifact + a "do not assert anything you cannot see in this brief" instruction).

## Escalation
type: `architectural_concern` → MJ (Phase-2 approval mechanism). Phase-1 confidence high; Phase-2 confidence capped by CRITICAL-1.
