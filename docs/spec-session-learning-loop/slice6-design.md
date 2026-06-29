# Slice 6 — `learn` + `instincts` CLI — Build-Ready Design

**Author:** MJ (Strategic Systems Architect) · **For:** Shaq (implementation) · **Status:** build-ready spec.
**Modifies:** `bin/dreamteam.ts` (add 2 subcommands) · `scripts/paths.ts` (add 1 path helper).
**Wires (no changes to these — all exist, Slices 3–5):** `web/src/session-analyzer.ts` (`createSessionAnalyzer`) · `web/src/directive-capture.ts` (`createDirectiveCapture`) · `web/src/memory-projection.ts` (`createMemoryProjection`) · `web/src/instincts-db.ts` (`createInstinctsDb`) · `web/src/fact-store.ts` (`createFactStore`).
**Serves:** architecture.md §0 (in-session step), §3 (ingestion), §4 (projection). Pins the CLI-specific decisions left open by `slice4-design.md §5`.

> **LOCKED UX (do not violate):** the human approves at END OF SESSION while context is fresh — this is an in-session LOOP step, NOT a notification/async nudge. Human-directive capture is FREE-TEXT (the keystroke after a human edit is the trust anchor — normalized-identical-to-suggestion is rejected, BR-13b/c). Auto-inferred `pending` approval may use a simple yes/no select (those are never claimed human-authored).

---

## 0. Existing CLI structure (investigation result — match this exactly)

`bin/dreamteam.ts` is a single-file, zero-dependency dispatcher. Conventions Slice 6 MUST match:

1. **Dispatch:** one top-level `switch (cmd)` over `const [cmd, ...rest] = process.argv.slice(2)`. Each branch calls a `cmd<Name>(rest)` function returning a numeric exit code (`number` or `Promise<number>`). `process.exit(code)` at the end.
2. **Arg parsing:** two helpers only — `flag(args, "--name")` (returns the following token or `undefined`) and `has(args, "--name")` (boolean). No getopt lib. Sub-subcommands are read positionally from `rest[0]`.
3. **Paths/config:** everything resolves through `scripts/paths.ts` (`assetsDir`, `dataDir`, `workspaceDir`, `dbPath`, `readConfig`). No hard-coded paths in `bin/`.
4. **Heavy deps live in `web/`/`scripts/`:** `bin/` imports thin (`provision`, `checkProviders`, `paths`). The `eval`/`web` commands `Bun.spawn` into `assetsDir()` entrypoints rather than importing them. Slice 6 instead **imports the web modules directly** (they are local TS, async, dependency-injectable) — this is the right call because `learn` orchestrates them in-process and needs the return values, unlike the fire-and-forget `eval`/`web` passthroughs.
5. **Output:** plain `console.log`, no spinner/color libs. Usage text is one `usage()` template literal listing every command — Slice 6 adds two lines to it.
6. **Help routing:** `undefined | "help" | "--help" | "-h"` → `usage()`. Unknown command → stderr + usage + exit 1.

Project-slug convention (mirror, do not reinvent): `scripts/session-eval-hook.ts` derives `project = path.basename(path.dirname(transcript_path))`. The CLI runs from a working dir, so the equivalent is `path.basename(process.cwd())`.

---

## 1. Subcommand surface

Two new top-level commands added to the `switch`:

```
learn [--project <slug>] [--out <dir>] [--dry-run] [--yes] [--no-input] [--window <n>] [--model <m>]
instincts <list|approve|reject|review> [args]
```

### 1.1 `learn` — the in-session loop step
| Arg | Meaning | Default |
|---|---|---|
| `--project <slug>` | project scope | `path.basename(process.cwd())` |
| `--out <dir>` | projection output dir (see §3) | `memoryProjectionDir(project)` (dreamteam-owned) |
| `--dry-run` | run analyzer + show what would be captured/projected; write NOTHING to DB or disk | off |
| `--yes` | auto-approve auto-inferred `pending` candidates without prompting (CI/scripted) | off |
| `--no-input` | force headless mode even on a TTY (capture-to-pending only; never auto-approve) | off |
| `--window <n>` | analyzer findings window | 50 (module default) |
| `--model <m>` | model override forwarded to analyzer LLM (advisory; default impl uses its own) | unset |

