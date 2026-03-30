# DREAM TEAM DEMO — PRESENTER NOTES

> Keep this on your second screen. Bold = say it. `Code` = show it. Checkboxes = don't skip.

---

---

## PART 1: CEO + LEADERSHIP (15 min)

---

### 1.1 THE PROBLEM — 2 min

> SHOW: nothing yet, just talk

- [ ] **"AI coding assistants are powerful, but one agent alone has no checks and balances"**
- [ ] **"One perspective means business logic mistakes, security gaps, and architecture issues slip through"**
- [ ] **"Catching a bug in dev is cheap. Catching it in production is not."**

---

### 1.2 THE TEAM — 5 min

> SHOW: README.md agent table or a slide with the roster

- [ ] **"We built a team of 6 AI specialists — each one does one thing well"**

Go through the roster. Keep it conversational:

- [ ] **Bird** — "Checks the business rules are correct. Is this what we actually want?"
- [ ] **MJ** — "Designs the architecture. Will this scale?"
- [ ] **Shaq** — "The builder. Writes the code."
- [ ] **Kobe** — "The quality enforcer. What could break in production?"
- [ ] **Pippen** — "Stability and ops. Can we debug this at 3am?"
- [ ] **Magic** — "Synthesizes everything into docs and summaries"

Then the orchestration:

- [ ] **"Coach K coordinates — decides who works when, curates what each agent sees"**
- [ ] **"Built-in tension by design: correctness vs elegance, quality vs speed"**
- [ ] **"No agent ever commits or pushes code — human is always in control"**

> SHOW: Full Team mermaid diagram (pre-rendered screenshot)

Walk the phases quickly — point at diagram as you go:

- [ ] Bird + MJ analyze in parallel
- [ ] Magic curates handoff
- [ ] **Human checkpoint — nothing gets built until you approve**
- [ ] Shaq implements
- [ ] Kobe + Pippen review in parallel
- [ ] Fix-verify loop if needed
- [ ] Magic writes final synthesis

---

### 1.3 EVALS — HOW WE KNOW IT WORKS — 4 min

> SHOW: eval web dashboard (have it pre-loaded at localhost:3000)

- [ ] **"We don't ship agents based on vibes. We test them empirically."**
- [ ] **"126 test scenarios across all 6 individual agents — not the orchestrator yet, that's V2"**
- [ ] **"Each scenario is a realistic task with defined grading criteria"**
- [ ] **"Scored by an independent grader — agents don't grade themselves"**
- [ ] Point at dashboard: per-agent pass rates, scenario breakdown
- [ ] **Explain pass@k and pass^k** — "You'll see three metrics: pass@1, pass@3, and pass^3. pass@k means: run the agent k times, does it pass *at least once*? That's the ceiling — what the agent is capable of. pass^k means: run it k times, does it pass *every single time*? That's the floor — how consistent it is. So for 3 trials: pass@3 is the best case, pass@1 is the expected single-shot experience, and pass^3 is the worst case. A scenario with pass@3=100% but pass^3=33% means the agent can always get it right eventually but fails 2 out of 3 times — it's capable but unreliable. When pass@3 equals pass^3, the agent is perfectly consistent. We optimize for pass@1 — that's what users actually experience — but we watch the gap between pass@3 and pass^3 to spot flaky scenarios."
- [ ] **"When we change an agent spec, we re-run evals to prove it got better, not worse"**

---

### 1.4 TRACES + CONTINUOUS IMPROVEMENT — 2 min

> SHOW: a retro HTML report (pre-opened in browser tab)

