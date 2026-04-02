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

DEMO: Willow automapper warning

1. Build sln
2. Catch a warning
3. /team suggest possible approaches to avoid automapper dependency, use bird, mj & kobe in parallel and present their suggestions
4. While it runs move to evals

### 1.3 EVALS — HOW WE KNOW IT WORKS — 4 min

> SHOW: eval web dashboard (have it pre-loaded at localhost:3000)

- [ ] **"We don't ship agents based on vibes. We test them empirically."**
- [ ] **"126 test scenarios across all 6 individual agents — not the orchestrator yet, that's V2"**
- [ ] **"Each scenario is a realistic task with defined grading criteria"**
- [ ] **"Scored by an independent grader — agents don't grade themselves"**
- [ ] Point at dashboard: per-agent pass rates, scenario breakdown
- [ ] **Explain pass@k and pass^k** — "You'll see three metrics: pass@1, pass@3, and pass^3. pass@k means: run the agent k times, does it pass _at least once_? That's the ceiling — what the agent is capable of. pass^k means: run it k times, does it pass _every single time_? That's the floor — how consistent it is. So for 3 trials: pass@3 is the best case, pass@1 is the expected single-shot experience, and pass^3 is the worst case. A scenario with pass@3=100% but pass^3=33% means the agent can always get it right eventually but fails 2 out of 3 times — it's capable but unreliable. When pass@3 equals pass^3, the agent is perfectly consistent. We optimize for pass@1 — that's what users actually experience — but we watch the gap between pass@3 and pass^3 to spot flaky scenarios."
- [ ] **Explain blind spots** — "These metrics tell you how good the agent is _at the things you thought to test_. But there's always a blind spot — the scenarios you didn't write. A 100% pass rate on 20 scenarios doesn't mean the agent is perfect, it means it's perfect at those 20 tasks. That's why we have three defenses against blind spots:"
  - "One — draft eval capture. Every `/team` session auto-generates draft scenarios from real work. So the test suite grows from actual usage, not just imagination."
  - "Two — failure mode fields. Every scenario defines `failure_modes` — specific anti-patterns we've seen. When we discover a new failure in production, we add it as a scenario. The suite encodes our scar tissue."
  - "Three — category separation. `regression` scenarios protect what works. `capability` scenarios push the frontier. If all your scenarios are regression, you've stopped learning. If all are capability, you're not protecting your gains."
  - "The honest truth: evals are a lower bound on quality, never an upper bound. But a measured lower bound beats an unmeasured guess every time."
- [ ] **"When we change an agent spec, we re-run evals to prove it got better, not worse"**

---

### 1.4 TRACES + CONTINUOUS IMPROVEMENT — 2 min

> SHOW: a retro HTML report (pre-opened in browser tab)

- [ ] **"Every session produces an HTML retro report"**
- [ ] Point at retro: **"An HTML report — timeline, what each agent did, what was caught, team metrics"**
- [ ] **"These traces let us debug bad decisions, spot patterns, and measure improvement over time"**
- [ ] **"On top of that — every /team session automatically creates draft eval scenarios for each agent that ran"**
- [ ] **"So real work feeds directly into our test suite. The more we use it, the better our evals get."**
- [ ] **Real example — Bird's improvement arc:**
  - Quick explainer: "pass@1 = passes first try. pass@3 = passes at least once in 3 tries (ceiling). pass^3 = passes all 3 tries (floor). We care about pass@1 for real-world reliability and watch pass@3 vs pass^3 gap for flakiness. And remember — these metrics only cover scenarios we've written. Blind spots shrink over time as real usage generates new draft scenarios."
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

- [ ] **"We just shipped Miro integration — agents can now read boards, create diagrams, write docs, all via MCP. DDD event storming, architecture diagrams, domain catalogs — directly on Miro."**
- [ ] **"Three more things on the roadmap"**
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
- [ ] If it's slow or stalls — **open a second terminal with the dry-run retro report and walk through it**

Narrate as it runs:

- [ ] **Bird phase** — point out structured output fields, domain rules extracted
- [ ] **Coach K handoff** — "Watch what gets passed to Shaq vs what gets filtered out"
- [ ] **Shaq phase** — plan mode first, then implementation, AC coverage mapping
- [ ] **Kobe phase** — findings, confidence levels, severity ratings
- [ ] **Magic phase** — final synthesis, retro report

---

### 2.4 EVAL FRAMEWORK — 5 min

> SHOW: web app Scenarios Editor — `/scenarios/bird/scenario-01` (has full definition: prompt, expected behavior, failure modes, scoring rubric, graders)

