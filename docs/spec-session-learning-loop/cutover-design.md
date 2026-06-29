# Go-Live Cutover Design — Session Learning Loop (Slices 7, 8, 9)

**Author:** MJ (Strategic Systems Architect) · **Status:** design for build · **Date:** 2026-06-26
**Scope:** The final three coupled slices that switch the Dream Team from the file-writing
MEMORY HARVEST to the DB-backed learning loop: (7) `team.md` in-session learning step + learning Skill,
(8) `scripts/import-file-memory.ts` one-time migration, (9) installer cutover + `dreamteam doctor`.

> **PRIME DIRECTIVE (non-negotiable, enforced by tests):** Nothing in slices 7/8/9 may execute against
> the real `~/.claude` during build or `bun test`. Every destructive/stateful path takes an injectable
> target dir and a fake `HOME`. The real cutover is run **once, by the user, later**, behind an explicit
> confirm flag. The existing `runLearn` guardrail (`isUnderClaudeDir` refuses `~/.claude` unless
> `--installer-phase`) is the model; slices 8/9 extend the same discipline.

> **DEPENDS ON BIRD (migration ruling).** This document designs the migration *mechanism* only. The
> *rules* — specifically the `confidence` value and `status` to stamp on migrated `feedback` instincts,
> and any derived-type handling — are Bird's. spec §6.5 already locks migrated-and-scrub-passing feedback
> to `status='approved'`. The confidence value is NOT yet pinned (it is neither auto-inferred S/R nor the
> 0.9 human-directive constant). The importer accepts these as a single `MigrationPolicy` object so Bird's
> ruling is a one-line config change, never a code rewrite. See §8.3 and the "Open dependency" callout.

---

## 0. What exists today (investigation findings)

### 0.1 The MEMORY HARVEST step being replaced (`commands/team.md` ~L1675–1716)
- Runs **after spec sign-off, before Final Output**. End-of-session, context-fresh, **in-session** — not a
  notification, not a detached worker. This is the exact shape the new learning step must mirror.
- **Zero artifacts by default.** Surfaces ≤3 candidates (confirmations / patterns) via a single
  `AskUserQuestion` (multiSelect). "None — skip" is a first-class option.
- **On explicit human selection only**, it writes a memory **file** to
  `~/.claude/projects/<project>/memory/<name>.md` with frontmatter (`name`, `description`,
  `type: feedback | project`) and appends a one-line index entry to `MEMORY.md`
  (`- [file.md](file.md) — hook`).
- Hard rules: no file unless explicitly selected; one question, one turn; checkpoint saving is separate.
- **This is the live file-based system the loop replaces.** It is still authoritative until slice 9 runs.

### 0.2 The existing memory format
- `~/.claude/projects/<slug>/memory/*.md` — ~24 files today, frontmatter `name` / `description` /
  `type` (`type` sits at top level in the live files, e.g. `type: feedback`; some specs reference
  `metadata.type` — the importer must accept **both** top-level `type:` and `metadata.type:`).
- `MEMORY.md` — flat index of `- [file.md](file.md) — hook` lines (em-dash or `--` separator both occur).
- Frontmatter `type` ∈ {`user`, `project`, `reference`, `feedback`}.

### 0.3 The install mechanism (`scripts/install.ts` → `adapters/provision.ts` → `adapters/claude-code.ts`)
- `scripts/install.ts` is a **thin shim** → `provision({ harnesses: "claude-code" })`.
- `provision()` (adapters/provision.ts): runs each harness adapter's `install()`, writes
  `~/.dreamteam/config.json` manifest + backups dir, writes the legacy `~/.claude/dreamteam/repo-root`.
- `ClaudeCodeAdapter.install()` (adapters/claude-code.ts): backs up existing `agents/`+`commands/` to a
  timestamped `backupDir`, removes renamed-away files, copies agents (model-rendered) + commands, and
  **symlinks every `scripts/*.ts` (except install.ts) into `~/.claude/scripts/`**. So `commands/team.md`
  is **copied** (drift-tracked by sha in the manifest); `scripts/*.ts` are **symlinked** (always in sync
  with repo source). Editing `commands/team.md` in repo source is local until `dreamteam install`/`repair`
  re-copies it.
- `mergeHooks()` already reads/merges `~/.claude/settings.json` **add-if-missing** (never overwrites
  existing keys). This is the precedent the settings cutover extends — but the cutover must do a
  **set/overwrite** of the auto-memory keys, which is a new, more invasive operation (see §9.4).

### 0.4 The built modules the cutover wires together (all present, tested)
- `bin/dreamteam.ts`: `runLearn(opts, deps)` (Humble Object — injectable store/facts/analyzer/capture/
  projection/llm/prompt), `cmdLearn` (argv shell; `--project --dry-run --yes --no-input --out
  --installer-phase`), `cmdInstincts` (list/review/approve/reject), `cmdDoctor` (provider reachability,
  to be extended). `runLearn` **always** regenerates the projection (Fix-3/AC-6) even if steps 2–4 throw.
- `web/src/memory-projection.ts`: `createMemoryProjection().regenerate(ctx, outDir)` — DB → MEMORY.md +
  topic files; AC-8 post-write self-check; `TruncationError`/`SelfCheckError` hard errors; never touches
  `~/.claude` itself (caller supplies `outDir`).
- `web/src/instincts-db.ts`: `upsertDirective`, `setStatus`, `recordSignal`, `selectForProjection`,
  `ensure` (idempotent DDL). `upsertDirective` supersede-on-upsert keyed by `identity_key+scope+project`.
- `web/src/fact-store.ts`: `upsertFact` (supersede-on-upsert by identity key; NOT scrubbed), `ensure`.
- `web/src/instinct-scrub.ts`: `scrub(candidate)` → `{ok}` | `{ok:false,reason,matchedRule}` (DROP gate).
- `scripts/paths.ts`: `memoryProjectionDir(project)` = `<workspace>/memory/<project>` (PRE-cutover,
  Dream Team-owned, never `~/.claude`); `workspaceDir`, `backupsDir`, `dbPath`, `DEFAULT_TENANT/USER`.

### 0.5 Settings mechanism — VERIFIED against official docs (code.claude.com/docs/en/settings)
*(corrected per claude-code-guide + MJ re-resolution 2026-06-26 — §4.4 is the authoritative section)*