**Exit codes:** `0` success (including "nothing to learn"); `1` projection self-check / truncation hard-failure (`SelfCheckError`/`TruncationError` from §4); `2` analyzer LLM hard error that is NOT the graceful empty/timeout path (these are already swallowed by the module and never reach the CLI). The projection ALWAYS runs (Fix-3/AC-6 decoupling) even when capture is skipped.

**Output:** a compact summary block — analyzer result (`candidatesGenerated`, `candidatesScrubbed`, `materialized.length`), directive outcomes (approved/pending/rejected counts), and projection result (`instinctsInIndex`, `factsInIndex`, `linesWritten`, target dir). In `--dry-run`, prefix every line with `[dry-run]` and emit counts only.

### 1.2 `instincts <sub>` — review/curation surface
| Sub | Args | Behavior | Exit |
|---|---|---|---|
| `list` | `[--status pending\|approved\|rejected]` (default `pending`) | print `id · status · confidence · domain · trigger` one per line via `store.listByStatus(ctx, status)` | 0 |
| `review` | none | like `list pending` but multi-line: each pending instinct with its `behavioral_shape`, `suggested_content`, `occurrence_count`, `confidence` — the human-decision view (architecture §0 "human reviews the generalized instinct text") | 0 |
| `approve` | `<id>` | `store.getById(id)` → if found, `store.setStatus(id, "approved")`; print confirmation | 0 found / 1 not-found / 1 bad-id |
| `reject` | `<id>` | same with `"rejected"` | 0 / 1 |

`approve`/`reject` do **NOT** regenerate the projection inline (decision pinned in §5) — they flip status and exit; the next `learn` (or an explicit `learn --no-input`) rebuilds MEMORY.md. Print a one-line hint: `Run 'dreamteam learn' to refresh MEMORY.md.`

---

## 2. `learn` orchestration (exact sequence)

Mirrors `slice4-design.md §5`, with the CLI-interaction and headless behavior pinned. All steps share one `InstinctCtx`/`ProjectionCtx` from §4. Stores are constructed once and **injected into every factory** so they share one driver/connection:

```
const driver = getDriver();                       // db-driver seam; bun:sqlite today
const store  = createInstinctsDb(driver);
const facts  = createFactStore(driver);
const analyzer   = createSessionAnalyzer({ store });
const capture    = createDirectiveCapture({ store });
const projection = createMemoryProjection({ instincts: store, facts });
```

1. **ensure stores** — `await store.ensure();` (idempotent DDL; `fact-store`/projection rely on it). FactStore ensure if it exposes one; otherwise `store.ensure()` covers the instinct tables and projection reads facts read-only.
2. **run analyzer (auto-inferred)** — `const a = await analyzer.runInstinctAnalyzer(ctx);`. The module owns the empty short-circuit (zero findings → zero LLM calls) and graceful timeout (returns, never throws). No CLI branching needed beyond reading `a` for the summary.
3. **present auto-inferred `pending` for approval** — `const pending = await store.listByStatus(ctx, "pending");`
   - **interactive + not `--no-input` + not `--yes`:** for each pending row, render the generalized text (trigger + behavioral_shape + confidence) and read a **yes/no** answer via the readline prompt (§2.1). yes → `store.setStatus(id,"approved")`; no/blank → leave `pending`. This is the ONLY place a select-style yes/no is allowed (auto-inferred is never claimed human-authored).
   - **`--yes`:** approve all pending without prompting.
   - **headless (`--no-input` or no TTY):** SKIP approval entirely — rows stay `pending` for a later `instincts approve`. **Never auto-approve in headless** (would forge consent).
4. **surface + capture human directives (FREE-TEXT)** — only when interactive AND not headless:
   - `const sugg = await capture.surface(transcript, llm, ctx);` (transcript source: `--from <file>` is out of scope for v1; pass the empty/last-turn buffer the caller provides, or skip surfacing when no transcript is available — see §2.2).
   - For each suggestion: print `suggestionText`, then **read a free-text line** the human types/edits (§2.1). Build `DirectiveDecision { typedText: <line>, confirmed: <true on a non-empty confirmed line> }` and call `capture.captureDirective(sugg, decision, ctx)`.
   - The module enforces the authorship guard (`isHumanAuthored` — normalized-identical → `rejected-not-authored`) and the scrub gate (`rejected-scrub`) BEFORE any write. The CLI only routes keystrokes; it does NOT pre-filter. Print the `CaptureOutcome.result` per directive.
   - **Headless:** directive capture is SKIPPED entirely (free-text authorship is structurally impossible without a human typing). Document: directives are an interactive-only path.