- [ ] **"Every session produces two artifacts"**
- [ ] Point at retro: **"An HTML report — timeline, what each agent did, what was caught, team metrics"**
- [ ] **"And a replayable terminal recording"**
- [ ] **"These traces let us debug bad decisions, spot patterns, and measure improvement over time"**
- [ ] **"On top of that — every /team session automatically creates draft eval scenarios for each agent that ran"**
- [ ] **"So real work feeds directly into our test suite. The more we use it, the better our evals get."**
- [ ] **Real example — Bird's improvement arc:**
  - Quick explainer: "pass@1 = passes first try. pass@3 = passes at least once in 3 tries (ceiling). pass^3 = passes all 3 tries (floor). We care about pass@1 for real-world reliability and watch pass@3 vs pass^3 gap for flakiness."
  - "Bird started at 65% pass@1 — 7 out of 20 scenarios failing"
  - "Evals showed us the exact failure patterns: Bird was mixing escalation types — adding missing_context alongside contradiction — and sometimes producing empty acceptance criteria"
  - "We went through 13 iterations of spec tuning. Hit a plateau at 70% — 5 hard-fail scenarios at 0/3 pass rate, meaning pass^3 was 0% on those — not just unreliable, completely broken"
  - "Breakthrough came from fixing the grader semantics — the contains grader now accepts Bird's substantively correct analysis even when it adds extra escalation types"
  - "Also added structured output contracts to Bird's spec: machine-to-machine framing, escalation type classification before analysis, explicit first/last character rules for JSON"
  - "Result: Bird went from 65% to 90% pass@1, 75% to 100% pass@3, and pass^3 converged with pass@3 — meaning the wins are consistent, not lucky"
  - "That's the flywheel: evals surface the problem, traces show you exactly where, you tune the spec, re-run evals, measure the improvement"

---

### 1.5 WHAT'S NEXT: V2 — 2 min

> SHOW: nothing, just talk. Keep it forward-looking.

- [ ] **"Three things on the roadmap"**
- [ ] **"One — optimizing Shaq's delivery speed. Right now only ~40-50% of Shaq's 100-turn budget goes to actual code writing. The rest is coordination, codebase exploration, and reporting. Three levers to fix that:"**
  - "Lever 1: Richer handoff briefs from Magic — Shaq spends 10-15 turns exploring the codebase to find patterns. If Magic's brief includes exact file paths and code snippets to follow, we recover those turns."
  - "Lever 2: Pre-resolved ambiguity from Bird — every time Shaq hits an edge case not covered in the acceptance criteria, he stalls, escalates, waits for an answer. If Bird covers edge cases upfront, those stalls go away."
  - "Lever 3: Reduce the output tax — Shaq spends 10-15 turns writing a structured report at the end. Things like files_changed can be auto-generated from git diff instead of manually listed."
  - "Combined, that's ~1.4-1.5x more implementation capacity without adding a second coder agent — which we evaluated and rejected because the coordination overhead eats the gains on most tasks."
- [ ] **"Two — team-wide evals. Right now we test each agent alone. V2 tests the full pipeline end-to-end: does Bird's output actually help Shaq write better code?"**
- [ ] **"Three — Braintrust migration. Our eval system is custom-built — shell scripts, SQLite, standalone HTML reports. It works, but we're evaluating Braintrust for better run-over-run comparison and regression tracking. Plan is to start by instrumenting our existing pipeline — push results into Braintrust's logging layer without changing how agents run. Zero capability loss, better dashboard. Then decide if deeper integration is worth it."**
- [ ] **"And cross-agent metrics — handoff quality, context loss between phases, escalation patterns"**
- [ ] **"The goal: prove the team is better than the sum of its parts"**

> TRANSITION: "That's the overview. Now we'll go deeper for the engineering team."

---

---

## PART 2: ENGINEERING DEEP DIVE (30 min)

---

### 2.1 AGENT ARCHITECTURE — 5 min

> SHOW: `agents/bird.md` in editor

Walk through the spec file top to bottom:

- [ ] **Role + persona** — what this agent is responsible for
- [ ] **Tools allowed** — "Bird can read and analyze but can't edit files. Shaq can write code but can't create tasks. Least privilege."
- [ ] **Output schema** — "Structured fields that Coach K validates before passing to the next agent. Prevents agents from talking past each other."
- [ ] **Escalation protocol** — "Rules for when to stop and ask instead of guessing"
- [ ] **Confidence assessment** — "Self-reported confidence, high/low areas, assumptions"
- [ ] **Turn budget** — "Hard limit: stop research at ~70% of turns, write output. Prevents infinite exploration."

> SHOW: quick glance at `agents/shaq.md` for contrast

- [ ] **Model selection** — "Opus for deep reasoning (Bird, MJ, Kobe, Pippen). Opusplan for Shaq. Sonnet for Magic."
- [ ] **"Every agent is just a markdown file. You can read, edit, and contribute."**

---

### 2.2 /TEAM ORCHESTRATION — 5 min

> SHOW: `commands/team.md` in editor