| Key | Type | Default | Behavior |
|---|---|---|---|
| `autoMemoryEnabled` | boolean | `true` | When `false`, Claude **does not read from OR write to** the auto-memory directory. |
| `autoMemoryDirectory` | string | `~/.claude/plans` | Custom auto-memory dir; project/local settings only honored **after the workspace-trust dialog**. |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | env | — | Env-var disable. |

**RESOLUTION (Option A — shipped).** The original design planned to set `autoMemoryEnabled:false` to stop
jotting. That was invalid: per the verified docs, `autoMemoryEnabled:false` disables **both** read and
write — killing injection at the same time it stops jotting. The shipped approach (Option A, §4.4) keeps
`autoMemoryEnabled:true` and leaves `autoMemoryDirectory` unset, then neutralizes the auto-jotter at the
**filesystem layer** (dir `0500` / files `0400`; jotter writes get EACCES; loader reads are unaffected).
`writeGuarded` manages all projection writes (unlock → write → AC-8 → re-lock in finally). The
`projects/<slug>/memory/MEMORY.md` load path is a separate project-memory mechanism independent of the
`autoMemoryEnabled` flag; confirmed by the step-5 live session check in the runbook.

---

## 1. Cutover architecture at a glance

```
PRE-CUTOVER (today)                         POST-CUTOVER (after user runs slice 9)
─────────────────────                       ──────────────────────────────────────
team.md MEMORY HARVEST                       team.md LEARNING STEP (DB loop)
  └─ writes *.md + MEMORY.md      ──┐        learning Skill (non-team sessions)
     to projects/<slug>/memory/    │           └─ both call `dreamteam learn --installer-phase`
                                   │                or the agent-driven equivalent
Claude built-in auto-jot          │        Projection writer OWNS projects/<slug>/memory/
  (separate feature)              │           └─ MEMORY.md + topic files regenerated from DB
                                  │        Built-in auto-jot DISABLED (no two-writer collision)
                                  │
                  ┌───────────────┘
                  ▼
         scripts/import-file-memory.ts  (slice 8, one-time, idempotent)
            reads projects/<slug>/memory/*.md → DB (facts | instincts) + archive + worklist
                  │
                  ▼
         scripts/cutover.ts  (slice 9, one-time, --execute gated)
            backup → migrate → initial projection → VERIFY → flip settings → activate
            (rollback on any failure)
```

**The coupling:** slice 9 is the only place the three become atomic. Slices 7 and 8 are authored to be
**safe to ship before the cutover runs** (team.md edit is repo-local until re-installed; the importer
writes nothing without being invoked). Slice 9 sequences them and is the single destructive gate.

---

## 2. Slice 7 — `team.md` learning step + learning Skill

### 2.1 Decision: CLI-invoking step, NOT a re-implemented agent step
**The learning step invokes the Slice-6 `dreamteam learn` CLI; it does not re-author module calls in
prose.** Rationale (low-coupling / single-source-of-truth):
- `runLearn` already encodes the locked sequence (ensure → analyze → approve auto-inferred →
  directive capture → **always** regenerate). Re-expressing that as agent prose would fork the logic and
  drift from the tested core — a guaranteed second-order maintenance bug.
- The deterministic core (scrub, confidence, AC-8 self-check, projection determinism) lives in code with
  CI gates. An agent-driven re-implementation cannot inherit those gates.
- The interactive UX (`yes/no` for auto-inferred, free-text for directives) is already implemented in
  `cmdLearn`'s readline prompt with the BR-13a authorship guard.

**Division of labor:**
- The **deterministic spine** (analyzer, scrub, DB writes, projection, AC-8) → `dreamteam learn`.
- The **human-directive free-text UX** that needs the live conversation → the agent surfaces directive
  candidates *in-conversation* (it has the transcript the CLI does not — see R3/Step 4 in `runLearn`,
  which calls `capture.surface("")` with an empty transcript in headless/CLI mode). The team.md step is
  where the human's live directives are captured as candidates and handed to the loop.

**Honoring the locked UX (BR-13/13a):**
- **Auto-inferred → yes/no approval.** Mechanically: `dreamteam learn` (interactive TTY) prompts
  `Approve instinct #id …? [y/N]` per auto-inferred pending row. These are never claimed human-authored.
- **Human-directive → FREE-TEXT edit + confirm keystroke (the trust anchor).** Mechanically: the agent
  presents each surfaced directive candidate and asks the human to **type or edit** the directive line.
  The captured text is passed to `capture.captureDirective(sugg, {typedText, confirmed}, ctx)`, which
  enforces BR-13b (byte/normalized-identical-to-suggestion → REJECTED) and only writes `status='approved'`
  on a genuine human edit + confirm. **AskUserQuestion one-tap select is forbidden for directives** — it
  would forge authorship.

### 2.2 Where it lives in team.md
A new section **"## SESSION LEARNING (DB LOOP)"** authored **adjacent to / replacing MEMORY HARVEST**,
same trigger point (after spec sign-off, before Final Output). It mirrors MEMORY HARVEST's discipline:
end-of-session, context-fresh, one pass, skippable.

### 2.3 Coexistence — the pre-cutover safety problem
Until slice 9 flips the switch, the **old file-writing harvest is the live system** and the projection
target is the Dream Team-owned `memoryProjectionDir` (NOT `~/.claude`). Two coherent options:

| Option | Behavior pre-cutover | Verdict |
|---|---|---|
| **A. Atomic** — team.md edit is part of slice 9; old harvest stays until cutover | Old harvest writes files; loop not yet wired into team.md | Coherent but means team.md isn't validated until cutover. |
| **B. Dual-safe authoring** (CHOSEN) | team.md ships the new step **guarded** — it calls `dreamteam learn` which, pre-cutover, writes to `memoryProjectionDir` (its own dir, harmless) and never touches `~/.claude`. The old harvest section is **kept until cutover**, marked "DEPRECATED — removed at go-live". | Lets the loop be exercised pre-cutover without affecting the live `~/.claude` memory. The `isUnderClaudeDir` guardrail makes this safe by construction. |

**CHOSEN: Option B.** The new step is written to target `memoryProjectionDir` until slice 9 passes
`--installer-phase` and repoints to `~/.claude`. Pre-cutover, running the step is a harmless no-op against
the live memory dir (it writes to the Dream Team workspace). The old harvest block stays, flagged
DEPRECATED, and is **deleted by the slice-9 team.md edit** (one repo-source commit, then `dreamteam
install`/`repair` re-copies). This makes the switch a single reviewable diff, not a flag-day rewrite.

**Authoring note:** because team.md is **copied** (not symlinked) by the adapter and drift-tracked by sha,
the slice-9 edit MUST be followed by `dreamteam repair` (or `install`) to propagate to `~/.claude`. The
cutover script (§9) calls provision to re-copy as its final activation step.

