# Session Synthesis: Best-Practices Implementation (P1 + P4)
Date: 2026-03-12
Session type: Full Team — Agent Team (parallel sessions)
Task: Implement P1 (evals/) and P4 (README effort table) from the Anthropic best-practices audit

---

## Executive Summary

The Dream Team successfully implemented two of four originally planned improvements from the Anthropic best-practices audit. P2 (split team.md) and P3 (shared protocol extraction) were dropped during the session after Bird's analysis revealed both were architecturally unsound given how Claude Code loads agent definitions. P1 and P4 were fully implemented, quality-reviewed, and shipped after one fix-verify loop.

**Delivered:**
- `evals/` directory with 18 structured evaluation scenarios across 6 agents (Bird, MJ, Shaq, Magic, Kobe, Pippen)
- `evals/README.md` with format spec, scoring guide, and coverage table
- `README.md` effort table updated with implementation cost estimates and an adaptive thinking warning for Shaq

**Scope corrections made during session:**
- Pippen eval scenarios were initially written for orchestration behavior (Coach K's role). All 3 were rewritten to test stability, integration, and operational readiness — Pippen's actual responsibilities.

---

## Agent Contributions

### Bird — Domain Authority (88% confidence, 23,985 tokens, 13 tools, 110s)

Bird's primary role in this session was checkpoint validation — confirming that all assumptions made before implementation were accurate against the actual file states. This is Bird's escalation-prevention function: verify before anyone builds.

Key findings:
- All 4 acceptance criteria from the checkpoint (AC1-AC4) confirmed valid. No drift between planned state and actual file state.
- **P3 line-reduction estimate overestimated by 5x.** The checkpoint claimed ~400 lines of duplicated protocol content across agent files; Bird measured ~80. This finding was a direct driver of the P3 drop decision — the effort-to-value ratio collapsed.
- **Cross-file reference mechanism unverified.** Agent .md files are loaded as standalone prompts by Claude Code. Markdown links to a shared file would not cause that file's content to be included at runtime. This finding was the decisive blocker for P3.
- Minor finding: the checkpoint effort table listed Shaq's model as `opus` but the frontmatter says `opusplan`. Low severity — no implementation impact.
- Rules established for eval structure: 4 required fields per scenario, minimum 18 scenarios total, agent names must match frontmatter values, model values must match agent file frontmatter.

### Shaq — Primary Executor (97% confidence, 56,974 tokens, 32 tools, 422s — initial; 24,441 tokens, 15 tools, 111s — fix round)

Shaq handled all file creation and modification. Initial implementation delivered all 19 files (18 scenarios + evals/README.md) plus the README.md effort table modification.

Initial implementation findings:
- All 18 scenarios included all 4 required fields
- No deviations from spec on format or field names
- Agent names and model values matched frontmatter across all scenarios
- Pippen scenarios were thematically wrong (see Kobe findings below) — this is a domain error, not a format error

Fix round (after Kobe's review):
- Rewrote all 3 Pippen scenarios from scratch — theme changed from orchestration to stability/integration
- New scenario names: `scenario-01-integration-review.md`, `scenario-02-operational-readiness-gaps.md`, `scenario-03-infrastructure-escalation.md`
- Updated README.md Pippen rationale text
- Updated evals/README.md Pippen agent description

### Kobe — Quality Enforcer (92% confidence, 30,679 tokens, 18 tools, 94s — initial; 23,349 tokens, 10 tools, 29s — verification)

Kobe caught the single most consequential error in the session: all 3 Pippen scenarios tested orchestration rather than Pippen's actual role.

Initial review findings:
- **CRITICAL: All 3 Pippen scenarios tested orchestration behavior.** The scenarios gave Pippen tasks that belong to Coach K (coordinating agent handoffs, managing task routing). Pippen's role is stability review, integration assessment, and operational readiness — none of which appeared in the initial scenarios.
- **HIGH: README.md Pippen rationale said "Orchestration" instead of "Stability review."** The effort table entry was also wrong.
- **IMPORTANT: evals/README.md Pippen description referenced orchestration** in the agent description.

Verdict after initial review: SHIP WITH FIXES.

Verification round: All 3 findings confirmed fixed. Final verdict: SHIP.

### Magic — Context Synthesizer (this document)

Synthesized all agent outputs into this document. Logged retro events to the session cast file.

---

## Decisions and Rationale

### Decision 1: Drop P2 (split team.md)

**What was decided:** Keep `commands/team.md` as a single 1,050-line file.

**Rationale:** `commands/team.md` is loaded as Coach K's full system prompt by Claude Code. Claude Code slash commands load the entire file as the prompt — there is no mechanism for a slash command to follow cross-file references and include content from sibling files. Splitting the file would have removed content from Coach K's context at runtime. The current size (1,050 lines) is appropriate for a complex orchestrator whose system prompt must encode routing logic, all six agent personas for coordination, and the full team protocol.

**Finding that drove this:** Claude Code's slash command loading is flat — one file, one prompt.

### Decision 2: Drop P3 (shared protocol extraction)

**What was decided:** Do not extract shared escalation protocol content into a shared/ directory.

**Rationale (two independent blockers):**
1. **Runtime resolution failure:** `install.sh` does flat file copies to `~/.claude/agents/`. There is no `shared/` directory in the install target. Even if agent .md files contained markdown links to a shared protocol file, Claude Code loads each agent file as a standalone prompt — it does not follow links to include referenced content.
2. **Effort miscalibration:** Bird measured ~80 lines of genuinely duplicated protocol content across agent files, not the ~400 estimated in the checkpoint. The effort-to-value ratio made this not worth doing even if the runtime problem were solved.

**Finding that drove this:** Both the runtime loading mechanism and the size estimate were wrong in the checkpoint.

### Decision 3: Approve P1 (evals/) and P4 (README effort table)

**What was decided:** Implement both. No architectural risks. Clear spec. Bounded scope.

**Rationale:** P1 creates durable quality infrastructure — 18 eval scenarios that can be run after any model or prompt change to detect regressions. P4 surfaces the cost and model choice for each agent, which is useful operational information for users deciding which agent to invoke. Neither required changes to the runtime loading path.

### Decision 4: Fix-verify loop on Pippen scenarios

**What was decided:** Kobe's CRITICAL finding required a full rewrite of all 3 Pippen scenarios before shipping.

**Rationale:** Evals that test the wrong behavior are worse than no evals — they give a false quality signal. Shipping orchestration evals under Pippen's name would have meant every future "Pippen eval run" was testing Coach K, not Pippen. The fix-verify loop caught this before it became a persistent artifact.

---

## Files Created / Modified

### Created

| File | Purpose |
|------|---------|
| `evals/README.md` | Format spec, scoring guide, coverage table, instructions for running and extending evals |
| `evals/bird/scenario-01-domain-rule-extraction.md` | Bird happy path: extract domain rules from a business spec |
| `evals/bird/scenario-02-acceptance-criteria-completeness.md` | Bird edge case: incomplete or ambiguous acceptance criteria |
| `evals/bird/scenario-03-business-impact-assessment.md` | Bird escalation: business impact requires escalation, not estimation |
| `evals/mj/scenario-01-architecture-pattern-selection.md` | MJ happy path: pattern selection with clear trade-off analysis |
| `evals/mj/scenario-02-system-health-diagnosis.md` | MJ edge case: health diagnosis under ambiguous signals |
| `evals/mj/scenario-03-trade-off-analysis.md` | MJ escalation: trade-offs require stakeholder input, not unilateral decision |
| `evals/shaq/scenario-01-spec-faithful-implementation.md` | Shaq happy path: implement exactly to spec |
| `evals/shaq/scenario-02-test-coverage.md` | Shaq edge case: coverage gaps under ambiguous requirements |
| `evals/shaq/scenario-03-escalation-on-ambiguity.md` | Shaq escalation: ambiguous spec requires escalation before implementing |
| `evals/magic/scenario-01-synthesis-completeness.md` | Magic happy path: complete synthesis with all agent inputs |
| `evals/magic/scenario-02-contradiction-detection.md` | Magic edge case: contradicting agent outputs require explicit flagging |
| `evals/magic/scenario-03-handoff-brief-quality.md` | Magic escalation: missing agent output requires escalation, not partial synthesis |
| `evals/kobe/scenario-01-review-finding-accuracy.md` | Kobe happy path: accurate findings with correct severity |
| `evals/kobe/scenario-02-false-positive-rate.md` | Kobe edge case: avoids false positives on correct code |
| `evals/kobe/scenario-03-verdict-calibration.md` | Kobe escalation: verdict calibration when risk is genuinely unclear |
| `evals/pippen/scenario-01-integration-review.md` | Pippen happy path: service with adequate observability confirmed READY |
| `evals/pippen/scenario-02-operational-readiness-gaps.md` | Pippen edge case: service with partial observability — READY WITH CAVEATS |
| `evals/pippen/scenario-03-infrastructure-escalation.md` | Pippen escalation: incomplete rollback plan requires escalation |

### Modified

| File | Change |
|------|--------|
| `README.md` | Added effort table with token counts, time, confidence, and model per agent; added adaptive thinking warning for Shaq |

---

## Open Items and Risks

### Risk: Pippen eval naming convention

The Pippen scenario file names use descriptive topic names rather than the generic `scenario-01-happy-path.md` pattern used by other agents. This was an intentional naming choice by Shaq after the rewrite (more descriptive), but it creates an inconsistency across the eval directory. Low severity — the evals/README.md documents the happy/edge/escalation mapping explicitly, so the intent is still clear.

### Risk: No automated eval runner

The evals are manual by design — a human evaluator must run each scenario and exercise judgment. This is correct for the current team size and toolset, but means evals will only be run if someone actively decides to run them. There is no CI integration to enforce this.

### Open question: Eval coverage for Coach K

There are no evals for Coach K (`commands/team.md`). The orchestrator is the most complex component and arguably the highest-leverage agent to evaluate. This was out of scope for this session but worth addressing.

### Open question: Eval versioning

Evals have no version field. If an agent's responsibilities change, old evals will silently become invalid (they'll still run, but test the wrong behavior). A version or "last validated against" field in each scenario might be worth adding.

---

## Team Metrics

| Metric | Value |
|--------|-------|
| Escalation count | 0 |
| Fix-verify loops | 1 |
| Contradictions detected | 0 (Bird and Kobe findings were complementary, not conflicting) |
| Scope drops | 2 (P2, P3 — both architecturally justified) |

### Confidence per agent

| Agent | Confidence | Notable caveat |
|-------|-----------|---------------|
| Bird | 88% | Cross-file reference mechanism confirmed by reasoning, not by direct test |
| Shaq (initial) | 97% | Pippen scenarios were format-correct but domain-wrong — confidence was warranted on format, not on domain accuracy |
| Shaq (fix round) | 97% | Rewrites grounded in Pippen's agent definition |
| Kobe (initial) | 92% | — |
| Kobe (verification) | implicit SHIP | All 3 findings verified fixed |

### Finding attribution

| Finding | Agent | Severity | Resolved |
|---------|-------|----------|---------|
| P3 line count overestimated by 5x | Bird | Important | Yes — P3 dropped |
| Cross-file references don't resolve at runtime | Bird | Important | Yes — P2 and P3 dropped |
| Shaq model listed as `opus` vs `opusplan` in frontmatter | Bird | Low | No — effort table uses correct value; frontmatter mismatch is pre-existing |
| Pippen scenarios tested orchestration, not stability | Kobe | Critical | Yes — rewrote all 3 scenarios |
| README.md Pippen rationale said "Orchestration" | Kobe | High | Yes — fixed |
| evals/README.md Pippen description referenced orchestration | Kobe | Important | Yes — fixed |

### Token and time usage

| Agent | Tokens | Tools | Time |
|-------|--------|-------|------|
| Bird | 23,985 | 13 | 110s |
| Shaq (initial) | 56,974 | 32 | 422s |
| Shaq (fix round) | 24,441 | 15 | 111s |
| Kobe (initial) | 30,679 | 18 | 94s |
| Kobe (verification) | 23,349 | 10 | 29s |
| Magic | synthesis | — | — |

---

## Suggested Git Commands

```bash
# Review what was created
git status
git diff README.md

# Stage and commit the eval infrastructure
git add evals/
git add README.md
git commit -m "feat: Add evals/ directory with 18 scenarios across 6 agents

Implements P1 from Anthropic best-practices audit.

- 3 scenarios per agent (happy path, edge case, escalation) for:
  Bird, MJ, Shaq, Magic, Kobe, Pippen
- evals/README.md with format spec, scoring guide, coverage table
- All scenarios grounded in agent definition files (agents/<name>.md)
- Pippen scenarios cover stability/integration/operational readiness
  (not orchestration -- Kobe catch, fix-verify loop completed)

P2 (split team.md) and P3 (shared protocol extraction) dropped:
- Claude Code slash commands load a single file; cross-file references
  don't resolve at runtime. Splitting would remove content from context.
- install.sh does flat copies; no shared/ target directory exists.
- Duplication was ~80 lines, not ~400 as estimated in checkpoint."

# Separate commit for the README effort table
git add README.md
git commit -m "docs: Add effort table to README with model and cost per agent

Implements P4 from Anthropic best-practices audit.

Surfaces token counts, time estimates, confidence levels, and model
choice for each agent. Includes adaptive thinking warning for Shaq
(opusplan may have higher latency on simple tasks)."
```

---

## Next Steps

### Immediate
- Run a manual spot-check on 2-3 eval scenarios to verify they produce meaningful signal when given to the actual agent in a fresh session. The evals were written correctly per spec but have not been exercised against a live agent.
- Decide whether to address the Shaq model label mismatch (`opus` vs `opusplan`) in the existing effort table. Bird flagged this as low severity.

### Near-term
- Add eval scenarios for Coach K (commands/team.md). The orchestrator is the highest-leverage agent to evaluate and currently has zero coverage.
- Consider adding a "last validated against" field to each scenario to prevent silent staleness as agent definitions evolve.
- Consider whether the Pippen scenario naming convention (descriptive names vs generic happy/edge/escalation names) should be standardized across all agents.

### Future
- Investigate CI integration for eval runs — even a simple script that lists all 18 scenario files and reminds the user to run them after a model change would be better than purely manual.
- Revisit P3 (protocol deduplication) if the install mechanism ever gains support for a shared/ directory or if a different deduplication approach (code-level rather than file-level) becomes viable.