5. **regenerate projection** — `await projection.regenerate(projCtx, outDir);` ALWAYS runs (even if steps 2–4 were skipped/headless), per the Fix-3/AC-6 decoupling: the read-side projection must never be gated by the learn/capture write-side. Surfaces `SelfCheckError`/`TruncationError` as exit 1.
6. **summary** — print the §1.1 block.

`--dry-run` short-circuits all writes: run step 2 with a no-op store wrapper is overkill — instead, in dry-run, run the analyzer against the **real** read path but pass `--dry-run` down by NOT calling setStatus/captureDirective and by calling `regenerate` against a throwaway temp dir under the scratchpad (or skip the write and just report `countEligible`). Simplest correct rule: **dry-run resolves `outDir` to an OS temp dir and skips steps 3–4 prompts**, printing what WOULD be captured. (Analyzer step 2 already persists signals to the buffer; to keep dry-run truly non-destructive, dry-run constructs the analyzer/store against a `:memory:` driver — see §6 test seam — so nothing touches the real DB.)

### 2.1 Interactive capture in a CLI (readline / the keystroke trust anchor)
Use Node's built-in `node:readline/promises` (no new dep; ships with Bun). One reader for the whole session:

```ts
import * as readline from "node:readline/promises";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// yes/no (auto-inferred): const ans = (await rl.question("Approve? [y/N] ")).trim().toLowerCase();
// free-text (directive):  const typed = (await rl.question("Edit/restate the directive (empty to skip):\n> ")).trim();
//                         const confirmed = typed.length > 0;  // the Enter keystroke after editing = the trust anchor
rl.close();
```
- **TTY detection:** `const interactive = process.stdin.isTTY === true && !has(args,"--no-input");`. Non-TTY (piped/CI) ⇒ headless path automatically.
- **The trust anchor is the human's typed line + the Enter keystroke.** The CLI passes that raw line as `typedText`; `directive-capture.isHumanAuthored` decides authorship (normalized compare against `suggestionText`). The CLI must NOT echo the suggestion as a pre-filled editable default in a way that lets the human submit it unchanged and have it count — readline `question` with no default is correct (blank submit = skip, not accept).

### 2.2 Headless / non-interactive mode (Slice 7 team.md will invoke `learn`)
| Concern | Headless behavior |
|---|---|
| auto-inferred pending | left `pending` (no auto-approve) unless `--yes` is explicitly passed |
| human directives | SKIPPED (free-text requires a human) |
| projection | ALWAYS regenerated (decoupled) |
| exit | 0 unless projection hard-fails |

This makes `dreamteam learn --no-input` a safe deterministic core the Skill/team.md step can call to refresh MEMORY.md from already-approved state, with humans curating later via `instincts approve`.

---

## 3. Projection-target resolution (CRITICAL — Slice 6 is NON-destructive)

**Rule (pin this exactly):**

> `learn` writes MEMORY.md to a **dreamteam-OWNED** directory under `workspaceDir()`. It MUST NOT write to Claude Code's built-in auto-memory dir (`~/.claude/projects/<slug>/memory/`). Switching the projection target to the live `~/.claude` memory dir is the **installer slice**, gated on explicit user approval, and only after the one-time file-memory migration + the atomic REPLACE ordering (architecture §7). Until then, running `learn` is safe and fully reversible.

Resolution order for `outDir`:
1. explicit `--out <dir>` (operator override; honored verbatim),
2. else `--dry-run` → an OS temp dir (e.g. `fs.mkdtempSync(path.join(os.tmpdir(),"dreamteam-learn-"))`), discarded after the summary,
3. else the default: a NEW path helper in `scripts/paths.ts`:

```ts
/** Dreamteam-owned projection target for `learn` (PRE-installer; NEVER ~/.claude). */
export function memoryProjectionDir(project: string): string {
  return path.join(workspaceDir(), "memory", project);
}
```

`regenerate()` already `mkdirSync(outDir, { recursive: true })`, so the dir is created on first run. This keeps the built-in `~/.claude` auto-memory untouched (no two-writer collision in Slice 6) and makes the eventual installer switch a single call-site change (`--out` or a config flag flipping the default to the `~/.claude` path).