### 2.4 The learning Skill (non-team sessions)
A new Skill `commands/learn.md` (or a `learn` skill manifest) that runs the **same end-of-session loop**
for ordinary (non-`/team`) sessions. It is the same prose contract as the team.md step, minus the
team-orchestration context: surface directives in-conversation, run `dreamteam learn`, honor the
auto-inferred-yes/no vs directive-free-text split. One source of behavioral truth shared by reference
(the Skill points at the same `dreamteam learn` CLI). This closes the "skippable, no-hook" gap noted in
architecture §8 — both team and ordinary sessions get the loop.

### 2.5 Test strategy (slice 7)
team.md / Skill changes are **prose** — reviewed, not executed. Assertions are reviewer checks:
(a) the directive path specifies free-text edit + confirm and forbids one-tap select; (b) the step targets
`memoryProjectionDir` pre-cutover and `~/.claude` only under `--installer-phase`; (c) the deprecated
harvest block is present pre-cutover and removed by the slice-9 diff; (d) the Skill references the same CLI.
A lightweight automated guard: a grep test asserting team.md's learning section does NOT contain an
`AskUserQuestion` block for the directive path (anti-regression on the authorship anchor).

---

## 3. Slice 8 — `scripts/import-file-memory.ts` (one-time migration)

### 3.1 Mechanism (Bun TS, idempotent, dry-runnable, fixture-first)

```
import-file-memory.ts
  --source <dir>      (REQUIRED; fixture dir in tests; real projects/<slug>/memory only when user runs it)
  --archive <dir>     (default: <source>/archive)
  --worklist <file>   (default: <workspace>/reports/migration-worklist.md)
  --project <name>    (scope for project/instinct rows; default basename of cwd)
  --dry-run           (report only; write NOTHING — no DB, no archive, no worklist)
  --db <path>         (default: dbPath(); tests inject :memory: or a temp file)
```

**No default that points at `~/.claude`.** `--source` is REQUIRED and has no default — the script refuses
to run without it. This is the slice-8 analogue of the `isUnderClaudeDir` guard: you cannot accidentally
migrate the live dir; the caller (slice 9) passes it explicitly.

### 3.2 Algorithm
```
1. Resolve source dir; list *.md except MEMORY.md and anything under <archive>.
2. For each file:
   a. Parse frontmatter. Read `type` (accept BOTH top-level `type:` and `metadata.type:`).
      - Missing/unknown type → SKIP + log to worklist as "unclassifiable" (never guess).
   b. If filename prefix (user_/project_/feedback_/reference_) disagrees with `type`:
      → `type` is authoritative (OQ-4 / BR-M1); LOG the mismatch to the worklist.
   c. Route by type:
      - user      → FactStore.upsertFact(kind='user')        [NOT scrubbed]
      - project   → FactStore.upsertFact(kind='project')     [NOT scrubbed]
      - reference → FactStore.upsertFact(kind='reference')   [NOT scrubbed]
      - feedback  → build InstinctCandidate {trigger, behavioral_shape, evidence} from the file;
                    run scrub(candidate):
                      ok    → InstinctsDb.upsertDirective({status: POLICY.status,
                                 ... }) with confidence per POLICY  [SEE §8.3 / BIRD]
                      !ok   → DO NOT IMPORT; append to worklist with {file, reason, matchedRule}
   d. Record the file as processed (for idempotency + reconciliation counts).
3. Archive: COPY (never move/delete) each processed source file into <archive>/ preserving name.
   (Copy, not rename — leaves the live dir intact for the projection to take over in slice 9.)
4. Emit a migration REPORT (counts + worklist path + mismatch log).
```

**Mapping `feedback` file → `InstinctCandidate`.** The fact rows are trivial (content verbatim). The
instinct candidate shape needs `trigger` / `behavioral_shape` / `evidence`. Pragmatic mechanism: use the
frontmatter `name` → `trigger`, `description` → `behavioral_shape`, and the body (or its first paragraph)
→ a single `evidence[0]`. **This split is a heuristic the importer owns; the exact field derivation is a
detail Bird may refine** (it affects identity_key + scrub surface, not the mechanism). Domain: feedback
files have no domain tag → default to a single migration domain (e.g. `process`) unless Bird rules
otherwise; identity_key is computed by `InstinctsDb.identityKey(trigger, domain, shape)`.

### 3.3 Migrated-feedback confidence/status — OPEN DEPENDENCY (Bird)
```ts
interface MigrationPolicy {
  feedbackStatus: "approved" | "pending";   // spec §6.5 → "approved" (already-curated). LOCKED.
  feedbackConfidence: number;               // 0.3–0.9. NOT YET PINNED. Bird's ruling.
                                            // Candidates: 0.7 (min injection-eligible) | 0.9 (curated, treat as directive-grade).
  feedbackIngestionPath: "human_directive"; // curated human guidance → directive path is the honest fit
                                            //   (n=1, no S/R evidence set). Bird to confirm.
}
```
The importer takes a `MigrationPolicy`. Default ships `{status:"approved", confidence:0.9,
ingestionPath:"human_directive"}` as a **provisional** value matching the directive-grade reading of
"already-curated guidance" — flagged for Bird sign-off. Because `upsertDirective` already stamps
confidence=0.9 for the directive path, the provisional default is the path of least surprise. **If Bird
rules a different value, it is a one-field change to the default policy object.**

### 3.4 Idempotency
- Facts: `FactStore.upsertFact` is supersede-on-upsert by `(tenant,user,project,kind,content_key)`.
  Use a **stable `content_key`** derived from the source filename (e.g. `migrated:<filename>`), so a
  re-run updates rather than duplicates.
- Instincts: `upsertDirective` is supersede-on-upsert by `(tenant,identity_key,scope,project)`. Identical
  re-run → same identity_key → no duplicate. (A re-run after a scrub-rule change could newly DROP a
  previously-imported item — that is correct; the worklist captures it; the prior row is not auto-deleted,
  which is acceptable for a one-time migration and noted in the report.)
- Archive copy is overwrite-safe (idempotent file copy).

### 3.5 Dry-run
`--dry-run` constructs the candidate list and runs scrub **in memory** (scrub is pure), reports the would-be
tier for each file + the would-be worklist entries, and asserts **zero writes**: no DB driver opened for
write, no archive copy, no worklist file created. Implementation: in dry-run, pass a `:memory:` driver
that is never committed AND short-circuit before all `fs`/archive/worklist writes, printing the plan only.

