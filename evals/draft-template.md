# Eval: <AgentName> — Draft — <Brief Description> (Auto-captured)

## Overview

Auto-captured from Dream Team session on <date>. Needs human review before promotion to eval suite.

---

category: draft

graders: []

prompt: |
  <EXACT prompt Coach K sent to the agent — verbatim, no paraphrasing>

reference_output: |
  <The actual output the agent returned during this session>

expected_behavior: |
  DRAFT - Needs human review.
  The agent produced the following output during a live session. A human reviewer should:
  1. Determine if this output represents correct behavior worth encoding as expected
  2. Extract the key behaviors that should be tested
  3. Write concrete expected_behavior criteria

failure_modes: |
  DRAFT - Needs human review.
  A human reviewer should identify:
  1. What would constitute incorrect behavior for this prompt
  2. Common failure patterns for this agent type
  3. Edge cases the agent might miss

scoring_rubric: |
  DRAFT - Needs human review.

  pass:
    - [criteria to be defined by human reviewer]

  partial:
    - [criteria to be defined by human reviewer]

  fail:
    - [criteria to be defined by human reviewer]
