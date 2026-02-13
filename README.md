# 🏀 Dream Team AI Agents

A multi-agent AI system for complex software development tasks, inspired by the 1992 Olympic Dream Team. Seven specialized AI agents work together through OpenCode to deliver championship-level results.

---

## 📖 Table of Contents

1. [Quick Start](#-quick-start)
2. [Team Philosophy](#-team-philosophy)
3. [The Team Lineup](#-the-team-lineup)
4. [How It Works](#-how-it-works)
5. [Installation](#-installation)
6. [Usage](#-usage)
7. [Safety Features](#-safety-features)
8. [Workflow Details](#-workflow-details)
9. [Examples](#-examples)
10. [Configuration](#-configuration)
11. [Troubleshooting](#-troubleshooting)
12. [Architecture](#-architecture)
13. [Future Development](#-future-development)

---

## 🚀 Quick Start

### Installation
```bash
cd ~/Github/Bondarewicz/dreamteam
./install-opencode-fixed.sh
source ~/.zshrc
```

### Usage
```bash
# From any directory
cd ~/your-project
dt "analyse and fix bug where postcode 0299 cannot be used"

# Or in OpenCode session
opencode
> Execute Dream Team for: add user authentication with JWT tokens
```

### What Happens
1. **Planning Phase** → Jordan, Bird, Coach K analyze and plan
2. **⏸️ Checkpoint** → You review and approve the plan
3. **Implementation Phase** → Shaq, Kobe, Pippen execute and review
4. **Synthesis** → Magic summarizes everything
5. **YOU commit manually** → Full control over git

---

## 🥇 Team Philosophy

- **Humans own intent and values**
- **AI agents execute, challenge, and accelerate**
- **Clear role boundaries prevent chaos**
- **Tension is intentional and productive**

This team mirrors the original Olympic Dream Team:
- Superstars with **distinct strengths**
- One shared objective: **win decisively**
- No politics, no ego protection — only results

> **AI accelerates execution. Humans own meaning. Championships are won by systems, not stars alone.**

---

## 🏆 The Team Lineup

### 🐐 Michael Jordan — *Domain Authority & Final Arbiter*
**Role:** Business Truth Holder

**Responsibilities:**
- Owns domain language, rules, and invariants
- Defines what is *correct* vs merely *working*
- Approves or rejects solutions based on business reality
- Prevents domain drift and accidental complexity

**Key Questions:**
- Is this faithful to the business?
- What rule are we encoding here?
- What must never break?

**Temperature:** 0.3 (precise) | **Authority:** Final say on domain correctness

---

### 🧠 Magic Johnson — *Context Synthesizer & Team Glue*
**Role:** Shared Understanding & Communication

**Responsibilities:**
- Synthesizes outputs from all agents
- Maintains shared context and decisions
- Produces summaries, ADRs, and handoff notes
- Translates between business, domain, and tech

**Key Questions:**
- Does everyone agree on what we're building?
- What changed and why?
- What's the current state of play?

**Temperature:** 0.4 (balanced) | **Authority:** Determines what information to preserve

---

### 🎩 Larry Bird — *Strategic Systems Architect*
**Role:** Big-Picture Architecture & Trade-offs

**Responsibilities:**
- Designs system boundaries and interactions
- Chooses patterns and architectural styles
- Balances elegance, pragmatism, and longevity
- Anticipates second-order effects

**Key Questions:**
- Where are the seams?
- What will hurt to change later?
- Are we optimizing the right constraint?

**Temperature:** 0.5 (creative) | **Authority:** Proposes architectural approaches

---

### 🧑‍🏫 Coach K — *Delivery, Cadence & Discipline*
**Role:** Execution Orchestrator

**Responsibilities:**
- Breaks work into shippable increments
- Enforces scope, order, and sequencing
- Time-boxes debates and reviews
- Overrides perfectionism to ship on time

**Key Questions:**
- What ships next?
- What's the smallest win?
- What do we cut if needed?

**Temperature:** 0.3 (decisive) | **Authority:** HIGHEST - can override all agents to ship

---

### 💪 Shaquille O'Neal — *Primary Executor*
**Role:** High-Output Implementation Engine

**Responsibilities:**
- Implements features from specs
- Writes production-ready code and tests
- Handles migrations, refactors, and integrations
- **NEVER commits to git without user permission**

**Key Questions:**
- What exactly do I build?
- Where's the spec?
- How fast can this be done cleanly?

**Temperature:** 0.2 (consistent) | **Authority:** Chooses implementation details within constraints

**CRITICAL CONSTRAINTS:**
- ❌ NEVER run `git commit` or `git push`
- ❌ NEVER commit without explicit permission
- ✅ CAN analyze, suggest, create/edit files
- ✅ USER controls all commits

---

### 🐍 Kobe Bryant — *Relentless Quality & Risk Enforcer*
**Role:** Failure Hunter & Standards Assassin

**Responsibilities:**
- Finds edge cases, race conditions, and hidden coupling
- Reviews code and architecture ruthlessly
- Demands explicit handling of failure modes
- Forces clarity through discomfort

**Constraints:**
- ⏱️ Time-boxed to 30 minutes
- 🔢 Max 3 critical findings
- 🔧 Must propose mitigation or fix
- ⚖️ Can be overridden by Coach K

**Key Questions:**
- Where does this fail in production?
- What happens at 3am?
- What assumption are we hiding?

**Temperature:** 0.4 (analytical) | **Authority:** Can flag critical issues, time-boxed by Coach K

---

### 🧪 Scottie Pippen — *Stability, Integration & Defense*
**Role:** Reliability & Cross-Cutting Concerns

**Responsibilities:**
- Ensures components work together
- Reviews observability, monitoring, and resilience
- Focuses on non-functional requirements
- Covers gaps others don't see

**Key Questions:**
- Is this operable?
- Can we debug this live?
- What breaks under load?

**Temperature:** 0.4 (practical) | **Authority:** Ensures operational readiness

---

## ⚖️ Built-In Tension (By Design)

- **Jordan vs Bird** → correctness vs elegance
- **Kobe vs Shaq** → quality vs speed
- **Coach K vs everyone** → shipping vs perfection

This tension is **intentional and productive**. It drives better decisions.

---

## 🔄 How It Works

### Execution Flow

```
┌─────────────────────────────────────────┐
│  Phase 1: PLANNING (Automatic)          │
├─────────────────────────────────────────┤
│  1. Jordan   → Domain rules             │
│  2. Bird     → Architecture design      │
│  3. Coach K  → Task breakdown           │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  ⏸️  CHECKPOINT: Pre-Implementation     │
├─────────────────────────────────────────┤
│  Review plan, approve or adjust         │
│  YOU decide: proceed (yes) or change    │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Phase 2: IMPLEMENTATION (After OK)     │
├─────────────────────────────────────────┤
│  4. Shaq    → Implementation (no commits!)│
│  5. Kobe    → Top 3 risks + fixes       │
│  6. Pippen  → Operations review         │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Phase 3: SYNTHESIS (Always)            │
├─────────────────────────────────────────┤
│  7. Magic   → Complete summary          │
│             → Key decisions             │
│             → Next steps for YOU        │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  YOUR ACTION: Manual Review & Commit    │
├─────────────────────────────────────────┤
│  - Review suggestions                   │
│  - Test changes                         │
│  - Commit when satisfied                │
└─────────────────────────────────────────┘
```

---

## 📦 Installation

### Prerequisites
- **OpenCode** (Claude Code CLI) - Already installed if you're reading this!
- **Claude Max subscription** - No API costs
- **Bash/Zsh shell** - MacOS/Linux

### Install Steps

```bash
# 1. Navigate to Dream Team directory
cd ~/Github/Bondarewicz/dreamteam

# 2. Run installer (installs to ~/.dreamteam/)
./install-opencode-fixed.sh

# 3. Reload your shell
source ~/.zshrc  # or source ~/.bashrc

# 4. Verify installation
which dt
# Should output: dt: aliased to $DREAMTEAM_HOME/dt

# 5. Test it
cd ~/any-project
dt "create a hello world script"
```

### What Gets Installed

```
~/.dreamteam/
├── dreamteam-prompt.txt    # Embedded agent configs
└── dt                       # Command script

~/.zshrc (or ~/.bashrc)
└── Dream Team aliases added:
    - dt "task"
    - dreamteam "task"
```

---

## 💻 Usage

### Method 1: Direct Command (Recommended)

```bash
cd ~/your-project
dt "add user authentication with JWT tokens"
```

### Method 2: OpenCode Interactive

```bash
cd ~/your-project
opencode
```

Then in the session:
```
Execute Dream Team for: add user authentication with JWT tokens and rate limiting
```

### Method 3: From Different Directory

```bash
# Start OpenCode in specific directory
opencode ~/path/to/other-project

# Then execute Dream Team
> Execute Dream Team for: your task
```

### Command Syntax

```bash
# Basic
dt "task description"

# With quotes (recommended)
dt "analyse and fix bug where postcode 0299 cannot be used"

# Complex tasks
dt "refactor authentication to use repository pattern, maintain backward compatibility, add tests"
```

---

## 🛡️ Safety Features

### No Auto-Commits (CRITICAL)

**Agents will NEVER:**
- ❌ Run `git commit`
- ❌ Run `git push`
- ❌ Commit changes without permission
- ❌ Make irreversible git operations

**Agents CAN:**
- ✅ Analyze code and suggest changes
- ✅ Read git status and diffs
- ✅ Create/edit files (with your OpenCode permissions)
- ✅ Provide implementation approaches

**YOU Control:**
- 🎯 When to commit
- 🎯 What to commit
- 🎯 Commit messages
- 🎯 When to push

### Pre-Implementation Checkpoint

After planning (Jordan, Bird, Coach K), you get:

```
⏸️  DREAM TEAM - PRE-IMPLEMENTATION SUMMARY
================================================

📋 PLANNING COMPLETE - Ready for Implementation

🐐 JORDAN'S DOMAIN ANALYSIS:
[Key domain rules - 3-5 bullets]

🎩 BIRD'S ARCHITECTURE:
[Key decisions - 3-5 bullets]

🧑‍🏫 COACH K'S PLAN:
[Task breakdown - 3-5 bullets]

💡 KEY DECISIONS: [Top 3]
⚠️  RISKS: [Concerns]
📊 ESTIMATED EFFORT: [Estimate]

================================================
✋ PAUSE - Do you want to proceed? (yes/no)
================================================
```

**Impact:**
- See full plan BEFORE implementation
- Approve or request changes
- No wasted effort on wrong approaches

---

## 📋 Workflow Details

### Phase 1: Planning

**Duration:** ~45-75 minutes (time-boxed)

1. **Jordan (30 min)** → Domain Definition
   - Input: Business goal, requirements
   - Output: Domain rules, acceptance criteria, invariants
   
2. **Bird (45 min)** → Architecture Design
   - Input: Jordan's domain rules
   - Output: Architecture proposal, trade-offs, dependencies
   
3. **Coach K (30 min)** → Task Breakdown
   - Input: Jordan's criteria + Bird's architecture
   - Output: Sequenced tasks, scope decisions, time estimates

**⏸️ Checkpoint:** You review and approve

### Phase 2: Implementation & Review

**Duration:** Variable (depends on task complexity)

4. **Shaq (variable)** → Implementation
   - Input: Coach K's tasks + Bird's architecture + Jordan's rules
   - Output: Implementation approach, code structure
   - **NO GIT COMMITS** - suggestions only
   
5. **Kobe (30 min, MAX 3 findings)** → Quality Review
   - Input: Shaq's implementation
   - Output: Top 3 critical risks with reproduction scenarios and fixes
   - Time-boxed by Coach K
   
6. **Pippen (30 min)** → Stability Review
   - Input: Implementation + architecture
   - Output: Observability, monitoring, operational checklist

### Phase 3: Synthesis

**Duration:** ~20 minutes

7. **Magic (20 min)** → Context Synthesis
   - Input: All previous outputs
   - Output: Executive summary, key decisions, handoff notes, next steps

---

## 📚 Examples

### Example 1: Bug Fix

```bash
cd ~/my-app
dt "analyse and fix bug where postcode 0299 cannot be used"

# Output:
# 1. Planning summary (Jordan, Bird, Coach K analyze)
# 2. Checkpoint - approve?
# 3. Implementation suggestions (Shaq proposes fix)
# 4. Risk analysis (Kobe identifies edge cases)
# 5. Ops review (Pippen checks monitoring)
# 6. Final summary (Magic synthesizes)

# YOU then:
git add src/validation/postcode.js
git commit -m "fix: Allow leading zero postcodes (0299)"
git push
```

### Example 2: New Feature

```bash
cd ~/api-project
dt "add REST API for products with CRUD operations, pagination, and authentication"

# Planning phase completes → Review
# Approve → yes

# Implementation phase completes → Review suggestions
# Test the implementation
# Commit when satisfied

git add src/api/products/
git commit -m "feat: Add products API with CRUD, pagination, auth"
```

### Example 3: Refactoring

```bash
cd ~/legacy-app
dt "refactor authentication to use repository pattern"

# Review architectural changes in planning
# Ensure you agree with approach
# Approve → yes

# Review refactoring suggestions
# Test extensively
# Commit in small increments

git add src/auth/repository/
git commit -m "refactor: Extract auth repository interface"

git add src/auth/implementation/
git commit -m "refactor: Implement concrete auth repository"

git add tests/auth/
git commit -m "test: Add repository pattern tests"
```

### Example 4: Complex Multi-Step Task

```bash
opencode

> Analyze the current authentication system
[I explore and report]

> Execute Dream Team for: Migrate authentication from sessions to JWT tokens, 
  ensure backward compatibility for 2 weeks, add refresh token mechanism, 
  implement logout blacklist

[Full Dream Team execution with detailed plan]

> Have Kobe do a deeper security review focusing on token theft scenarios
[Kobe provides additional analysis]

> Thanks, I'll implement this incrementally
[You proceed with manual implementation and commits]
```

---

## ⚙️ Configuration

### Agent Configurations

Located in `agents/*.yaml`:

```yaml
name: dreamteam-jordan
role: Domain Authority & Final Arbiter
persona: Michael Jordan
model: gpt-4-turbo  # Can be changed

description: |
  Business Truth Holder...

system_prompt: |
  You are Michael Jordan...
  
constraints:
  max_response_tokens: 2000
  temperature: 0.3
```

**To modify agent behavior:**
```bash
# Edit agent config
nano ~/Github/Bondarewicz/dreamteam/agents/jordan.yaml

# Regenerate runtime
cd ~/Github/Bondarewicz/dreamteam
./install-opencode-fixed.sh

# Changes are now active
```

### Workflow Configuration

Located in `workflows/standard-workflow.yaml`:

```yaml
phases:
  - phase: 1_domain_definition
    agent: dreamteam-jordan
    inputs: [business_goal, user_requirements]
    outputs: [domain_rules, acceptance_criteria]
    time_box: 30 minutes
```

**To modify workflow:**
```bash
nano ~/Github/Bondarewicz/dreamteam/workflows/standard-workflow.yaml
./install-opencode-fixed.sh
```

### Runtime Configuration

Active configuration: `~/.dreamteam/dreamteam-prompt.txt`

This file is **generated** from the YAML configs. Don't edit directly - edit the source YAML files instead.

---

## 🔧 Troubleshooting

### Command Not Found: `dt`

```bash
# Reload shell
source ~/.zshrc  # or ~/.bashrc

# Verify
which dt

# If still not found, reinstall
cd ~/Github/Bondarewicz/dreamteam
./install-opencode-fixed.sh
```

### Agents Not Loading / Permission Errors

The current setup embeds all agent configs to avoid permission issues.

If you see errors:
```bash
# Verify installation
ls -la ~/.dreamteam/

# Should show:
# - dreamteam-prompt.txt (embedded configs)
# - dt (command script)

# Reinstall if missing
./install-opencode-fixed.sh
```

### Changes to Agent Configs Not Taking Effect

```bash
# After editing agents/*.yaml, regenerate:
cd ~/Github/Bondarewicz/dreamteam
./install-opencode-fixed.sh

# This rebuilds ~/.dreamteam/dreamteam-prompt.txt
```

### Want to Use Different Model

```bash
# Edit agent config
nano agents/jordan.yaml

# Change:
model: gpt-4-turbo

# To (future when available):
model: claude-sonnet-4-5

# Regenerate
./install-opencode-fixed.sh
```

### Dream Team in Different Repository

```bash
# Option 1: Navigate first
cd ~/other-project
dt "your task"

# Option 2: Start OpenCode in that directory
opencode ~/other-project
> Execute Dream Team for: your task
```

---

## 🏗️ Architecture

### Design Principles

**Role-First Design:**
- **Roles are stable** (Jordan, Magic, Bird, etc.)
- **Models are interchangeable** (Claude today, others tomorrow)
- No vendor lock-in

**Configuration Structure:**
```
Repository (Source of Truth):
├── agents/*.yaml           # Agent definitions
├── workflows/*.yaml        # Workflow definitions
└── install-opencode-fixed.sh  # Builder

Runtime (Generated):
├── ~/.dreamteam/dreamteam-prompt.txt  # Embedded configs
└── ~/.dreamteam/dt                     # Command wrapper
```

### How It Works Internally

```
1. You run: dt "task"
           ↓
2. Script loads: ~/.dreamteam/dreamteam-prompt.txt
           ↓
3. Pipes to: opencode run
           ↓
4. OpenCode (Claude) receives embedded prompt with:
   - All 7 agent system prompts
   - Workflow definition
   - Your task
           ↓
5. I (OpenCode) execute each agent sequentially
           ↓
6. Output: Structured report with all agent responses
           ↓
7. YOU: Review and commit manually
```

### Technology Stack

- **Orchestration:** OpenCode (Claude Code CLI)
- **Model:** Claude (via your Claude Max subscription)
- **Cost:** $0 (included in Claude Max)
- **Languages:** Bash (wrapper), YAML (config), Markdown (docs)
- **Availability:** Global (works in any directory)

### File Structure

```
dreamteam/
├── README.md                  # This file (all documentation)
├── .gitignore                 # Git ignore rules
├── install-opencode-fixed.sh  # Installer script
│
├── agents/                    # Agent configurations
│   ├── jordan.yaml            # Domain Authority
│   ├── magic.yaml             # Context Synthesizer
│   ├── bird.yaml              # Systems Architect
│   ├── coach-k.yaml           # Execution Orchestrator
│   ├── shaq.yaml              # Primary Executor
│   ├── kobe.yaml              # Quality Enforcer
│   └── pippen.yaml            # Stability Specialist
│
├── workflows/                 # Workflow definitions
│   └── standard-workflow.yaml # Standard 7-phase workflow
│
└── examples/                  # Usage examples
    └── example-task.md        # Complete auth feature walkthrough
```

---

## 🔮 Future Development

### Planned: LangGraph Migration

Once Anthropic provides API access as part of Claude Max subscriptions (or offers a "Max API" tier), this system can be migrated to use **LangGraph** for enhanced orchestration.

**Why LangGraph:**
- Most mature and widely adopted framework
- Graph-based state management
- Perfect for conditional workflows
- Production-grade

**Migration Path:**
Current YAML configs are designed to be compatible:

```python
# Future migration (conceptual):
from langgraph.graph import StateGraph
import yaml

# Load existing agent configs
with open('agents/jordan.yaml') as f:
    jordan_config = yaml.safe_load(f)

# Create LangGraph nodes from configs
workflow = StateGraph(DreamTeamState)
workflow.add_node("jordan", create_agent(jordan_config))
# ... add other agents

# Add conditional edges
workflow.add_conditional_edges(
    "coach_k",
    should_proceed,  # User approval checkpoint
    {"yes": "shaq", "no": "jordan"}
)
```

**Benefits of Future Migration:**
- Parallel agent execution
- Advanced state management
- Built-in memory and persistence
- Richer debugging tools
- Conditional branching

**Current Status:**
- Current OpenCode implementation works perfectly
- No migration needed until API access is included in Max
- YAML configs are future-proof

---

## 📝 Best Practices

### 1. Always Review Pre-Implementation Summary
- Check if the approach makes sense
- Verify architecture aligns with your vision
- Question anything unclear

### 2. Test Before Committing
```bash
# After Dream Team suggests changes
npm test
npm run build
# Review the actual code
# THEN commit
```

### 3. Use Descriptive Commit Messages
```bash
# Dream Team might suggest:
git commit -m "Add feature"

# You should use:
git commit -m "feat: Add user authentication with JWT tokens

- Implement bcrypt password hashing
- Add JWT token generation and validation
- Include rate limiting on login endpoints
- Add integration tests

Addresses #123"
```

### 4. Commit in Small Increments
```bash
# If Dream Team suggests multiple changes, commit separately:
git add src/auth/ && git commit -m "feat: Add auth service"
git add tests/auth/ && git commit -m "test: Add auth tests"
git add src/middleware/ && git commit -m "feat: Add auth middleware"
```

### 5. Ask Follow-Up Questions
```bash
opencode
> Execute Dream Team for: add caching
[Team executes]

> Have Kobe review specifically for cache invalidation edge cases
[Kobe digs deeper]

> What's the performance impact of Bird's proposed architecture?
[I provide analysis]
```

---

## 🤝 Contributing

This is a personal project, but if you want to:

**Customize for your needs:**
1. Fork this repo
2. Modify `agents/*.yaml` for your preferences
3. Adjust `workflows/*.yaml` for your workflow
4. Run `./install-opencode-fixed.sh`

**Share improvements:**
- Document interesting use cases
- Share agent configuration tweaks
- Suggest workflow improvements

---

## 📄 License

This is a personal project. Use freely, modify as needed.

---

## 🏀 Ready to Win Championships!

**Your Dream Team is ready.**

```bash
# From any project
cd ~/your-project
dt "your task"

# Let the Dream Team work their magic
# You stay in control
# Ship with confidence
```

**Remember:**
- ✅ Agents NEVER auto-commit
- ✅ You review before implementation
- ✅ You control all git operations
- ✅ Full transparency at every step

**Go build something amazing!** 🏆
