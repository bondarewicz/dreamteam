# Intake — Hybrid multi-provider `/team`

**Author:** user (via Coach K intake)
**Date:** 2026-06-17
**Topic:** Run `/team` interactively across all four providers without losing any subscription.

## Problem statement

Today `/team` runs only on Claude (via Claude Code). We want to run the same
agent roster interactively on **any** provider — Claude, Codex, Gemini, Ollama —
choosing per agent (the tier/pin system from Phase 3B already expresses this).
The cross-provider **eval** path already works; the **interactive** path does not.

## Hard constraints (all must hold)

1. **Claude stays on the Max subscription.** Never bill the Anthropic API.
2. **Codex stays on the ChatGPT subscription** (`codex` CLI). Never bill the OpenAI API.
3. **Gemini** via its CLI (free tier / its own auth).
4. **Ollama** local.
5. **Interactive `/team`** — the orchestrated SDD/quick-fix flow, not just single-shot evals.
6. Per-agent provider selection (reuse the existing tier/pin model spec).

## Decision already made (do not re-litigate)

**The proxy approach is ruled out.** A session-wide `ANTHROPIC_BASE_URL` proxy
(LiteLLM / claude-code-router / custom) forces Claude calls to the Anthropic API
(loses Max) and can only reach GPT via the paid OpenAI API (loses the ChatGPT
sub). Both Max and ChatGPT-Codex are subscription/CLI-only — not proxy-able.
A single global base_url also can't route per-agent. → Proxy fails constraints 1 & 2.

## Chosen direction (to be specified by the team)

**Hybrid delegation.** Claude Code remains the orchestrator, running on Max
natively (no base_url change). Coach K runs each agent on its pinned provider:
- pinned to claude → normal Claude subagent (Max)
- pinned to codex/gemini/ollama → delegate that agent's turn to its **first-party
  CLI** (`codex exec`, `gemini`, ollama API) — i.e. reuse `evals/src/provider-backends.ts`,
  which already drives all four on native auth.

Because no session-wide base_url is set, Max is preserved for Claude agents +
Coach K; non-Claude agents run as external CLI processes on their own subs/local.

## What the team must produce

- **Bird (domain):** what "correct" means here — invariants (never bill metered API,
  subscription integrity, per-agent routing fidelity, result-contract preservation),
  acceptance criteria, escalations.
- **MJ (architecture):** where delegation hooks into `/team`; the agent-turn interface;
  how a delegated (single-shot-ish) provider turn folds back into the interactive
  pipeline (briefs, checkpoints, reviewer loop); reuse vs. new code.
- **Pippen (operations):** failure modes (CLI missing/unauthed/timeout), observability,
  graceful degradation, what happens mid-session if a provider dies.
- **Drexler (scope):** what already exists (provider-backends, tiers/pins, traces) and
  must NOT be rebuilt; the smallest version that delivers the constraints.
- **Kobe (quality/risk):** edge cases, the riskiest assumptions (local-model tool-use,
  context hand-off fidelity, codex's internal loop vs. a live subagent).
- **Magic (synthesis):** the unified `spec.md` the user signs off on.

## Known reusable assets

- `evals/src/provider-backends.ts` — `runProviderBackend` drives ollama/gemini/codex on native auth (single-shot today).
- `evals/src/agent-runner.ts` — `resolveEffectiveModel` (tier/pin → provider/model), per-agent dispatch.
- `scripts/model-tiers.ts` + agent frontmatter — per-agent provider/model pins.
- The `--provider` eval flow proves per-agent cross-provider execution end to end.

## Open question for the team

A delegated `codex exec` / ollama / gemini turn is "brief + context in → structured
result out" (codex runs its own internal agentic loop inside the exec). Is that an
acceptable substitute for a live Claude subagent inside `/team`, or does the
interactive flow need genuine multi-turn tool use from non-Claude agents? (MJ +
Kobe to assess.)
