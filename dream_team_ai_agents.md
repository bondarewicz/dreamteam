# 🏀 Dream Team AI Agents (Olympic Edition)

This document defines a **Dream Team–inspired AI agent lineup**, designed to function like an elite Olympic basketball team: clear roles, minimal overlap, extreme excellence, and disciplined execution.

The goal is to enable **any complex software development task** to be tackled end‑to‑end using orchestrated AI agents (Claude, ChatGPT, Gemini), coordinated by an external orchestrator.

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

---

## 🏆 Dream Team Lineup (AI Roles)

### 🐐 Michael Jordan — *Domain Authority & Final Arbiter*
**Role:** Business Truth Holder

**Responsibilities**
- Owns domain language, rules, and invariants
- Defines what is *correct* vs merely *working*
- Approves or rejects solutions based on business reality
- Prevents domain drift and accidental complexity

**Key Questions**
- Is this faithful to the business?
- What rule are we encoding here?
- What must never break?

---

### 🧠 Magic Johnson — *Context Synthesizer & Team Glue*
**Role:** Shared Understanding & Communication

**Responsibilities**
- Synthesizes outputs from all agents
- Maintains shared context and decisions
- Produces summaries, ADRs, and handoff notes
- Translates between business, domain, and tech

**Key Questions**
- Does everyone agree on what we’re building?
- What changed and why?
- What’s the current state of play?

---

### 🎩 Larry Bird — *Strategic Systems Architect*
**Role:** Big‑Picture Architecture & Trade‑offs

**Responsibilities**
- Designs system boundaries and interactions
- Chooses patterns and architectural styles
- Balances elegance, pragmatism, and longevity
- Anticipates second‑order effects

**Key Questions**
- Where are the seams?
- What will hurt to change later?
- Are we optimizing the right constraint?

---

### 🧑‍🏫 Coach K — *Delivery, Cadence & Discipline*
**Role:** Execution Orchestrator

**Responsibilities**
- Breaks work into shippable increments
- Enforces scope, order, and sequencing
- Time‑boxes debates and reviews
- Overrides perfectionism to ship on time

**Key Questions**
- What ships next?
- What’s the smallest win?
- What do we cut if needed?

---

### 💪 Shaquille O’Neal — *Primary Executor*
**Role:** High‑Output Implementation Engine

**Responsibilities**
- Implements features from specs
- Writes production‑ready code and tests
- Handles migrations, refactors, and integrations
- Optimizes only when instructed

**Key Questions**
- What exactly do I build?
- Where’s the spec?
- How fast can this be done cleanly?

---

### 🐍 Kobe Bryant — *Relentless Quality & Risk Enforcer*
**Role:** Failure Hunter & Standards Assassin

**Responsibilities**
- Finds edge cases, race conditions, and hidden coupling
- Reviews code and architecture ruthlessly
- Demands explicit handling of failure modes
- Forces clarity through discomfort

**Constraints**
- Time‑boxed
- Max 3 critical findings
- Must propose mitigation or fix
- Can be overridden by Coach K

**Key Questions**
- Where does this fail in production?
- What happens at 3am?
- What assumption are we hiding?

---

### 🧪 Scottie Pippen — *Stability, Integration & Defense*
**Role:** Reliability & Cross‑Cutting Concerns

**Responsibilities**
- Ensures components work together
- Reviews observability, monitoring, and resilience
- Focuses on non‑functional requirements
- Covers gaps others don’t see

**Key Questions**
- Is this operable?
- Can we debug this live?
- What breaks under load?

---

## 🔄 Recommended Execution Flow

1. **Jordan** defines domain & acceptance criteria
2. **Bird** proposes architecture
3. **Coach K** slices and schedules work
4. **Shaq** implements
5. **Kobe** reviews for critical risks
6. **Pippen** checks stability & operability
7. **Magic** synthesizes and documents
8. Iterate until victory

---

## ⚖️ Built‑In Tension (By Design)

- Jordan vs Bird → correctness vs elegance
- Kobe vs Shaq → quality vs speed
- Coach K vs everyone → shipping vs perfection

This tension is intentional and productive.

---

## 🧠 Guiding Principle

> **AI accelerates execution.
> Humans own meaning.
> Championships are won by systems, not stars alone.**

---

## 🧩 Implementation Recommendation: Using OpenCode as the Orchestrator

This Dream Team is designed to be **model-agnostic** and **role-first**. The recommended way to implement it is by using **OpenCode** as the orchestration layer, with each role mapped to an independent AI agent that can be swapped or upgraded without changing the team structure.

---

## 🎛 Core Principle: Roles ≠ Models

- **Roles are stable** (Jordan, Magic, Bird, etc.)
- **Models are interchangeable** (Claude, ChatGPT, Gemini, future models)
- OpenCode acts as the **coach’s clipboard**, routing tasks between agents

This ensures:
- No vendor lock-in
- Easy experimentation
- Gradual evolution of the team

---

## 🏗 Recommended OpenCode Setup (Initial Phase)

### Phase 1: Claude-Only Lineup (Baseline)

To establish consistency and shared reasoning style, start with **Claude as the sole model** for all agents.

In OpenCode:
- Define **one agent per Dream Team role**
- Assign **Claude** as the underlying model for every agent
- Differentiate agents **only by system prompt and constraints**

This gives you:
- Predictable behavior
- Easier debugging
- Cleaner feedback loops

---

## 🧠 Agent Configuration Pattern

For each role (example: Michael Jordan):

- **Agent name:** `dreamteam-jordan`
- **Model:** Claude
- **System prompt:**
  - Role description
  - Responsibilities
  - Guardrails
  - Decision authority

Repeat this pattern for:
- `dreamteam-magic`
- `dreamteam-bird`
- `dreamteam-coach-k`
- `dreamteam-shaq`
- `dreamteam-kobe`
- `dreamteam-pippen`

---

## 🔄 Orchestration Flow in OpenCode

A typical OpenCode pipeline:

1. **Jordan agent**
   - Input: business goal
   - Output: domain rules, acceptance criteria

2. **Bird agent**
   - Input: Jordan output
   - Output: architecture proposal

3. **Coach K agent**
   - Input: scope + architecture
   - Output: ordered task breakdown

4. **Shaq agent**
   - Input: tasks
   - Output: implementation

5. **Kobe agent**
   - Input: implementation
   - Output: top risks + fixes

6. **Pippen agent**
   - Input: updated implementation
   - Output: operability & stability review

7. **Magic agent**
   - Input: all outputs
   - Output: synthesized summary & next steps

OpenCode coordinates inputs/outputs and preserves state between steps.

---

## 🔁 Swapping Models Later (Key Advantage)

Once the flow is stable:

- Swap **Claude → ChatGPT** for Shaq (execution speed)
- Swap **Claude → Gemini** for Coach K (planning)
- Keep **Claude** for Jordan and Kobe (reasoning & critique)

Because roles are isolated:
- No prompt rewrites needed
- No pipeline redesign
- Only model assignment changes

---

## ⚠️ Guardrails to Enforce in OpenCode

- **Single active owner per stage** (no parallel chaos)
- **Time-box Kobe and Bird** reviews
- **Coach K has override authority**
- **Magic always produces final shared context**

These guardrails prevent infinite loops and analysis paralysis.

---

## 🏁 Final Recommendation

Start conservative:
- Claude-only
- Sequential execution
- Tight prompts

Then evolve:
- Parallelize safely
- Swap models tactically
- Add benchmarks per role

> **Treat this like a real Olympic team**: structure first, talent second.

---

*End of document.*

