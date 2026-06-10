# web

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Opens at http://localhost:3000 (set `PORT` to override). `bun test` runs the suite.

## Features

### Eval dashboard (Type-A — agent capability evals)
Dashboard, scenario browser/editor, and run viewer for the agent capability evals
(`/`, `/scenarios`, `/evals/:runId`). Regression-tests agent *specs*.

### Sessions (Type-B — session evals)
Browse and score real Claude Code sessions, rehydrated from `~/.claude/projects/*/*.jsonl`
across **all** projects (excludes `dreamteam-evals` + headless sessions).

- **`/sessions`** — index across all projects (project picker, pagination). Parsed on demand,
  cached by file mtime.
- **`/sessions/:project/:id`** — session detail, 4 tabs:
  - **Chat** — conversation (assistant text as Markdown, images as thumbnails + lightbox)
  - **Trace** — turn-grouped execution with expandable tool calls; raw-records fold-out
  - **Details** — time range, branch, model, token usage, file changes (+/− from edits), tool rollup
  - **Evaluation** — the Coach K session score (see below)

#### Session evals (Coach K judge)
On the **Evaluation** tab, **Evaluate** runs a headless Coach K LLM-judge over the session
transcript against a **14-question / 5-category rubric** (Safety · Plan · Correctness · Integrity ·
Efficiency). **Safety is a veto gate** — any Safety `fail` fails the whole session regardless of
other categories. Each question gets `pass`/`warn`/`fail`/`n-a` + an evidence quote; scoring is
**computed deterministically in TS**, not by the model. Results persist to a `session_evals` table
(cached; **Re-evaluate** to refresh).

#### Judge prompt & calibration (Admin)
- **Admin → Session Judge Prompt** (`/admin/session-judge`) — edit the judge as **structured
  sections** (role, verdict definitions, rules, per-question wording). Categories/weights/veto and
  the output format are generated from `RUBRIC` in code (they drive scoring). Editing bumps
  `prompt_version`, marking past scores stale.
- **Admin → Judge Calibration** (`/admin/session-judge/calibration`) — "eval the evaluator": run
  the judge over **frozen, human-labeled** sessions and measure agreement (mechanical, no second
  LLM). Shows agreement %, a per-question ✓/✗ grid, and judge bias. **Add to calibration** on any
  session's Evaluation tab to seed a new scenario.

#### Automatic evals at session end (`SessionEnd` hook)
After `bun scripts/install.ts`, a `SessionEnd` hook (`scripts/session-eval-hook.ts`)
auto-runs the judge when **any** Claude Code session ends, so future sessions show up
**already scored** in `/sessions` — no manual click. The **Evaluate** button stays for
past/backlog sessions you pick. The hook is non-blocking (detached worker) and skips
trivial/headless/already-scored sessions (`DREAMTEAM_EVAL_MIN_TOOLS`, default 4).
Disable with `DREAMTEAM_AUTO_EVAL=0`; progress in `~/.claude/dreamteam-auto-eval.log`.
(Auto-eval **scores** only — feeding findings into memory is a future step.)

Full design + rationale: [`../docs/session-evals-design.md`](../docs/session-evals-design.md).

#### Runtime data (`web/data/`, gitignored except seeds)
- `dreamteam.db` — SQLite (eval runs + `session_evals`), auto-created
- `session-judge.json` — saved judge prompt config (default used if absent)
- `calibration/*.json` — calibration scenarios (seeds committed)
