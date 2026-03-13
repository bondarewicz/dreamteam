# Checkpoint: Anthropic Best Practices Audit
Date: 2026-03-12
Status: **READY FOR IMPLEMENTATION** — Phase 1 (analysis) and Phase 2 (checkpoint) complete. Phase 3 (Shaq implementation) not started.

## How to Resume

To pick this up in a new session, tell Claude:
> "Read `docs/checkpoint-best-practices-audit.md` and implement priorities P1-P4. Use `/shaq` or `/team` to execute."

All context needed for implementation is in this file. No need to re-run Bird or MJ.

## User Decisions (from session 2026-03-12)

- **Naming**: Keep persona names (bird, mj, etc.) — deliberate trade-off, accept the FAIL
- **Fast Mode**: Out of scope — available in Claude Code via `/fast` but 6x pricing not worth it
- **P5 (API constraints doc)**: Dropped entirely
- **Model lineup**: Keep as-is (5 opus + 1 sonnet), no changes
- **Scope**: All 4 remaining priorities approved for implementation

---

## Audit Summary

Bird (domain analysis, 92% confidence) and MJ (architecture analysis, 88% confidence) audited the dreamteam codebase against Anthropic's best practices for Claude Code agent systems. The scorecard: 4 PASS, 4 PARTIAL, 2 FAIL.

The two FAILs are the implementation priority: zero evaluations exist, and `commands/team.md` is 2x the allowed length. Everything else is either a clean win or a bounded cleanup task.

---

## Magic's Handoff Brief for Shaq

```
handoff_brief:
  recipient: shaq
  task_context: >
    The dreamteam codebase passes most Anthropic best-practice checks but has two
    hard failures and three bounded improvement areas. Shaq's job is to fix all five:
    (1) create the evals/ directory with test scenarios for all 6 agents,
    (2) split commands/team.md to bring it under 500 lines,
    (3) extract the shared Team Protocol boilerplate into one file that all agents
    reference, (4) add effort-level guidance to README, and (5) add a short adaptive
    thinking warning to README. No architecture changes. No renames. Documentation
    and file-structure work only.
```

---

## What Shaq Needs to Build

### Priority 1 — CRITICAL: Create evals/ directory (FAIL → PASS)

**Why it matters:** Anthropic says build evals BEFORE docs. The project has none. This is the highest-priority gap.

**Files to create:**

```
evals/
  bird/
    scenario-01-domain-rule-extraction.md
    scenario-02-acceptance-criteria-completeness.md
    scenario-03-business-impact-assessment.md
  mj/
    scenario-01-architecture-pattern-selection.md
    scenario-02-system-health-diagnosis.md
    scenario-03-trade-off-analysis.md
  shaq/
    scenario-01-spec-faithful-implementation.md
    scenario-02-test-coverage.md
    scenario-03-escalation-on-ambiguity.md
  magic/
    scenario-01-synthesis-completeness.md
    scenario-02-contradiction-detection.md
    scenario-03-handoff-brief-quality.md
  kobe/
    scenario-01-review-finding-accuracy.md
    scenario-02-false-positive-rate.md
    scenario-03-verdict-calibration.md
  pippen/
    scenario-01-multi-agent-coordination.md
    scenario-02-blocker-detection.md
    scenario-03-task-decomposition.md
  README.md   # explains how to run evaluations
```

**Format for each scenario file:**

Each `scenario-XX-*.md` file must include:
- `prompt:` — the input given to the agent
- `expected_behavior:` — what correct output looks like (observable, not vague)
- `failure_modes:` — what bad output looks like
- `scoring_rubric:` — how to grade the output (pass/partial/fail criteria)

**Minimum bar:** 3 scenarios per agent = 18 total. Scenarios should cover the happy path, an edge case, and an escalation case for each agent.

---

### Priority 2 — CRITICAL: Split commands/team.md (FAIL → PASS)

**Why it matters:** At 1050 lines, `commands/team.md` is 2x the 500-line soft limit. It violates progressive disclosure — everything is inlined when most of it should be referenced.

**Current file:** `/Users/lb/Github/Bondarewicz/dreamteam/commands/team.md`

**Target state:**

```
commands/team.md                          # under 500 lines — orchestration logic only
workflows/
  recording-lifecycle.md                 # recording init/event/finish/upload protocol
  phase-transitions.md                   # phase handoff sequences and gating rules
  escalation-protocol.md                 # when/how agents escalate to Coach K
  session-report-format.md               # retro/report template and fields
```

