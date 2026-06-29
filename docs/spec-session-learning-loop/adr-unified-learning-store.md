# Feature Summary & ADR — Unified Learning & Memory Store

**Tracker:** session-learning-loop
**Status:** Slices 1–9 complete, 557 tests green, all local/uncommitted.
**Date:** 2026-06-26
**Authors:** Łukasz (head coach) + Bird + MJ + Shaq + Kobe + Pippen + Drexler + Magic

---

## What this feature is

The Unified Learning & Memory Store replaces the file-based markdown memory system
(`~/.claude/.../memory/*.md`, ~20 files, four frontmatter types) with a single DB-backed store. It is not
an add-on — it is a consolidation. Both what was in file memory and what the session-learning loop
produces live in this store.

The core loop: session judge findings (warn/fail) → signal extraction → scrub gate → DB → human
approval → projection writer regenerates `MEMORY.md` → Claude Code loads it at the next session start.
Every step is local, deterministic, and human-gated.

---

## Locked design decisions (do not re-litigate)

**No hooks.** Capture and approval run as an in-session agent step (mirrors `team.md` MEMORY HARVEST
discipline). The prior hook-based SessionEnd analyzer design was abandoned because `session-eval-hook.ts`
spawns a detached worker where interactive approval is structurally impossible (C-4). No new hooks were
added.

**Injection via built-in auto-memory loading MEMORY.md.** The projection writer regenerates `MEMORY.md` +
topic files from the DB; Claude Code's built-in project-memory loader picks it up at the next session start
(200 lines / 25KB). No inject hook needed.

**Option A injection mechanism (autoMemoryEnabled:true + filesystem lock).** The original plan to set
`autoMemoryEnabled:false` was invalid — that flag disables both read and write, which would kill injection.
The shipped approach: keep `autoMemoryEnabled:true` (loader stays on); neutralize the auto-jotter at the
filesystem layer (memory dir `0500` / files `0400`); all projection writes go through `writeGuarded`
(unlock → write → AC-8 → re-lock in finally). MJ re-resolution 2026-06-26.

**Two-tier confidentiality.** Scoped facts (`user`/`project`/`reference`) are identifying, never scrubbed,
protected by row-level tenant isolation only. Shareable instincts (`feedback` + auto-derived) are
generalizable heuristics, always scrubbed, human-approved before injection.

**Human-gated injection.** No instinct is injected until a human explicitly approves it. For auto-inferred
instincts: yes/no review in-session. For human-directive instincts: the human types or edits the directive
text (BR-13a authorship guard — byte-identical-to-suggestion is rejected; the keystroke is the trust
anchor).

**Two ingestion paths.** Auto-inferred: ≥3 distinct sessions of warn/fail findings → `status='pending'`
→ requires review. Human-directive: n=1, in-session confirmed, confidence fixed at 0.9, `status='approved'`
on confirm keystroke. Migrated: one-time import from file-based `feedback` memories,
`confidence=0.7`, `ingestion_path='migrated'`, `status='approved'` (Bird ruling, Slice 8).

**Turso deferred.** v1 ships single-user local `bun:sqlite`. The DB-driver async seam (`web/src/db-driver.ts`),
tenant columns, and fail-closed scope predicates are structured so Turso is a driver/config swap. Cross-tenant
enforcement and tests (AC-S1/S2) are a Turso-phase gate.

---

## v1 Release gates

| Gate | Description |
|---|---|
| **AC-2** | Adversarial scrub corpus: DROP invariant (client identifiers, imperatives, base64/homoglyphs) AND KEEP invariant (legitimate instinct vocabulary) pass simultaneously. CI gate. |
| **AC-8** | Projection-selection adversarial gate: rejected/pending/sub-threshold/expired/wrong-tenant instincts absent from the generated MEMORY.md. Post-write self-check re-parses after every regeneration. |
| **AC-M1** | Migration tier-correctness: every file memory lands in the correct tier per frontmatter `type`; zero `feedback` in scoped_facts; zero `user`/`project`/`reference` in instincts. |
| **AC-MIG** | Migration idempotency, dual-frontmatter parse (flat `type:` and `metadata.type:`), worklist emission for scrub-dropped feedback files. |

---

## The 9 slices

