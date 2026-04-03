# Eval Improvement Workflow

A practical guide for diagnosing and improving agent eval scores. Written based on the Bird structured-output improvement session (2026-03-17).

---

## System overview

Each agent (Bird, Kobe, MJ, Shaq, Pippen, Magic) has 20 eval scenarios. Each scenario runs through:

1. **Agent call** — the agent produces output
2. **Deterministic graders** — structural/format checks (field presence, JSON validity, value constraints)
3. **Rubric scoring** — LLM-based quality scoring by Coach K

Results are written to `evals/results/raw/<timestamp>/` and compiled into the web app DB. The web app at localhost:3000 is the single source of truth. Never read scores from the terminal; never guess scores from memory.

The eval script handles the full pipeline. Never orchestrate agent calls manually.

---

## Step 1: Baseline run

Run the full suite to get a current picture across all agents.

```
/eval
```

Open the web app at localhost:3000. Look at pass rates per agent. Identify which agent has the lowest score or the largest regression. That is your target.

---

## Step 2: Pick your target

The web app at localhost:3000 shows per-agent pass rates. Pick the agent with the lowest pass^N rate or the most recent regression. In the Bird session, Bird dropped from ~65% to ~15-20% after a structured output schema change — that made it the obvious target.

---

## Step 3: Single-trial iteration

Run agent-specific evals for fast feedback. Single trials are cheap and give you signal quickly.

```
/eval bird
```

Analyze grader vs rubric results separately in the report:

- **Grader failures** = structural or format issues. The agent is not producing output that matches the expected schema. Fix the output schema in the scenario grader config, or fix how the agent formats its response.
- **Rubric failures** = content quality issues. The agent is producing valid structure but the content is wrong or incomplete. Fix the agent prompt or spec.

Make your change, re-run `/eval bird`, and compare results in the web app. Repeat until single-trial scores stabilize — meaning additional runs no longer reveal new failure modes.

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

**Web app at localhost:3000 is the single source of truth.** Do not read scores from terminal output. Do not summarize results in the terminal.

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
| Invalid grader path | Grader | Grader references a path that doesn't exist in agent's output schema | Regenerate graders on the scenario edit page |
| Wrong field value | Grader | Agent not following stop conditions | Tighten stop condition instructions in spec |
| Semantic content | Rubric | Agent prompt is vague | Rewrite prompt section covering that domain |
| Flaky (mixed trials) | Multi-trial | Agent is inconsistent on edge cases | Add explicit examples or constraints to spec |
| Hard fail | Multi-trial | Capability gap | Bigger prompt rewrite or out-of-scope for this agent |

---

## Traces

Every eval run captures a full conversation trace per scenario — every tool call, thinking step, and assistant response. When a scenario fails, click the "trace" link on its card in the web app to see exactly where the reasoning went wrong.

Trace pages are rendered by the web app. They show the step-by-step flow with:
- User prompt, thinking blocks, assistant responses, tool calls + results
- Per-step metadata (tokens, cache hit ratio, service tier)
- First-failure highlighting on fail/partial scenarios
- "Show full output" toggle for truncated content

See `docs/follow-up-2026-03-24.md` for full details on trace capture.

---

## Troubleshooting

### Scenario fails but justification says it passed

**Symptom**: A scenario shows `fail` but the rubric justification says "all pass criteria met". The grader results panel shows failed graders with paths like `refund.` or `parcel` that don't match any field in the agent's output.

**Cause**: The auto-generated graders reference paths that don't exist in the agent's JSON output schema. This happens when graders were generated before the schema-aware rewrite (pre-2026-03-27) or when the grader generator has a bug.

**Fix**:
1. Open the scenario in the editor: `/scenarios/<agent>/<scenario-id>`
2. Click **Generate Graders** to regenerate with the schema-aware generator
3. Review the generated graders — every path should reference a real field in the agent's output (e.g., `business_rules`, `acceptance_criteria` for Bird)
4. Click **Save**
5. Click **Dry Run** to re-evaluate with the fixed graders

### Cleaning up eval runs with broken graders

If broken grader runs pollute the dashboard, delete them from the database:

```sql
-- Find runs to delete (check timestamps in the web app)
SELECT run_id, timestamp FROM eval_runs ORDER BY timestamp DESC LIMIT 10;

-- Delete a specific run and its results
DELETE FROM eval_results WHERE run_id = 'eval/run-YYYY-MM-DD-HHMM';
DELETE FROM agent_summaries WHERE run_id = 'eval/run-YYYY-MM-DD-HHMM';
DELETE FROM eval_runs WHERE run_id = 'eval/run-YYYY-MM-DD-HHMM';
```

Run these via: `sqlite3 data/dreamteam.db "DELETE FROM ..."`

### New scenario workflow

When creating a new scenario via `/scenarios/new`:

1. Select agent and describe what the scenario should test
2. Click **Generate Scenario** — Bird generates the prompt and all fields
3. Review and edit the generated content
4. Click **Save** — creates the scenario file on disk
5. Click **Generate Graders** — generates schema-aware graders for the agent
6. Click **Save** again — persists the graders to the file
7. Click **Dry Run** — runs a single-trial eval to validate

The Dry Run button only appears after graders are saved. This enforces the correct sequence.

### Draft promotion workflow

Every `/team` session auto-captures draft eval scenarios in `evals/<agent>/drafts/draft-*.md`. These drafts contain the exact prompt sent to each agent and the agent's actual output. To promote a draft to the production eval suite, use the guided workflow at `/scenarios`:

1. **Review content** — Open the draft from the `/scenarios` page. Review the prompt, reference output, expected behavior, failure modes, and scoring rubric. The scoring rubric is auto-generated from the reference output at capture time, but may need refinement.

2. **Generate Graders** — Click **Generate Graders** to create machine-checkable assertions from the expected behavior and scoring rubric. Review the generated graders — accept or reject each one.

3. **Save** — Click **Save** to persist the graders to the draft file on disk.

4. **Validate** — Click **Validate** to check for errors. Validate also auto-assigns the production scenario name (computing the next scenario number for the agent and setting the title to production format: `Eval: {Agent} — Scenario {NN} — {Name} ({Category})`).

5. **Set category** — Change the category dropdown from "draft" to a real category:
   - **capability** — tests a core agent competency ("can it do this at all?")
   - **regression** — prevents a specific bug from recurring
   - **happy-path** — standard input, expected behavior
   - **edge-case** — unusual inputs or boundary conditions
   - **adversarial** — actively tries to trip the agent

6. **Dry Run** — Click **Dry Run** to execute a single-trial eval. This saves the form, runs the eval, and redirects to the live eval page. The dry run validates that graders execute correctly and the scenario produces a meaningful result. Note: Dry Run auto-saves the form, so no separate Save is needed between Validate and Dry Run.

7. **Promote** — After the dry run completes, return to the draft edit page. The **Promote to Production** button appears. Click it to move the draft from `evals/<agent>/drafts/` to `evals/<agent>/scenario-NN-<name>.md`. The draft file is deleted after promotion.

The draft edit page shows a 7-step workflow stepper at the top indicating your current position. Each step is checked off as you complete it.

**Staleness protection**: If you edit eval-relevant fields (prompt, graders, scoring rubric) after a dry run, promotion is blocked until you re-run. Non-eval fields (category, title, overview) can be changed freely without invalidating the dry run.

**When to promote**: Not every draft needs promotion. Promote drafts that test important behaviors you want to protect against regression. Skip drafts that test trivial or one-off interactions.

---

## File locations

- Agent specs: `agents/<name>.md`
- Scenario files: `evals/<agent>/scenario-NN-<name>.md`
- Draft scenarios: `evals/<agent>/drafts/draft-*.md` (auto-captured from /team sessions)
- Grader configs: embedded in scenario files under `graders:` block
- Raw results: `evals/results/raw/<timestamp>/`
- Compiled results: `evals/results/*.json`
- Trace data: embedded in raw results as `trace` array, viewable via web app
- Web app (single source of truth): `http://localhost:3000` (run with `bun web/index.ts`)
- Web app DB: `data/dreamteam.db` (populated by migration)
- Eval CLI: `evals/src/cli.ts` (run with `bun evals/src/cli.ts`)
- DB migration trigger: `bun web/src/migrate.ts`
- Grader implementations: `evals/src/graders.ts`
