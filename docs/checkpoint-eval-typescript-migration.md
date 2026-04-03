# Checkpoint: eval-typescript-migration
Date: 2026-04-02

## Bird's Domain Analysis
- 19 business rules (12 invariants) covering 4-phase pipeline, grader hard gate, score enum, trial naming, NDJSON parsing, JSON extraction, team scenarios, baseline detection, calibration gap
- 15 acceptance criteria in Given/When/Then format
- 10 edge cases: empty output, [*] on non-array, capitalized score, graders inside prompt blocks, comma-separated filters with spaces
- Confidence: 82%

## MJ's Architecture Design
- 12 TypeScript modules in evals/src/: types, json-extract, scenario-parser, graders, discovery, concurrency, claude-adapter, agent-runner, scorer, assembler, pipeline, cli, report, workbench-export
- Pattern: Pure Core / Impure Shell with DI via ClaudeAdapter interface
- Zero external dependencies, bun:test for testing
- Grader registry pattern, Promise.all + concurrency limiter
- Confidence: 85%

## Magic's Handoff Brief
- No contradictions between Bird and MJ
- Implementation order: inside-out, pure modules first
- Full brief at docs/handoff-brief-eval-migration.json
- Confidence: 90%

## Coach K Task Breakdown
1. types.ts (S) - Type definitions
2. json-extract.ts + tests (S) - 3-tier JSON extraction
3. scenario-parser.ts + tests (M) - Parse markdown scenarios
4. graders.ts + tests (L) - All 8 grader types
5. discovery.ts + tests (S) - Glob + filter
6. concurrency.ts (S) - Promise semaphore
7. claude-adapter.ts (S) - Bun.spawn wrapper
8. agent-runner.ts + tests (M) - NDJSON parsing, team scenarios
9. scorer.ts + tests (M) - Scoring prompts, retry, hard gate
10. assembler.ts + tests (M) - Aggregation, pass@k, calibration gap
11. pipeline.ts + tests (M) - 4-phase orchestration
12. cli.ts (S) - Arg parsing
13. report.ts + workbench-export.ts (S) - DB migration + CSV export
