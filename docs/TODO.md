# TODO

Consolidated from all docs. Source file noted for context.

## Eval System

- [ ] Apply structured output (JSON contract) to kobe, mj, shaq, pippen, magic — Bird's pattern proven *(follow-up-2026-03-23)*
- [ ] Audit other agents' eval results for structural compliance issues *(follow-up-2026-03-23)*
- [ ] Research Claude Agent SDK `output_format` for constrained decoding — permanent fix for structured output *(follow-up-2026-03-23)*
- [ ] Fix 22 scenario grader configs that are too specific — use regex alternations or Coach K scoring *(retro-2026-03-16)*
- [ ] Fix `not_contains` grader false positives (context-dependent checks) *(retro-2026-03-16)*
- [ ] Add `.gitignore` or archival policy for `evals/results/` clutter *(retro-2026-03-16)*
- [ ] Improve `parse_scenario_meta` fallback logic *(retro-2026-03-16)*
- [ ] Stabilize flaky scenarios: 15 (Bird misclassifies regulatory compliance), 17 (empty acceptance_criteria), 04 (intermittent) *(eval-workflow, follow-up-2026-03-23)*
- [ ] Add eval scenarios for Coach K — orchestrator has zero coverage *(best-practices-synthesis)*
- [ ] Draft eval promotion tooling: script to review/promote drafts to production *(follow-up-2026-03-23)*
- [ ] Investigate CI integration for eval runs *(best-practices-synthesis)*

## Team Evals V2 (Active — checkpoint-team-evals-v2)

### P0 — Draft Capture (Stream A) — DONE
- [x] WI-0: Add "Capture team eval draft?" question to AskUserQuestion in team.md STEP 1 — opt-in, controls TEAM_EVAL_CAPTURE flag *(2026-03-31)*
- [x] WI-1: Write-ahead draft pattern in team.md — skeleton before agents, append on complete, conditional on TEAM_EVAL_CAPTURE=true *(2026-03-31)*
- [x] WI-2: Team draft template (evals/team-draft-template.md) — multi-phase structure with human_decisions block *(2026-03-31)*
- [ ] WI-3: Team scenario file format — reference scenario from Willow draft *(checkpoint-team-evals-v2)* [S]
- [x] WI-12: Coach K eval scenarios — 5 scenarios in evals/coachk/ testing orchestration rules (never implement directly, context curation, phase ordering, consolidated checkpoints, human decision flow). JSON graders. *(2026-03-31)*
- [x] WI-13: Coach K draft capture — Coach K curation drafts captured at every agent prompt point in evals/coachk/drafts/ *(2026-03-31)*
- [x] WI-14: Human decision capture — AskUserQuestion responses recorded during sessions as fixtures in team draft human_decisions block *(2026-03-31)*
- [x] Recording removed entirely from team.md — RECORDING flag, cast.sh, all recording infrastructure stripped *(2026-03-31)*

### P1 — Team Eval Execution (Stream C) — DONE
- [x] WI-4: eval-run.sh team support — parse_team_scenario, run_team_scenario, score_team_scenario_all_trials, dispatch routing, --timeout-per-phase with TimeoutExpired handling *(2026-04-02)*
- [x] WI-5: Add 'team' + 'coachk' to KNOWN_AGENTS in Scenarios.ts *(2026-04-02)*
- [x] WI-6: Team scenario parser — parseTeamScenario/serializeTeamScenario in scenarios.ts, Phase/ParsedTeamScenario types *(2026-04-02)*

### P2 — Dashboard & Workflow (Stream D) — DONE
- [x] WI-7: Team scenario edit UI — TeamScenarioEditPage with collapsible phases via details/summary *(2026-04-02)*
- [x] WI-8: Dashboard team badge — team (#e8912d) + coachk (#a371f7) in AGENT_COLORS *(2026-04-02)*
- [x] WI-9: Team grader generation — ?phase=N support, per-phase agent schema *(2026-04-02)*
- [x] WI-10: Team dry run — 600s timeout, --agent team *(2026-04-02)*
- [x] WI-11: Team draft promotion — phase-completeness validation *(2026-04-02)*

### Known gaps (from testing)
- [ ] Team scenarios must be self-contained — prompts reference src/Willow.sln but evals run outside Willow repo. Inline canned codebase context so agents don't need the real repo. *(2026-04-02)*
- [ ] Dashboard run detail must show per-phase agent cards with traces — currently only shows team badge, no drill-down into individual phase outputs. Must show each agent's output, grader results, and trace just like individual evals. *(2026-04-02)*
- [ ] Team eval report regression message must include root cause — "P1 Regression at fail" is useless without explaining WHY it failed (e.g., "agents couldn't access Willow codebase — scenario not self-contained"). Include per-phase pass/fail breakdown and first failing phase. *(2026-04-02)*
- [ ] Team dry run stale-run detection — recordDryRunHash not called for team dry runs
- [ ] serializeTeamScenario loses descriptive section headers on round-trip

## Agent Optimization

- [ ] Lever 1: Richer handoff briefs from Magic — include 2-3 file paths with snippets *(shaq-optimization)*
- [ ] Lever 2: Pre-resolved ambiguity from Bird — edge case coverage in acceptance criteria *(shaq-optimization)*
- [ ] Lever 3: Reduce output schema tax — auto-populate `files_changed` and `acceptance_criteria_coverage` from git diff *(shaq-optimization)*
- [ ] Measure Shaq turn usage before/after on a real `/team` run *(shaq-optimization)*
- [ ] Decide whether to address Shaq model label mismatch (`opus` vs `opusplan`) *(best-practices-synthesis)*
- [ ] Validate 70% turn budget threshold with empirical data from actual runs *(checkpoint-best-practices)*

## Integrations

- [ ] Context7: Install MCP server, add tools to MJ's whitelist, add instruction section to Shaq/MJ *(context7-integration)*
- [ ] Serena: Install MCP server, test with real codebase, run MJ/Kobe evals with Serena vs baseline *(serena-integration)*
- [ ] Braintrust: Start with Option 3 (instrumentation) — logging SDK into existing eval pipeline, ~1 day *(braintrust-potential-migration)*

## Governance & Safety

- [ ] Add `claudeMdExcludes` to personal settings *(claude-md-governance)*
- [ ] Add defensive preamble to all 6 agent definitions *(claude-md-governance)*
- [ ] Propose team-agreed CLAUDE.md for each repo using Dream Team *(claude-md-governance)*
- [ ] Add CODEOWNERS after team-agreed CLAUDE.md is merged *(claude-md-governance)*

## Future Ideas (Low Priority)

- [ ] Cloud sandbox scaling (Daytona/Modal/E2B) for horizontal eval scaling *(harbor-comparison)*
- [ ] Dataset registry / versioning scheme for scenario sets *(harbor-comparison)*
- [ ] Agent-agnostic harness for A/B testing configurations *(harbor-comparison)*
- [ ] Container-based execution for Shaq scenarios *(harbor-comparison)*
- [ ] Upgrade Pippen to Opus for complex NFR reviews *(team-improvement-analysis)*
- [ ] SubagentStart hooks for automatic effort switching *(checkpoint-best-practices)*
- [ ] Revisit protocol deduplication if install gains shared/ directory support *(best-practices-synthesis)*
