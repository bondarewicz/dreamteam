# Eval: Team — Scenario 02 — Eval Infrastructure TypeScript Migration

## Overview

Tests the full Dream Team pipeline on the eval infrastructure TypeScript migration task. Reconstructed from a real session on 2026-04-02 against the dreamteam codebase. Full pipeline: Bird (domain analysis) → MJ (architecture design) → human checkpoint fixture → Shaq (implementation) → Kobe (quality review).

This is a regression test for cross-agent information flow: Bird must identify the grader hard gate, score enum, and trial naming as invariants; MJ must design with ClaudeAdapter DI for testability; Shaq must implement all 8 grader types with behavioral parity; Kobe must find real edge-case bugs (not superficial issues). If Shaq skips grader types or MJ's architecture isn't DI-friendly, the team eval fails even if individual agent outputs are well-structured.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: "orchestration_decision.action"
    expected: "present_checkpoint"
  - type: json_field
    path: "checkpoint_analysis.agent_findings"
    min_items: 2

---

## Phase 1: Bird — Domain Analysis

phase_1_agent: bird

phase_1_prompt: |
  You are Bird, the Domain Authority. Analyze the eval infrastructure migration from shell scripts with embedded Python to TypeScript (Bun runtime) and extract the business rules, constraints, and invariants that must be preserved.

  IMPORTANT: All context is provided inline below. Do NOT search the filesystem — the codebase is not available in this environment.

  ## Eval Infrastructure Context (provided for eval — do NOT search the filesystem)

  The current eval system is 4 shell scripts with embedded Python3 (~87KB total):

  ### scripts/eval-run.sh (~55KB) — Master Orchestrator
  - 4-phase pipeline: agents → graders → scoring → assembly
  - Phase 1 (Agents): invokes `claude` CLI per scenario, captures NDJSON streaming output, extracts final assistant message
  - Phase 2 (Graders): calls eval-graders.sh for each scenario, aggregates pass/fail per grader
  - Phase 3 (Scoring): sends scenario + agent output + rubric to LLM for pass/partial/fail judgment
  - Phase 4 (Assembly): builds final JSON result file
  - Scenario discovery: globs `evals/{agent}/scenario-*.md`
  - Parallel execution via Python ThreadPoolExecutor
  - Team scenario handling: sequential phase execution, human fixtures injected automatically
  - Resume support: skips already-completed scenarios
  - Trial naming: trial 0 → base filename (no suffix), trial N → filename-tN.json

  ### scripts/eval-graders.sh (~24KB) — Deterministic Graders
  8 grader types:
  - `json_valid`: checks output is parseable JSON
  - `contains`: checks field or full output contains substring
  - `not_contains`: checks field or full output does NOT contain substring
  - `regex`: checks field or full output matches regex pattern
  - `section_present`: checks markdown section heading exists in output
  - `field_count`: checks JSON field is an array with expected item count
  - `length_bounds`: checks string field length within [min, max]
  - `json_field`: checks JSON field at dot-path exists and optionally: equals expected, is in one_of list, min_items (array), max_items (array), or "present" (just exists)
    - dot-path supports [*] wildcard for array expansion (e.g. "items[*].name")

  CRITICAL INVARIANT: Any grader failure forces the final scenario score to "fail" regardless of LLM rubric score. This is the hard gate.

  ### Score Enum
  Closed set: "pass", "partial", "fail". No other values are valid.

  ### Result File Format
  ```json
  {
    "agent": "bird",
    "scenario": "scenario-01-foo",
    "trial": 0,
    "score": "pass",
    "grader_results": [...],
    "grader_override": false,
    "rubric_score": "pass",
    "output": "..."
  }
  ```

  ### Trial Naming
  - Trial 0: `evals/results/bird-scenario-01-foo.json`
  - Trial 1: `evals/results/bird-scenario-01-foo-t1.json`
  - Trial N: `evals/results/bird-scenario-01-foo-tN.json`

  ### pass@k / Flaky Metrics
  - pass@k: true if ANY trial across k trials scores "pass"
  - flaky: true if trial scores differ across runs

  ### Scenario Format
  Scenarios at `evals/{agent}/scenario-*.md`. Team scenarios have phase_N_agent, phase_N_prompt, phase_N_graders fields.

  ### Web Dashboard
  Consumes final JSON result files from `evals/results/`. Reads from SQLite DB (auto-migrated from JSON on first run). Dashboard is already TypeScript/Bun at `web/`.

  Your task: Provide a comprehensive domain analysis covering:
  - All business rules, constraints, and invariants (with testable assertions)
  - Complete acceptance criteria (Given/When/Then format)
  - Domain language and terminology (term + definition pairs)
  - What must NEVER break during migration (hard invariants)
  - Edge cases from a business perspective
  - Confidence assessment

  MJ is working on architecture design IN PARALLEL with you. When you complete your domain analysis, message MJ with your key findings so he can validate his architecture against your domain rules. Then message Coach K with your complete output.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_1_expected_behavior: |
  Bird must produce structured JSON with domain_analysis object containing all required sections.

  Bird must identify as hard invariants:
  - Grader hard gate: any grader fail forces final score to "fail" regardless of LLM rubric
  - Score enum: closed set of exactly "pass", "partial", "fail"
  - Trial naming: trial 0 = no suffix, trial N = -tN suffix
  - 4-phase pipeline ordering: agents → graders → scoring → assembly (cannot be reordered)

  Bird must identify all 8 grader types by name with behavioral description.

  Bird must identify pass@k and flaky as derived metrics computed across trials.

  Bird must produce structured JSON output with domain_analysis, business_rules (each with invariant flag and testable_assertion), acceptance_criteria (Given/When/Then), edge_cases, and confidence.

