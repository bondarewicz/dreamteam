# Archived eval scenarios

These scenarios are **not run** by the eval harness. The runner (`evals/src/discovery.ts`)
skips any `evals/` entry whose name starts with `.`, so this whole tree is invisible to
`bun evals/src/cli.ts`. Nothing here is deleted — restore a scenario by moving it back to
`evals/<agent>/`.

## Why these were archived (2026-06-16)

The active suite was trimmed from **157 → 40 scenarios** to cut usage/limits while keeping a
high-signal baseline. Selection was grounded in recorded score history across all runs in
`evals/results/`, keeping per agent:

- the **hardest standing gaps** (scenarios that always fail — best regression sentinels),
- the **genuine discriminators** (high score variance across runs, n ≥ 9),
- the **must-NOT-trigger controls** (false-positive guards), and
- one **C# variant** for each code-touching agent.

Archived scenarios were either **saturated** (always pass → low marginal signal) or
**batch-redundant** (large blocks sharing an identical fail-rate, i.e. they discriminate
between model tiers identically — keeping a few representatives loses ~no signal).

## `team/` scenarios — retired, not just trimmed

`team/scenario-*` (full `/team` orchestration runs) are retired as a quality signal. A re-run
has **no live message bus**, so the agents can't actually collaborate — it isn't like-for-like
with a real `/team` session. `/team` quality is now measured by **session evals** (retrospective
LLM-judge over the real recorded session trace — the bus already happened, it's in the trace).
See `docs/session-evals-design.md`. Kept here only as reference / a possible wiring smoke-test.

To run an archived scenario ad hoc, move it back:

```bash
git mv evals/.archive/kobe/scenario-07-memory-leak.md evals/kobe/
```
