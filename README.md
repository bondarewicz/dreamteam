# Dream Team

Source of truth for all Claude Code agents and commands. Install once, use everywhere.

## What's in the box

**10 agents**, each with a matching `/command`. Two categories:

### Standalone Agents (project-specific knowledge)

These agents carry project-specific context (Willow, Cocobolo) and work independently.

| Agent | Command | Role | Color |
|-------|---------|------|-------|
| **guardian** | `/guardian` | Production readiness reviewer | blue |
| **architect** | `/architect` | System health & technical strategy | red |
| **analyst** | `/analyst` | Business impact & requirements analysis | yellow |
| **frontend** | `/frontend` | UI architecture & React specialist | purple |

### Dream Team Agents (general-purpose)

These agents are project-agnostic. Use individually via their command, or together via `/team`.

| Agent | Command | Persona | Role | Color |
|-------|---------|---------|------|-------|
| **mj** | `/mj` | Michael Jordan | Domain Authority & Final Arbiter | red |
| **bird** | `/bird` | Larry Bird | Strategic Systems Architect | green |
| **shaq** | `/shaq` | Shaquille O'Neal | Primary Code Executor | purple |
| **kobe** | `/kobe` | Kobe Bryant | Quality & Risk Enforcer | cyan |
| **pippen** | `/pippen` | Scottie Pippen | Stability, Integration & Defense | magenta |
| **magic** | `/magic` | Magic Johnson | Context Synthesizer & Team Glue | yellow |

### Agent capabilities

Each agent has restricted tool access based on its role:

| Agent | Tools | Why |
|-------|-------|-----|
| mj | Read, Grep, Glob | Analysis only — no code changes |
| bird | Read, Grep, Glob, Bash | Needs shell for dependency checks |
| shaq | All except Task | Full implementer — writes code |
| kobe | Read, Grep, Glob, Bash | Review only — can run tests |
| pippen | Read, Grep, Glob, Bash | Stability review — checks runtime |
| magic | Read, Grep, Glob | Synthesis only |
| guardian | Read, Grep, Glob, Bash, Edit | Reviewer + critical bug fixes |
| architect | Read, Grep, Glob, Bash, WebFetch, WebSearch | Strategy needs external research |
| analyst | Read, Grep, Glob, Bash | Business analysis from code |
| frontend | All except Task | Hands-on UI specialist |

Agents with `memory: user` (guardian, kobe, magic) learn across sessions — remembering review patterns, failure modes, and past decisions.

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

## Usage

```bash
# Use any agent directly via its command
/guardian                   # Production readiness review
/architect                  # System health analysis
/analyst                    # Business impact analysis
/frontend                   # Frontend architecture guidance
/mj                         # Domain analysis
/bird                       # Architecture design
/shaq                       # Code implementation
/kobe                       # Quality review
/pippen                     # Stability review
/magic                      # Synthesis & documentation

# Use the full Dream Team via /team
/team Add pagination to the user list      # Coach K asks: Quick Fix or Full Team?
/team Build a real-time notification system
/team Fix the race condition in checkout
```

## Installation

### 1. Clone and install agents

```bash
git clone <this-repo> ~/Github/Bondarewicz/dreamteam
cd ~/Github/Bondarewicz/dreamteam
./install.sh
```

The installer:
1. Backs up existing `~/.claude/agents/` and `~/.claude/commands/`
2. Copies all 10 agent files to `~/.claude/agents/`
3. Copies all 11 command files to `~/.claude/commands/`
4. Removes old files (penny.md, etc.) if present

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
├── agents/                    # Agent definitions (10 files)
│   ├── guardian.md            # Standalone: production readiness
│   ├── architect.md           # Standalone: system health
│   ├── analyst.md             # Standalone: business impact
│   ├── frontend.md            # Standalone: UI architecture
│   ├── mj.md                  # Dream Team: domain authority
│   ├── bird.md                # Dream Team: systems architect
│   ├── shaq.md                # Dream Team: code executor
│   ├── kobe.md                # Dream Team: quality enforcer
│   ├── pippen.md              # Dream Team: stability & integration
│   └── magic.md               # Dream Team: context synthesizer
├── commands/                  # Slash commands (11 files)
│   ├── guardian.md            # /guardian
│   ├── architect.md           # /architect
│   ├── analyst.md             # /analyst
│   ├── frontend.md            # /frontend
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

## Built-in Tension (by design)

The Dream Team has intentional creative tension:

- **MJ vs Bird** — correctness vs elegance
- **Kobe vs Shaq** — quality vs speed
- **Coach K vs everyone** — shipping vs perfection

This tension is productive. It prevents groupthink and ensures robust solutions.