phase_1_graders:
  - type: json_valid
  - type: json_field
    path: "domain_analysis.business_rules"
    min_items: 5
  - type: json_field
    path: "domain_analysis.acceptance_criteria"
    min_items: 3
  - type: contains
    field: "domain_analysis.business_rules"
    value: "grader"
    description: "Bird must identify grader hard gate as invariant"
  - type: contains
    field: "domain_analysis.business_rules"
    value: "pass"
    description: "Bird must identify score enum as invariant"

phase_1_reference_output: |
  {
    "domain_analysis": {
      "business_context": "Migration of eval infrastructure from shell scripts with embedded Python to TypeScript (Bun runtime). The eval system is a 4-phase pipeline that tests AI agent quality by running scenarios, applying deterministic graders, scoring via LLM rubric, and assembling results into a JSON report that feeds a web dashboard. This is the team's quality gate — if migration introduces regressions, bad agent changes could ship undetected.",
      "bounded_context": "Eval Pipeline — scenario discovery, agent execution, deterministic grading, LLM-based rubric scoring, result assembly, and report generation.",
      "ubiquitous_language": [
        {"term": "Scenario", "definition": "A markdown file defining a test case for an agent."},
        {"term": "Agent Run", "definition": "Phase 1 execution: invoking the claude CLI."},
        {"term": "Grader", "definition": "A deterministic, zero-LLM-call check. Eight types."},
        {"term": "Grader Override", "definition": "Hard gate: any grader fail forces final score to fail."},
        {"term": "Score", "definition": "Closed enum: pass, partial, fail."},
        {"term": "Trial", "definition": "Single execution. Trial 0 = base filename, 1+ append -tN."},
        {"term": "pass@k", "definition": "Boolean: true if any trial passes."},
        {"term": "Flaky", "definition": "Boolean: true if trial scores differ."},
        {"term": "Team Scenario", "definition": "Multi-phase scenario with sequential agents."},
        {"term": "Human Fixture", "definition": "Phase with agent=human, output=prompt text."},
        {"term": "Baseline Run", "definition": ">=100 scenarios AND >=80% of total."}
      ],
      "business_rules": [
        {"id": "BR-1", "rule": "Any grader failure forces final score to fail regardless of LLM rubric score", "invariant": true, "testable_assertion": "Given a scenario where all graders fail but rubric scores pass, final score must be fail"},
        {"id": "BR-2", "rule": "Score enum is closed: only pass, partial, fail are valid values", "invariant": true, "testable_assertion": "Score field must match /^(pass|partial|fail)$/ — no other values accepted"},
        {"id": "BR-3", "rule": "Trial 0 uses base filename with no suffix; trial N appends -tN", "invariant": true, "testable_assertion": "Trial 0 file: agent-scenario-name.json; Trial 2 file: agent-scenario-name-t2.json"},
        {"id": "BR-4", "rule": "4-phase pipeline ordering is fixed: agents → graders → scoring → assembly", "invariant": true, "testable_assertion": "Graders must run after agent output is captured; scoring must run after graders; assembly must run last"},
        {"id": "BR-5", "rule": "8 grader types must all be supported with behavioral parity to shell implementation", "invariant": true, "testable_assertion": "Each grader type produces identical pass/fail results for identical inputs vs original shell implementation"},
        {"id": "BR-6", "rule": "json_field dot-path supports [*] wildcard for array expansion", "invariant": true, "testable_assertion": "Path items[*].name matches name field across all array elements"},
        {"id": "BR-7", "rule": "pass@k is true if ANY trial in a k-trial set scores pass", "invariant": false, "testable_assertion": "Given [fail, pass, fail] trials, pass@3 = true"},
        {"id": "BR-8", "rule": "flaky is true if trial scores differ across runs", "invariant": false, "testable_assertion": "Given [pass, fail] trials, flaky = true; given [pass, pass] trials, flaky = false"}
      ],
      "acceptance_criteria": [
        {"id": "AC-1", "given": "A scenario with a grader that fails", "when": "Pipeline runs to completion", "then": "Final score is fail regardless of rubric judgment"},
        {"id": "AC-2", "given": "Trial 0 of scenario bird/scenario-01-foo", "when": "Result is written", "then": "File is named evals/results/bird-scenario-01-foo.json with no suffix"},
        {"id": "AC-3", "given": "Trial 2 of scenario bird/scenario-01-foo", "when": "Result is written", "then": "File is named evals/results/bird-scenario-01-foo-t2.json"},
        {"id": "AC-4", "given": "A json_field grader with path items[*].name and expected present", "when": "Output has items array with name on each element", "then": "Grader passes"},
        {"id": "AC-5", "given": "An existing result file for a scenario+trial", "when": "Resume mode is active and pipeline runs", "then": "Scenario is skipped — not re-executed"}
      ],
      "edge_cases": [
        {"scenario": "Agent output is empty string", "expected_behavior": "json_valid grader fails; grader override activates; final score is fail"},
        {"scenario": "Agent output has leading markdown fence before JSON", "expected_behavior": "json_valid grader fails; migration must handle extraction consistently with original"},
        {"scenario": "json_field path with [*] wildcard on empty array", "expected_behavior": "Grader passes if min_items is 0 or unset; fails if min_items > 0"},
        {"scenario": "Human fixture phase in team scenario", "expected_behavior": "Human phase output is injected verbatim, no claude CLI invocation"},
        {"scenario": "Score value not in closed enum returned by LLM rubric", "expected_behavior": "Pipeline rejects or normalizes to fail — invalid scores must not propagate to result file"}
      ],
      "confidence": {"level": 85, "reasoning": "Domain well-understood from complete context. Uncertainty on edge cases in [*] wildcard expansion semantics and exact LLM rubric extraction behavior."}
    }
  }

