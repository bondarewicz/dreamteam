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

Each agent directory contains 3 scenario files covering:
- Scenario 01: Happy path (correct behavior under normal conditions)
- Scenario 02: Edge case (correct behavior under unusual or ambiguous conditions)
- Scenario 03: Escalation case (correct behavior when the agent must stop and escalate rather than proceed)

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

There is no automated runner. Evals are designed for manual review by a human evaluator who can exercise judgment about whether the agent's output satisfies the spirit of the expected_behavior, not just its letter.

## Scoring

Each scenario is scored on a three-point scale:

| Score   | Meaning |
|---------|---------|
| pass    | Output satisfies all pass criteria in the scoring_rubric |
| partial | Output satisfies some but not all criteria; the main structure is present but incomplete |
| fail    | Output is missing key criteria or contains a failure mode from the failure_modes field |

A full eval run across all 18 scenarios gives an agent quality baseline. Regressions (scenarios that previously passed now failing) after a model or prompt change indicate a quality regression.

## Agent Coverage

| Agent  | Scenarios | Happy Path | Edge Case | Escalation |
|--------|-----------|------------|-----------|------------|
| bird   | 3         | scenario-01 | scenario-02 | scenario-03 |
| mj     | 3         | scenario-01 | scenario-02 | scenario-03 |
| shaq   | 3         | scenario-01 | scenario-02 | scenario-03 |
| magic  | 3         | scenario-01 | scenario-02 | scenario-03 |
| kobe   | 3         | scenario-01 | scenario-02 | scenario-03 |
| pippen | 3         | scenario-01 | scenario-02 | scenario-03 |

Total: 18 scenarios across 6 agents.

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
