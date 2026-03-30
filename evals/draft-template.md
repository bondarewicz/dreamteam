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
  <Auto-generate from reference_output. Describe what the agent must produce:
  - Output format (JSON, prose, structured text)
  - Required top-level keys or sections present in reference_output
  - Key content properties each section must contain
  - Example: "Agent produces valid JSON with a business_rules array (each entry has id, rule, testable_assertion) and an acceptance_criteria array (each entry has id, given, when, then) and a confidence object.">

failure_modes: |
  <Auto-generate from reference_output. Identify what would constitute failure:
  - Output format violations (e.g., not valid JSON, markdown fences around JSON)
  - Missing required top-level keys found in reference_output
  - Sections present but lacking required sub-fields
  - Off-topic or hallucinated content unrelated to the prompt
  - Example: "Output is not valid JSON. Missing business_rules array. Acceptance criteria present but entries lack given/when/then structure. No confidence level provided.">

scoring_rubric: |
  <Auto-generate from reference_output. Define pass/partial/fail thresholds:>

  pass:
    - <Primary format requirement met — e.g., output is valid JSON with no surrounding markdown>
    - <All required top-level sections present — derived from keys in reference_output>
    - <Content is substantive — e.g., entries have required sub-fields, not empty arrays>

  partial:
    - <Format correct but one or more sections missing or incomplete>
    - <Sections present but sub-fields lack required detail — e.g., acceptance criteria present but entries lack given/when/then>

  fail:
    - <Output is not valid JSON (or wrong format entirely)>
    - <Output is completely off-topic or refuses to engage with the task>