**Guardrail (defensive):** if a resolved `outDir` falls inside `~/.claude/` and no explicit installer-phase flag is set, `learn` refuses with exit 1 and a message pointing at the installer slice. Cheap, prevents accidental clobber.

---

## 4. Ctx / tenant resolution (v1 single-user)

v1 is single-tenant/single-user (architecture §0 scope note). Constants live in `paths.ts` (or a small `config` block) so the Turso phase swaps them for real tenant/user resolution:

```ts
const DEFAULT_TENANT = "local";   // v1 single-tenant constant
const DEFAULT_USER   = "local";   // v1 single-user constant
const project = flag(rest,"--project") ?? path.basename(process.cwd());
```

Build the three ctx shapes from these:
```ts
const ctx: AnalyzerCtx & InstinctCtx = { tenant_id: DEFAULT_TENANT, project };          // analyzer + instincts list/setStatus
const projCtx: ProjectionCtx = {
  tenant_id: DEFAULT_TENANT,
  project,
  user_id: DEFAULT_USER,
  project_id: project,            // MUST equal `project` to satisfy regenerate()'s consistency guard
};
```

**ProjectionCtx consistency guard (verified in source, memory-projection.ts:288):** `project_id !== null && project_id !== project` throws. Setting `project_id = project` satisfies it and scopes facts to this project. Pass `project_id = null` ONLY if the operator wants user-scoped facts exclusively — expose this later if needed; v1 default is `project_id = project`.

`InstinctCtx.agent_id` is dormant in v1 (validated, not stored) — leave unset.

---

## 5. `instincts` subcommands — decisions

- **`list`/`review`** read via `store.listByStatus(ctx, status)` (tenant-bound). `review` is the human-decision view (shows `suggested_content` + `behavioral_shape` + evidence-derived `confidence`/`occurrence_count`).
- **`approve`/`reject`** use `store.getById(id)` then `store.setStatus(id, status)`.
  - **Scopeless-by-id Turso caveat (verified in source, instincts-db.ts:635 & :730):** `setStatus`/`getById` are scopeless `WHERE id = :id` — safe in v1 single-tenant ONLY (AUTOINCREMENT ids are enumerable; cross-tenant mutation is a real threat in a shared DB). The CLI must NOT paper over this with a fake ctx — it relies on the v1 single-tenant invariant. **Flag for the Turso phase:** when these methods gain a `TenantCtx` param (BR-S4 fail-closed), the CLI passes `ctx` and the `instincts approve/reject` handlers gain a tenant bind. Add a `// TODO(turso): pass TenantCtx` at both call sites.
- **Does `approve` regenerate the projection?** **NO — deferred to next `learn`.** Rationale: (1) keeps each `instincts` command a single cheap DB write with no file-system side effects (least-surprise, scriptable, idempotent); (2) the projection is the read-side cache that `learn` already owns and where the non-destructive outDir rule + self-check live; (3) avoids duplicating outDir resolution in two commands. Print the hint `Run 'dreamteam learn' to refresh MEMORY.md.` A future `--apply` flag on `approve` could regenerate inline if curation friction proves real — explicitly out of v1 scope.

---

## 6. Test plan

CLI is tested by extracting the orchestration into a **pure, injectable function** and testing THAT, not the `process.argv` shell. Refactor `learn` as:

```ts
export interface LearnDeps {
  store: InstinctsDb; facts: FactStore;
  analyzer: ReturnType<typeof createSessionAnalyzer>;
  capture:  ReturnType<typeof createDirectiveCapture>;
  projection: ReturnType<typeof createMemoryProjection>;
  prompt: { yesNo(q: string): Promise<boolean>; freeText(q: string): Promise<string>; };  // readline seam
  interactive: boolean;
}
export async function runLearn(opts: { ctx; projCtx; outDir; dryRun; autoYes }, deps: LearnDeps): Promise<LearnSummary>;
```

The thin `cmdLearn(rest)` builds real deps (readline-backed `prompt`, `getDriver()` stores) and calls `runLearn`. Tests build fake deps. **No real `claude -p` in tests** — inject a fake `LlmClient` into the analyzer/capture (the modules already accept this).

