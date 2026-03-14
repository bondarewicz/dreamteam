# Harbor Framework vs Dream Team Evals — Comparison & Future Improvements

Date: 2026-03-14
Source: https://harborframework.com/

## What is Harbor?

Harbor is a general-purpose framework for evaluating and optimizing agents in container environments. From the makers of Terminal-Bench. Supports arbitrary agents (Claude Code, OpenHands, Codex CLI) against standardized benchmarks (SWE-Bench, Terminal-Bench, Aider Polyglot).

Install: `uv tool install harbor`
CLI: `harbor run -d <dataset@version> -m <model> -a <agent> -n 32`

## Comparison

### Philosophy

| | Harbor | Dream Team |
|---|---|---|
| Target | General-purpose agent benchmarking | Domain-specific agent team evaluation |
| Paradigm | Container-sandboxed execution environments | Session-isolated Claude Code subagent calls |
| Focus | "Can this agent solve coding tasks?" | "Does each specialist agent behave correctly for its role?" |

### Eval Definition

| | Harbor | Dream Team |
|---|---|---|
| Format | Datasets (registered or local dirs), benchmark-oriented | YAML-in-Markdown per-scenario files (`evals/<agent>/scenario-*.md`) |
| Structure | Task = containerized environment + prompt + grader | Scenario = `prompt` + `expected_behavior` + `failure_modes` + `scoring_rubric` + optional `graders` |
| Discovery | CLI flag: `--dataset <name@version>` or `--path <dir>` | Filesystem glob: `evals/*/scenario-*.md` — zero config |
| Granularity | One task = one coding problem | One scenario = one behavioral probe |
| Extensibility | Registry for sharing/versioning datasets | Add a `.md` file — auto-discovered on next run |

Harbor tasks are environment-heavy (Docker, file systems, toolchains). Dream Team scenarios are prompt-heavy (behavioral probes with rich rubrics).

### Runner / Execution

| | Harbor | Dream Team |
|---|---|---|
| Parallelism | Cloud sandbox scaling (Daytona, Modal, E2B) — horizontal across machines | Single-message multi-Agent tool calls — parallel within one session |
| Isolation | Docker containers per task | Fresh Agent subprocess per scenario |
| Multi-trial | `--n-concurrent` for parallel trials | `--trials N` — all N x scenarios in one parallel batch |
| Agents supported | Arbitrary (Claude Code, OpenHands, Codex CLI, etc.) | Dream Team agents only (Bird, MJ, Shaq, Kobe, Pippen, Magic) |
| Durability | Not documented | 3-layer: raw output -> JSONL checkpoint -> final JSON |

Harbor scales horizontally across machines. Dream Team scales within a single Claude Code session.

### Scoring & Grading

| | Harbor | Dream Team |
|---|---|---|
| Primary scorer | Automated graders (details sparse) | Coach K LLM-as-judge scoring against rubric |
| Score values | Likely pass/fail (benchmark-style) | `pass` / `partial` / `fail` (3-tier) |
| Hard gates | Container-level (did the test pass?) | 7 grader types: `json_valid`, `contains`, `not_contains`, `regex`, `section_present`, `field_count`, `length_bounds` |
| Human override | Not documented | First-class: human overrides -> new append-only result file |
| Calibration | Not documented | `confidence_stated` (0-100) + `calibration_gap` metric |
| Multi-trial aggregation | Not documented | Worst-of-N + empirical `pass@1`, `pass@k`, `pass^k`, `flaky` |

### Reporting

| | Harbor | Dream Team |
|---|---|---|
| Output format | Not detailed publicly | Standalone HTML report + append-only JSON |
| Regression detection | Not documented | Automatic: compares vs prior complete baseline |
| Trend tracking | Not documented | Historical pass-rate progression |
| Action items | Not documented | P1/P2/P3 prioritized action items |

## Ideas to Steal from Harbor

### 1. Cloud Sandbox Scaling
Harbor's integration with Daytona/Modal/E2B for horizontal scaling is worth exploring. Currently Dream Team is bottlenecked by a single Claude Code session. If scenarios grow to 100+, we may need distributed execution.

**Potential approach:** Wrap the eval runner to dispatch agent calls across multiple Claude Code sessions or API calls in parallel, rather than being limited to one session's concurrency.

### 2. Dataset Registry / Versioning
Harbor's registered datasets (`dataset@version`) allow sharing and reproducibility. Dream Team scenarios live in the repo which is fine for now, but a versioning scheme for scenario sets could help track eval coverage evolution separately from code changes.

### 3. Agent-Agnostic Harness
Harbor can evaluate arbitrary agents. If Dream Team agents ever need to be compared against alternatives (e.g., "does a different prompt for Bird outperform the current one?"), having a more generic agent interface in the eval runner could help A/B test agent configurations.

### 4. Container-Based Execution Environments
For Shaq scenarios specifically, container isolation would allow testing actual code execution (compile, run tests) rather than just evaluating the output text. This would make Shaq evals more realistic.

## Where Dream Team is Already Ahead

- **LLM-as-judge + grader hybrid** — richer than pure automated grading
- **Human override workflow** — first-class, append-only
- **Calibration tracking** — confidence gap detection is unique
- **3-layer crash-safe durability** — raw output + JSONL checkpoint + final JSON
- **Behavioral probes** — testing agent judgment, not just task completion
- **Regression detection & trend tracking** — built into reporting
- **Prioritized action items** — P1/P2/P3 in HTML report

## Conclusion

The two systems are complementary. Harbor benchmarks raw agent capability on coding tasks. Dream Team evaluates orchestrated team behavior for specialist roles. Future improvement: adopt Harbor's horizontal scaling model if scenario count outgrows single-session parallelism.
