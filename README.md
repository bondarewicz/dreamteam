# Dream Team

Source of truth for all Claude Code agents and commands. Install once, use everywhere.

## What's in the box

**6 agents**, each with a matching `/command`, plus a `/team` orchestrator and `/code-review` for automated PR reviews.

| Agent | Command | Persona | Role | Model | Tools |
|-------|---------|---------|------|-------|-------|
| **bird** | `/bird` | Larry Bird | Domain Authority & Final Arbiter | `claude-opus-4-7` | Read, Grep, Glob, Bash |
| **mj** | `/mj` | Michael Jordan | Strategic Systems Architect | `claude-opus-4-7` | + WebFetch, WebSearch |
| **shaq** | `/shaq` | Shaquille O'Neal | Primary Code Executor | `claude-opus-4-7` | All except Task |
| **kobe** | `/kobe` | Kobe Bryant | Quality & Risk Enforcer | `claude-opus-4-7` | + Edit |
| **pippen** | `/pippen` | Scottie Pippen | Stability, Integration & Defense | `claude-opus-4-7` | Read, Grep, Glob, Bash |
| **magic** | `/magic` | Magic Johnson | Context Synthesizer & Team Glue | `claude-opus-4-7` | + Write, Edit |

Coach K (the orchestrator) runs on `claude-opus-4-7`. All agents are pinned to specific model builds rather than floating aliases so eval baselines stay reproducible across versions. Kobe and Magic carry `memory: user` and learn across sessions.

### Cross-cutting agent features

- **Output schema** — structured fields Coach K validates before handoffs (prevents agents talking past each other).
- **Escalation protocol** — each agent knows when to stop and ask instead of guessing.
- **Confidence assessment** — self-reported confidence + assumptions, so downstream agents can calibrate trust.
- **Turn budget** — hard limits force agents to ship instead of researching forever.

## When to use what

| Command | When to reach for it |
|---------|---------------------|
| `/bird` | Validate business logic or define what "right" looks like |
| `/mj` | Architecture decisions, system design, health diagnostics |
| `/shaq` | Clear spec, need code written |
| `/kobe` | Code is written, need ruthless quality review |
| `/pippen` | Verify operational/production readiness |
| `/magic` | Synthesize perspectives into docs/ADRs |
| `/team` | Task too big for one agent — full pipeline |
| `/team` + Miro | Visual architecture & DDD on a board |
| `/code-review` | Automated PR review (local-only output) |

## /team — Coach K Orchestration

Coach K coordinates the team in three modes:

- **Quick Fix (subagents)** — sequential pipeline for bugs and small features: Bird → Shaq → Kobe → Magic. Coach K curates a focused brief per agent instead of dumping all prior outputs. If Kobe finds issues, Shaq fixes and Kobe re-verifies — no fixes are skipped.
- **PR Review (parallel subagents)** — Bird + MJ + Kobe review the diff in parallel, Coach K synthesizes to `docs/PR-<number>-review.md`. All `gh` commands are READ-ONLY; nothing is posted to GitHub.
- **Full Team (agent teams)** — 6 independent sessions for new features and complex multi-file work. Phase 1 Bird + MJ analysis (concurrent) → Magic handoff brief → Coach K checkpoint + user approval → Shaq implements → Kobe + Pippen review (parallel) → Magic synthesis. Checkpoints saved to disk so earlier work isn't lost. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; falls back to Quick Fix if disabled.

**Git safety:** no agent ever commits or pushes. The user controls all git operations.

**Retros:** every `/team` run produces a checkpoint in `docs/checkpoint-<topic>.md` and an HTML retro in `reports/retros/` with team metrics (escalations, confidence, fix-verify loops).

## /code-review — Automated PR Review

Based on the [official Claude Code code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review), adapted for local-only output. Launches CLAUDE.md-compliance + bug-detector agents in parallel, plus validation agents to reduce false positives. Output stays in the terminal — nothing is posted to GitHub.

```
/code-review 42        # Review PR #42
/code-review           # Review current branch's PR
```

## Installation

```bash
git clone <this-repo> ~/Github/Bondarewicz/dreamteam
cd ~/Github/Bondarewicz/dreamteam
bun scripts/install.ts
```

The installer backs up existing files, then copies agents to `~/.claude/agents/` and commands to `~/.claude/commands/`. Re-run `bun scripts/install.ts` after any edit and restart Claude Code.

For Full Team mode, add to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

## Models & Tuning

The `model:` field in each `agents/*.md` is the source of truth. Edit it and run `bun scripts/install.ts` to apply.

**Strategy:** quality-first, with each agent on the model matching its reasoning demands. Pinning every agent to a specific build (e.g. `claude-opus-4-7`) lets us run full evals against an identical config — the only variable between runs is the model version.

**A/B a single run** without editing frontmatter: `bun evals/src/cli.ts --trials 3 --model claude-opus-4-7`. The flag only affects phase-1 agent runs; the Coach K scoring judge stays on the default so comparisons share a baseline.

**Effort note:** Claude Code subagent frontmatter does **not** expose a per-agent thinking/effort dial. Effort is governed globally by adaptive thinking — do **not** set `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`. To raise or lower an agent's effective effort, choose a heavier/lighter model or tighten the prompt.

**Turn limits:** shaq runs at `maxTurns: 100` (it writes code and iterates); the rest at `50`.

**Tuning quick reference:**

| If you notice... | Try... |
|-----------------|--------|
| Hitting rate limits on Full Team | Downgrade bird/mj/magic to a sonnet build |
| Kobe's findings feel shallow | Keep on opus — quality is where depth matters most |
| Shaq/Pippen quality is great | Consider a sonnet build to save rate limits |

## Web Eval Viewer

`web/` is a Bun server that serves eval results from SQLite (`data/dreamteam.db`) and auto-imports JSON results from `evals/results/` on first run.

```bash
cd web && bun install && bun run start    # opens http://localhost:3000
bun run dev                               # hot reload
PORT=8080 bun run start                   # change port
```

Eval scenarios can also be exported to [Anthropic Workbench](https://platform.claude.com/workbench) via `bun evals/src/workbench-export.ts <agent>`. See `evals/README.md`.

## Miro Integration

The Dream Team integrates with [Miro](https://miro.com) via MCP. Agents can read board context, create diagrams (flowchart, UML, ER), write documents, and build tables — turning analysis into visual artifacts.

**Setup:**

```bash
claude mcp add --transport http miro https://mcp.miro.com
claude mcp list
claude mcp authenticate miro
```

**Example — DDD event storming from a Miro board:**

```
/team come up with implementation plan for https://miro.com/app/board/<BOARD_ID>/
```

Bird + MJ read the board and produce domain + architecture analysis; Coach K writes back event storming flowcharts, service decomposition diagrams, sequence diagrams, and document cards. See the [demo board](https://miro.com/app/board/<BOARD_ID>/).

## Built-in Tension (by design)

- **Bird vs MJ** — correctness vs elegance
- **Kobe vs Shaq** — quality vs speed
- **Coach K vs everyone** — shipping vs perfection

The tension prevents groupthink.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

Agent names and jersey numbers are used affectionately as a framing device. This project is not affiliated with, endorsed by, or sponsored by the NBA, USA Basketball, the named players or their estates, Chuck Daly's estate, or Coach Mike Krzyzewski.