| # | Test | Asserts |
|---|---|---|
| T1 | **orchestration order** | spy deps record call sequence: `ensure → runInstinctAnalyzer → (listByStatus/approval) → surface/captureDirective → regenerate`. regenerate is LAST and ALWAYS called. |
| T2 | **non-destructive outDir** | `runLearn` with default resolution writes under `workspaceDir()/memory/<project>` (use a tmp `XDG_DATA_HOME`); assert NOTHING is written under a fake `~/.claude`. |
| T3 | **outDir guardrail** | `--out` inside `~/.claude/` (no installer flag) → throws/exit 1, no write. |
| T4 | **headless: no auto-approve** | `interactive:false` → pending rows stay `pending`; `prompt.yesNo`/`freeText` never called; capture skipped; regenerate still called. |
| T5 | **`--yes` approves pending** | `autoYes:true` → every pending row flipped to `approved` via `setStatus`; then regenerate emits them. |
| T6 | **authorship guard path** | fake `prompt.freeText` returns text == suggestion → `captureDirective` yields `rejected-not-authored`, no instinct row; edited text + confirm → `approved`, row present (delegates to the module's guard — assert the CLI passes the RAW typed line through unmodified). |
| T7 | **interactive yes/no approval** | `prompt.yesNo → true` for a pending → `setStatus(id,"approved")` called with that id. |
| T8 | **`instincts approve` flips + next regenerate emits** | seed a `pending` instinct (conf≥0.7); `instincts approve <id>` → status `approved`, projection NOT regenerated inline; then `runLearn` (or projection.regenerate) → MEMORY.md contains it. |
| T9 | **TTY simulation** | `process.stdin.isTTY` true vs undefined drives `interactive`; verify mapping (unit-test the resolver, not real TTY). |
| T10 | **dry-run non-destructive** | `dryRun:true` → no `setStatus`/`captureDirective`/real-DB writes; summary reports counts; real DB row count unchanged (use `:memory:` or pre/post count). |
| T11 | **projection hard-fail → exit 1** | projection stub throws `SelfCheckError`/`TruncationError` → `runLearn` propagates; `cmdLearn` maps to exit 1. |

Stores in tests: real `createInstinctsDb(createDriver(":memory:"))` so `setStatus`/`listByStatus`/`selectForProjection` SQL is exercised end-to-end; fake `LlmClient`; fake `prompt`.

---

## 7. Risks / deferred-to-installer

- **R1 (installer switch-over):** the projection target must eventually become `~/.claude/projects/<slug>/memory/` AND built-in auto-memory must be disabled — but ONLY after file-memory migration + a populated MEMORY.md (architecture §7 atomic REPLACE). **Deferred to the installer slice.** Slice 6's `--out` + default-helper design makes this a one-line default change + a config flag. The §3 guardrail prevents accidental early clobber. MEDIUM, mitigated.
- **R2 (scopeless setStatus/getById):** safe in v1 single-tenant only; CLI relies on the invariant. `// TODO(turso): pass TenantCtx` at both call sites. Flagged for Turso phase. LOW in v1.
- **R3 (transcript source for `surface`):** v1 has no clean in-process transcript handle in the CLI. Decision: directive surfacing is best-effort — if no transcript is available, skip step 4 and log it; the team.md/Skill step (Slice 7) is the richer directive entry point. Do NOT block `learn` on transcript availability. LOW.
- **R4 (FactStore.ensure):** if `fact-store` has no `ensure()`, ensure the shared driver has the `scoped_facts` DDL run once (importer/installer normally does this). For a standalone `learn` pre-install, call whatever DDL entrypoint fact-store exposes; if none, projection over an empty facts table is still valid. LOW — verify at build.
- **R5 (readline on non-TTY):** guarded by `isTTY` check; piped stdin never enters interactive prompts. LOW.

---

## 8. Files to create / modify
- **MODIFY `bin/dreamteam.ts`** — add `cmdLearn(rest)` + `cmdInstincts(rest)`, two `switch` cases, two `usage()` lines. Extract `runLearn(opts, deps)` (exported for tests) + a thin `cmdLearn` wrapper that builds real deps.
- **MODIFY `scripts/paths.ts`** — add `memoryProjectionDir(project)` + (optionally) `DEFAULT_TENANT`/`DEFAULT_USER` constants.
- **CREATE `web/src/__tests__/learn-cli.test.ts`** (or `bin/__tests__/`) — the §6 table.
- **No new dependencies** (`node:readline/promises`, `node:os`, `node:fs` are built-in).