**Splitting rule:** `commands/team.md` retains the orchestration logic (who does what, in what order, with what outputs). Procedural detail (step-by-step recording commands, full event tables, report templates) moves to `workflows/` files and is referenced with a relative link.

**Acceptance check:** `wc -l commands/team.md` must return under 500.

---

### Priority 3 — IMPORTANT: Extract shared Team Protocol boilerplate (PARTIAL → PASS)

**Why it matters:** The Team Protocol block (Before Starting, Message Discipline, Escalation Protocol, Dependency Verification, Turn Budget Management) is copy-pasted across all 6 agent files. That is ~500 lines of duplication. When the protocol changes, all 6 files need updating — a maintenance trap.

**Current duplicated block appears in:**
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/bird.md`
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/mj.md`
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/shaq.md`
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/magic.md`
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/kobe.md`
- `/Users/lb/Github/Bondarewicz/dreamteam/agents/pippen.md`

**Files to create:**

```
shared/
  team-protocol.md      # the canonical Team Protocol block
```

**Files to modify:** All 6 agent files. Replace the inline Team Protocol block with a single reference line:

```
See [shared/team-protocol.md](../shared/team-protocol.md) for the mandatory team protocol.
```

**Note on agent-specific escalation sub-rules:** Each agent has a different set of escalation examples (Bird has domain-ambiguity escalations, Shaq has spec-ambiguity escalations, etc.). These are agent-specific and must NOT be extracted — only the shared structural protocol goes to shared/. Keep the agent-specific escalation bullet points inline in each agent file.

**Expected line reduction:** ~400 lines removed across 6 files.

---

### Priority 4 — IMPORTANT: Add effort-level guidance to README (documentation only)

**Why it matters:** MJ found that the effort parameter (thinking budget) is the highest-impact undocumented feature. Users who don't know about it will get suboptimal results, especially for high-complexity tasks.

**File to modify:** The project README (locate with `Glob "**/README.md" --path /Users/lb/Github/Bondarewicz/dreamteam` excluding the `.claude/` subdirectory).

**Section to add:** A new section titled "Model and Thinking Configuration" that documents:

| Agent | Model | Effort Level | Rationale |
|-------|-------|--------------|-----------|
| bird  | opus  | high         | Domain analysis benefits from deep reasoning |
| mj    | opus  | high         | Architecture trade-offs require extended thinking |
| kobe  | opus  | high         | Code review requires thorough pattern matching |
| pippen| opus  | high         | Orchestration requires complete task graph analysis |
| shaq  | opus  | medium       | Implementation is execution-heavy, not reasoning-heavy |
| magic | sonnet| low          | Synthesis is structured writing, not complex reasoning |

Also add this warning:

```
Do NOT set CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1. Adaptive thinking is active
by default and allows the model to dynamically scale its thinking budget. Disabling
it removes a meaningful quality lever with no compensating benefit.
```

---

## What NOT to Do

**Do NOT rename agents from persona names to gerund-form.**

Bird flagged that `bird`, `mj`, `shaq` fail the Anthropic naming convention (which prefers `defining-domain-rules` over `bird`). This is documented as a FAIL in the audit. However, it is a deliberate trade-off: the persona names carry identity, team cohesion, and tone that the gerund names would destroy. The descriptions compensate with third-person, examples, and trigger context that satisfy the intent of the naming rule. The names stay. Shaq should not touch agent names.

**Do NOT switch Magic from sonnet to opus+low.**

MJ explicitly evaluated this and rejected it. Magic's synthesis workload is structured writing, not complex reasoning. Sonnet is appropriate and more cost-efficient.

**Do NOT implement Fast Mode.**

Fast Mode IS available in Claude Code (toggle with `/fast`), but it costs 6x standard pricing. User decision: not worth it for multi-agent workflows. Out of scope.

**Do NOT change model assignments for other agents.**

The 5 opus + 1 sonnet lineup was reviewed and confirmed correct by MJ.

---

## Acceptance Criteria

### AC1: evals/ directory

```
given: no evals/ directory exists
when: Shaq creates the evals/ structure
then: evals/ contains at least 3 scenario files per agent (18+ total),
      each file has prompt/expected_behavior/failure_modes/scoring_rubric fields,
      and evals/README.md explains how to run them