### 3.6 Test strategy (slice 8) — runs against a FIXTURE dir, never `~/.claude`
Fixture: `web/src/__tests__/fixtures/file-memory/` containing crafted `*.md`:
- one of each `type` (user/project/reference/feedback) with clean content;
- a `feedback` file whose body carries a client identifier (must DROP → worklist, NOT imported) — BR-M2;
- a file whose filename prefix disagrees with `type` (mismatch log assertion) — OQ-4;
- a file with missing/unknown `type` (unclassifiable → worklist, skipped);
- a `feedback` file with a malicious imperative (`curl … | sh`) → DROP → worklist (C-1).
Assertions:
1. Tier correctness (AC-M1): each clean file lands in the correct tier by `type`; zero `feedback` in
   `scoped_facts`; zero `user`/`project`/`reference` in `instincts`.
2. Scrub-drop → worklist (H-8): every DROPped feedback item appears in the worklist with reason; none
   appears in `instincts`.
3. Archive: every processed source file is copied into the archive dir; the **source files still exist**
   (copy, not move).
4. Idempotency: run twice against the same fixture+DB → identical row counts (no duplicates).
5. Dry-run: against the fixture, asserts the DB is untouched (row count 0 after), no archive dir created,
   no worklist file written, and the printed plan matches the wet-run tiering.
6. Migrated-feedback rows carry `MigrationPolicy.status`/`confidence` (parameterized — the test pins the
   provisional default and is updated when Bird rules).

---

## 4. Slice 9 — installer cutover (`scripts/cutover.ts`) + `dreamteam doctor`

### 4.1 New module: `scripts/cutover.ts` (NOT folded into install.ts)
Rationale: `provision()`/`install()` is the **idempotent, repeatable** install path (run on every update).
The cutover is a **one-time, destructive, irreversible-without-rollback** state transition. Conflating them
would make every routine `dreamteam install` risk re-running a destructive flip. Keep them separate;
cutover *calls* provision as its final activation step.

```
dreamteam cutover
  --execute            (REQUIRED to perform destructive steps 4→5; without it, DRY-RUN/plan only)
  --home <dir>         (override HOME; tests inject a fake home; defaults to real HOME only in prod)
  --source <dir>       (file-memory source; defaults to <home>/.claude/projects/<slug>/memory)
  --project <name>
```

**The destructive steps (settings flip + harvest removal) require `--execute`.** Without it, the command
prints the full plan and exits 0 having written nothing — the same dry-run discipline as slices 6/8.

### 4.2 The atomic ordering (architecture §0 — migrate + project BEFORE disabling built-in)
```
STEP 1  BACKUP
        - Copy <home>/.claude/projects/<slug>/memory/  → <backupsDir>/cutover-<ts>/memory/
        - Copy <home>/.claude/settings.json            → <backupsDir>/cutover-<ts>/settings.json.bak
        - Record a cutover-manifest.json {ts, paths, prior settings auto-memory keys}.
        GATE: backup verified to exist + non-empty before proceeding. (No --execute needed; read-only-ish.)

STEP 2  MIGRATE
        - Run import-file-memory.ts --source <memory dir> --db <dbPath> (NOT dry-run).
        - Capture counts {facts, instincts, dropped→worklist, skipped, mismatches}.

STEP 3  INITIAL PROJECTION
        - Run the projection (via `dreamteam learn --installer-phase --no-input --out <memory dir>` OR
          a direct createMemoryProjection().regenerate(ctx, <memory dir>)) to write MEMORY.md + topic
          files INTO the real projects/<slug>/memory dir. This is the ONLY step that writes ~/.claude
          memory, and it is ADDITIVE (writes the new MEMORY.md alongside the archived originals).
        - This produces a NON-EMPTY MEMORY.md as the replacement BEFORE anything is disabled.

STEP 4  VERIFY  (the gate — must pass before any destructive flip)
        - AC-8 self-check passed during regeneration (regenerate throws SelfCheckError/TruncationError
          on failure → cutover aborts → rollback).
        - MEMORY.md exists AND is non-empty (> 0 bytes, contains both section headers).
        - Reconciliation: (facts emitted in index + overflow) + (instincts in index) is consistent with
          migration counts (every migrated fact is either in-index or in an overflow topic file; every
          approved instinct ≤6 in index).
        - Projection is byte-identical on a second regenerate (determinism spot-check).
        REQUIRES --execute to PROCEED PAST this gate. Without --execute: print verify result, STOP.

STEP 5  ACTIVATE (destructive — only reached with --execute AND step 4 green)
        (corrected per claude-code-guide + MJ re-resolution 2026-06-26 — Option A settings mechanism)
        5a. ENSURE autoMemoryEnabled:true — write/overwrite this key in settings.json; NEVER write false.
            Leave autoMemoryDirectory unset (default per-project dir is correct).
        5b. RE-LOCK — chmod dir 0500 / files 0400 after the settings write (writeGuarded already
            locked after step 3; this re-lock covers any window opened by step 5a).
        5c. TEAM.MD ACTIVATION: copy the slice-7 team.md (new SESSION LEARNING step, MEMORY HARVEST
            removed) into <home>/.claude/commands/team.md.
        5d. Write cutover-complete marker into the cutover-manifest.

STEP 6  ROLLBACK (on ANY failure in steps 2–5)
        - Restore settings.json from settings.json.bak (re-enables built-in auto-memory exactly as before).
        - Restore the memory dir from backup (the archived originals + prior MEMORY.md).
        - Restore team.md from backup if 5b ran.
        - Leave the DB in place (harmless; re-running migration is idempotent) but log it.
        - Exit non-zero with the failing step + the restore actions taken.
```

**Why this ordering is correct (second-order reasoning):** the failure mode that matters is a window where
built-in auto-memory is disabled but no replacement MEMORY.md exists → the user silently loses all memory
injection. The ordering eliminates that window: the populated replacement is produced and *verified*
(steps 2–4) **before** the disable (5a). If anything fails before 5a, built-in auto-memory was never
touched — no loss. If 5a/5b fails, rollback restores the prior settings + memory.

### 4.3 `keep PRAGMA busy_timeout=5000` (H-4) and DB safety
The cutover opens the real DB for migration + projection. It must use the same driver config as runtime
(`busy_timeout=5000`) so a concurrently-running session does not deadlock the migration. The cutover
should refuse to run if a `dreamteam learn` is detected mid-flight is out of scope for v1 (single-user,
single-machine assumption) — documented as an accepted limitation.

