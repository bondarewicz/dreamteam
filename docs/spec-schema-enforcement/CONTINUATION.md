# Continuation — schema-enforcement (resume here)
Last updated: 2026-06-01
Status: Bird vertical slice BUILT + FIXED + partially verified. **Next step: run the full Bird eval gate.**

This is the resume point. Read this first, then `architecture.md` for the full design + empirical findings.

---

## TL;DR

Goal (from `intake.md`): remove markdown "output JSON / no fences" **safety guards** from agent
prompts and enforce a real **JSON schema per agent**, so outputs are consistent and evals stop
failing on format deviations.

**Decided, proven design:** agents write their analysis as **natural prose**; dispatch via
`claude -p --system-prompt-file ~/.claude/agents/<agent>.md --json-schema <FLAT schema> --output-format json`;
the CLI's `structured_output` carries the validated object. A code-level Zod normalization layer is
the deterministic safety net. Single Zod registry = SSOT.

**The key unlock:** `structured_output` reliably populates ONLY for **flat** schemas. Flatten the
shape (hoist wrapper objects to top-level prefixed keys) and you keep every field AND get reliable
CLI-enforced structured output — no richness lost. Depth is the limiter, not field count.

---

## Empirical findings (CLI 2.1.156, ~9 probes — all reproducible)

| probe | result |
|-------|--------|
| `--agent <name>` + `--json-schema` | ❌ BROKEN — `structured_output` absent (validator bypassed). GitHub #20625 closed "not planned". |
| `--system-prompt-file <agent>.md` + `--json-schema` | ✅ works (this is the path we use) |
| `--system-prompt` / `--append-system-prompt` / `--agents` inline + `--json-schema` | ✅ all work |
| trivial / foreign / **flat** schema (≤~1650 B) | ✅ `structured_output` populated |
| rich nested `BirdOut` (2910 B, 8 sections) | ❌ absent (prose OR json result; prompt-independent) — **3/3 deterministic** |
| flattened-complete (1372–1649 B, all fields, wrappers hoisted) | ✅ populated, all keys |

Conclusion: **schema DEPTH/structure** drives `structured_output` population, not field count or
prompt wording. Keep schemas flat (singleton objects hoisted; a single `array → object` level is OK).

Diagnostic scripts: `scripts/poc-bird-schema.ts` (A/B old vs new path). (`scripts/test-agent-json-schema.ts`
was a throwaway and has since been removed.)

---

## What's BUILT (all UNCOMMITTED — Thread A)

NEW files (untracked):
- `schemas/agent-schemas.ts` — Zod registry (SSOT). Flat `BirdOut` + compact `BIRD_JSON_SCHEMA` (~1649 B) + `getAgentSchema/getAgentJsonSchema/validateAgentOutput`.
- `evals/src/schema-runner.ts` — `runAgentWithSchema()` via `--system-prompt-file + --json-schema`. **Model precedence: explicit override → frontmatter model → omit `--model` (never empty)** (this was a fixed bug). Reads `structured_output` then falls back to `result`.
- `evals/src/normalize-output.ts` — `normalizeAgentOutput()` consistency layer: json-extract → Zod safeParse → bounded coercion → re-validate. Always returns a valid object OR a typed failure (never silent). Coercion guarded; deterministic path is the workhorse.
- `evals/src/__tests__/schema-runner.test.ts`, `evals/src/__tests__/normalize-output.test.ts` — unit tests (live tests guarded by `LIVE_BUS_TEST=1`).
- `scripts/poc-bird-schema.ts` — A/B PoC.

MODIFIED files (uncommitted):
- `agents/bird.md` — **format guards stripped** (Output Contract JSON-ONLY, FINAL REMINDER); **flat paths** (`confidence_level` etc.); **high-confidence calibration anchor added** (clear spec → 70-90 default ~80; regulated-but-specified ~60-80; keep all low rules ≤50/55/60). Synced to `~/.claude/agents/bird.md` (in sync). Behavioral guidance (escalation-type consistency, stop conditions, invariant heuristic) KEPT.
- `evals/src/agent-runner.ts` — `runBirdAgentCall()` + per-agent dispatch branch: **Bird uses the schema path; all other agents unchanged** (still `--agent`).
- 18 × `evals/bird/scenario-*.md` — grader `json_field` paths retargeted to flat keys (`confidence.level`→`confidence_level`, `business_impact.financial`→`business_impact_financial`, `domain_analysis.bounded_context`→`bounded_context`, etc.). Array-of-object paths (`business_rules[*].invariant`, `acceptance_criteria[*].given/when/then`, `escalations[*].type`) UNCHANGED.
- `package.json` + `bun.lock` — added `zod` 4.4.x.

`docs/spec-schema-enforcement/` (untracked): `intake.md`, `domain.md` (Bird), `architecture.md` (full design + all findings — READ THIS), `review.md` (Kobe), this file.

243 unit tests pass (2 live-guarded skip).

---

## VERIFIED so far (independently, from raw eval outputs)

