# Checkpoint: Team Evals V2
Date: 2026-03-31

## Bird's Domain Analysis

**Key business rules:**
- BR-1: Team evals test pipeline composition, not individual agents in isolation — must have 2+ phases with cross-agent handoffs
- BR-2: Three scoring dimensions: individual agent quality, cross-agent handoff quality, pipeline outcome
- BR-3: Human checkpoints must be pre-scripted fixtures for reproducibility
- BR-4: Coach K's context curation quality is a graded dimension
- BR-5: Team drafts are distinct from per-agent drafts — capture entire session timeline
- BR-6: Fix-verify loops must be represented in expected behavior
- BR-9: Cross-agent information propagation is the primary value — if Bird identifies a critical rule and Shaq ignores it, the team eval fails even if both individually produce good output

**Key acceptance criteria:**
- AC-1: Each phase executes in order with prior outputs available as context
- AC-2: Dashboard shows team runs with 'team' badge, drill-down to per-agent cards by phase
- AC-3: Human checkpoints inject predetermined responses automatically
- AC-4: Both per-agent AND team drafts generated from every /team session
- AC-5: Cross-agent handoff failures scored distinctly from individual agent failures
- AC-8: Phase-level scoring breakdown shows WHERE pipeline failed

**Confidence: 52%** — greenfield domain, fundamental design decisions still open

## MJ's Architecture Design

**Execution model:** Phase-isolated — each phase runs one agent independently with canned inputs from the scenario file. Human decisions become static fixtures. Deterministic, reproducible, reuses existing eval infrastructure.

**Grading model:** Two-tier — per-phase graders (using each phase's agent schema) + pipeline-level rubric scoring

**Storage:** Existing eval_results table, no schema migration. Phase info encoded in scenario_id naming convention (e.g., `scenario-01-automapper--phase-1`).

**Draft capture:** Write-ahead pattern — skeleton created before agents spawn, appended as each phase completes. Fixes Willow gap.

**Team scenario file format:** Numbered phase blocks (phase_N_agent, phase_N_prompt, phase_N_reference_output, phase_N_expected_behavior, phase_N_graders) + pipeline-level fields (pipeline_expected_behavior, pipeline_scoring_rubric). `phase_N_agent: human` is a special marker for decision fixtures.

**Confidence: 82%**

### Implementation Plan (11 work items)

| WI | Item | Size | Priority | Depends On |
|----|------|------|----------|------------|
| 1 | Write-ahead draft pattern in team.md | M | P0 | — |
| 2 | Team draft template file | S | P0 | — |
| 3 | Team scenario file format (reference scenario) | S | P0 | — |
| 4 | eval-run.sh team support | L | P1 | WI-2, WI-3 |
| 5 | KNOWN_AGENTS update | S | P1 | — |
| 6 | Team scenario parser | M | P1 | WI-3 |
| 7 | Team scenario list + edit UI | M | P2 | WI-6 |
| 8 | Dashboard team badge | S | P2 | — |
| 9 | Team grader generation | S | P2 | WI-6 |
| 10 | Team dry run | M | P2 | WI-4, WI-6 |
| 11 | Team draft promotion | S | P2 | WI-6 |

**Parallel streams:**
- Stream A (immediate): WI-1 + WI-2
- Stream B (immediate): WI-5 + WI-8
- Stream C (blocked on WI-2+3): WI-3 → WI-4 + WI-6
- Stream D (blocked on C): WI-7, WI-9, WI-10, WI-11

## Kobe's Risk Analysis

**3 Critical blockers:**
1. **No timeout in eval-run.sh** — subprocess.run() has no timeout. Team scenarios (20-60 min) hang the thread pool. Fix: add timeout=1800 for team, timeout=300 for individual.
2. **'team' not in KNOWN_AGENTS** — web pipeline silently rejects team scenarios. Fix: add to KNOWN_AGENTS array.
3. **Human checkpoints can't be automated** — team.md has MANDATORY AskUserQuestion calls. Fix: phase-isolated execution with pre-scripted human decisions as fixtures.

**Important issues:**
- Draft template assumes single-agent interaction — team drafts need different structure
- Cost: ~$90-150+ per --trials 3 team eval run
- Non-determinism compounds across 6 agents
- Coach K violated own rules in Willow session (directly edited files instead of routing through Shaq)

**Confidence: 90%**