### 4.4 Settings mechanism — SHIPPED: Option A (corrected per claude-code-guide + MJ re-resolution 2026-06-26)

**SHIPPED: Option A — keep `autoMemoryEnabled:true`; neutralize the jotter at the filesystem layer.**

The original §4.4 plan ("CHOSEN: (b) Disable built-in auto-memory (`autoMemoryEnabled:false`)") was
superseded during Slice 9 build after confirming that `autoMemoryEnabled:false` disables BOTH read and
write — it would kill injection at the same moment it stopped jotting. The shipped design is:

**Option A mechanism:**
1. **Keep `autoMemoryEnabled:true`** (write/overwrite this key to ensure it; never write false).
   The built-in loader continues reading `projects/<slug>/memory/MEMORY.md` each session start.
2. **Leave `autoMemoryDirectory` unset.** The default per-project dir already loads correctly.
3. **Neutralize the auto-jotter at the filesystem layer:** after projection, `writeGuarded` re-locks
   the memory dir (`chmod 0500`) and all files (`chmod 0400`). Any jotter write attempt receives EACCES
   and fails silently. The projection writer is the sole write authority.
4. **`writeGuarded` manages all projection writes:** unlock (dir 0700 / files 0600) → `regenerate()` →
   AC-8 post-write self-check → re-lock (dir 0500 / files 0400) in `finally`. A throw in any inner step
   still re-locks (the `finally` is unconditional).

**Why this satisfies the REPLACE ruling:**
- No two-writer collision: the filesystem lock prevents jotter writes, projection is sole writer.
- Injection preserved: `autoMemoryEnabled:true` keeps the loader running; MEMORY.md is readable (0400
  files, 0500 dir — only writes are blocked for non-owners; the harness reads as the owner).