- [ ] **Scenario structure** — walk through each section in the web UI: prompt, expected behavior, failure modes, scoring rubric, grader configs
- [ ] **"126 scenarios across 6 agents — ~20-25 each"**
- [ ] **"Each scenario is a realistic task, not a toy example"**
- [ ] **"Under the hood it's just a markdown file anyone can edit"** — briefly flash the raw `.md` in editor to make the point, then back to web UI

> SHOW: draft promotion flow — `/scenarios` page

- [ ] **Point at the two badge states** — "Notice the green READY badge on Kobe's draft vs the gray DRAFT badge on Shaq's"
  - Kobe `draft-2026-03-30-1900-passbar-segments-003` — **READY** (green): has graders, category set, dry run done
  - Shaq `draft-2026-03-30-1900-passbar-segments-002` — **DRAFT** (gray): still needs graders, dry run, etc.
- [ ] **"The badge tells you at a glance which drafts are ready to promote and which still need work"**
- [ ] Click into Kobe's READY draft — show the workflow stepper at step 7 (Promote)
- [ ] **"This one is ready — one click to make it a production scenario"**
- [ ] Click into Shaq's DRAFT — show the workflow stepper at an earlier step
- [ ] Point at the stepper: "7 steps — review, generate graders, save, validate, set category, dry run, promote"
- [ ] Click **Validate** — "Watch: it auto-assigns the production scenario name and number"
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
- [ ] **Workbench export** — "We can export any agent's scenarios to Anthropic Workbench for batch evaluation"
  - [ ] Show the command: `scripts/eval-export-workbench.sh bird --with-rubric`
  - [ ] **"One CSV per agent. Set the system prompt to the agent spec, user message to the template variable, import the CSV — done."**
  - [ ] **"This lets you test against different models, temperatures, or prompt variations side-by-side on [platform.claude.com/workbench](https://platform.claude.com/workbench)"**
  - [ ] **"The same scenarios we run locally via eval-run.sh work identically in Workbench — one test suite, two execution environments"**
- [ ] **Real example — walk through Bird's improvement arc:**
  - Remind them: "pass@1 = first try. pass@3 = at least once in 3 (ceiling). pass^3 = all 3 pass (floor). Gap between pass@3 and pass^3 = flakiness."
  - Baseline: 65% pass@1, 75% pass@3 — 7 failing scenarios
  - Failure analysis from evals: Bird was mixing escalation types (adding `missing_context` alongside `contradiction`), wrong type classification (scenario 15), empty acceptance criteria (scenario 17)
  - 13 iterations of spec tuning — hit plateau at 70% — 5 hard-fail scenarios at 0% pass^3
  - Two breakthroughs: (1) fixed grader `contains` semantics to accept substantively correct output with extra types, (2) added structured output contract to Bird's spec — machine-to-machine framing, escalation type classification before analysis
  - Result: 65% -> 90% pass@1, 75% -> 100% pass@3, pass^3 converged with pass@3 — consistent, not lucky
  - "Without evals we'd be guessing. With evals we knew exactly what was failing and could measure every change."

---

### 2.5 MIRO INTEGRATION — 5 min

