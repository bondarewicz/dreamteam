# Dream Team

Source of truth for all Claude Code agents and commands. Install once, use everywhere.

## What's in the box

**6 agents**, each with a matching `/command`, plus a `/team` orchestrator.

| Agent | Command | Persona | Role | Model | Max Turns |
|-------|---------|---------|------|-------|-----------|
| **mj** | `/mj` | Michael Jordan | Domain Authority & Final Arbiter | haiku | 10 |
| **bird** | `/bird` | Larry Bird | Strategic Systems Architect | haiku | 12 |
| **shaq** | `/shaq` | Shaquille O'Neal | Primary Code Executor | **sonnet** | 30 |
| **kobe** | `/kobe` | Kobe Bryant | Quality & Risk Enforcer | haiku | 15 |
| **pippen** | `/pippen` | Scottie Pippen | Stability, Integration & Defense | haiku | 10 |
| **magic** | `/magic` | Magic Johnson | Context Synthesizer & Team Glue | haiku | 8 |

Only Shaq runs on Sonnet (he writes production code). All other agents use Haiku for fast, low-cost analysis and review.

### Agent capabilities

Each agent has restricted tool access based on its role:

| Agent | Tools | Why |
|-------|-------|-----|
| mj | Read, Grep, Glob, Bash | Domain analysis + business impact assessment |
| bird | Read, Grep, Glob, Bash, WebFetch, WebSearch | Architecture + external research + health diagnostics |
| shaq | All except Task | Full implementer — writes code |
| kobe | Read, Grep, Glob, Bash, Edit | Quality review + can fix critical bugs directly |
| pippen | Read, Grep, Glob, Bash | Stability review — checks runtime |
| magic | Read, Grep, Glob | Synthesis only |

Agents with `memory: user` (kobe, magic) learn across sessions — remembering review patterns, failure modes, and past decisions.

## When to use each agent

### `/mj` — "Is this correct?"

Use MJ when you need to validate business logic or define what "right" looks like before writing code.

- "Are these pricing rules correct?"
- "What are the business rules for refund eligibility?"
- "Define acceptance criteria for the checkout flow"
- "What's the business impact of changing the order lifecycle?"
- "Who are the stakeholders affected by this migration?"

### `/bird` — "How should this be built?"

Use Bird when you need architecture decisions, system design, or health diagnostics on existing code.

- "Should we use event sourcing or CRUD for orders?"
- "Design the component boundaries for the notification system"
- "Our API response times are degrading — what should we investigate?"
- "Review the current architecture for technical debt"
- "What are the trade-offs between these two approaches?"

### `/shaq` — "Build it."

Use Shaq when you have a clear spec and need code written. He implements features, writes tests, and follows existing patterns.

- "Implement this API endpoint per the spec"
- "Add pagination to the user list"
- "Write tests for the discount calculation"
- "Refactor this service to use the repository pattern"
- "Create the database migration for the new schema"

### `/kobe` — "Is this safe to ship?"

Use Kobe when code is written and you need a ruthless quality review before deploying. He also checks production readiness and can fix critical bugs directly.

- "Review this PR for edge cases and race conditions"
- "This handles money — find every way it could break"
- "Is this ready to deploy? Check everything."
- "Review the error handling in the payment service"
- "Check if this migration is safe to run in production"

### `/pippen` — "Will this hold up in production?"

Use Pippen when you need to verify operational readiness — monitoring, observability, resilience, and integration between components.

- "Do we have enough logging to debug this at 3am?"
- "Check if the new service has proper health checks and metrics"
- "Review the retry/timeout configuration"
- "Can we roll this back safely?"
- "How do these three services interact under failure conditions?"

### `/magic` — "Summarize everything."

Use Magic when you need to synthesize multiple perspectives into clear documentation, ADRs, or handoff notes.

- "Summarize all the analysis and implementation work"
- "Document why we chose event sourcing over CRUD"
- "Create an ADR for the authentication redesign"
- "Write handoff notes for the next team"
- "What decisions were made and what's still open?"

### `/team` — "Get the whole squad on it."

Use `/team` when the task is too big for one agent. Coach K coordinates the full Dream Team — from domain analysis through implementation, review, and synthesis.

- **Quick Fix** (subagents): Bug fixes, small features, focused changes
- **Full Team** (agent teams): New features, architecture changes, complex multi-file work

```
/team Add pagination to the user list           # Quick Fix territory
/team Build a real-time notification system      # Full Team territory
/team Fix the race condition in checkout         # Quick Fix territory
```

### Decision tree

```
Need to understand the business rules?         → /mj
Need to design the system?                     → /bird
Need to write the code?                        → /shaq
Need to review the code?                       → /kobe
Need to check production readiness?            → /pippen
Need to document or synthesize?                → /magic
Need the full pipeline (analyze → build → review → document)?  → /team
```

## /team — Coach K Orchestration

The `/team` command launches Coach K, who coordinates the Dream Team. You choose the mode:

### Quick Fix — Subagents (within session)

For bug fixes, small features, and focused changes. Sequential subagents, lower token cost.

```
User ──→ Coach K ──→ MJ (domain) ──→ Shaq (implement) ──→ Kobe (review) ──→ Magic (synthesize)
```

1. **MJ** defines business rules and acceptance criteria
2. **Shaq** implements the code with tests
3. **Kobe** reviews for critical risks (max 3 findings)
4. **Magic** synthesizes everything into a summary

### Full Team — Agent Team (parallel sessions)

