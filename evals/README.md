# Evals

Evaluation scenarios for each Dream Team agent. Each scenario is a structured test that verifies an agent produces correct, on-spec behavior in a specific situation.

## Structure

```
evals/
  bird/         Domain Authority — domain rules, acceptance criteria, business impact
  mj/           Strategic Architect — pattern selection, health diagnosis, trade-offs
  shaq/         Primary Executor — spec-faithful implementation, test coverage, escalation
  magic/        Context Synthesizer — synthesis completeness, contradiction detection, handoff quality
  kobe/         Quality Enforcer — finding accuracy, false positive rate, verdict calibration
  pippen/       Stability Reviewer — stability review, integration assessment, operational readiness
  README.md     This file
```

Each agent directory contains 20+ scenario files covering happy paths, edge cases, escalation cases, adversarial inputs, and domain-specific challenges.

## Scenario File Format

Each scenario file contains 4 required fields:

```
prompt:            The input given to the agent
expected_behavior: What correct output looks like (observable, not vague)
failure_modes:     What bad output looks like (specific anti-patterns)
scoring_rubric:    How to grade the output (pass / partial / fail criteria)
```

## How to Run an Eval

1. Open the scenario file to read the prompt and expected behavior.
2. Give the prompt to the agent in a fresh session (no prior context).
3. Read the agent's full output.
4. Score using the scoring_rubric: pass / partial / fail.
5. Record the result with a brief note on what the agent got right or wrong.

Use `bun evals/src/cli.ts` for automated runs (see `--help`), or run manually for human review.

## Scoring

Each scenario is scored on a three-point scale:

| Score   | Meaning |
|---------|---------|
| pass    | Output satisfies all pass criteria in the scoring_rubric |
| partial | Output satisfies some but not all criteria; the main structure is present but incomplete |
| fail    | Output is missing key criteria or contains a failure mode from the failure_modes field |

A full eval run across all 125 scenarios gives an agent quality baseline. Regressions (scenarios that previously passed now failing) after a model or prompt change indicate a quality regression.

## Agent Coverage

| Agent  | Scenarios |
|--------|-----------|
| bird   | 20        |
| mj     | 20        |
| shaq   | 20        |
| magic  | 25        |
| kobe   | 20        |
| pippen | 20        |

Total: 125 scenarios across 6 agents.

## Adding New Scenarios

To add a scenario:
1. Create a new file in the agent's directory following the naming convention: `scenario-NN-descriptive-name.md`
2. Include all 4 required fields: prompt, expected_behavior, failure_modes, scoring_rubric
3. Ground the scenario in the agent's actual responsibilities as defined in `agents/<name>.md`
4. Update the coverage table in this README

## Connection to Agent Definitions

Each scenario is grounded in the agent's definition file at `agents/<name>.md`. Before writing a new scenario, read the agent definition to understand:
- The agent's actual role and responsibilities
- The output schema they are required to produce
- The escalation protocol they must follow
- Their guardrails and decision authority

Scenarios that test behaviors not described in the agent definition are not valid evals.

## Workbench Export

`evals/src/workbench-export.ts` exports eval scenarios into a CSV that can be imported directly into Anthropic Workbench for batch evaluation.

### End-to-End Workflow

**Step 1 — Run the export**

```bash
# Export a single agent
bun evals/src/workbench-export.ts bird

# Export all agents (one CSV per agent)
bun evals/src/workbench-export.ts --all

# Include scoring rubric as a second column
bun evals/src/workbench-export.ts bird --with-rubric
bun evals/src/workbench-export.ts --all --with-rubric
```

Output files are written to `evals/<agent>/workbench-import.csv`.

**Step 2 — Configure Workbench**

In Anthropic Workbench:
1. Open a new prompt session.
2. Set the **System Prompt** to the agent definition file (`agents/<name>.md`).
3. Set the **User Message** to the template variable `{{scenario_input}}` — exactly as written, with double curly braces.

**Step 3 — Import the CSV**

1. Go to the **Evaluate** tab in Workbench.
2. Click **Import Test Cases**.
3. Select the `workbench-import.csv` file for the agent you want to evaluate.
4. Workbench will expand the `scenario_input` column into individual test cases.

**Step 4 — Score results**

Each scenario is graded on a five-point scale that maps to the three-point rubric used in manual evals:

| Workbench score | Manual rubric |
|-----------------|---------------|
| 1–2             | fail          |
| 3               | partial       |
| 4–5             | pass          |

**Step 5 — Optional: use scoring_rubric as a grading prompt**

When you export with `--with-rubric`, the CSV contains a second column `scoring_rubric`. You can paste the rubric text into Workbench's grading prompt field to instruct an LLM judge to apply the same pass/partial/fail criteria used in manual evals.

### CSV Format

The exported CSV follows RFC 4180 escaping (implemented in `evals/src/workbench-export.ts`), which correctly handles prompts that contain quotes, commas, and newlines.

| Column            | Always present | Description                                  |
|-------------------|----------------|----------------------------------------------|
| `scenario_input`  | yes            | The full prompt text for the scenario        |
| `scoring_rubric`  | with --with-rubric only | The scoring rubric for the scenario |

Headers never contain curly braces and are always lowercase with underscores.

### Warnings and Errors

- If a scenario file has no extractable `prompt` field, the script prints a warning to stderr and skips that row. No empty rows are written.
- If an agent name does not match an existing directory, the script exits with a non-zero status and an error message.
- All other scenarios in the batch are still exported when one is skipped.