Calibration restored + guardrail intact (raw `evals/results/raw/2026-06-01-1403/`):
- scenario-01 (clear, band 65-90): **82 / 78 / 82** ✅
- scenario-05 (healthcare, 65-90): **80 / 82 / 80** ✅
- scenario-06 (fintech, 60-85): **76 / 75 / 75** ✅
- scenario-09 (contradiction, ≤50 guardrail): **25 / 25 / 25**, esc=`[contradiction]` ✅ (no over-correction)

Infra works end-to-end: Bird via CLI → populated `agent_output` (~15K chars) → flat keys → Zod-valid.

---

## ⏭️ NEXT STEP — run the full Bird eval gate (the only remaining validation)

```bash
bun evals/src/cli.ts --agent bird --trials 3
```
- Runs all 21 Bird scenarios × 3 trials WITH rubric scoring (~63 live runs + scoring, 30-45 min).
- Results → `evals/results/<ts>.json` + migrated to the web app at **localhost:3000** (single source of truth — do NOT summarize scores in terminal; read pass@1/pass@3 for the gate verdict only).
- **Verdict criteria** (from team.md EVAL GATE): PASS = pass@1 ≥80% AND flaky=0. CONDITIONAL = pass@3 ≥80% but pass@1 <80% or flaky>0 → ask user. BLOCK = pass@3 <80% or a critical scenario fails all 3.
- Tip: run a subset first if needed, e.g. `--scenario bird/scenario-01-...,bird/scenario-09-...`. Use `--phase agents` to skip scoring when only checking output shape.

If the gate PASSES → roll the pattern to the next agent (see Rollout). If issues → most likely another grader-path mismatch or a behavioral shift from a stripped guard (see Lessons).

---

## Open risks / known issues

1. **`ubiquitous_language` + `stakeholders_affected` were reduced to string arrays** (from
   `{term,definition}` / `{group,impact}` objects) to fit the flat schema. Current graders only check
   array existence, so no eval impact — but it IS a real richness reduction. Decide if acceptable, or
   model them as a flat 2-field array-of-object (which the probes show is fine for `structured_output`).
2. **`structured_output` size threshold is empirical/undocumented** (~≤1650 B works, 2910 B doesn't).
   Keep per-agent schemas lean; could change across CLI versions. The `normalize-output.ts` code path
   is the deterministic fallback if a CLI version regresses this.
3. **Only Bird is migrated.** Other agents still use `--agent` dispatch + their nested contracts.
4. **bun.lock vs bun.lockb** — `zod` added; verify lockfile committed correctly.

## Lessons (important)
- **Stripping md "guards" can silently shift agent BEHAVIOR, not just format.** Bird went
  under-confident (48-55 vs expected 65-90) because the removed JSON example had anchored confidence
  at ~75. FIX = keep BEHAVIORAL guidance (calibration anchors, escalation rules) while removing only
  FORMAT mandates. The eval gate is what catches this — always run it after guard removal.
- Verify the FULL CLI pipeline, not just the runner in isolation (the empty-`--model` bug only
  appeared end-to-end).

## Rollout plan (per agent, after Bird gate passes)
1. Add flat schema to `schemas/agent-schemas.ts` (enumerate the agent's grader `json_field` paths FIRST; cover every one; hoist wrappers; keep schema ≲1650 B).
2. Add the agent to the per-agent dispatch branch in `agent-runner.ts` (schema path).
3. Retarget that agent's grader paths to flat keys.
4. Strip FORMAT guards from `<agent>.md`, KEEP behavioral guidance; `bun scripts/install.ts`.
5. Run `bun evals/src/cli.ts --agent <name> --trials 3`. Watch for behavioral shifts.
Order suggestion (MJ): read-only reviewers next (MJ, Pippen, Drexler, Kobe), Shaq last.

---

## Thread B — collaboration fidelity (DONE, committed)
Separate sub-thread completed earlier this session and COMMITTED:
- `commands/team.md` Full Team path hardened: mandatory `TeamCreate`, first-message-receipt join gate,
  cleanup-before-create (zombie teams), `TeamDelete` on cleanup, collision-resistant team name. Kobe SHIP.
- `evals/src/__tests__/collaboration.test.ts` — Bird↔MJ bus message-exchange test (live guarded by `LIVE_BUS_TEST=1`).
- Empirically proven: agents only collaborate when spawned as real teammates (`TeamCreate` + `team_name`); bare parallel `Agent` calls silently degrade to isolated subagents.

## Also committed this session
- `chore: Grant the Skill tool to all subagents` (7 agent md files).
- `test: unit tests for concurrency limiter and trial scorer`.
- docs/ cleanup (stale artifacts + tool-comparison notes removed; `bird-structured-output-spec.md` → `docs/spec-bird-structured-output/spec.md`; checkpoints removed).

## To commit Thread A (when ready)
`agents/bird.md`, `evals/bird/scenario-*.md`, `evals/src/agent-runner.ts`, `schemas/`,
`evals/src/schema-runner.ts`, `evals/src/normalize-output.ts`, `evals/src/__tests__/{schema-runner,normalize-output}.test.ts`,
`scripts/poc-bird-schema.ts`, `package.json`, `bun.lock`, `docs/spec-schema-enforcement/`.
Suggested message: `feat(evals): flat-schema structured-output enforcement for Bird (proof slice)`.