| # | Purpose | Sign-off | Key new files |
|---|---|---|---|
| **1** | Scrub gate — deterministic DROP-not-redact, 8 detectors, C-2 hardening (decode-and-rescan, NFKC+confusable-fold, cross-field concat), Rule 4 restructured to positive-name-signal (path C, wordlist removed). | Kobe (confidence 88) | `web/src/instinct-scrub.ts`, `web/src/__tests__/instinct-scrub.test.ts` |
| **2** | DB-driver seam — async wrapper over `bun:sqlite` mirroring `@libsql/client` surface; only module importing a concrete driver; CI grep guard; `DbDriverError`+`DRIVER_ERROR_CODES`. | Pippen | `web/src/db-driver.ts` |
| **3** | Two-tier schema + stores — `scoped_facts` (tier 1, no scrub, no TTL) + `instincts`/`signals_buffer`/`instinct_occurrences` (tier 2); named UNIQUE indexes with COALESCE NULL-traps; `agent_id` dormant forward-compat column; `embedding` deferred. | Kobe | `web/src/fact-store.ts`, `web/src/instincts-db.ts`, `docs/spec-session-learning-loop/slice3-design.md` |
| **4** | Two ingestion paths — `session-analyzer.ts` (auto-inferred: FindingsReader ACL, empty short-circuit before LLM, ≤30s timeout, scrub, recordSignal) + `directive-capture.ts` + `llm-client.ts` (claude -p seam, Promise.race timeout, SIGTERM→SIGKILL, stderr drain). BR-2.1 confidence via SQL ROUND. | Kobe + Pippen | `web/src/session-analyzer.ts`, `web/src/directive-capture.ts`, `web/src/llm-client.ts` |
| **5** | Projection writer — DB → MEMORY.md + topic files; injected outDir (never `~/.claude` directly); AC-8 post-write self-check (symmetric both tiers); truncation hard-error for top-6 eligible; byte-identical determinism. | Kobe | `web/src/memory-projection.ts` |
| **6** | `learn` + `instincts` CLI — `runLearn(opts, deps)` Humble Object + `cmdLearn`/`cmdInstincts` shells; symlink-hardened `~/.claude` guardrail; always-regenerate (AC-6); `--dry-run` = `:memory:` + no-op; headless captures-to-pending (no forged consent). | Kobe + Pippen | `bin/dreamteam.ts` (modified), `scripts/paths.ts` |
| **7** | `team.md` SESSION LEARNING step + learn skill — dual-safe pre-cutover (writes to Dream Team workspace dir, not `~/.claude`); MEMORY HARVEST marked DEPRECATED; `commands/learn.md` skill for non-team sessions; AskUserQuestion forbidden for directive path. | Pippen | `commands/team.md` (modified), `commands/learn.md` |
| **8** | File-memory migration — `import-file-memory.ts`: dual-frontmatter parser, REQUIRED `--source`, tier routing, scrub-on-feedback, worklist for dropped items, archive-copy, idempotent, `--dry-run`. BR-8′ TTL fix: `auto_inferred` pruned; `migrated`/`human_directive` TTL-exempt. | Kobe + Pippen | `scripts/import-file-memory.ts` |
| **9** | Installer/cutover — `scripts/cutover.ts`: Option A (ensure `autoMemoryEnabled:true` + FS lock), backup→migrate→projection(writeGuarded)→VERIFY(AC-8+non-empty+both-headers+determinism+dirLocked)→ACTIVATE→rollback; `dreamteam doctor` memory-health extension (`autoMemoryEnabled:true`, MEMORY.md non-empty, dir locked, DB reachable). All tested against fake HOME; real cutover is user-run. | (build complete) | `scripts/cutover.ts`, `bin/dreamteam.ts` (doctor extension) |

**Test count by end of each slice:** 134 after slice 1 → 333 after slice 3 → 400 after slice 4 → 433
after slice 5 → 452 after slice 6 → 518 after slice 8 → **557 total** after slice 9.

---

## Deferred / known gaps

| Item | Status | Trigger to add |
|---|---|---|
| **Turso / libSQL driver swap** | Deferred — v1 is local SQLite | Multi-user or cloud sync requirement |
| **Cross-tenant enforcement (AC-S1/S2)** | Schema-ready; tests deferred | Turso phase |
| **Promotion to global scope (BR-7/7a)** | v1.1 | After cross-project pattern observed |
| **Global confidence recompute (M-3)** | v1.1 | After promotion ships |
| **Analyzer prompt golden-label calibration** | v1.1 | After loop produces candidate history |
| **Embedding / vector retrieval** | Deferred — column exists (BLOB, no v1 writer) | Turso vector phase |
| **`memory_links` table / wikilink resolution** | Deferred — `[[text]]` preserved verbatim | Slice 8 parser reads links, or projection adds traversal |
| **`agent_id` dedup in index** | Dormant column; swap is DROP+CREATE (no ALTER TABLE) | Bird ruling on agent scoping |
| **Agent-driven in-conversation directive persistence (R3)** | v1 gap — run `dreamteam learn` interactively to persist | Full transcript passthrough design |
| **Analyzer LLM prompt quality eval** | Untested against real `claude -p` | Recommend `--trials 3` eval pass before relying on auto-inferred instincts |
| **Group-leader spawn for `llm-client.ts`** | Best-effort no-op today (Bun.spawn doesn't set group leader) | Grandchild orphan risk on timeout path |
| **`getById`/`setStatus`/`getFactById` scopeless** | Safe in single-tenant v1; must take TenantCtx at Turso phase | Add all three together + regression test |

---

## Terminology

| Domain term (Bird) | Code term | Definition |
|---|---|---|
| Scoped fact | `scoped_facts` table, `kind` in {user, project, reference} | Tier-1 memory: identifying, never scrubbed, tenant-isolated |
| Shareable instinct | `instincts` table | Tier-2 memory: behavioral, scrubbed, promotable |
| Ingestion path | `ingestion_path` column | How an instinct entered the store: `auto_inferred` / `human_directive` / `migrated` |
| In-session approval | `runLearn` + `dreamteam learn` CLI | Agent-driven end-of-session loop while context is fresh |
| Projection | `memory-projection.ts` `regenerate()` | DB → MEMORY.md + topic files; sole write path to memory dir |
| writeGuarded | `writeGuarded()` in `memory-projection.ts` | unlock → write → AC-8 → re-lock in `finally` |
| Option A | Shipped injection mechanism | `autoMemoryEnabled:true` + FS lock (dir 0500/files 0400) neutralizes jotter |
