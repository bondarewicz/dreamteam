# Architecture: schema-enforcement
Author: MJ (Strategic Systems Architect)
Date: 2026-05-29

## Critical Empirical Finding (verified live against the CLI)

**`--agent` + `--json-schema` do NOT work together.** When both flags are used, the result
envelope's `structured_output` field is **absent** — schema validation does not fire; the agent's
embedded system prompt dominates. Also confirmed: there is **no `--max-turns` flag** in the CLI;
`--bare` strips MCP/hooks/CLAUDE.md/memory; `--json-schema` requires `--output-format json`.

> **Empirically reproduced — CLI 2.1.156** via `scripts/test-agent-json-schema.ts`:
> - CONTROL (`--json-schema`, no `--agent`): `structured_output = {"answer":"pong"}`, cost $0.329.
> - TREATMENT (`--json-schema` + `--agent bird`): `structured_output = undefined`, cost $0.039.
> - The ~10× cost drop signals the validate-and-retry machinery never engaged under `--agent`.
> - ~~OPEN~~ **RESOLVED:** the bypass is specific to the `--agent <name>` flag (issue #20625,
>   closed "not planned"). Persona-injection flags all PRESERVE enforcement — confirmed live on
>   2.1.156:
>   - `--system-prompt "<text>"` + `--json-schema` → ✅ populated
>   - `--append-system-prompt "<text>"` + `--json-schema` → ✅ populated
>   - `--agents '<inline JSON def>'` + `--json-schema` → ✅ populated
>   - **`--system-prompt-file ~/.claude/agents/<name>.md` + `--json-schema` → ✅ populated**
>     (`{"answer":"pong"}`, cost $0.198 — the path the eval harness will use).
>   - Agent SDK: `system_prompt` + `output_format:{type:json_schema}` → ✅ (documented).
>   ⇒ We were "holding it wrong": don't use `--agent`; inject the persona via `--system-prompt-file`.

**Consequence:** Option 2 as written (rely on the CLI to both load the agent and enforce the
schema) is blocked. To get schema enforcement you must load the persona via `--system-prompt-file`
(not `--agent`), which loses `--agent` auto-discovery niceties.

## PoC Finding (2026-05-29) — `structured_output` is unreliable for rich schemas

Bird PoC + four direct probes (CLI 2.1.156) established:
- `--json-schema` enforcement **is real** — a foreign `{mood: enum}` schema forced `mood:"happy"`
  into `structured_output` (a field Bird would never emit), proving the CLI runs a real
  structured-extraction pass, not a no-op.
- BUT `structured_output` population is **inconsistent**: present for trivial (`{answer}`) and
  foreign (`{mood}`) schemas, **absent for the real 2910-byte `BirdOut`** (the JSON landed only in
  `result` as a string). When the model's own response *is* the big JSON, the separate
  structured-extraction did not populate `structured_output`.
- When `structured_output` is absent, parsing `result` carries **no enforcement guarantee** — it's
  the model's raw text, clean only because the prompt happens to make it so.

**The lever is SCHEMA SIZE/COMPLEXITY (confirmed by 6 probes):**

| schema | size | `structured_output` |
|--------|------|---------------------|
| `{answer}` / `{mood}` | tiny | ✅ populated |
| lean flat Bird (summary, AC[], confidence, escalate) | 285 B | ✅ populated (10 ACs extracted) |
| rich `BirdOut` (8 sections, deep nested) | 2910 B | ❌ absent (prose OR json result, prompt-independent) |

Tested both: a no-JSON-instruction prose prompt with `BirdOut` still gave absent `structured_output`,
while a lean flat schema gave it reliably. So prompt wording is NOT the cause — schema complexity is.

**RESOLVED — it's DEPTH, not field count. No trade-off needed.** A *flattened-complete* schema
(1372 B, ALL 14 grader fields preserved, wrapper objects hoisted to top-level) populates
`structured_output` reliably (all 14 keys, 6 business_rules, 6 acceptance_criteria). So the rich
`BirdOut` failed because of its **nesting depth** (singleton wrapper objects), not because it had too
many fields.

