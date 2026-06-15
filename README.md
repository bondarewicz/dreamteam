# Dream Team

A squad of specialized Claude Code agents — each owns one job (domain rules, architecture, implementation, quality, scope, synthesis) — plus a `/team` orchestrator that runs them as a pipeline from problem statement to reviewed, spec-backed code. Install once into `~/.claude/`, use in every project. The agents are named after the 1992 USA Basketball Dream Team; the personas are a framing device, the roles are real.

> **New here? Start at the site → [bondarewicz.github.io/dreamteam](https://bondarewicz.github.io/dreamteam/)** — it walks the roster, the playbook, and the evals visually. This README is the technical reference: how the pieces actually fit together.

## Repository layout

| Path | What's in it |
|------|--------------|
| `agents/` | One markdown file per agent — YAML frontmatter (config) + body (system prompt). The source of truth. |
| `commands/` | Slash commands (`/team`, `/bird`, `/eventstorming`, …) that wrap the agents. |
| `schemas/` | Zod registry (`agent-schemas.ts`) — the typed output contract enforced at the process boundary. |
| `evals/` | Scenario suites per agent + the TypeScript eval pipeline (`evals/src/`). |
| `scripts/` | Install/sync (`install.ts`), eval baselines (`baseline-eval.ts`, `select-baseline.ts`), hooks, site build. |
| `web/` | Bun server + SQLite that serves eval results for human review. |
| `site/` | The GitHub Pages source (static; deployed by `.github/workflows/deploy-site.yml`). |
| `docs/` | Specs (`spec-<topic>/`) and design notes, including `spec-schema-enforcement/`. |

## How an agent is defined

Each agent is a single markdown file, `agents/<name>.md`: YAML frontmatter is the config, the body is the system prompt (Team Protocol, escalation rules, output schema).

```yaml
---
name: bird
model: claude-opus-4-8     # pinned build, not a floating alias
tools: Read, Grep, Glob, Bash, Skill
maxTurns: 50
# memory: user            # (kobe, magic) — learns across sessions
---
```

| Agent | Command | Role | Model | Tools |
|-------|---------|------|-------|-------|
| **bird** | `/bird` | Domain Authority & Final Arbiter | `claude-opus-4-8` | Read, Grep, Glob, Bash |
| **mj** | `/mj` | Strategic Systems Architect | `claude-opus-4-8` | + WebFetch, WebSearch, Context7, Honeycomb |
| **shaq** | `/shaq` | Primary Code Executor | `claude-sonnet-4-6` | All except Task |
| **kobe** | `/kobe` | Quality & Risk Enforcer | `claude-opus-4-8` | + Edit |
| **pippen** | `/pippen` | Stability, Integration & Defense | `claude-opus-4-8` | Read, Grep, Glob, Bash, Honeycomb |
| **magic** | `/magic` | Context Synthesizer & Team Glue | `claude-sonnet-4-6` | + Write, Edit |
| **drexler** | `/drexler` | Deletion-Bias Enforcer | `claude-sonnet-4-6` | Read, Grep, Glob, Bash |

Coach K (the orchestrator) runs on `claude-opus-4-7`. Models are pinned to specific builds so eval baselines vary only the model version. `maxTurns` is a hard ceiling: shaq runs at `100` (writes code and iterates), drexler at `30` (search-only), the rest at `50`. Per-agent thinking/effort is **not** exposed in frontmatter — to change effective effort, pick a heavier/lighter model or tighten the prompt.

Every agent body enforces four shared contracts: an **output schema** Coach K validates before handoffs, an **escalation protocol** (stop and ask, never guess), a **confidence assessment** (self-reported confidence + assumptions), and the **turn budget** above.

## Install & sync

```bash
git clone <this-repo> ~/Github/Bondarewicz/dreamteam
cd ~/Github/Bondarewicz/dreamteam
bun scripts/install.ts
```

`install.ts` backs up any existing files, then copies `agents/*` → `~/.claude/agents/` and `commands/*` → `~/.claude/commands/`. **Edit the repo source, never `~/.claude/` directly** — that's the copy. Re-run `install.ts` after any edit and restart Claude Code.

Full Team mode needs the experimental flag in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

## Orchestration — `/team`

Coach K curates a focused brief per agent (not a dump of all prior output) and runs one of three modes:

- **Quick Fix (subagents)** — sequential pipeline for bugs/small features: **you author intake** → Bird → Shaq → Kobe + Drexler (parallel) → Magic synthesises the spec → **you sign off**. If Kobe finds bugs or Drexler finds bloat, Shaq fixes and reviewers re-verify — no fix is skipped.
- **PR Review (parallel subagents)** — Bird + MJ + Kobe review the diff in parallel; Coach K synthesizes to `docs/PR-<number>-review.md`. All `gh` commands are READ-ONLY.
- **Full Team (agent teams)** — independent sessions for new features: **intake** → Phase 1 Bird + MJ (concurrent) → Magic handoff brief → Coach K checkpoint + your approval → Shaq implements → Kobe + Pippen + Drexler review (parallel) → Magic consolidates → **you sign off**. Sessions run in isolated git worktrees; checkpoints are saved to disk so earlier work survives. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; falls back to Quick Fix if disabled.

**Git safety:** no agent ever commits or pushes — you control all git operations. Every run drops a checkpoint in `docs/checkpoint-<topic>.md` and an HTML retro in `reports/retros/` (escalations, confidence, fix-verify loops).

### Spec-driven development

A `/team` session produces a multi-authored spec under `docs/spec-<topic>/`, and that spec is the contract. Each agent writes its own artifact in its own voice:

| File | Author | Contents |
|------|--------|----------|
| `intake.md` | **you** | Problem statement, out of scope, constraints (Coach K drafts from your one-liner; you confirm) |
| `domain.md` | Bird | Acceptance criteria |
| `architecture.md` | MJ | Decisions + NFRs |
| `operations.md` | Pippen | Readiness criteria |
| `scope.md` | Drexler | What was deliberately kept out |
| `review.md` | Kobe | Quality findings |
| `spec.md` | Magic | The synthesis — terminology normalised across sections, contradictions flagged not silently resolved |

You sign off on `spec.md` before the session ends; reject it and it's re-synthesised. The `scripts/check-plan.ts` hook advises (never blocks) when `Edit`/`Write` runs with no `intake.md` present.

## Schema enforcement

Agent outputs are typed at the **process boundary**, not by prompt convention. Coach K dispatches a worker as a headless subprocess that carries its own schema:

```
claude -p --system-prompt-file agents/<name>.md --json-schema <flat schema> --output-format json
```

The CLI validates the result against the schema and re-prompts on mismatch, surfacing the validated object in `structured_output`. Two findings drive the design (see `docs/spec-schema-enforcement/`):

- `structured_output` populates reliably only for **flat** schemas — hoist wrapper objects to top-level prefixed keys and you keep every field. Depth is the limiter, not field count.
- The `--agent <name>` path doesn't bind the validator (GitHub #20625, closed); `--system-prompt-file` does.

`schemas/agent-schemas.ts` is the single Zod registry; a code-level Zod normalization layer (`evals/src/normalize-output.ts`) is the deterministic safety net.

## Evals

Every code-touching agent has a scenario suite under `evals/<agent>/` — happy paths, edge cases, escalation cases, adversarial inputs. Each scenario file declares four fields:

```
prompt:            the input given to the agent
expected_behavior: what correct output looks like (observable, not vague)
failure_modes:     specific anti-patterns
scoring_rubric:    pass / partial / fail criteria
```

The pipeline is a deterministic TypeScript CLI (`evals/src/cli.ts`), not in-context orchestration. Per run it: ① spawns each agent in parallel (`claude -p`), ② runs zero-LLM deterministic graders, ③ scores each output against its rubric with a pinned Coach K judge, ④ writes results to the web viewer's SQLite DB.

```bash
/eval                                         # run + auto-score, then open the web app for review
bun evals/src/cli.ts --trials 3               # run directly; --trials samples each scenario N times
bun evals/src/cli.ts --model claude-opus-4-7  # A/B a model under test without editing frontmatter
```

`--model` affects only the agents under test; the scoring judge stays on the default so comparisons share a baseline.

**Web viewer** — `web/` serves results from `data/dreamteam.db` and auto-imports JSON from `evals/results/` on first run:

```bash
cd web && bun install && bun run start    # http://localhost:3000
bun run dev                               # hot reload
```

Scenarios can also be exported to [Anthropic Workbench](https://platform.claude.com/workbench) via `bun evals/src/workbench-export.ts <agent>`. See `evals/README.md`.

### Baseline eval (model bake-off)

All scenarios × 3 models burns a Max plan's weekly limit in one sitting, so the baseline runs a **subset of scenarios where models actually diverge** — ranked by the pass/partial/fail entropy of each scenario across past runs (always-green guardrails and all-fail floors separate nothing and are dropped). `scripts/baseline-eval.ts` validates every id before spending a token, pins the judge to Sonnet for a constant scoring baseline, and runs models sequentially with a Sonnet canary that aborts the moment a run trips the session limit — so a hit cap costs one model, not the whole window.

```bash
bun scripts/baseline-eval.ts              # all 3 models (Sonnet canary first), trials 2
bun scripts/baseline-eval.ts --dry-run    # validate the subset, spend zero quota
bun scripts/baseline-eval.ts --list       # print the subset and exit
bun scripts/select-baseline.ts            # re-derive the ranked discriminator subset
```

Trials default to 2 — a single trial undersamples and makes scenarios look falsely unanimous across models.

## MCP tools

Agents are granted tools liberally, so **any MCP server connected to Claude Code just works** — no per-agent wiring. For example, MJ and Shaq pull version-specific library docs from [Context7](https://context7.com) before writing code, and the team reads/writes [Miro](https://miro.com) boards. Add servers the usual way; keys live in `~/.claude.json` (User scope), never the repo:

```bash
claude mcp add --transport http context7 https://mcp.context7.com/mcp --header "CONTEXT7_API_KEY: <key>" -s user
claude mcp add --transport http miro https://mcp.miro.com
```

`/eventstorming` builds a [Brandolini](https://leanpub.com/introducing_eventstorming)-style Event Storm directly on a Miro board using the canonical colour notation and build order (`as-is` / `to-be` / `both`, or `--recipe` to print the notation reference). It returns the board URL plus a summary, saved to `docs/eventstorms/` if that directory exists (Miro URLs rot; a checked-in summary survives).

## License

MIT — see [LICENSE](LICENSE). Agent names and jersey numbers are used affectionately as a framing device; this project is not affiliated with, endorsed by, or sponsored by the NBA, USA Basketball, the named players or their estates, Chuck Daly's estate, or Coach Mike Krzyzewski.