> SHOW: Miro board at [https://miro.com/app/board/uXjVGp3Xb4A=/](https://miro.com/app/board/uXjVGp3Xb4A=/)
>
> This board was created by running Bird + MJ against **MJ Eval Scenario 05 — Microservices Decomposition** (a courier platform with 8 engineers, 5K writes/sec location tracking, strict payment consistency). The board started with a generic web architecture diagram; the Dream Team added all the DDD event storming artifacts.

- [ ] **"The Dream Team doesn't just analyze — it creates visual artifacts directly on Miro boards"**
- [ ] **"This is a first-class integration via MCP — agents read board context, create diagrams, write documents"**
- [ ] **"This board started with a basic architecture diagram. We pointed Bird and MJ at an existing eval scenario — a courier platform decomposition — and they produced everything you see here."**

Walk through what's on the board:

- [ ] **Scenario Context Card** (top-left) — "First, the scenario: a courier platform monolith, 8 engineers, 500 couriers sending GPS every 10 seconds, payment with strict consistency. This is MJ's eval scenario 05 — a real test case we use to validate the architecture agent."
- [ ] **Event Storming Flowchart** — "Bird analyzed the domain and identified 6 bounded contexts, 24 domain events, 16 business rules. Coach K turned those into this DDD event storming diagram — commands, aggregates, events, policies, all color-coded by bounded context."
- [ ] **Service Decomposition** — "MJ recommended 4 services for an 8-person team. Not 6, not 8 — that's the key insight. The diagram shows team topology (2 engineers per service), infrastructure (TimescaleDB for location, PostgreSQL for payments), and external systems."
- [ ] **Saga Sequence Diagram** — "The full order-payment-delivery flow as a UML sequence diagram — showing sync vs async boundaries between all 4 services plus the courier app."
- [ ] **Document Cards** — "Domain events catalog with payloads and consumers, 6 hot spots needing team discussion, migration strategy with strangler fig pattern across 4 phases. All created by the agents."

> SHOW: the /team command that created this

```
/team come up with implementation plan for https://miro.com/app/board/uXjVGp3Xb4A=/
```

- [ ] **"One command. Bird does domain analysis, MJ does architecture, Coach K orchestrates the Miro updates."**
- [ ] **"The board becomes a living artifact — not a static diagram someone drew once and forgot"**
- [ ] **"We used an existing eval scenario as the domain input — the same scenarios we test agents with become the source material for real visual output"**

Key points to emphasize:

- [ ] **"Agents read before they write"** — context_get and context_explore analyze existing board content first
- [ ] **"Standard DDD notation"** — event storming colors, swim lanes by bounded context, standard sticky note conventions
- [ ] **"Works with any Miro board URL"** — just paste it into a /team command
- [ ] **"Setup is just OAuth"** — first use prompts for browser auth, then it just works

---

### 2.6 RETRO REPORTS — 3 min

> SHOW: retro HTML report in browser

Walk through sections quickly — point at each:

- [ ] Executive summary
- [ ] Timeline with phase markers
- [ ] Agent activity cards
- [ ] Key findings per agent (rendered as cards)
- [ ] Confidence levels per agent (shown as pills on each agent card)
- [ ] **"These feed directly back into agent improvement"**

---

### 2.7 HOW TO USE IT — 2 min

> SHOW: terminal or a summary slide

Quick reference — say each one:

- [ ] `/bird` — "Is my business logic correct?"
- [ ] `/shaq` — "Implement this feature"
- [ ] `/kobe` — "Review this code ruthlessly"
- [ ] `/team` — "This is too big for one agent"
- [ ] `/team` + Miro URL — "Analyze this board and create event storming"
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
| "Can we run evals outside Claude Code?"    | Yes. `scripts/eval-export-workbench.sh` exports scenarios to CSV for [Anthropic Workbench](https://platform.claude.com/workbench). Same scenarios, same rubrics — just a different execution environment. Useful for comparing models or prompt variations side-by-side.                                                                                                                                                                 |
| "How does the Miro integration work?"      | MCP (Model Context Protocol). Miro exposes tools via an MCP server — diagram_create, doc_create, context_get, etc. Claude Code connects to it via OAuth. Agents read board context first, then create artifacts. No API keys to manage, no plugins to install.                                                                                                                                                                           |
| "Why basketball players?"                  | Deliberate trade-off. Anthropic's best practices recommend gerund-form descriptive names (e.g., `defining-domain-rules` instead of `bird`). We audited this and accepted the FAIL — persona names carry identity and team cohesion that functional names destroy. The descriptions compensate with clear role context. And yes, the personas can be changed — they're just markdown files. The architecture doesn't depend on the names. |

---

---

## PREP CHECKLIST — DO BEFORE THE DAY

- [ ] Pick demo scenario — business-legible, non-trivial
- [ ] Dry-run with `/team` Quick Fix — confirm it finishes in ~10 min
- [ ] Verify retro report generates and looks clean
- [ ] Pre-render the Full Team mermaid diagram as screenshot
- [ ] Start eval web dashboard on localhost:3000
- [ ] Capture `/usage` cost numbers from the dry-run
- [ ] Test screen share — terminal font size, theme readability
- [ ] Authorize Miro MCP server (run any Miro tool once, complete OAuth in browser)
- [ ] Verify Miro demo board is accessible: [https://miro.com/app/board/uXjVGp3Xb4A=/](https://miro.com/app/board/uXjVGp3Xb4A=/) (created from MJ Eval Scenario 05 — courier platform)
- [ ] Pre-open all tabs/files:
  - [ ] README.md (agent table)
  - [ ] Miro board: [https://miro.com/app/board/uXjVGp3Xb4A=/](https://miro.com/app/board/uXjVGp3Xb4A=/)
  - [ ] Mermaid diagram screenshot
  - [ ] `agents/bird.md`
  - [ ] `agents/shaq.md`
  - [ ] `commands/team.md`
  - [ ] A checkpoint file
  - [ ] Eval web dashboard
  - [ ] `evals/bird/scenario-01-domain-rule-extraction.md`
  - [ ] A retro HTML report
  - [ ] Terminal ready with the demo scenario