**THE PATH (no richness sacrificed):**
- **Flatten the shape, keep every field.** Hoist the singleton wrapper objects to prefixed top-level
  keys: `domain_analysis.bounded_context` → `bounded_context`, `confidence.level` → `confidence_level`,
  `business_impact.financial` → `business_impact_financial`, etc. Keep arrays-of-objects
  (`business_rules[]`, `acceptance_criteria[{given,when,then}]`, `escalations[{type}]`) AS-IS — a single
  `array → object` level is fine.
- Result: reliable CLI-enforced `structured_output` + full field richness + agents write NATURAL prose
  (delete the JSON-output guards — the original goal).
- **Grader impact is minimal:** only the 3 hoisted wrappers' paths change (`confidence.level` →
  `confidence_level`, …). Every array-of-object grader path is unchanged.
- Zod registry holds the flattened schemas; the code-Zod normalization layer becomes a thin
  defense-in-depth net (the CLI's `structured_output` is now the primary, reliable source).

Proven via 7 probes. Working flattened schema fixture: `/tmp/birdflat.json` (to be ported into the
registry as the new `BirdOut`).

## The Two Decisions the Doc Conflates

1. **Enforce schemas at a boundary** ← the actual goal.
2. **Switch the dispatch mechanism** (Task tool/agent-teams → `claude -p` subprocess).

Decision 2 is **not required** to achieve Decision 1. The eval harness *already* dispatches via
`claude -p`, and `json-extract.ts` already validates at code level independent of dispatch.

## Collaboration Constraint (empirically verified — 2026-05-29)

A live probe (`TeamCreate collab-probe` + Bird & MJ spawned as teammates with `team_name`,
`run_in_background`) **confirmed inter-agent messaging works**: Bird DM'd MJ `"Canonical term:
Customer"`; MJ received it, derived `ICustomerRepository`, and DM'd Bird a confirmation. Teammates
**get `SendMessage` injected by the harness** regardless of their frontmatter `Tools` list.

Two consequences:
1. **Friction-by-design requires the agent-teams bus.** It only engages when the orchestrator
   actually calls `TeamCreate` and spawns with `team_name`. Bare parallel `Agent` calls (no
   `team_name`) **silently degrade** to isolated subagents that cannot communicate — no error, just
   independent convergence that *looks* like agreement. (This is exactly what happened in this
   session's Phase 1 before the probe.) ⇒ `commands/team.md` Full Team path should make
   `TeamCreate` + a "members joined" check non-skippable.
2. **`claude -p` subprocesses cannot join the bus.** So adopting subprocess dispatch *to get native
   `--json-schema`* would **kill collaboration**. Native enforcement and live inter-agent friction
   are mutually exclusive with today's tooling.

⇒ **Revised conclusion:** decouple schema enforcement from dispatch. Keep the agent-teams bus for
the interactive path; enforce the schema as a **post-agent normalization stage** (code-level Zod
parse via `json-extract`, backstopped by a bounded `claude -p --json-schema` coercion pass on the
agent's final text). Schema is enforced on the *artifact*, not the *conversation*. The eval harness
(already stateless, no collaboration needed) can still use process-boundary `--json-schema` via
`--system-prompt-file`.

## Recommended Approach — Hybrid Enforcement (Option C)

- **Interactive `/team` path:** keep Task-tool dispatch. Replace prompt-text guards with a
  **code-level Zod validation layer** (parse via json-extract → `safeParse` → bounded retry).
  Preserves shared session context, MCP (Context7/Honeycomb), memory:user, AskUserQuestion UX.
- **Eval harness:** use **process-boundary `--json-schema`** with `--system-prompt-file` +
  `--output-format json` + `--model` + `--allowedTools`. Pull `.structured_output`, re-validate
  with Zod (defense in depth). Maximum reproducibility; harness already uses `claude -p`.
- **Single source of truth:** one **Zod schema registry** (`schemas/agent-schemas.ts`) exporting
  both `z.toJSONSchema()` (for the CLI flag) and `z.infer` TS types (for code). Never duplicate
  schemas into md files.

## Components

- **Agent Schema Registry** — `schemas/agent-schemas.ts`. One named Zod export per agent. SSOT.
- **Output Validation Layer** — `evals/src/validate-output.ts`. json-extract → Zod safeParse →
  typed `AgentResult<T>` or typed error. Used by both eval pipeline and the /team validation path.
- **Process Runner** — evolution of `evals/src/agent-runner.ts`. Adds `runAgentWithSchema()` using
  `--system-prompt-file + --json-schema + --output-format json`. Falls back to existing `--agent`
  path when schema not requested.
- **Agent MD Files** — keep the Output Contract section as *guidance*; remove the load-bearing
  FINAL REMINDER / "json.loads()" enforcement paragraphs.
- **team.md / coachk.md** — reduce 17 inline JSON reminders to one brief note each; point the
  validation block at the code layer.

## Patterns

Schema Registry (SSOT) · Anti-Corruption Layer (the validation boundary absorbs fences/preambles)
· Hybrid enforcement (same schema, two enforcement points) · Defense-in-depth (CLI validates, Zod
re-validates).

## Non-Functional Requirements

- Reproducible evals (model pinning preserved; `--bare` available for eval baseline).
- Schemas must stay **flat**, deep fields `.optional()` to avoid `--json-schema` retry exhaustion.
- A CI test asserts md-documented schema matches the Zod registry (drift guard).

## Trade-offs

- **Hybrid vs full process-boundary migration:** gains /team UX + MCP + memory + low blast radius;
  costs two enforcement points (mitigated by shared registry) and a slightly looser interactive
  path than evals.
- **`--system-prompt-file` vs `--agent`:** unlocks `structured_output`; loses `--agent`
  auto-discovery — must pass model/tools explicitly from frontmatter.
- **Zod vs raw JSON Schema:** type inference + safeParse + JSON Schema gen from one definition;
  adds a zod dep.

## Migration Path

1. Create `schemas/agent-schemas.ts` (all 8 agents) + `evals/src/validate-output.ts`.
2. Convert **Bird first** (read-only, clean schema, well-tested scenarios) in the eval harness:
   add `runAgentWithSchema()`.
3. A/B Bird old (`--agent`) vs new (process-boundary) across existing eval scenarios — compare
   schema-failure rate and quality scores.
4. If retry-exhaustion < ~10%, convert MJ, Pippen, Drexler, Kobe. **Shaq last** (widest tool
   surface, most session-dependent).
5. Strip FINAL REMINDER guards from md; reduce team.md reminders; update coachk.md validation
   section.

## Risks

- **High:** `--json-schema` retry exhaustion on complex schemas → keep flat, `.optional()`, measure
  on Bird PoC first.
- **Medium:** schema drift md↔registry → CI parity test. `--system-prompt-file` may not fully
  reproduce `--agent` behavior → test. Interactive code-validation is weaker than process-boundary.
- **Low:** no `--max-turns` → use `--max-budget-usd` proxy. memory:user loss only in (stateless)
  eval path.

## Open Architecture Questions

- Retry-exhaustion rate on Bird's real schema — unknown until PoC. **(Still the #1 unknown.)**
- ~~Does `--system-prompt-file` reproduce `--agent`?~~ **RESOLVED:** `--system-prompt-file <agent>.md`
  + `--json-schema` populates `structured_output` (tested). Caveat: the file is fed verbatim
  *including YAML frontmatter* — consider stripping frontmatter, or accept it as harmless preamble.
  Also: `--system-prompt-file` does NOT auto-resolve the agent's frontmatter `tools`/`model`, so the
  runner must read those from the .md frontmatter and pass `--allowedTools`/`--model` explicitly.
- If a future CLI fixes `--agent` + `--json-schema`, collapse the hybrid into one unified path.
- `--agents` inline-JSON + schema also works — a possible alternative to `--system-prompt-file`,
  but the inline format (name/description/instructions) diverges from the .md format; less tested.

## Confidence

MJ: **82/100**. High: the `--agent`+`--json-schema` incompatibility (tested live), hybrid
separation, Zod registry, Bird-first PoC. Low: retry-exhaustion rates, `--system-prompt-file`
fidelity, whether interactive code-validation fully eliminates the format failures.
