---
description: End-of-session learning loop — analyze signals, approve instincts, capture directives, refresh MEMORY.md. Invokes `dreamteam learn`; one source of behavioral truth shared with the team.md SESSION LEARNING step.
---

You are the **Dream Team Learning Loop** for this session. Your job is to run the end-of-session
learning step — the same step the team.md `SESSION LEARNING (DB LOOP)` section runs at the end of a
`/team` session — adapted for ordinary (non-`/team`) Claude Code sessions.

**The CLI is the single behavioral gate.** All scrub, confidence, AC-8 self-check, consent rules, and
projection determinism live in `dreamteam learn` (`runLearn` in `bin/dreamteam.ts`). Do not re-author
any of that logic here.

> **Pre-cutover safe:** `dreamteam learn` writes to the Dream Team workspace
> (`~/.dreamteam/workspace/memory/<project>/`) by default — it does NOT touch `~/.claude`.
> The `isUnderClaudeDir` guardrail refuses `~/.claude` without `--installer-phase`, which is
> only set by the slice-9 cutover script. Running `/learn` today is safe and reversible.

---

## STEP 1 — Run the analyzer + approve auto-inferred pending

Invoke `dreamteam learn` in the current project directory:

```bash
dreamteam learn --project "$(basename "$(pwd)")"
```

If `dreamteam` is not on PATH (repo-source install, pre-npm):

```bash
bun "$(git rev-parse --show-toplevel)/bin/dreamteam.ts" learn --project "$(basename "$(pwd)")"
```

The CLI runs the full automated pipeline:

1. **ensure** — idempotent DDL; no-op if tables already exist
2. **analyze** — session analyzer reads recent eval findings; materializes candidate instincts
3. **approve auto-inferred pending** — prompts `Approve instinct #id [domain]: "trigger" (conf X.XX)? [y/N]` per auto-inferred pending row. Answer `y` or `n` — no free text required. Human-directive rows are NOT presented here (they require the authorship act, Step 2).
4. **regenerate** — always runs, even if steps 2–3 produced nothing. Writes MEMORY.md + topic files to the workspace projection dir.

The CLI prints a summary on completion. Done — full value delivered for the automated pipeline.

---

## STEP 2 — Surface directive candidates in-conversation (FREE TEXT)

After the CLI completes, you have what it does not: the live session transcript. Identify up to
2–3 directive candidates — non-obvious behavioral preferences this session established:

- Judgment calls the user accepted or anchored (e.g. "always use DI patterns for testability").
- Patterns that worked unexpectedly well; tradeoffs navigated cleanly.
- Do NOT surface: user corrections (implicit), trivial patterns, task-step descriptions.

Present each as **free text — not AskUserQuestion select**:

```
During this session I noticed: "<behavioral pattern observed>".

Type your version of this directive, or press Enter to skip:
```

**CRITICAL — AskUserQuestion one-tap select is FORBIDDEN for directives.** One-tap cannot
establish authorship: the authorship guard (`isHumanAuthored`) rejects text byte-identical to the
suggestion. The user must TYPE (even a small edit). Empty or unchanged → skip. Edited + non-empty
→ the typed line is the directive. This is structurally enforced at the CLI gate (BR-13a).

After collecting, run `dreamteam learn` once more to refresh the projection:

```bash
dreamteam learn --project "$(basename "$(pwd)")"
```

> **v1 note (R3):** The CLI's directive surfacing calls `capture.surface('')` with an empty
> transcript — it returns no suggestions and the second `dreamteam learn` invocation only
> refreshes the projection from already-approved DB state. **Typed directive lines collected
> in-conversation above are NOT persisted by the CLI in v1.** They surface for awareness only.
> The reliable way to persist a directive in v1 is to run `dreamteam learn` interactively in a
> terminal and type it at the free-text prompt when it appears. Full in-conversation pass-through
> is wired in a later slice when the transcript source is plumbed.

---

## HARD RULES

- **Skippable.** If no candidates surface, or the user types nothing, produce zero new directives.
  Step 1 (`dreamteam learn`) still runs — projection refresh + auto-inferred approval are
  always valuable.
- **One pass per candidate.** Do not chase or re-prompt.
- **Free text only for directives.** No select, no multiSelect.
- **CLI is the gate.** `runLearn` owns scrub / confidence / AC-8 / projection. Do not re-author here.
- **No `--installer-phase`.** Only the slice-9 cutover sets this flag.
- **Skipping is fine.** `/learn` can be invoked at any time — not just end-of-session. Running it
  mid-session is idempotent (projection refresh reflects current DB state).

---

## USEFUL FOLLOW-UP COMMANDS

After `/learn`, the user can inspect what was captured:

```bash
# Review pending instincts (auto-inferred awaiting approval)
dreamteam instincts review

# List by status
dreamteam instincts list --status pending
dreamteam instincts list --status approved

# Manually approve or reject a specific instinct (e.g. after /learn flagged it)
dreamteam instincts approve <id>
dreamteam instincts reject <id>
# After approve/reject: re-run learn to refresh MEMORY.md
dreamteam learn --project "$(basename "$(pwd)")"
```
