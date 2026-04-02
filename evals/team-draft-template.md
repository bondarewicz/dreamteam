# Eval: Team — Draft — <Brief Description> (Auto-captured)

## Overview

Auto-captured from Dream Team session on <date>. Needs human review before promotion to eval suite.

Source session: <session-id or N/A>

---

category: draft

graders: []

## Session Timeline

| Phase | Agent(s) | Task | Outcome |
|-------|----------|------|---------|
| 1 | <agents> | <task description> | <outcome> |
| 2 | Human | <decision description> | <what was selected> |
| 3 | <agents> | <task description> | <outcome> |

## Prompt

prompt: |
  <EXACT user prompt that initiated this team session — verbatim, no paraphrasing>

## Phase 1: Analysis

### Coach K → <Agent 1>

coach_k_prompt_<agent1>: |
  <EXACT prompt Coach K sent to Agent 1 — verbatim, no paraphrasing>

<agent1>_reference_output: |
  <The actual output Agent 1 returned during this session>

### Coach K → <Agent 2>

coach_k_prompt_<agent2>: |
  <EXACT prompt Coach K sent to Agent 2 — verbatim, no paraphrasing>

<agent2>_reference_output: |
  <The actual output Agent 2 returned during this session>

## Phase 2: Human Decision

human_decisions:
  - question: "<question text from AskUserQuestion>"
    header: "<header label>"
    selected: "<label the human chose>"
    context: "<brief note on when in the session — e.g., 'after Phase 1 analysis checkpoint'>"
  - question: "<next question text>"
    header: "<header label>"
    selected: "<label chosen>"
    context: "<brief note>"

## Phase 3: Implementation

### Coach K → Shaq

coach_k_prompt_shaq: |
  <EXACT prompt Coach K sent to Shaq — must reflect any human overrides from Phase 2>

shaq_reference_output: |
  <The actual output Shaq returned during this session>

## Phase 4: Review

### Coach K → Kobe

coach_k_prompt_kobe: |
  <EXACT prompt Coach K sent to Kobe — include domain rules and implementation summary>

kobe_review_reference_output: |
  <The actual output Kobe returned during this session>

## Phase 5: Fix-Verify Loop(s)

<!-- Repeat this block for each fix-verify iteration. Delete section if no fix-verify loops occurred. -->

### Fix-Verify Loop 1

human_intervention: |
  <If human triggered or guided this loop, capture their exact words and decision>

coach_k_prompt_shaq_fixes: |
  <EXACT prompt Coach K sent to Shaq for fix iteration>

shaq_fixes_reference_output: |
  <Shaq's fix output>

kobe_verify_reference_output: |
  <Kobe's verification output>

## Phase N: Synthesis

### Coach K → Magic

coach_k_prompt_magic: |
  <EXACT prompt Coach K sent to Magic>

magic_reference_output: |
  <The actual output Magic returned during this session>

## Expected Team Behaviors

expected_behavior: |
  Phase 1 — Analysis:
  - <Agent 1> identifies <what they should find — domain rules, architectural approach, risks>
  - <Agent 2> identifies <what they should find>
  - All agents produce structured JSON output

  Phase 2 — Human Checkpoint:
  - Coach K presents consolidated comparison (NOT sequential agent dumps)
  - Human can make an informed decision combining all agent perspectives

  Phase 3 — Implementation:
  - Shaq follows the human-approved approach (not agent recommendations if overridden)
  - Implementation reflects any overrides from Phase 2 human decisions

  Phase 4 — Review:
  - Reviewer(s) verify correctness against domain rules and acceptance criteria
  - Any findings are routed through fix-verify loop before proceeding

  Phase N+ — Fix-Verify:
  - When gaps are found, Shaq adds targeted fixes and reviewer re-verifies
  - Loop continues until reviewer(s) say SHIP

failure_modes: |
  - <Agent 1> fails to identify <critical finding>
  - <Agent 2> recommends <bad approach> without discovering <blocker>
  - Shaq ignores the human's Phase 2 decision and implements agent recommendation instead
  - Coach K presents agent outputs sequentially without synthesis at checkpoint
  - Human checkpoint skipped — implementation starts without approval
  - Fix-verify loop skipped — reviewer findings not addressed before synthesis

scoring_rubric: |
  This is a team eval — scoring covers the full pipeline, not individual agents.

  pass:
    - All analysis agents produce structured analysis with distinct perspectives
    - Coach K presents consolidated comparison enabling informed human decision
    - Human decision (if any override) is respected and flows downstream to Shaq
    - Implementation reflects the approved approach
    - Review catches any missed requirements or gaps
    - Fix-verify loop resolves all issues to SHIP verdict

  partial:
    - Analysis produced but perspectives poorly differentiated
    - Implementation correct but tests not added or incomplete
    - Review misses gaps
    - Human override noted but not fully reflected in Shaq's prompt

  fail:
    - Agents produce duplicate analysis with no distinct value-add per agent
    - Implementation does not reflect the human's approved approach
    - No review performed after implementation
    - Coach K doesn't consolidate parallel analysis into actionable comparison
    - Human checkpoint skipped — implementation starts without approval