- [ ] **Three modes:**
  - Quick Fix — sequential subagents, fast, lower cost
  - PR Review — 3 agents in parallel, local output only
  - Full Team — 6 independent sessions via agent teams API

- [ ] **Context curation** — "Coach K doesn't dump all output to the next agent. It curates a focused brief. Only what that agent needs."

- [ ] **Fix-verify loop** — "If Kobe finds issues, Shaq fixes, Kobe re-verifies. Repeats until both reviewers say SHIP."

> SHOW: a checkpoint file (`docs/checkpoint-*.md`)

- [ ] **"This is the human gate. Nothing gets implemented until you approve the plan."**

---

### 2.3 LIVE DEMO — 10 min

> SHOW: terminal, font size large

- [ ] Run `/team` Quick Fix on the prepared scenario
- [ ] If it's slow or stalls — **switch to pre-recorded backup immediately, don't wait**

Narrate as it runs:

- [ ] **Bird phase** — point out structured output fields, domain rules extracted
- [ ] **Coach K handoff** — "Watch what gets passed to Shaq vs what gets filtered out"
- [ ] **Shaq phase** — plan mode first, then implementation, AC coverage mapping
- [ ] **Kobe phase** — findings, confidence levels, severity ratings
- [ ] **Magic phase** — final synthesis, retro report

> If using backup recording: play at 2x, pause at each phase transition to explain

---

### 2.4 EVAL FRAMEWORK — 5 min

> SHOW: web app Scenarios Editor — `/scenarios/bird/scenario-01` (has full definition: prompt, expected behavior, failure modes, scoring rubric, graders)

- [ ] **Scenario structure** — walk through each section in the web UI: prompt, expected behavior, failure modes, scoring rubric, grader configs
- [ ] **"126 scenarios across 6 agents — ~20-25 each"**
- [ ] **"Each scenario is a realistic task, not a toy example"**
- [ ] **"Under the hood it's just a markdown file anyone can edit"** — briefly flash the raw `.md` in editor to make the point, then back to web UI

> SHOW: draft promotion flow — `/scenarios` page, click a draft

- [ ] **Draft-to-production walkthrough** — "Here's a draft that was auto-captured from a real /team session"
- [ ] Point at the workflow stepper: "7 steps — review, generate graders, save, validate, set category, dry run, promote"
- [ ] Click **Validate** — "Watch: it auto-assigns the production scenario name and number"
- [ ] Change category to "capability" — "Classify the scenario"
- [ ] **"Dry Run validates it works, then Promote moves it to production. The whole pipeline is guided."**

> SHOW: eval web dashboard

- [ ] Per-agent pass rates
- [ ] Per-scenario drill-down — click into one
- [ ] Trend over time — before/after spec changes

- [ ] **Grading** — "Schema-aware graders, independent scoring, not self-assessed"
- [ ] **Trials** — "We run --trials 3 minimum. Single trial can be lucky."
- [ ] **Draft capture + promotion** — "Every /team session auto-generates draft eval scenarios for each agent. Real work becomes test cases."
  - [ ] **Show the flow**: open `/scenarios`, point at a draft (dashed border, draft badge), click into it
  - [ ] **Walk the stepper**: "7-step guided workflow — review content, generate graders, save, validate, set category, dry run, promote"
  - [ ] **Highlight auto-naming**: "Click Validate — it computes the next scenario number and sets the production title automatically"
  - [ ] **Highlight staleness protection**: "If you edit the prompt or graders after a dry run, it blocks promotion until you re-run. But changing the category is fine."
  - [ ] **"The eval suite grows organically from actual usage. The more we use /team, the better our test coverage gets."**
- [ ] **Real example — walk through Bird's improvement arc:**
  - Remind them: "pass@1 = first try. pass@3 = at least once in 3 (ceiling). pass^3 = all 3 pass (floor). Gap between pass@3 and pass^3 = flakiness."
  - Baseline: 65% pass@1, 75% pass@3 — 7 failing scenarios
  - Failure analysis from evals: Bird was mixing escalation types (adding `missing_context` alongside `contradiction`), wrong type classification (scenario 15), empty acceptance criteria (scenario 17)
  - 13 iterations of spec tuning — hit plateau at 70% — 5 hard-fail scenarios at 0% pass^3
  - Two breakthroughs: (1) fixed grader `contains` semantics to accept substantively correct output with extra types, (2) added structured output contract to Bird's spec — machine-to-machine framing, escalation type classification before analysis
  - Result: 65% -> 90% pass@1, 75% -> 100% pass@3, pass^3 converged with pass@3 — consistent, not lucky
  - "Without evals we'd be guessing. With evals we knew exactly what was failing and could measure every change."

