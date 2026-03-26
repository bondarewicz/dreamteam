# Braintrust Potential Migration

**Date:** 2026-03-26
**Status:** Assessment complete, no decision made

## Context

The Dream Team eval system is a custom-built, multi-agent evaluation pipeline. This document assesses the feasibility of migrating to [Braintrust](https://www.braintrust.dev/) and documents the trade-offs.

## Current Eval System Overview

### Scale
- 125 scenarios across 6 agents (Bird, MJ, Shaq, Kobe, Pippen, Magic)
- Categories: regression, capability, hard, very hard
- Scenario types: happy-path, edge-case, adversarial, regression

### Architecture (4-phase pipeline)

```
Phase 1: Agent Runs        → Claude CLI with --agent flag (parallel, configurable concurrency)
Phase 2: Deterministic Graders → json_valid, json_field, contains, regex, field_count, length_bounds
Phase 3: LLM Rubric Scoring    → Coach K as judge (pass/partial/fail with justification)
Phase 4: Result Assembly        → JSON aggregation with pass@k, flaky detection
```

### Key Features
- **Scenarios as markdown** — each `.md` file contains prompt, expected_behavior, failure_modes, scoring_rubric, and optional grader configs
- **Grader-as-hard-gate** — deterministic graders override LLM scores (grader fail = scenario fail, no exceptions)
- **Trials with pass@k** — `--trials N` runs each scenario N times, computes pass@1 and pass@3, flags flaky scenarios
- **Standalone HTML reports** — calibration analysis, regression detection, per-agent scorecards, cost tracking
- **Workbench CSV export** — scenarios exportable for Anthropic Console batch eval
- **Agent invocation via CLI** — agents are `.md` definition files executed through `claude --agent`, with full tool use, file system access, and multi-turn reasoning

## What Maps Cleanly to Braintrust

| Current Component | Braintrust Equivalent | Migration Effort |
|---|---|---|
| Scenario prompts + expected outputs | Braintrust Datasets (JSON rows) | Low — write a parser for 125 markdown files |
| Deterministic graders | Custom Scorer functions (Python/TS) | Low — direct 1:1 mapping |
| LLM-as-judge (Coach K) | Braintrust LLM Scorer | Low — reshape rubric format |
| Result storage (JSON) | Braintrust Experiments | Free — handled by SDK |
| HTML reports | Braintrust UI | Free — built-in comparison, regression, timelines |
| Cost tracking | Braintrust logging | Free — automatic with API calls |

## What Gets Harder

### Agent Invocation (Hard)

The agents are Claude Code CLI sessions, not API calls. Each agent has:
- File system access (reads codebase, writes files)
- Tool use (Bash, Grep, Glob, Edit, Write)
- Multi-turn reasoning loop (agent decides when to stop)
- Agent definition files (`.md` with system prompts, output schemas, escalation protocols)

Braintrust expects a `task function` that takes an input and returns an output — essentially `prompt → response`. The CLI agent loop doesn't fit this model without a wrapper.

### Grader Precedence (Medium)

The current system enforces grader-as-hard-gate: if any deterministic grader fails, the scenario fails regardless of how good the LLM judge thinks the output is. Braintrust scorers are additive — all scores are reported independently. Enforcing precedence requires custom logic in the eval harness.

### pass@k / Flaky Detection (Medium)

Braintrust supports running experiments multiple times, but doesn't have native:
- pass@k computation (did at least 1 of k trials pass?)
- Flaky detection (mixed results across trials for the same scenario)
- Consistency ratio (pass@1 / pass@3)

These would need to be built as post-processing on top of Braintrust experiment results.

### Multi-Phase Orchestration (Medium)

The 4-phase pipeline is sequential by design: graders must run after agent output, LLM scoring after graders, assembly after scoring. Braintrust evals are "run function → score" in a single pass. The pipeline would need restructuring — likely collapsing phases 2-4 into a composite scorer.

## Migration Options

### Option 1: Hybrid (Keep Runner, Use Braintrust for Scoring/Reporting)

Keep `eval-run.sh` for Phase 1 (agent execution). After raw outputs are captured, push them into Braintrust as logged experiments and use Braintrust's scorers + UI for phases 2-4.

**Pros:**
- Keep full CLI agent capabilities
- Get Braintrust's UI for comparison and regression
- Incremental migration — can run both systems in parallel

**Cons:**
- Two systems to maintain
- Braintrust doesn't control the agent execution, so tracing is partial
- Estimated effort: 2-3 days

### Option 2: Full Migration (Rewrite Agents as API Calls)

Rewrite all agent definitions as API-based prompt chains. Each agent becomes a Braintrust task function that calls the Claude API directly.

**Pros:**
- Single system, full Braintrust integration
- Native tracing, logging, prompt versioning

**Cons:**
- Lose CLI agent capabilities (file system access, tool use, multi-turn reasoning)
- Major rewrite of agent definitions and invocation logic
- The agents fundamentally depend on tool use — this would require rearchitecting how they work
- Estimated effort: 1-2 weeks, with capability regression

**Not recommended** given current agent architecture.

### Option 3: Instrumentation (Recommended)

Use Braintrust's logging SDK to instrument the existing `eval-run.sh` pipeline. The runner stays unchanged, but results are also pushed to Braintrust for visualization and comparison.

**Pros:**
- Lightest lift — no changes to agent definitions, graders, or scoring
- Get Braintrust's dashboard for time-series comparison and regression tracking
- Zero capability loss
- Can evaluate whether deeper migration is worth it

**Cons:**
- Not a "real" Braintrust eval — more like piping results into their logging layer
- pass@k and flaky detection still handled by existing tooling
- Estimated effort: ~1 day

## Recommendation

**Start with Option 3 (instrumentation).** The current eval system is purpose-built for CLI-based multi-agent evaluation with features (grader-as-hard-gate, pass@k, flaky detection) that don't have direct Braintrust equivalents. The main value Braintrust adds is a better UI for comparing runs over time.

Instrument the pipeline, use it for a few weeks, then decide if deeper integration is worth the trade-offs.

## Decision

_Pending — no migration decision made yet._