```

### AC2: commands/team.md line count

```
given: commands/team.md is 1050 lines
when: Shaq splits it and moves procedural detail to workflows/
then: wc -l commands/team.md returns < 500,
      all procedural content is preserved in workflows/ files,
      and team.md references the workflow files by relative path
```

### AC3: shared Team Protocol extraction

```
given: Team Protocol is copy-pasted in all 6 agent files
when: Shaq extracts the shared block to shared/team-protocol.md
then: shared/team-protocol.md exists with the canonical protocol,
      each agent file has a reference link replacing the inline block,
      agent-specific escalation examples remain inline in each agent file,
      and total line count across the 6 agent files is reduced by ~400 lines
```

### AC4: README effort guidance

```
given: no effort-level documentation exists in the README
when: Shaq adds the Model and Thinking Configuration section
then: README contains a table mapping agent -> model -> effort level -> rationale,
      and includes the CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING warning
```

---

## Contradictions and Resolutions

**Terminology alignment — "boilerplate" vs "shared protocol":**
Bird calls the duplicated content "~500 lines of boilerplate." MJ calls the same thing "shared protocol blocks." These are the same thing. In implementation: the shared structural protocol goes to `shared/team-protocol.md`; agent-specific escalation sub-rules stay inline. Shaq should use the file path `shared/team-protocol.md` (not `protocols/` or `common/`).

**No contradictions between Bird and MJ** were found on the substantive recommendations. Their findings are additive: Bird identified structural/content gaps (evals, line counts, duplication), MJ identified documentation gaps (effort levels, API constraints, adaptive thinking). Both sets of findings are independent and non-conflicting.

---

## Open Questions

1. **Turn budget threshold**: Bird flagged that the 70% turn-budget threshold has no empirical basis. This is noted but left unresolved — changing it requires data from actual runs, which doesn't exist yet. The evals/ work (Priority 1) will generate the data needed to revisit this. For now, leave it at 70%.

2. **SubagentStart hooks for automatic effort switching**: MJ flagged this as a MEDIUM-impact speculative idea. It is not in scope for this implementation — requires experimentation before a commitment can be made. Flag it as a future investigation item in the README or an evals/ scenario.

3. **Workflow file naming convention**: Bird's finding uses "progressive disclosure splitting" as the goal, but does not specify exact filenames for the `workflows/` directory. The names above (`recording-lifecycle.md`, `phase-transitions.md`, etc.) are MJ's recommendation — Shaq should read `commands/team.md` and let the content sections guide the final split. The names are illustrative, not mandatory.

---

## Audit Scorecard Reference

| Check | Before | After (target) |
|-------|--------|----------------|
| Naming | FAIL | FAIL (deliberate — no change) |
| Descriptions | PASS | PASS |
| Conciseness | PARTIAL | PASS (via AC2) |
| Degrees of Freedom | PASS | PASS |
| Progressive Disclosure | PARTIAL | PASS (via AC2) |
| Workflows & Feedback Loops | PASS | PASS |
| Templates & Examples | PASS | PASS |
| Evaluations | FAIL | PASS (via AC1) |
| Consistency | PARTIAL | PASS (via AC3) |
| Error Handling | PARTIAL | unchanged (out of scope) |

**Error Handling remains PARTIAL** — Bird's audit noted this as a gap but did not define specific changes. It is out of scope for this implementation. Shaq should not touch error handling without a new Bird analysis pass.

---

## Files Summary

| File | Action | Priority |
|------|--------|----------|
| `evals/` directory + 18+ scenario files + README | CREATE | P1 — CRITICAL |
| `workflows/recording-lifecycle.md` | CREATE | P2 — CRITICAL |
| `workflows/phase-transitions.md` | CREATE | P2 — CRITICAL |
| `workflows/escalation-protocol.md` | CREATE | P2 — CRITICAL |
| `workflows/session-report-format.md` | CREATE | P2 — CRITICAL |
| `commands/team.md` | MODIFY (trim to <500 lines) | P2 — CRITICAL |
| `shared/team-protocol.md` | CREATE | P3 — IMPORTANT |
| `agents/bird.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `agents/mj.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `agents/shaq.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `agents/magic.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `agents/kobe.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `agents/pippen.md` | MODIFY (replace inline protocol with reference) | P3 — IMPORTANT |
| `README.md` | MODIFY (add effort table + adaptive thinking warning) | P4 — IMPORTANT |

Total: 5 new directories/files (evals tree), 4 new workflow files, 1 new shared file, 7 modified files.