- Rollback unchanged: if step 5 fails, settings.json is restored from backup (autoMemoryEnabled
  restores to its prior value; the lock is released by rollback's unlock-first step).

**Empirical assumption and gate:** the claim "0500 dir blocks jotter writes but not loader reads" is
harness runtime behavior that tests against a fake HOME cannot exercise. The RUNBOOK step 5 live session
check is the only confirmation. If memory is not loaded in the live session, rollback and diagnose.

The settings write is a **set/overwrite** (unlike `mergeHooks`'s add-if-missing), because we must
ensure the key is `true` even if it was previously `false`. The prior value is captured in the backup +
cutover-manifest for exact rollback.

### 4.5 `dreamteam doctor` extension (health/integrity check)
*(corrected per Option A — autoMemoryEnabled:true is the healthy state, not false)*

Extend `cmdDoctor` (bin/dreamteam.ts) with a memory-health section:
- Read `~/.claude/settings.json` auto-memory keys.
- **Assert `autoMemoryEnabled:true`** — this is the healthy Option-A post-cutover state. A value of
  `false` means the loader is disabled, which would kill injection; fail loud.
- **Assert `projects/<slug>/memory/MEMORY.md` exists and is non-empty.** Fail loud if owned-but-empty
  (the projection has run but produced nothing — the catastrophic silent-no-memory state).
- **Assert the memory dir is locked** (`chmod 0500` in effect) — if the dir is writable, writeGuarded's
  finally-lock failed; the jotter-neutralization hole is open; warn loudly.
- Assert `autoMemoryDirectory` is absent or consistent with the memory dir path (no mismatch).
- Assert the DB is reachable (`store.ensure()` succeeds) and `selectForProjection` runs without error.
- Surface any pending AC-8 self-check failure marker (if the last projection wrote a failure breadcrumb).
- Report the cutover-manifest state (cutover complete? rolled back?).
Doctor is **read-only** and never writes — safe to run anytime, including in tests against a fake home.

### 4.6 Test strategy (slice 9) — temp dirs + fake HOME, never real `~/.claude`
- **Fake home:** every test builds a `tmpHome` (mkdtemp) with `tmpHome/.claude/projects/<slug>/memory/`
  seeded from the slice-8 fixture, a `tmpHome/.claude/settings.json`, and a temp DB. `cutover.ts` takes
  `--home` so nothing resolves to the real HOME. A guard asserts `--home` is set in tests.
- **Ordering test:** instrument the steps (or assert on side-effects) to prove backup happens before any
  write and settings flip (5a) happens **only after** VERIFY (4) passes. Assert MEMORY.md is non-empty in
  the fake home **before** settings.json shows `autoMemoryEnabled:false`.
- **Backup-before-destruct:** after a successful cutover, the backup dir contains the pre-cutover
  memory + settings; the originals are archived (slice-8 archive) not deleted.
- **VERIFY gate:** inject a projection that throws `SelfCheckError` (or seed a DB that yields an empty
  MEMORY.md) → assert cutover aborts at step 4, settings.json is UNCHANGED (`autoMemoryEnabled` still
  true), and rollback restored state.
- **Rollback-on-failure:** force a failure in 5a (e.g. settings path unwritable) after the flip began →
  assert settings.json + memory dir are restored from backup and exit code is non-zero.
- **--execute gating:** without `--execute`, assert the destructive steps never run (settings unchanged,
  team.md unchanged) and the plan is printed.
- **doctor:** seed (a) disabled + empty MEMORY.md → doctor FAILS loud; (b) disabled + non-empty MEMORY.md
  → doctor passes; (c) enabled → doctor reports built-in active. All against fake home.

---

## 5. File changes summary (build-ready)

| File | Action | Notes |
|---|---|---|
| `commands/team.md` | MODIFY | Add "SESSION LEARNING (DB LOOP)" step (Option B dual-safe); keep MEMORY HARVEST flagged DEPRECATED pre-cutover; slice-9 diff removes harvest. Copied by adapter — needs `repair` to propagate. |
| `commands/learn.md` (Skill) | CREATE | Same loop for non-team sessions; references `dreamteam learn`. |
| `scripts/import-file-memory.ts` | CREATE | One-time migration; `--source` required; `--dry-run`; archive-copy; worklist; `MigrationPolicy`. Symlinked by adapter. |
| `scripts/cutover.ts` | CREATE | One-time atomic cutover; `--execute` + `--home`; backup→migrate→project→VERIFY→flip→rollback. Symlinked by adapter. |
| `bin/dreamteam.ts` | MODIFY | Add `cutover` subcommand (→ scripts/cutover.ts); extend `cmdDoctor` with memory-health section. |
| `scripts/doctor.ts` | MODIFY (optional) | Add `checkMemoryHealth(home, project)` returning a `ProviderCheck`-shaped result reused by `cmdDoctor`. |
| `web/src/__tests__/import-file-memory.test.ts` | CREATE | Fixture-based; AC-M1, scrub-drop→worklist, archive, idempotency, dry-run. |
| `web/src/__tests__/cutover.test.ts` | CREATE | Fake-home; ordering, backup-before-destruct, VERIFY-gate, rollback, --execute gating, doctor. |
| `web/src/__tests__/fixtures/file-memory/` | CREATE | Crafted `*.md` per §3.6. |

---

## 6. Risks & open items
*(corrected per claude-code-guide + MJ re-resolution 2026-06-26)*

- **[RESOLVED] auto-memory disable-vs-load semantics (§0.5/§4.4 original concern).** The original
  plan to set `autoMemoryEnabled:false` was invalid — that flag disables both read and write, killing
  injection. **Resolution: Option A** (shipped). Keep `autoMemoryEnabled:true`; neutralize the jotter
  at the filesystem layer (dir 0500 / files 0400 via `writeGuarded`). The disable-vs-load risk is
  eliminated because no disable flag is set. Residual: the "0500 dir blocks writes but not reads"
  assumption is confirmed only by the RUNBOOK step-5 live session check — a runtime-only gate.
- **[HIGH] Bird migration ruling (§3.3).** `feedbackConfidence`/`ingestionPath` for migrated feedback not
  pinned. Provisional default `{approved, 0.9, human_directive}`. One-field change when Bird rules.
- **[MED] team.md is copied, not symlinked.** Slice-9 edit needs `repair`/`install` to propagate; the
  cutover does this in step 5b. A bare repo edit without re-install leaves `~/.claude/commands/team.md`
  stale.
- **[MED] settings overwrite vs add-if-missing.** The cutover does a set/overwrite of auto-memory keys —
  more invasive than `mergeHooks`. Prior values are backed up; rollback restores exactly.
- **[LOW] feedback→InstinctCandidate field derivation** (name→trigger, description→shape, body→evidence)
  is a heuristic affecting identity_key + scrub surface; Bird may refine; mechanism unaffected.

## 7. Confidence
High on the mechanism, ordering, rollback, and test strategy (all modules read; all seams verified
in code). Medium on the settings semantics (one verified doc fetch + an inference from the default-dir
discrepancy; runtime behavior unconfirmable at build time). The design is structured so that uncertainty
is contained by the VERIFY gate + rollback + doctor, not load-bearing on a guess.

---

# 8. CUTOVER DRY-RUN CORRECTION + CANONICAL SLUG (post real-data dry-run)

**Author:** MJ (Strategic Systems Architect) · **Status:** fix spec for Shaq · **Date:** 2026-06-26
**Trigger:** A real-data dry-run of the cutover exposed TWO defects. The "plan/verify" no-execute mode
is DESTRUCTIVE, and `--project` is overloaded with a default that matches neither axis. This section
supersedes the relevant parts of §4.2 (step gating) and the RUNBOOK Step-1 claims (lines 26–31).

> **PRIME DIRECTIVE RESTATED + STRENGTHENED:** `dreamteam cutover` WITHOUT `--execute` MUST write
> NOTHING to `~/.claude` AND NOTHING to the real workspace DB. Only `--execute` may touch the real DB,
> the real memory dir, or apply the 0500 lock. This is now an enforced test invariant (§8.4 Test B).

---

## 8.1 DEFECT 1 (CRITICAL) — the no-execute "dry-run" is destructive

### Root cause (confirmed in `scripts/cutover.ts`)
Only **step 5 (activate)** is gated by `execute`. Steps 2 and 3 mutate the real environment regardless:

- **Step 2 MIGRATE** (`runCutover` ~L587–604): calls `runImport({ dryRun:false, dbPath: resolvedDbPath,
  archiveDir: <sourceDir>/archive, ... })`. `resolvedDbPath` defaults to the **real** `defaultDbPath()`,
  and `archiveDir` defaults to `<real source>/archive`. So a no-execute run imports into the real DB and
  copies into the real source dir.
- **Step 3 PROJECTION** (`runCutover` ~L609–631): calls `writeGuarded(projection, ctx, memoryDir)` where
  `memoryDir = <home>/.claude/projects/<project>/memory` (the **real** dir). `writeGuarded` overwrites
  `MEMORY.md` and re-locks the dir at **0500** in its `finally`.
- **Step 1 BACKUP** (`runCutover` ~L555): when the memory dir is absent it calls
  `fs.mkdirSync(memoryDir, { recursive:true })` — a real-dir mutation even in no-execute mode.

The RUNBOOK Step-1 (lines 26–31) claims the no-execute run is "read-only", runs "against a temporary
target", and "writes nothing to `~/.claude`" — all three are FALSE against the current code. Those lines
must be rewritten to match the corrected flow below.

### Corrected design — sandbox the entire no-execute pipeline

No-execute mode runs the FULL pipeline (migrate → project → verify) against a **throwaway staging
sandbox**, then produces the report PLUS a preview diff of what the real `MEMORY.md` WOULD become. The
real DB, real source dir, real memory dir, and the lock are never touched.

```
runCutover(opts):
  mode = opts.execute ? "execute" : "dry-run"

  # --- target resolution (THE key change: targets depend on mode) ---
  realMemoryDir   = harnessMemoryDir(home, projectId)            # <home>/.claude/projects/<id>/memory
  realDbPath      = opts.dbPath ?? defaultDbPath()
  realSourceDir   = opts.source ?? realMemoryDir                 # migrate READS this (never written)

  if mode == "execute":
     memoryDir  = realMemoryDir          # projection target = real
     dbPath     = realDbPath             # migrate/project DB = real
     archiveDir = realSourceDir/archive  # archive copies = real (alongside originals)
     applyLock  = true
  else:  # dry-run — build a sandbox under os.tmpdir()
     stagingRoot = mkdtemp("cutover-dryrun-")
     memoryDir   = stagingRoot/memory          # projection writes HERE, not real
     dbPath      = stagingRoot/staging.db       # migrate/project DB = throwaway copy
     archiveDir  = stagingRoot/archive          # archive copies go HERE, not real source
     applyLock   = false                        # NEVER lock the real dir in dry-run
     # Seed staging DB from the real DB so the preview reflects already-learned data:
     if exists(realDbPath): seedStagingDb(realDbPath -> dbPath)   # WAL-safe copy (§8.1 note)

  STEP 1 BACKUP:
     # Backup is read-of-real / write-to-workspace — allowed in BOTH modes (useful, harmless).
     # FIX: in dry-run, DO NOT mkdir the real memory dir when absent. Record
     #      memoryDirExistedBefore and skip creation; the sandbox dir is created instead.

  STEP 2 MIGRATE:
     runImport({ sourceDir: realSourceDir,   # READ-ONLY: import copies OUT to archiveDir, never writes source
                 dryRun: false,              # wet against the STAGING db in dry-run (sandbox is writable)
                 dbPath, archiveDir, project: projectId, worklistPath, reportPath })

  STEP 3 PROJECTION:
     wg = applyLock ? writeGuarded : regenerateNoLock   # dry-run uses a non-locking regenerate into staging
     wg(projection-over-dbPath, ctx, memoryDir)

  STEP 4 VERIFY:
     verify(memoryDir, dbPath, projectId, settingsPath, projection-over-dbPath)
     # Runs against the STAGED output in dry-run — user sees real verify results safely.
     # NOTE: the dirLocked check is execute-only; in dry-run report dirLocked="n/a (staging)".

  if mode == "dry-run":
     PREVIEW = diff(read(realMemoryDir/MEMORY.md) or "<none>",  staging/MEMORY.md)
     write PREVIEW + tier counts + worklist + mismatches to <backupDir>/cutover-dryrun-preview.md
     cleanup(stagingRoot)
     return { success: verify.passed, manifest, verifyResult, preview }

  # mode == "execute": continue to STEP 5 ACTIVATE (unchanged), STEP 6 ROLLBACK (unchanged)
```

**Why this is correct (second-order):** the migrate step already preserves source files (it COPIES to
the archive dir, never moves/deletes — `import-file-memory.ts` L546–555). Redirecting `archiveDir` and
`dbPath` to the sandbox makes migrate fully non-destructive while still exercising the real parser against
the real files (faithful preview). Seeding the staging DB from the real DB means the preview reflects
both migrated facts AND any pre-existing learned instincts, so the diff is the true would-be `MEMORY.md`.

**WAL-safe staging-DB seed (note for Shaq).** `realDbPath` is opened WAL (db-driver §27). A bare
`fs.copyFileSync` of the `.db` can miss un-checkpointed `-wal`/`-shm` pages. Use ONE of:
  (a) `VACUUM INTO '<staging.db>'` via a short-lived driver on the real DB (clean single-file snapshot), OR
  (b) checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) then copy `.db` (+`-wal`,`-shm` if present).
Prefer (a) — single file, no lock window. The cutover already assumes no concurrent session (RUNBOOK L14).

### Override interaction (sandboxed run by hand)
- `--home <dir>` — redirects ALL `~/.claude` resolution (memory dir, settings) to `<dir>`. A test/sandbox
  passes a temp home so even `--execute` touches nothing real.
- `--source <dir>` — overrides the migrate READ source. In dry-run defaults to the real memory dir
  (read-only). Allowed in both modes.
- `--db <path>` — names which DB the run operates against. In **execute** it IS the write target
  (defaults to `defaultDbPath()`). In **dry-run** it is the **seed source** copied into the throwaway
  `staging.db`; the real file named by `--db` is never written. (Document this asymmetry in `--help`.)
- `--backup-dir <dir>` — relocates backups + the dry-run preview file; works in both modes.
- Fully-sandboxed manual run: `cutover --project <id> --home <tmpHome> --db <tmpDb> --backup-dir <tmpBk>`
  touches nothing real in EITHER mode.

---

## 8.2 DEFECT 2 — `--project` overloaded + defaults wrong

### Root cause
`--project` is used for BOTH (a) the Claude Code harness memory-dir slug
(`<home>/.claude/projects/<slug>/memory`, path-encoded) AND (b) the DB tenant/project scoping key. Every
command defaults it to `path.basename(process.cwd())` (= `dreamteam`):
`cmdLearn` L329, `cmdInstincts` L465, `cmdDoctor` L623, `cmdCutover` L653, `cutover.ts` CLI L745,
`import-file-memory.ts` CLI L699. The basename matches NEITHER axis: the real harness dir is the
path-encoded slug (`-Users-lb-Github-Bondarewicz-dreamteam`), so the default cutover targets a
nonexistent dir; passing the path-encoded slug to fix the dir then mis-scopes the DB relative to
`learn`/`doctor` which still default to the basename.

### CONFIRMED Claude Code harness encoding (empirically verified)
The harness slug is the **absolute cwd with every non-alphanumeric character replaced by `-`**, 1:1,
**no collapsing of consecutive separators**, **no lowercasing**, leading `/` becomes a leading `-`:

```ts
const canonicalProjectId = (cwd = process.cwd()) =>
  path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-");
```

Verified against real dir names under `~/.claude/projects/` (each reproduced exactly):

| Absolute cwd | Harness dir name |
|---|---|
| `/Users/lb/Github/Bondarewicz/dreamteam` | `-Users-lb-Github-Bondarewicz-dreamteam` |
| `/Users/lb/Github/Bondarewicz/dreamteam/.claude-worktrees/tutorial-upgrades` | `-Users-lb-Github-Bondarewicz-dreamteam--claude-worktrees-tutorial-upgrades` |
| `/Users/lb/.bun/install/global/node_modules/@bondarewicz/dreamteam` | `-Users-lb--bun-install-global-node-modules--bondarewicz-dreamteam` |

Note the double dashes: `/.` → `--` (slash + dot, each → one dash) and `/@` → `--`; `_` (in
`node_modules`) → `-`; an existing `-` (in `claude-worktrees`) stays `-`. The live derivation
`canonicalProjectId()` resolves to `-Users-lb-Github-Bondarewicz-dreamteam`, which **exists** on disk.

### DECISION — ONE canonical id for BOTH axes (not a split)
Use `canonicalProjectId()` as BOTH the harness memory-dir slug AND the DB scope key.

**Justification (low coupling via single source of truth).** The split option (`memorySlug` for the dir,
`projectId` for the DB) reintroduces exactly the defect we are fixing: two values that must stay in
lockstep but can drift. The harness-dir slug is an EXTERNAL contract (must equal Claude Code's encoding,
non-negotiable); the DB scope key is INTERNAL and opaque — it can be any stable string. Making the
internal key equal the external slug costs only a verbose (but harmless) DB key and removes a whole class
of axis-drift bugs. Migrated data (`cutover`) and learned data (`learn`/`instincts`/`doctor`) then share
one scope by construction. `--project` remains an explicit OVERRIDE for non-cwd targets; normal use never
passes it.

**Migration note (existing pre-cutover rows).** Pre-cutover `learn` runs scoped rows under the buggy
default `dreamteam`. Switching the scope key to the path-encoded id strands those rows. This is
acceptable: pre-cutover `learn` wrote to the Dream Team workspace (experimental, `memoryProjectionDir`),
and the cutover repopulates the canonical scope from files. Shaq should NOT silently re-scope; note it in
the cutover report. If preservation is wanted later, add a one-time `UPDATE … SET project=<canonical>
WHERE project='dreamteam'` behind an explicit flag — out of scope for this fix.

---

## 8.3 FIX SPEC FOR SHAQ — exact functions/steps to change

### `scripts/paths.ts`
1. ADD `canonicalProjectId(cwd = process.cwd()): string` → `path.resolve(cwd).replace(/[^A-Za-z0-9]/g,"-")`.
   Document the confirmed encoding + the 3 verified fixtures in the JSDoc.
2. ADD `harnessMemoryDir(home: string, projectId: string): string`
   → `path.join(home, ".claude", "projects", projectId, "memory")`. Single source for the harness path
   (cutover + doctor must both call it).

### `bin/dreamteam.ts`
3. Replace `path.basename(process.cwd())` defaults with `canonicalProjectId()` in: `cmdLearn` (L329),
   `cmdInstincts` (L465), `cmdDoctor` (L623), `cmdCutover` (L653). `--project` stays the override.
4. `cmdDoctor`: build the memory dir via `harnessMemoryDir(home, project)` (don't re-encode by hand).

### `scripts/import-file-memory.ts`
5. CLI entry (L699): default `--project` to `canonicalProjectId()` (not basename).

### `scripts/cutover.ts` — the load-bearing change
6. CLI entry (L745): default `--project` to `canonicalProjectId()`.
7. `runCutover` (L500): introduce the **mode branch** of §8.1. Concretely:
   - Compute `realMemoryDir = harnessMemoryDir(home, project)`, `realDbPath = opts.dbPath ?? defaultDbPath()`,
     `realSourceDir = opts.source ?? realMemoryDir`.
   - Derive the active `memoryDir` / `dbPath` / `archiveDir` / `applyLock` from `execute` (execute → real;
     dry-run → staging sandbox created via `fs.mkdtempSync`).
   - Dry-run: seed `staging.db` from `realDbPath` via `VACUUM INTO` (a short-lived driver) when the real
     DB exists.
8. STEP 1 BACKUP (L540–571): in dry-run, REMOVE the `fs.mkdirSync(memoryDir)` real-dir creation (L555);
   record `memoryDirExistedBefore` only. Backup still copies real memory + settings into `backupDir`.
9. STEP 2 MIGRATE (L587–604): pass the mode-resolved `dbPath` and `archiveDir` (staging in dry-run);
   `sourceDir = realSourceDir` always (import is read-only on source).
10. STEP 3 PROJECTION (L609–631): open the driver on the mode-resolved `dbPath`; in dry-run call a
    NON-locking regenerate into `memoryDir` (staging). Factor `writeGuarded` so a `lock:false` path exists,
    OR call `projection.regenerate(ctx, stagingDir)` directly in dry-run (no unlock/lock/chmod at all).
    NEVER lock in dry-run.
11. STEP 4 VERIFY (L636–663): run `verify` against the mode-resolved `memoryDir`/`dbPath`. Make the
    `dirLocked` assertion execute-only (report `"n/a (staging)"` in dry-run). Keep the existing
    `if (!execute) return` early-exit — but FIRST emit the preview/diff:
12. ADD dry-run PREVIEW: before the early return, write `<backupDir>/cutover-dryrun-preview.md` containing
    (a) unified diff of real `MEMORY.md` (or `<none>`) vs staging `MEMORY.md`, (b) tier counts, (c) worklist
    + mismatches. Then `fs.rmSync(stagingRoot, {recursive:true,force:true})` and return.
13. STEP 5 ACTIVATE / STEP 6 ROLLBACK: unchanged (execute-only path).
14. `CutoverManifest`/`CutoverResult`: add `mode: "execute"|"dry-run"` and optional `previewPath` for
    observability; doctor/report can surface it.

### RUNBOOK.md
15. Rewrite Step-1 (lines 26–31): the no-execute run backs up to `~/.dreamteam`, runs migrate+project+
    verify **against a temp staging sandbox**, emits a preview diff, and writes NOTHING to `~/.claude` or
    the real DB. Remove the old false "temporary target" hand-wave; point at the preview file.

---

## 8.4 TEST ADDITIONS (close the two gaps that hid these defects)

### Test A — REAL cwd→slug derivation (the gap that hid Defect 2)
Defect 2 was hidden because tests INJECTED `--project`, never exercising the default path.
- `paths.test.ts`: assert `canonicalProjectId("/Users/lb/Github/Bondarewicz/dreamteam") ===
  "-Users-lb-Github-Bondarewicz-dreamteam"` plus the other two table fixtures (double-dash + underscore
  cases) — locks the exact transform incl. no-collapse / no-lowercase.
- A test that calls `canonicalProjectId()` with NO argument (real `process.cwd()`) and asserts it equals
  `process.cwd().replace(/[^A-Za-z0-9]/g,"-")` — exercises the live default, not an injected value.
- End-to-end default-resolution test: run `cmdCutover`/`cmdLearn` with NO `--project` against a fake home
  and assert the resolved memory dir is `<home>/.claude/projects/<canonicalProjectId()>/memory` and that
  cutover migrate + learn project share the SAME scope key.

### Test B — no-execute writes NOTHING to target memory dir / real DB (the gap that hid Defect 1)
- Seed a fake home with a memory dir containing a sentinel `MEMORY.md` (known bytes, known mode e.g. 0700)
  and a real DB file with a known content hash/mtime. Run `runCutover({execute:false, ...})`.
- Assert AFTER: target `MEMORY.md` bytes UNCHANGED; target dir mode UNCHANGED (NOT 0500); real DB
  hash/mtime UNCHANGED; no `archive/` dir created under the real source; AND the dry-run preview file
  exists and is non-empty.
- Negative-creation variant: target memory dir ABSENT before → assert it is STILL absent after a no-execute
  run (catches the L555 mkdir mutation).
- Execute variant (regression): `runCutover({execute:true,...})` against a fake home still writes + locks
  (0500) the real (fake-home) dir — confirms the gating flips behavior, not just the format.
