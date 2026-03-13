# Skills Analysis for Dream Team

> Sources analysed:
> - [NTCoding/claude-skillz](https://github.com/NTCoding/claude-skillz) — 2026-03-05
> - [Anthropic/skills](https://github.com/anthropics/skills) — 2026-03-05

---

## Cross-Cutting Patterns (from both repos)

These patterns recur across multiple skills and are more valuable than any individual skill. They should be embedded directly into agent prompts (Tier 1).

| Pattern | Source Skills | Description |
|---------|-------------|-------------|
| **Validation Loop** | pptx, xlsx, skill-creator, tdd-process | Generate -> Verify -> Fix -> Re-verify. "Assume there are problems. Your job is to find them." |
| **Fresh-Eyes Review** | doc-coauthoring, pptx | Spawn a context-free agent to review output. Catches blind spots the author can't see. |
| **Think-Then-Execute** | algorithmic-art, frontend-design, architect-refine-critique | Philosophy/architecture first, implementation second. Never conflate design with coding. |
| **Progressive Disclosure** | mcp-builder, skill-creator | Load minimum viable context, defer the rest. Critical for context window management. |
| **Eval-Iterate Loop** | skill-creator, session-optimizer | Draft -> Test against realistic scenarios -> Measure with-vs-without -> Improve -> Repeat. |
| **Fix Root Causes** | fix-it-never-work-around-it | Never bypass failures. Detect workaround language. Fix the underlying problem. |
| **Evidence-Based Confidence** | confidence-honesty, observability-first-debugging | Explicit confidence percentages, evidence inventory, instrument before hypothesizing. |
| **Questions Are Not Instructions** | questions-are-not-instructions | Acknowledge -> respond literally -> ask for direction -> then act. Universal guardrail. |

---

## Integration Architecture

```
Tier 1: EMBEDDED (in agent prompts)     — Patterns above, always in context
Tier 2: REFERENCED (loaded on demand)   — Full SKILL.md files, loaded when task matches
Tier 3: SCRIPTS (executed, never loaded) — recalc.py, validate.py, with_server.py
```

**Don't** embed full SKILL.md content in prompts (they're 100-600 lines each).
**Do** extract the patterns and reference files by path when the task requires them.

---

## Agent-Skill Mapping

### Bird (Domain Authority & Final Arbiter)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **tactical-ddd** | Rich domain language | Ban Manager/Handler/Processor/Util — domain naming enforcement |
| NTCoding | **tactical-ddd** | Make implicit explicit | Model states as distinct types, name hidden domain concepts |
| NTCoding | **confidence-honesty** | Explicit confidence percentages | Evidence inventory, falsifiability check, "why not 100%?" — strengthens domain assessments |
| NTCoding | **create-tasks** | Example Mapping | Identify rules, examples, edge cases from domain perspective |
| Anthropic | **doc-coauthoring** (Stage 1) | Structured interview protocol | Clarifying questions, info-dump encouragement, exit conditions for "sufficient context gathered" |
| Anthropic | **skill-creator** | Capture Intent | Clean interview: What should it do? When trigger? Expected output? — requirements gathering |
| Anthropic | **xlsx** | Domain invariants | Financial modeling rules, formula verification — transferable to any domain with hard constraints |

### MJ (Strategic Systems Architect)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **tactical-ddd** | Isolate domain logic | Domain can't import DB, HTTP, logging — architectural boundary enforcement |
| NTCoding | **tactical-ddd** | Use case orchestration (menu test) | Use cases = user goals, not internal machinery — system boundary design |
| NTCoding | **tactical-ddd** | Separate generic concepts | Retry/cache/validation is infra, not domain — separation of concerns |
| NTCoding | **tactical-ddd** | Aggregate invariant design | Aggregate root protects consistency, reference by ID |
| NTCoding | **separation-of-concerns** | features/ + platform/ + shell/ | Structured code organisation with placement decision tree |
| NTCoding | **architect-refine-critique** | Three-phase design chain | Explicit architect -> refiner -> critique flow with dedicated critique checklist |
| NTCoding | **lightweight-implementation-analysis-protocol** | Trace before implementing | 3-step "understand flow before coding" protocol |
| Anthropic | **mcp-builder** (Phase 1) | Deep Research & Planning | 4-phase engineering workflow: understand protocol, study framework, plan implementation, select tools |
| Anthropic | **skill-creator** | Component architecture | Metadata -> body -> bundled resources — progressive disclosure pattern for any plugin/extension system |
| Anthropic | **frontend-design** | Design thinking | Purpose -> Tone -> Constraints -> Differentiation — lightweight ADR process before coding |

### Shaq (Primary Code Executor)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **tactical-ddd** | Discriminated unions for state | Model states as distinct types, eliminate null/optional at type level |
| NTCoding | **tactical-ddd** | Value object extraction | Identify primitives that should be value objects (Money, Address, etc.) |
| NTCoding | **tactical-ddd** | Repository discipline | One repo per aggregate root, no partial loads, no hydrate abuse |
| NTCoding | **tactical-ddd** | Anemic model avoidance | Business logic in domain objects, use cases only orchestrate |
| NTCoding | **writing-tests** | Edge case checklists | BugMagnet-based checklists for numbers, strings, collections, dates, null/undefined |
| NTCoding | **software-design-principles** | Object calisthenics + fail-fast | Code-level guardrails: immutability, intention-revealing names, type safety |
| NTCoding | **tdd-process** | RED-GREEN-REFACTOR state machine | Strict TDD discipline (adapt, don't copy verbatim — too verbose at 600 lines) |
| NTCoding | **fix-it-never-work-around-it** | Fix root causes | Never bypass failures, detect workaround language |
| Anthropic | **docx** | Implementation cookbook | Comprehensive API patterns with Quick Reference table -> detailed sections -> Critical Rules summary |
| Anthropic | **xlsx** | Formula construction rules | Mandatory validation step: generate -> scan for errors -> fix -> re-verify |
| Anthropic | **pdf** | Multi-tool selection matrix | Task -> Best Tool -> Command lookup pattern for technology decisions during implementation |
| Anthropic | **mcp-builder** (Phase 2) | MCP implementation | Project structure, tool registration patterns, input/output schema design |
| Anthropic | **webapp-testing** | Playwright testing | Decision tree (static vs dynamic, server state), reconnaissance-then-action pattern |
| Anthropic | **web-artifacts-builder** | Build pipeline | Init -> develop -> bundle -> test pipeline with single-file artifact output |

### Kobe (Quality & Risk Enforcer)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **tactical-ddd** | Mandatory DDD checklist (9 items) | Verify isolation, naming, aggregates, value objects, repositories before shipping |
| NTCoding | **tactical-ddd** | Anemic model detection | Spot business logic leaked into use cases during review |
| NTCoding | **challenge-that** | Five adversarial perspectives | Skeptic, Pragmatist, Edge Case Hunter, Structural Critic, Root Cause Analyst |
| NTCoding | **confidence-honesty** | Confidence scoring | Force explicit certainty levels on risk assessments |
| Anthropic | **pptx** (QA section) | "Assume there are problems" | Visual QA with sub-agents, verification loop (generate -> inspect -> fix -> re-verify), fresh-eyes mandate |
| Anthropic | **skill-creator** (eval framework) | Benchmark comparison | Parallel with-skill vs baseline runs, quantitative assertions, blind A/B testing |
| Anthropic | **xlsx** | Formula Verification Checklist | Test sample references, verify column mapping, check row offsets, handle NaN, test edge cases — template for any review checklist |
| Anthropic | **webapp-testing** | Recon-then-action | Inspect rendered state before acting — understand the system before judging it |
| Anthropic | **doc-coauthoring** (Stage 3) | Reader Testing | Test documentation with a fresh agent that has zero prior context — catches assumption blind spots |

### Pippen (Stability, Integration & Defense)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **observability-first-debugging** | Instrument before hypothesizing | Systematic: reproduce -> instrument -> observe -> hypothesis -> test |
| Anthropic | **webapp-testing** | Server lifecycle management | `with_server.py` multi-server coordination, health checks via networkidle waits |
| Anthropic | **mcp-builder** (Phase 3-4) | Integration verification | Build verification, MCP Inspector testing, evaluation questions for acceptance testing |
| Anthropic | **docx/pptx** validation | Validate-repair-repack | validate.py -> auto-repair -> pack pipeline — operational pattern for deployment pipelines |

### Magic (Context Synthesizer & Team Glue)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **create-tasks** | SPIDR splitting + INVEST validation | Professional task decomposition for planning phase |
| NTCoding | **concise-output** | Signal-to-noise enforcement | Tighter summaries and ADRs |
| Anthropic | **doc-coauthoring** (full workflow) | Three-stage doc creation | Context Gathering -> Refinement & Structure -> Reader Testing — complete methodology for ADRs, specs, RFCs |
| Anthropic | **internal-comms** | Template-driven comms | Dispatch pattern: identify type -> load template -> follow format — keeps output consistent |
| Anthropic | **skill-creator** | Description optimization | Generate trigger queries -> test -> optimize -> re-test — applicable to writing clear, triggerable documentation |

### All Agents (Universal Guardrails)

| Source | Skill | Principle | What it adds |
|--------|-------|-----------|-------------|
| NTCoding | **questions-are-not-instructions** | Don't interpret questions as orders | Acknowledge -> respond literally -> ask for direction -> then act |
| NTCoding | **critical-peer-personality** | Professional skepticism | No praise, no estimates, propose don't ask — expert peer not servant |

---

## Priority Skills Ranking

### Tier 1: Steal-worthy (adopt patterns immediately)

| Rank | Skill | Source | Primary Agent(s) | Why |
|------|-------|--------|-------------------|-----|
| 1 | **skill-creator** | Anthropic | Kobe, Bird, All | Meta-skill: eval-iterate loop, benchmark comparison, blind A/B testing. Makes the team self-improving. |
| 2 | **tactical-ddd** | NTCoding | MJ, Bird, Shaq, Kobe | Comprehensive DDD patterns — aggregates, value objects, domain language. Complements MJ's strategic DDD with tactical depth. |
| 3 | **doc-coauthoring** | Anthropic | Magic, Bird | 3-stage doc workflow with Reader Testing via fresh-eyes sub-agent. Direct fit for ADRs, specs, RFCs. |
| 4 | **mcp-builder** | Anthropic | MJ, Pippen | 4-phase engineering workflow (Research -> Implement -> Review -> Evaluate). Best integration architecture patterns. |
| 5 | **observability-first-debugging** | NTCoding | Pippen | Research-backed debugging methodology. Instrument before hypothesizing. Exceptional quality. |
| 6 | **webapp-testing** | Anthropic | Kobe, Pippen | Playwright testing, recon-then-action pattern, server lifecycle management. |
| 7 | **questions-are-not-instructions** | NTCoding | All | Prevents Claude's #1 anti-pattern: interpreting questions as orders to act. Universal guardrail. |

### Tier 2: Solid (worth selective adoption)

| Skill | Source | Primary Agent(s) | Notes |
|-------|--------|-------------------|-------|
| **architect-refine-critique** | NTCoding | Bird -> MJ -> Kobe | Similar to our 3-phase flow but with explicit critique checklist |
| **confidence-honesty** | NTCoding | Bird, MJ | Explicit confidence percentages with evidence inventory |
| **writing-tests** | NTCoding | Shaq | Edge case checklists grounded in BugMagnet |
| **create-tasks** | NTCoding | Coach K, Magic | Example Mapping + SPIDR splitting + INVEST validation |
| **challenge-that** | NTCoding | Kobe | Five adversarial perspectives for risk review |
| **pptx** (QA section) | Anthropic | Kobe | "Assume there are problems" philosophy + verification loop |
| **xlsx** | Anthropic | Bird, Kobe | Rigorous validation pipeline, formula verification checklist |
| **internal-comms** | Anthropic | Magic | Template-driven structured communications |
| **frontend-design** | Anthropic | MJ | Design thinking framework + anti-pattern catalog |

### Tier 3: Niche (skip or extract patterns only)

| Skill | Source | Issue |
|-------|--------|-------|
| **tdd-process** | NTCoding | Great state machine but 600+ lines. "SEVERE VIOLATION" language is harsh. |
| **lightweight-task-workflow** | NTCoding | Bans TodoWrite/TodoRead — breaks Claude Code conventions |
| **typescript-backend-project-setup** | NTCoding | More of a course than a skill (550+ lines). Assumes NX. |
| **algorithmic-art** | Anthropic | Generative art domain — only the two-phase workflow transfers |
| **canvas-design** | Anthropic | Static visual art — only the refinement loop transfers |
| **brand-guidelines** | Anthropic | Anthropic-specific branding |
| **slack-gif-creator** | Anthropic | Niche animation use case |
| **theme-factory** | Anthropic | Simple theme catalog |

---

## DDD Complementarity Note

NTCoding's `tactical-ddd` and our MJ's DDD section are almost perfect complements:
- **Theirs**: Tactical playbook — how to write DDD code with TypeScript examples, anti-patterns, and tests
- **Ours**: Strategic guide — bounded contexts, context maps, subdomain classification, integration patterns
- **Their gap**: No strategic DDD (no bounded contexts or context maps)
- **Our gap**: No tactical depth (patterns listed but not shown with examples or anti-patterns)

---

## Cross-Cutting Observations

### Strengths (both repos)

- Evidence-based — multiple skills cite research (Cleveland & McGill, Kent Beck, SRE practices)
- Excellent anti-pattern documentation throughout
- Clear ownership boundaries — every skill knows its scope
- Strong checklists and validation gates
- Anthropic skills demonstrate superior progressive disclosure and context management

### Weaknesses

1. **Length** — Several NTCoding skills are 400-600 lines. Anthropic skills average 200+ lines. Cognitive load is high in both.
2. **No integration between NTCoding skills** — track-and-improve doesn't feed back into create-tasks. challenge-that identifies concerns but nobody owns resolving them.
3. **Team message delivery** — Multi-agent NTCoding skills assume reliable message delivery with no fallback.
4. **Missing ship gate** — No NTCoding skill provides a clear SHIP/NO-SHIP verdict like our Kobe does. Anthropic's pptx QA comes closest with its verification loop.
5. **Anthropic skills are task-specific** — Most Anthropic skills are document/artifact generation skills. The engineering patterns are embedded within them, not extracted for reuse.

---

## NTCoding System Prompts (Persona Layer)

| Prompt | Assessment |
|--------|-----------|
| **strategic-architect** | Strong — trade-offs over absolutes, ADRs, clean boundaries. Long but comprehensive. |
| **technical-investigator** | Excellent — LEARNING/INVESTIGATION/SOLVING modes, SRE practices, USE method. 330+ lines though. |
| **prd-expert** | Great product thinking — "show don't tell," ASCII mockups, parallelization tracking. |
| **super-tdd-developer** | Solid Kent Beck philosophy but terse on plan mode and flaky test handling. |
| **tdd-team-lead** | Rigorous state machine enforcement but no crash recovery or teammate timeout handling. |
