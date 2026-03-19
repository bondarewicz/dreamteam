# Retro: Eval Stability Session — 2026-03-16

## What happened

Attempted to run full 120-scenario eval suite multiple times. Each attempt failed differently. The eval system was unreliable and could not consistently produce scored results.

## Root causes found and fixed

### 1. Eval skill orchestrated everything in-context (FIXED)
The 742-line eval skill prompt told Claude Code to read prompts, launch 120 agents, score outputs, and write results — all within a single conversation context. This hit context limits, caused subagents to pick wrong tools (SendMessage instead of Agent), and produced partial results.

**Fix:** Rewrote eval skill as thin wrapper around `scripts/eval-run.sh`. The script handles the full pipeline deterministically outside of context.

### 2. Graders were case-sensitive by default (FIXED)
`contains` and `section_present` graders used exact string matching. Agent output is markdown with title-cased headers. Grader configs had lowercase expectations. Result: 85+ false grader failures across 120 scenarios.

**Fix:** Default is now case-insensitive with separator normalization (underscores, hyphens, spaces collapsed). Opt into `case_sensitive: true` when exact match is needed.

### 3. Calibration gap formula was wrong in eval-run.sh (FIXED)
Used simple pass_rate instead of weighted score (pass=100, partial=50, fail=0). Made calibration numbers inconsistent between the script and the report.

**Fix:** Now uses `(pass*100 + partial*50) / total` matching the eval spec and report script.

### 4. Blind spot metric was missing from calibration (FIXED — prior commit)
An agent could be "Calibrated" on average while stating 90% confidence on a scenario it failed. The average smoothed out individual catastrophic miscalibrations.

**Fix:** Added "Worst Fail Conf" column to calibration table. Overrides flag to "Blind Spot" when any fail has >= 85% confidence. Also added P1 action items for high-confidence fails. Threshold was originally 70% but raised to 85% on 2026-03-19 — at 70% it flagged 5/6 agents as Blind Spot, producing noise rather than signal. Research supports 85%: practical AI deployments use 85% as the boundary between autonomous operation and human escalation, and LLMs are systematically overconfident (84% of scenarios per academic benchmarks), making lower thresholds impractical.

### 5. Token usage and costs were empty (FIXED)
Re-scored runs from saved raw outputs had `tokens_used: 0` because original runs didn't capture token metadata. Fresh runs now capture real token/duration data from agent calls.

## Remaining issues (not yet fixed)

### 6. 22 scenario grader configs are too specific
Graders check for exact terms like `phantom`, `N+1`, `escalat`, `drift`, `configurable`, `bottleneck` that agents express using equivalent but different language. These are semantic checks masquerading as structural checks — Coach K scoring handles this better.

**Action:** Review the 22 failing scenario grader configs. Either loosen the terms, switch to regex with alternations, or remove semantic checks and rely on Coach K for those criteria.

### 7. `not_contains` graders have false positives
Some scenarios say "should not contain BLOCK" but the agent uses "BLOCK" in a valid context different from what was intended. `not_contains` is too blunt for context-dependent checks.

**Action:** Review `not_contains` graders across all scenarios. Consider removing them or making them more specific (e.g., check for `"verdict": "BLOCK"` rather than just `BLOCK`).

### 8. Eval data accumulation
Multiple partial/failed runs created result files and raw output directories that clutter `evals/results/`. Some are incomplete, some have wrong scores due to grader bugs.

**Action:** Clean up result files from this session's failed runs. Establish a `.gitignore` or archival policy for raw output directories.

### 9. `eval-run.sh` scenario_name and scenario_type parsing
The `parse_scenario_meta` function looks for a specific markdown title pattern (`# Eval:...`) that may not match all scenario files. Falls back to empty string for scenario_name.

**Action:** Verify all 120 scenario files match the expected title format, or improve the fallback to derive name from filename (like the eval skill did: strip prefix, replace hyphens, title-case).

### 10. No `--trials` support in eval-run.sh
The script doesn't implement multi-trial runs. The eval skill had detailed specs for `--trials N` but the script only does single runs.

**Action:** Add `--trials N` support to eval-run.sh if multi-trial evaluation is needed.
