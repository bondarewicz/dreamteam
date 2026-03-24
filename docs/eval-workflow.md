# Eval Improvement Workflow

A practical guide for diagnosing and improving agent eval scores. Written based on the Bird structured-output improvement session (2026-03-17).

---

## System overview

Each agent (Bird, Kobe, MJ, Shaq, Pippen, Magic) has 20 eval scenarios. Each scenario runs through:

1. **Agent call** — the agent produces output
2. **Deterministic graders** — structural/format checks (field presence, JSON validity, value constraints)
3. **Rubric scoring** — LLM-based quality scoring by Coach K

Results are written to `evals/results/raw/<timestamp>/` and compiled into an HTML report. The HTML report is the single source of truth. Never read scores from the terminal; never guess scores from memory.

The eval script handles the full pipeline. Never orchestrate agent calls manually.

---

## Step 1: Baseline run

Run the full suite to get a current picture across all agents.

```
/eval
```

Open the HTML report. Look at pass rates per agent. Identify which agent has the lowest score or the largest regression. That is your target.

---

## Step 2: Pick your target

The HTML report shows per-agent pass rates. Pick the agent with the lowest pass^N rate or the most recent regression. In the Bird session, Bird dropped from ~65% to ~15-20% after a structured output schema change — that made it the obvious target.

---

## Step 3: Single-trial iteration

Run agent-specific evals for fast feedback. Single trials are cheap and give you signal quickly.

```
/eval bird
```

Analyze grader vs rubric results separately in the report:

- **Grader failures** = structural or format issues. The agent is not producing output that matches the expected schema. Fix the output schema in the scenario grader config, or fix how the agent formats its response.
- **Rubric failures** = content quality issues. The agent is producing valid structure but the content is wrong or incomplete. Fix the agent prompt or spec.

Make your change, re-run `/eval bird`, and compare the report. Repeat until single-trial scores stabilize — meaning additional runs no longer reveal new failure modes.

---

## Step 4: Multi-trial validation

Once single-trial looks stable, promote to multi-trial to distinguish reliable passes from lucky ones.

```
/eval bird --trials 5
```

Every agent spec change must be validated with `--trials 3` minimum before shipping. A single passing trial can be luck.

### What the metrics mean

| Metric | What it tells you |
|---|---|
| **pass^5** (all 5 trials pass) | Reliability floor. Primary metric. Ship-safe scenarios. |
| **pass@5** (at least 1 of 5 passes) | Capability ceiling. The agent can do it but not reliably. |
| **pass@1** | Ignore when you have multi-trial data. Noise. |
| **flaky count** | Scenarios where pass@5 = true but pass^5 = false. Highest ROI optimization target. |
| **hard-fail** | Never passes across all trials. Capability gap — needs bigger changes. |

The gap between pass^5 and pass@5 is your improvement potential. Scenarios in that gap are the ones to fix next.

### Ship criteria

| Condition | Action |
|---|---|
| pass^N >= 80% and flaky count = 0 | Ship |
| pass@N >= 80% but pass^N < 80% | Fix flaky scenarios first, then re-validate |
| pass@N < 80% | Blocked — root cause analysis needed |

---

## Step 5: Interpreting scores across schema changes

Be careful comparing scores before and after a structural change to the agent or graders. The numbers are not directly comparable.

Example from the Bird session:

- **Before schema change**: 65% pass rate, but 0/20 grader passes. The graders were not enforcing structure, so rubric scoring was doing all the work. The 65% was inflated — agents were passing without producing valid structured output.
- **After schema change**: 60% pass rate, 20/20 grader passes. The graders now enforce JSON validity and field constraints on every scenario. The new 60% is a more rigorous score.

The post-change 60% represents higher actual quality than the pre-change 65%, even though the number is lower. When you add or tighten graders, expect scores to drop temporarily. That is the graders doing their job.

---

## Hard rules

**Never fabricate or guess scores.** Every score in your analysis must come from a fresh eval run. Do not re-score from memory. Do not estimate.

**HTML report is the single source of truth.** Do not read scores from terminal output. Do not summarize results in the terminal.

**Append-only results.** Never modify existing result files. Each run creates a new timestamped directory.

**Run scenarios in parallel.** The eval script handles this. Never run scenarios sequentially or manually.

**The eval script handles everything.** Use `/eval` and `/eval <agent> --trials N`. Do not call agents directly or write your own orchestration.

---

## Failure taxonomy quick reference

| Failure type | Where it shows | Root cause | Fix |
|---|---|---|---|
| JSON invalid | Grader | Agent wrapping JSON in markdown fences | Grader now handles fences automatically (2026-03-24 fix) |
| Missing field | Grader | Schema mismatch between spec and grader | Align spec and grader config |
| Plan mode stall | Grader | Agent enters plan mode and waits for approval in headless eval | Fixed: --append-system-prompt disables plan mode in eval runs |
| Wrong field value | Grader | Agent not following stop conditions | Tighten stop condition instructions in spec |
| Semantic content | Rubric | Agent prompt is vague | Rewrite prompt section covering that domain |
| Flaky (mixed trials) | Multi-trial | Agent is inconsistent on edge cases | Add explicit examples or constraints to spec |
| Hard fail | Multi-trial | Capability gap | Bigger prompt rewrite or out-of-scope for this agent |

---

## Traces

Every eval run captures a full conversation trace per scenario — every tool call, thinking step, and assistant response. When a scenario fails, click the "trace" link on its card in the HTML report to see exactly where the reasoning went wrong.

Trace pages are standalone HTML files in `reports/evals/traces/`. They show the step-by-step flow with:
- User prompt, thinking blocks, assistant responses, tool calls + results
- Per-step metadata (tokens, cache hit ratio, service tier)
- First-failure highlighting on fail/partial scenarios
- "Show full output" toggle for truncated content

See `docs/follow-up-2026-03-24.md` for full details on trace capture and rendering.

---

## File locations

- Agent specs: `agents/<name>.md`
- Scenario files: `evals/<agent>/scenario-NN-<name>.md`
- Grader configs: embedded in scenario files under `graders:` block
- Raw results: `evals/results/raw/<timestamp>/`
- Trace data: embedded in raw results as `trace` array
- Trace pages: `reports/evals/traces/*.html`
- HTML report: generated from raw results, opened by `/eval`
- Eval script: `scripts/eval-run.sh`
- Report generator: `scripts/eval-report.sh`
- Grader implementations: `scripts/eval-graders.sh`
