# TODO

Consolidated from all docs. Source file noted for context.

## Eval System

- [ ] Stabilize flaky scenarios: 15 (Bird misclassifies regulatory compliance), 17 (empty acceptance_criteria), 04 (intermittent) *(eval-workflow, follow-up-2026-03-23)*
- [ ] Draft eval promotion CLI: standalone script to review/promote drafts (web UI exists, no CLI) *(follow-up-2026-03-23)*
- [ ] Investigate CI integration for eval runs *(best-practices-synthesis)*

## Team Evals — Known Gaps

- [x] Team scenarios must be self-contained — scenario-01 references Willow.sln but evals run outside Willow repo. Inline canned codebase context. *(2026-04-02)* — DONE: all code inlined in prompts with "do NOT search filesystem" guards
- [ ] Team eval regression message must include root cause — per-phase pass/fail breakdown and first failing phase *(2026-04-02)*
- [ ] Team dry run stale-run detection — `recordDryRunHash` not called for team dry runs *(bug)*
- [ ] `serializeTeamScenario` loses descriptive section headers on round-trip — only phases 1 and 4 have hard-coded labels *(bug)*

## Agent Optimization

- [ ] Lever 1: Richer handoff briefs from Magic — include 2-3 file paths with snippets *(shaq-optimization)*
- [ ] Lever 2: Pre-resolved ambiguity from Bird — edge case coverage in acceptance criteria *(shaq-optimization)*
- [ ] Lever 3: Reduce output schema tax — auto-populate `files_changed` and `acceptance_criteria_coverage` from git diff *(shaq-optimization)*
- [ ] Measure Shaq turn usage before/after on a real `/team` run *(shaq-optimization)*
- [ ] Validate 70% turn budget threshold with empirical data from actual runs *(checkpoint-best-practices)*

## Integrations

- [ ] Context7: Add tools to MJ's whitelist, add instruction section to Shaq/MJ *(context7-integration)* — MCP server installed
- [ ] Serena: Test with real codebase, run MJ/Kobe evals with Serena vs baseline *(serena-integration)* — MCP server installed
- [ ] Braintrust: Start with Option 3 (instrumentation) — logging SDK into existing eval pipeline *(braintrust-potential-migration)*

## Governance & Safety

- [ ] Add `claudeMdExcludes` to personal settings *(claude-md-governance)*
- [ ] Propose team-agreed CLAUDE.md for each repo using Dream Team *(claude-md-governance)*
- [ ] Add CODEOWNERS after team-agreed CLAUDE.md is merged *(claude-md-governance)*

## Future Ideas (Low Priority)

- [ ] Cloud sandbox scaling (Daytona/Modal/E2B) for horizontal eval scaling *(harbor-comparison)*
- [ ] Dataset registry / versioning scheme for scenario sets *(harbor-comparison)*
- [ ] Agent-agnostic harness for A/B testing configurations *(harbor-comparison)*
- [ ] Container-based execution for Shaq scenarios *(harbor-comparison)*
- [ ] Upgrade Pippen to Opus for complex NFR reviews *(team-improvement-analysis)*
- [ ] SubagentStart hooks for automatic effort switching *(checkpoint-best-practices)*