---

## Phase 2: MJ — Architecture Design

phase_2_agent: mj

phase_2_prompt: |
  You are MJ, the Strategic Systems Architect. Design the TypeScript module structure for migrating the eval infrastructure from shell scripts with embedded Python to TypeScript (Bun runtime).

  IMPORTANT: All context is provided inline below. Do NOT search the filesystem — the codebase is not available in this environment.

  ## Current System (provided for eval — do NOT search the filesystem)

  4 shell scripts with embedded Python3 (~87KB total):
  - eval-run.sh (~55KB): master orchestrator, 4-phase pipeline (agents → graders → scoring → assembly), ThreadPoolExecutor parallelism, resume support, team scenario handling, NDJSON stream parsing
  - eval-graders.sh (~24KB): 8 deterministic grader types (json_valid, contains, not_contains, regex, section_present, field_count, length_bounds, json_field with [*] wildcard)
  - eval-report.sh (~4KB): result migration to SQLite + web app launch
  - eval-export-workbench.sh (~4KB): CSV export for Anthropic Workbench

  ## Domain Invariants from Bird's Analysis
  - Grader hard gate: any grader fail → final score = fail (regardless of LLM rubric)
  - Score enum: closed set — "pass", "partial", "fail" only
  - Trial naming: trial 0 = base filename, trial N = -tN suffix
  - 4-phase pipeline ordering: agents → graders → scoring → assembly
  - 8 grader types must all be supported with behavioral parity

  ## Existing TypeScript Context
  - Web dashboard already exists at web/ (Bun server, SQLite, Bun.serve on port 3000)
  - Results at evals/results/*.json (append-only)
  - Scenarios at evals/{agent}/scenario-*.md
  - Entry point will be evals/src/cli.ts (already exists as stub)

  ## Design Requirements
  - ClaudeAdapter must be injectable (DI) for testability — tests should not invoke the real claude CLI
  - All 8 grader types must be implemented as testable pure functions
  - Pipeline phases must be independently testable
  - Parallelism via Promise.all or Bun workers (not Python ThreadPoolExecutor)
  - Resume support must be preserved

  Your task: Design the TypeScript module structure. For each module:
  - File path (relative to evals/src/)
  - Exported types and functions
  - Dependencies (which other modules it imports)
  - Testability approach (how it will be unit tested)

  Also provide: module dependency graph, key architectural decisions with trade-offs, and any risks.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_2_expected_behavior: |
  MJ must design a module structure where ClaudeAdapter is injectable via DI — not hardcoded.

  MJ must produce a design where:
  - ClaudeAdapter interface is defined and injectable (real impl calls claude CLI, test impl returns fixtures)
  - Each of the 8 grader types is a testable pure function
  - Pipeline phases are independently invocable (not monolithic)
  - Module dependency graph is acyclic

  MJ must address the NDJSON streaming parsing challenge from the shell implementation.

  MJ must produce structured JSON with executive_summary, modules array (each with path, exports, dependencies, testability), dependency_graph, key_decisions, and risks.

phase_2_graders:
  - type: json_valid
  - type: json_field
    path: "modules"
    min_items: 4
  - type: contains
    field: "modules"
    value: "ClaudeAdapter"
    description: "MJ must design ClaudeAdapter as injectable interface"
  - type: contains
    field: "key_decisions"
    value: "DI"
    description: "MJ must explicitly address dependency injection for testability"

phase_2_reference_output: |
  {
    "executive_summary": "Migrate 4 shell scripts to TypeScript modules under evals/src/. Key architectural decision: ClaudeAdapter interface injected via DI to decouple claude CLI invocation from pipeline logic — enables unit testing without real claude calls. 8 grader types implemented as pure functions in graders.ts. Pipeline phases split into independently testable functions.",
    "modules": [
      {"path": "evals/src/types.ts", "exports": ["ScenarioResult", "GraderResult", "Score", "Trial", "GraderConfig", "ScenarioConfig"], "dependencies": [], "testability": "No logic — pure type definitions"},
      {"path": "evals/src/adapters/claude.ts", "exports": ["ClaudeAdapter", "ClaudeAdapterReal", "ClaudeAdapterFixture"], "dependencies": ["types.ts"], "testability": "ClaudeAdapterFixture returns hardcoded outputs — no CLI calls needed in tests"},
      {"path": "evals/src/graders.ts", "exports": ["runGrader", "jsonValid", "contains", "notContains", "regex", "sectionPresent", "fieldCount", "lengthBounds", "jsonField"], "dependencies": ["types.ts"], "testability": "Pure functions — test with input/expected output pairs, no side effects"},
      {"path": "evals/src/pipeline.ts", "exports": ["runAgentPhase", "runGraderPhase", "runScoringPhase", "runAssemblyPhase", "runScenario"], "dependencies": ["types.ts", "adapters/claude.ts", "graders.ts"], "testability": "Inject ClaudeAdapter fixture; mock scoring LLM call"},
      {"path": "evals/src/runner.ts", "exports": ["runEval", "discoverScenarios", "resolveTrialPath", "shouldSkip"], "dependencies": ["types.ts", "pipeline.ts"], "testability": "discoverScenarios and resolveTrialPath are pure; runEval testable with fixture adapter"},
      {"path": "evals/src/cli.ts", "exports": [], "dependencies": ["runner.ts"], "testability": "Thin CLI wrapper — not directly unit tested"}
    ],
    "dependency_graph": "cli → runner → pipeline → {adapters/claude, graders} → types",
    "key_decisions": [
      {"decision": "ClaudeAdapter DI pattern", "rationale": "Decouples pipeline from claude CLI; enables unit testing without real agent calls", "trade_off": "Slightly more boilerplate than direct subprocess calls"},
      {"decision": "Pure functions for all 8 grader types", "rationale": "Maximally testable; no shared state; deterministic", "trade_off": "None — graders are inherently stateless"},
      {"decision": "Promise.all for parallelism", "rationale": "Native Bun/Node async; simpler than workers for I/O-bound work", "trade_off": "CPU-bound graders could benefit from workers but graders are fast"}
    ],
    "risks": [
      "NDJSON stream parsing from claude CLI output — must handle partial lines and buffering correctly",
      "json_field [*] wildcard array expansion must match shell implementation exactly",
      "Team scenario human fixture injection must match original phase sequencing"
    ]
  }

---

## Phase 3: Human Checkpoint (Fixture)

phase_3_agent: human

phase_3_prompt: |
  Human decision fixture — inject this response automatically:

  "approved — proceed with MJ's architecture. ClaudeAdapter DI is the right call for testability. Make sure Shaq implements all 8 grader types and writes unit tests for each."

  This approves the architecture and adds explicit requirements:
  - All 8 grader types implemented (not just the common ones)
  - Unit tests for each grader type
  - ClaudeAdapter DI pattern as designed by MJ

phase_3_expected_behavior: |
  Human fixture injects approval with explicit requirements for 8 grader types and unit tests.
  Coach K must consolidate Bird's domain analysis and MJ's architecture into a structured checkpoint before presenting it.
  Coach K must NOT proceed to Shaq without presenting the checkpoint and receiving human approval.

phase_3_graders:
  - type: fixture
    value: "approved — proceed with MJ's architecture. ClaudeAdapter DI is the right call for testability. Make sure Shaq implements all 8 grader types and writes unit tests for each."

---

## Phase 4: Shaq — Implementation

phase_4_agent: shaq

phase_4_prompt: |
  You are Shaq, the Primary Executor. Given the analysis and architecture from prior phases, describe your implementation plan as structured JSON.

  IMPORTANT: Do NOT search the filesystem or write actual code files — this is a planning exercise. Describe what you WOULD implement.

  ## Context from Prior Phases

  Bird's domain invariants:
  - Grader hard gate: any grader fail → final score = "fail" regardless of LLM rubric
  - Score enum closed: "pass", "partial", "fail" only
  - Trial naming: trial 0 = base filename (no -tN suffix), trial N = -tN suffix
  - 4-phase pipeline ordering: agents → graders → scoring → assembly (cannot be reordered)
  - 8 grader types: json_valid, contains, not_contains, regex, section_present, field_count, length_bounds, json_field (with [*] wildcard array expansion)
  - Edge cases: empty agent output, markdown-fenced JSON, empty array on [*] wildcard, human fixture phases, invalid score enum values

  MJ's architecture:
  - evals/src/types.ts — shared types (ScenarioResult, GraderResult, Score enum, etc.)
  - evals/src/adapters/claude.ts — ClaudeAdapter interface + real impl + fixture impl for tests
  - evals/src/graders.ts — all 8 grader types as pure functions
  - evals/src/pipeline.ts — 4 phase functions (runAgentPhase, runGraderPhase, runScoringPhase, runAssemblyPhase)
  - evals/src/runner.ts — scenario discovery, trial path resolution, resume support, top-level runEval
  - evals/src/cli.ts — thin CLI entry point

  Human approval: "approved — proceed with MJ's architecture. Make sure Shaq implements all 8 grader types and writes unit tests for each."

  Describe your implementation plan:
  - What files would you create or modify? (At minimum: types.ts, adapters/claude.ts, graders.ts, pipeline.ts, runner.ts, and test files)
  - How would you implement the grader hard gate? (Specific logic)
  - How would you implement json_field with [*] wildcard path expansion?
  - How would you implement trial naming (0 = no suffix, N = -tN)?
  - How would you handle NDJSON streaming from the claude CLI output?
  - What tests would you add? (At minimum: one test per grader type + grader hard gate + trial naming)

  CRITICAL: Your final response must be raw JSON only. First character { last character }. No markdown fences.

phase_4_expected_behavior: |
  Shaq must plan implementation of all 8 grader types — not just the common ones.

  Shaq must explicitly address:
  - Grader hard gate: how any grader fail overrides rubric score to force final score = fail
  - json_field [*] wildcard: how array expansion works in dot-path resolution
  - Trial naming: conditional suffix logic for trial 0 vs trial N
  - NDJSON streaming: how claude CLI output is parsed line-by-line to extract final assistant message
  - ClaudeAdapter DI: real implementation uses claude CLI subprocess; fixture returns hardcoded string

  Shaq must plan at least 1 test per grader type (8 minimum) plus grader hard gate test plus trial naming test.

  Shaq must NOT skip any grader type or defer them to "later".

phase_4_graders:
  - type: json_valid
  - type: json_field
    path: "implementation_summary.files_changed"
    min_items: 5
  - type: contains
    field: "implementation_summary.approach"
    value: "grader"
    description: "Shaq must address all grader types in approach"
  - type: json_field
    path: "tests"
    min_items: 8
  - type: contains
    field: "implementation_summary.approach"
    value: "ClaudeAdapter"
    description: "Shaq must use ClaudeAdapter DI as designed by MJ"

phase_4_reference_output: |
  {
    "implementation_summary": {
      "what_was_built": "TypeScript eval infrastructure under evals/src/ implementing the 4-phase pipeline with all 8 grader types, ClaudeAdapter DI, trial naming, resume support, and NDJSON stream parsing",
      "approach": "MJ's module structure followed exactly. ClaudeAdapter interface injected via constructor — ClaudeAdapterReal spawns claude CLI subprocess and parses NDJSON stream; ClaudeAdapterFixture returns hardcoded string for unit tests. Grader hard gate implemented in runGraderPhase: if any GraderResult.pass === false, grader_override = true and final score forced to fail. json_field [*] wildcard splits path on [*], walks left side to get array, maps right side across all elements. Trial naming: trial === 0 ? baseFilename : baseFilename + -t${trial}.",
      "files_changed": [
        {"path": "evals/src/types.ts", "action": "created"},
        {"path": "evals/src/adapters/claude.ts", "action": "created"},
        {"path": "evals/src/graders.ts", "action": "created"},
        {"path": "evals/src/pipeline.ts", "action": "created"},
        {"path": "evals/src/runner.ts", "action": "created"},
        {"path": "evals/src/cli.ts", "action": "modified"},
        {"path": "evals/src/__tests__/graders.test.ts", "action": "created"},
        {"path": "evals/src/__tests__/pipeline.test.ts", "action": "created"},
        {"path": "evals/src/__tests__/runner.test.ts", "action": "created"}
      ]
    },
    "tests": [
      {"file": "graders.test.ts", "covers": "json_valid: valid JSON passes, invalid JSON fails"},
      {"file": "graders.test.ts", "covers": "contains: substring found passes, not found fails"},
      {"file": "graders.test.ts", "covers": "not_contains: substring found fails, not found passes"},
      {"file": "graders.test.ts", "covers": "regex: pattern match passes, no match fails"},
      {"file": "graders.test.ts", "covers": "section_present: heading exists passes, missing fails"},
      {"file": "graders.test.ts", "covers": "field_count: array length matches passes, mismatch fails"},
      {"file": "graders.test.ts", "covers": "length_bounds: string within bounds passes, outside fails"},
      {"file": "graders.test.ts", "covers": "json_field: dot-path resolution, min_items, one_of, [*] wildcard expansion"},
      {"file": "pipeline.test.ts", "covers": "grader hard gate: any grader fail forces final score to fail"},
      {"file": "runner.test.ts", "covers": "trial naming: trial 0 = no suffix, trial 2 = -t2 suffix"}
    ]
  }

---

## Phase 5: Kobe — Quality Review

phase_5_agent: kobe

phase_5_prompt: |
  You are Kobe, the Relentless Quality & Risk Enforcer. Review the TypeScript eval infrastructure implementation plan.

  IMPORTANT: Do NOT search the filesystem — review the implementation description provided below. This is a review exercise based on the described plan.

  ## Domain Invariants (from Bird — what "correct" means)
  - Grader hard gate: any grader fail forces final score to "fail" regardless of LLM rubric score
  - Score enum closed: "pass", "partial", "fail" only — no other values
  - Trial naming: trial 0 = base filename (no -tN suffix), trial N = -tN suffix
  - 4-phase pipeline ordering: agents → graders → scoring → assembly (cannot be reordered)
  - 8 grader types: json_valid, contains, not_contains, regex, section_present, field_count, length_bounds, json_field (with [*] wildcard array expansion)
  - json_field [*] wildcard: expands path across all array elements
  - pass@k: true if ANY trial scores pass; flaky: true if trial scores differ

  ## Implementation Plan (from Shaq)
  Files created:
  - evals/src/types.ts — shared types and Score enum
  - evals/src/adapters/claude.ts — ClaudeAdapter interface + real (claude CLI subprocess + NDJSON) + fixture
  - evals/src/graders.ts — all 8 grader types as pure functions
  - evals/src/pipeline.ts — 4 phase functions, grader hard gate in runGraderPhase
  - evals/src/runner.ts — scenario discovery, trial path, resume support
  - evals/src/cli.ts — thin CLI entry point
  - evals/src/__tests__/graders.test.ts — 1 test per grader type + [*] wildcard
  - evals/src/__tests__/pipeline.test.ts — grader hard gate test
  - evals/src/__tests__/runner.test.ts — trial naming test

  Shaq's confidence: 80% — notes uncertainty on [*] wildcard edge cases with empty arrays and on NDJSON buffer handling for very large streaming outputs.

  Review for:
  - Edge cases Shaq flagged as uncertain
  - Any grader behavioral parity gaps vs the shell implementation
  - NDJSON parsing correctness under streaming conditions
  - Missing test coverage for business-critical invariants
  - Any latent bugs in the grader hard gate implementation

  Be ruthless — find every way this implementation could go wrong.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_5_expected_behavior: |
  Kobe must identify real edge-case bugs — not superficial issues.

  Kobe should find at minimum:
  - [*] wildcard on empty array: if min_items > 0 grader should fail, but naive implementation might pass (empty array expanded → 0 matches → could be mishandled)
  - LLM rubric returns invalid score value: pipeline must reject/normalize — not propagate to result file
  - NDJSON buffer split across chunk boundary: partial line at chunk end must be buffered, not discarded

  Kobe may also find:
  - pass@k calculation if trial result files are read in filesystem order (not insertion order) could produce inconsistent flaky flag
  - Score enum enforcement: if TypeScript Score type is a string alias rather than a discriminated union, invalid values can slip through at runtime

  Kobe verdict should be SHIP WITH FIXES (not BLOCK — architecture is sound, issues are fixable).

phase_5_graders:
  - type: json_valid
  - type: json_field
    path: "summary.verdict"
    one_of: ["SHIP", "SHIP WITH FIXES"]
  - type: json_field
    path: "critical_findings"
    min_items: 1
  - type: contains
    field: "critical_findings"
    value: "empty"
    description: "Kobe must find the empty array edge case in [*] wildcard grader"

phase_5_reference_output: |
  {
    "summary": {
      "verdict": "SHIP WITH FIXES",
      "one_liner": "Architecture is sound and all 8 grader types are covered, but three edge cases need fixes before this replaces the shell implementation in CI."
    },
    "critical_findings": [
      {
        "title": "[*] wildcard grader on empty array with min_items > 0 may incorrectly pass",
        "severity": "High",
        "detail": "json_field grader with path items[*].name and min_items: 1 against output {items: []} — naive expansion yields empty match set. If implementation checks expanded_results.length >= min_items after expansion, 0 >= 1 correctly fails. But if implementation short-circuits on empty array before checking min_items, it returns pass. Must add explicit test: empty array with min_items: 1 must fail."
      },
      {
        "title": "NDJSON chunk boundary split drops partial lines",
        "severity": "High",
        "detail": "claude CLI streams NDJSON. If a line is split across two Buffer chunks, naive line-split processing discards the partial first chunk and the next chunk starts mid-line, producing an unparseable fragment. Must buffer remainder across chunks using a line-buffer accumulator."
      },
      {
        "title": "LLM rubric invalid score value not validated before writing result file",
        "severity": "Medium",
        "detail": "If LLM returns 'Pass' (capitalized) or 'good' instead of 'pass', and TypeScript Score type is a string alias, the invalid value writes to the result JSON undetected. Downstream dashboard and pass@k calculations break silently. Must normalize and validate against closed enum before assembly."
      }
    ],
    "important_issues": [
      {"title": "pass@k flaky flag depends on trial file read order — filesystem glob order is not guaranteed insertion order across OS/filesystem types"}
    ],
    "pre_ship_requirements": [
      "Add test: json_field [*] wildcard on empty array with min_items: 1 must fail",
      "Add NDJSON line-buffer accumulator for chunk boundary handling",
      "Add Score enum normalization + validation in runScoringPhase before assembly"
    ]
  }

---

## Pipeline-Level Fields

pipeline_expected_behavior: |
  Phase 1 — Bird (Domain Analysis):
  - Identifies grader hard gate, score enum, trial naming, and 4-phase ordering as hard invariants
  - Names all 8 grader types with behavioral descriptions
  - Produces acceptance criteria in Given/When/Then format
  - Identifies edge cases: empty output, markdown-fenced JSON, empty array on [*] wildcard, human fixture phases, invalid score enum

  Phase 2 — MJ (Architecture Design):
  - Designs ClaudeAdapter as injectable interface — not hardcoded subprocess call
  - Splits pipeline into independently testable phases
  - Designs all 8 grader types as pure functions
  - Dependency graph is acyclic: cli → runner → pipeline → {adapters, graders} → types

  Phase 3 — Human Checkpoint:
  - Coach K consolidates Bird and MJ outputs into structured checkpoint
  - Human approves with explicit requirement for all 8 grader types and unit tests
  - Coach K does NOT start Shaq without this approval

  Phase 4 — Shaq (Implementation):
  - Plans all 8 grader types — no skipping
  - Addresses grader hard gate, [*] wildcard, trial naming, NDJSON parsing explicitly
  - Plans minimum 8 grader tests + hard gate test + trial naming test
  - Uses ClaudeAdapter DI as designed

  Phase 5 — Kobe (Quality Review):
  - Finds real edge-case bugs — not superficial issues
  - Catches [*] wildcard empty array edge case
  - Catches NDJSON chunk boundary split
  - Catches LLM score enum normalization gap
  - Verdict: SHIP WITH FIXES

pipeline_failure_modes: |
  - Bird fails to identify grader hard gate as invariant
  - Bird fails to name all 8 grader types
  - MJ designs ClaudeAdapter as hardcoded subprocess (not injectable) — blocks unit testing
  - MJ creates circular dependencies between modules
  - Coach K skips checkpoint and goes directly to Shaq
  - Shaq skips one or more of the 8 grader types ("will add later")
  - Shaq skips [*] wildcard implementation or defers it
  - Shaq plans fewer than 8 grader tests
  - Kobe only finds superficial issues (naming, formatting) instead of behavioral edge cases
  - Kobe misses NDJSON chunk boundary or empty array edge cases
  - Kobe verdict is BLOCK when architecture is sound (over-blocking)

pipeline_scoring_rubric: |
  This is a team eval — scoring covers the full pipeline, not individual agents.

  pass:
    - Bird identifies grader hard gate, score enum, trial naming, and 4-phase ordering as invariants
    - Bird names all 8 grader types
    - MJ designs ClaudeAdapter as injectable interface with fixture for testing
    - MJ's dependency graph is acyclic
    - Coach K presents consolidated checkpoint before Shaq starts
    - Shaq plans all 8 grader types with no deferrals
    - Shaq plans minimum 8 grader tests + hard gate + trial naming
    - Kobe finds at least 1 real behavioral edge case (not superficial)
    - Kobe verdict is SHIP or SHIP WITH FIXES

  partial:
    - Bird misses 1-2 grader types or misses one invariant
    - MJ designs adapter but dependency graph has minor cycle
    - Shaq implements 6-7 of 8 grader types
    - Kobe finds only superficial issues
    - Checkpoint presented but poorly structured

  fail:
    - Bird fails to identify grader hard gate as invariant
    - MJ hardcodes ClaudeAdapter (not injectable) — unit testing blocked
    - Coach K skips checkpoint — Shaq starts without approval
    - Shaq skips 3 or more grader types
    - Kobe misses all behavioral edge cases
    - Any agent produces non-JSON output or invalid JSON