---

### 2.5 RECORDINGS + RETROS — 3 min

> SHOW: retro HTML report in browser

Walk through sections quickly — point at each:

- [ ] Executive summary
- [ ] Timeline with phase markers
- [ ] Agent activity cards
- [ ] Key findings per agent (rendered as cards)
- [ ] Confidence levels per agent (shown as pills on each agent card)

> SHOW: asciinema recording (briefly)

- [ ] **"Markers let you jump to key moments — agent spawns, human decisions, findings"**
- [ ] **"These feed directly back into agent improvement"**

---

### 2.6 HOW TO USE IT — 2 min

> SHOW: terminal or a summary slide

Quick reference — say each one:

- [ ] `/bird` — "Is my business logic correct?"
- [ ] `/shaq` — "Implement this feature"
- [ ] `/kobe` — "Review this code ruthlessly"
- [ ] `/team` — "This is too big for one agent"
- [ ] `/code-review 42` — "Review this PR"

- [ ] **Installation** — "Clone the repo, run `scripts/install.sh`, restart Claude Code. That's it."
- [ ] **Contributing** — "Edit specs in the repo, run install.sh to sync. Agent specs are just markdown."

---

---

## PART 3: Q&A (15 min)

> Have these answers ready. Don't memorize — just know where to point.

| Question                                   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How much does it cost per run?"           | Two sources: (1) for evals, the CLI reports `total_cost_usd` per agent run in its stream-json output — this is the real API cost. (2) For `/team` sessions, we don't have a single cost number — the lineup card tracks per-agent token counts and durations from the session, but cost is checked via `/usage` before and after the run. That gives you the delta. Show the `/usage` numbers you captured during prep.                  |
| "How long does a full /team run take?"     | Quick Fix: ~10 min. Full Team: ~20-30 min. Depends on scope.                                                                                                                                                                                                                                                                                                                                                                             |
| "Can we add our own agents?"               | Yes — it's a markdown file. Show the spec format.                                                                                                                                                                                                                                                                                                                                                                                        |
| "How does this compare to Cursor/Copilot?" | This is a team of specialists with evals, not autocomplete. Different layer.                                                                                                                                                                                                                                                                                                                                                             |
| "What if an agent hallucinates?"           | Escalation protocol, confidence assessment, human checkpoint, fix-verify loop. Multiple safety nets.                                                                                                                                                                                                                                                                                                                                     |
| "Can we use this in CI/CD?"                | `/code-review` already works for PRs. Team-wide evals in V2 will enable pipeline integration.                                                                                                                                                                                                                                                                                                                                            |
| "Why basketball players?"                  | Deliberate trade-off. Anthropic's best practices recommend gerund-form descriptive names (e.g., `defining-domain-rules` instead of `bird`). We audited this and accepted the FAIL — persona names carry identity and team cohesion that functional names destroy. The descriptions compensate with clear role context. And yes, the personas can be changed — they're just markdown files. The architecture doesn't depend on the names. |

---

---

## PREP CHECKLIST — DO BEFORE THE DAY

- [ ] Pick demo scenario — business-legible, non-trivial
- [ ] Dry-run with `/team` Quick Fix — confirm it finishes in ~10 min
- [ ] Record the dry-run as backup
- [ ] Verify retro report generates and looks clean
- [ ] Pre-render the Full Team mermaid diagram as screenshot
- [ ] Start eval web dashboard on localhost:3000
- [ ] Capture `/usage` cost numbers from the dry-run
- [ ] Test screen share — terminal font size, theme readability
- [ ] Pre-open all tabs/files:
  - [ ] README.md (agent table)
  - [ ] Mermaid diagram screenshot
  - [ ] `agents/bird.md`
  - [ ] `agents/shaq.md`
  - [ ] `commands/team.md`
  - [ ] A checkpoint file
  - [ ] Eval web dashboard
  - [ ] `evals/bird/scenario-01-domain-rule-extraction.md`
  - [ ] A retro HTML report
  - [ ] An asciinema recording
  - [ ] Terminal ready with the demo scenario