For new features, architecture changes, and complex multi-file work. Uses the experimental [agent teams](https://code.claude.com/docs/en/agent-teams) feature — 6 independent Claude Code sessions coordinated by Coach K via shared task list and inter-agent messaging.

```
Phase 1: Analysis & Design
  MJ (domain) ──→ Bird (architecture) ──→ Coach K (task breakdown) ──→ User approval

Phase 2: Implementation & Review
  Shaq (implement) ──→ Kobe + Pippen (parallel review) ──→ Magic (synthesize)
```

1. **MJ** provides full domain analysis, messages Bird when done
2. **Bird** designs system architecture based on MJ's analysis
3. **Coach K** breaks work into tasks, presents plan for user approval
4. **Shaq** implements the full feature
5. **Kobe** + **Pippen** review in parallel (quality + stability)
6. **Magic** synthesizes all outputs into final documentation

**Requirements for Full Team mode:**
- Enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` in settings.json or environment
- Higher token cost (6 independent sessions)
- If not enabled, Coach K falls back to the subagent workflow

### Git Safety

No agent ever commits or pushes. The user controls all git operations.

## Installation

### 1. Clone and install agents

```bash
git clone <this-repo> ~/Github/Bondarewicz/dreamteam
cd ~/Github/Bondarewicz/dreamteam
./install.sh
```

The installer:
1. Backs up existing `~/.claude/agents/` and `~/.claude/commands/`
2. Copies all 6 agent files to `~/.claude/agents/`
3. Copies all 7 command files to `~/.claude/commands/`
4. Removes old files (penny.md, guardian.md, etc.) if present

### 2. Enable agent teams (required for Full Team mode)

Agent teams are an experimental Claude Code feature that lets `/team` spawn 6 parallel sessions. Add this to your `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Without this setting, `/team` still works but falls back to sequential subagents (Quick Fix mode only).

### 3. Restart Claude Code

Start a new session to pick up the agents, commands, and settings.

### Re-installing after changes

Edit agent/command files in this repo, then run `./install.sh` again. Previous files are backed up automatically.

## Repository Structure

```
dreamteam/
├── agents/                    # Agent definitions (6 files)
│   ├── mj.md                  # Domain authority & business impact
│   ├── bird.md                # Systems architect & health diagnostics
│   ├── shaq.md                # Code executor
│   ├── kobe.md                # Quality enforcer & production readiness
│   ├── pippen.md              # Stability & integration
│   └── magic.md               # Context synthesizer
├── commands/                  # Slash commands (7 files)
│   ├── mj.md                  # /mj
│   ├── bird.md                # /bird
│   ├── shaq.md                # /shaq
│   ├── kobe.md                # /kobe
│   ├── pippen.md              # /pippen
│   ├── magic.md               # /magic
│   └── team.md                # /team (Coach K orchestrator)
├── backup/                    # Pre-rename backups of original agents
│   └── pre-rename/
├── dream_team_ai_agents.md    # Original Dream Team specification
├── install.sh                 # Installer script
└── README.md
```

## Customization

All agents live in `agents/` as Markdown files with YAML frontmatter. Edit them directly.

**Frontmatter fields:**
- `name` — Agent identifier (used in `subagent_type` and agent team spawning)
- `description` — When Claude should use this agent (with examples)
- `model` — Claude model to use (`sonnet`, `opus`, `haiku`, `inherit`)
- `color` — Terminal output color
- `tools` — Allowlist of tools (inherits all if omitted)
- `disallowedTools` — Denylist of tools
- `memory` — Persistent memory scope (`user`, `project`, `local`)
- `maxTurns` — Maximum agentic turns before stopping

**Body:** The agent's system prompt — role, responsibilities, guardrails, output format.

After editing, run `./install.sh` to deploy changes.

## Costs

### Model strategy

The Dream Team is optimized for cost: only the agent that writes code (Shaq) runs on Sonnet. All analysis, review, and synthesis agents run on Haiku, which is significantly cheaper and faster.

| Model | Agents | Input (per MTok) | Output (per MTok) |
|-------|--------|------------------|--------------------|
| Haiku | mj, bird, kobe, pippen, magic | $0.80 | $4.00 |
| Sonnet | shaq | $3.00 | $15.00 |

To upgrade an agent's model (e.g., for more complex analysis), edit its `model:` field in the agent file and re-run `./install.sh`.

### Turn limits

Every agent has a `maxTurns` cap to prevent runaway sessions:

| Agent | maxTurns | Rationale |
|-------|----------|-----------|
| mj | 10 | Domain analysis is focused |
| bird | 12 | Architecture needs exploration |
| shaq | 30 | Implementation requires more turns |
| kobe | 15 | Quality review with test runs |
| pippen | 10 | Stability review is focused |
| magic | 8 | Synthesis is the shortest task |

### Prompt caching

Claude Code automatically caches system prompts and long conversations. No configuration needed — you get reduced input costs on repeated content (agent definitions, large file reads, prior context) automatically.

### Tracking usage

- **API users**: `/cost` shows token counts, cache hits, and estimated cost for the current session
- **Claude Max/Pro subscribers**: `/stats` shows usage patterns, session history, and model preferences

Run either after a `/team` session to understand the resource consumption.

## Built-in Tension (by design)

The Dream Team has intentional creative tension:

- **MJ vs Bird** — correctness vs elegance
- **Kobe vs Shaq** — quality vs speed
- **Coach K vs everyone** — shipping vs perfection

This tension is productive. It prevents groupthink and ensures robust solutions.
