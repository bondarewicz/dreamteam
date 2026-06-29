# Operational Readiness — Session Learning Loop (Tier 2)

**Author:** Pippen (Stability, Integration & Defense) · **Status:** review for sign-off
**Verdict:** READY WITH CAVEATS — the design is sound and well-bounded, but ships with two **blocking** gaps before code: (1) SQLite concurrency has no `busy_timeout`, so a SessionStart inject and a SessionEnd worker writing simultaneously will throw SQLITE_BUSY; (2) there is **no observability surface** for the loop, so the head coach cannot see what it created/injected/pruned. Fix both and this is READY.

Files reviewed: `intake.md`, `domain.md`, `architecture.md`, `scripts/session-eval-hook.ts`, `web/src/db.ts`, `web/src/sessions-db.ts`, `scripts/hooks.json`, `adapters/claude-code.ts`.

---

## Risk register (severity-ranked)

### R1 — No `busy_timeout`; concurrent sessions throw SQLITE_BUSY · **HIGH**
`web/src/db.ts:12-20` sets `WAL` + `foreign_keys=ON` but **no `busy_timeout`**. Under WAL, concurrent readers don't block, but **writers are still serialized** and a second writer gets `SQLITE_BUSY` *immediately* (bun:sqlite does not auto-retry). The new design adds writers that did not exist before:
- The detached worker's analyzer transaction (upsert occurrences + promote + prune) — §5 "all writes inside one transaction".
- Two sessions ending ~simultaneously → two workers both opening their own connection (each process gets its own `getDb()` singleton) and both attempting the analyzer write txn.
- A SessionStart inject is read-only (safe under WAL), but the **TTL belt-and-suspenders** described in §5 is read-only too — good.

The real collision: **worker A holding the write transaction while worker B tries to begin its own** → B throws. Today this can't happen (judge writes are a single `INSERT OR REPLACE`, fast); the analyzer's multi-statement transaction widens the window materially.

**Guard required:** set `PRAGMA busy_timeout = 5000` (or higher) in `getDb()` for **all** connections — this is a one-line change in `db.ts:16` that benefits the existing judge writes too. Additionally, wrap the analyzer transaction so SQLITE_BUSY is caught, logged, and the run is **skipped, not crashed** (the loop is best-effort; a dropped run just means "try again next session"). Idempotency (§5, UNIQUE constraints) already makes a retry safe.

### R2 — Loop is a black box; no observability surface · **HIGH**
There is **no way for the head coach to see what the loop did**. The existing judge logs to `~/.claude/dreamteam-auto-eval.log` (`session-eval-hook.ts:25`), but the spec defines **no equivalent for the analyzer**: no log line for instincts created/materialized, candidates **dropped by the scrub gate** (the load-bearing safety event!), promotions, TTL prunes, or what was injected at SessionStart. Without this:
- You cannot audit BR-9 in production — you can't confirm the scrub gate is actually dropping leak candidates vs. silently passing everything.
- You cannot debug "why did a bad instinct get injected" or "why is nothing being injected" at 3am.
- You cannot distinguish "analyzer ran, found nothing" from "analyzer never ran / crashed".

**Requirement (must-have, see Observability section below).** This is non-negotiable for a feature whose dominant risk (per Bird §6) is a confidentiality leak — you must be able to *prove* the guard fired.

### R3 — Analyzer failure must not corrupt the judge's already-saved findings · **MEDIUM (well-mitigated in spec, must hold in code)**
§7 correctly mandates the analyzer call go *after* `saveSessionEval` in `runWorker()`, in its own `try/catch + log`, "never throw out of the worker." This is the right call. The judge findings are committed in their own `INSERT OR REPLACE` (`sessions-db.ts:48-62`) **before** the analyzer runs, and they live in a different table (`session_evals`). The analyzer reads `findings_json` but never writes it. **Error isolation is structurally sound** *provided*:
- The analyzer's try/catch is **inside** `runWorker`, wrapping only the `runInstinctAnalyzer` call — not so broad it swallows the judge save.
- The analyzer transaction is atomic (BEGIN/COMMIT via `db.transaction()`), so a mid-run crash rolls back partial instinct writes and leaves `session_evals` untouched. **Verify in code review** that promotion + prune + upsert are one `db.transaction()` and not three loose `db.run()`s.

### R4 — Orphan-occurrence growth between worker runs · **MEDIUM**
§1a buffers sub-threshold occurrences in `instinct_occurrences` with `instinct_id IS NULL`. These are only pruned at **worker time** (§5: "worker-time, not cron"). A project that generates many distinct never-repeating signals (one-off warns) accumulates orphan rows until *its next session ends*. Bounded by the 30d orphan TTL, but:
- The prune only runs **for the project whose session just ended**. A project that **never ends another session** keeps its orphans forever (§5 acknowledges this for instincts; same applies to orphan occurrences). Harmless to injection (never selected) but unbounded on disk for abandoned projects.
- **Guard:** make the TTL prune **global, not project-scoped** — when any worker runs the prune pass, prune expired orphans and expired instincts across *all* projects, not just `:project`. One extra `DELETE` with no project filter. Cheap, and it bounds abandoned-project residue.

### R5 — `occurrence_count` denormalized cache can drift · **MEDIUM**
§1 keeps `occurrence_count` as a denormalized cache of `COUNT(DISTINCT session_id)`. If a write partially fails (R1 SQLITE_BUSY mid-transaction) or a future code path updates the table without recomputing, the cache drifts and injection ranking (which uses it) lies. **Guard:** recompute inside the same transaction every time (spec says this — enforce in review), and add a cheap **self-heal/consistency check**: the inject query or a periodic worker pass can `COUNT(DISTINCT session_id)` and reconcile. Lower priority since injection ranking by a slightly-stale count is not safety-critical.

### R6 — Schema drift on existing installs · **MEDIUM (well-handled, one gap)**
MJ correctly identifies the `db.ts` `schema_version >= 1` short-circuit (`db.ts:26-27`) and routes the new tables through a **self-ensuring `ensure()`** in `instincts-db.ts`, mirroring `sessions-db.ts:10-31`. This is correct and is the proven pattern. Gaps:
- The `ensure()` `CREATE TABLE IF NOT EXISTS` is additive-only, so existing installs get the tables on first analyzer call — good. **But** if a *future* version needs to add a column, the `IF NOT EXISTS` no-ops and the new column never appears (same latent trap `session_evals` has). Document that **column additions require an explicit, guarded `ALTER TABLE` migration** path, even if not needed now.
- The `_ensured` module-level flag (`sessions-db.ts:10`) is per-process. Fine, but means the worker and inject hook each run `ensure()` once. The inject hook calling `ensure()` (which does CREATE TABLE) means **the read-only inject path can attempt a write (DDL) on a fresh install** → that DDL needs the busy_timeout too (ties back to R1). On an existing install with tables present, `CREATE TABLE IF NOT EXISTS` is a no-op and takes no write lock — acceptable.

### R7 — SessionStart fail-open correctness · **MEDIUM**
§4 says "on any error (DB locked, missing) → print empty/no additionalContext and exit 0." This is the **correct** fail-open posture and matches the existing judge hook's defensive style. Must verify in code:
- The **entire** hook body is wrapped so that a corrupt DB, a missing file, a malformed row, or a thrown `ensure()` DDL **all** result in `exit 0` with no stdout (or valid-but-empty `additionalContext`). A thrown exception that prints a stack trace to **stdout** would inject garbage into the session context — fail-open must mean **emit nothing parseable as context**, not "emit an error."
- If `DREAMTEAM_LEARN` is unset/0, the hook must `exit 0` *before* opening the DB (symmetry with `session-eval-hook.ts:82`).
- **Latency:** target <50ms is realistic for one indexed read on a tiny table, but the **`bun` process cold-start** (interpreter spin-up) dominates, not the query. Every SessionStart now pays a `bun` spawn it didn't before. Measure end-to-end (`time bun instinct-inject-hook.ts`) on the real machine, not just the query. If cold-start is >150ms, consider whether SessionStart is the right event vs. lazy injection.

### R8 — Two serial Opus calls per qualifying session · **LOW**
§2 adds a second Opus call (analyzer) after the judge, serially, in the detached worker. Off the exit path (good), gated by `DREAMTEAM_LEARN=1` (default off). Cost/latency of the worker doubles when enabled. Acceptable given it's opt-in and detached. **Watch:** the analyzer reads "last N=50 sessions or 90d" of findings (§2) — confirm that window query is indexed on `session_evals(project, judged_at)`; an unindexed scan grows with history.

### R9 — Rollback / disable · **LOW (good)**
Disable path is clean: `DREAMTEAM_LEARN=0` (or unset) stops both the analyzer and injection (§2, §4). `DREAMTEAM_AUTO_EVAL=0` kills the whole hook chain. The tables persist but are inert. **Caveat:** disabling does **not** remove the `SessionStart` hook from `settings.json` (mergeHooks is add-only, never strips — `claude-code.ts:156-157`). That's fine (env gate makes it inert) but document it: "to fully remove, delete the SessionStart block manually." A stale inject hook with `DREAMTEAM_LEARN` unset is a near-zero-cost `bun` spawn that exits immediately — acceptable.

---

## Integration assessment

| From | To | Status | Note |
|---|---|---|---|
| SessionEnd hook entry | detached worker | correct | unchanged path (`session-eval-hook.ts:95-98`), `unref`'d; analyzer rides the existing worker |
| judge `saveSessionEval` | analyzer `runInstinctAnalyzer` | **risk** | must be sequenced after-save + own try/catch (R3); verify in code |
| analyzer txn | inject hook read | **risk** | concurrent write/read needs busy_timeout (R1) |
| `hooks.json` SessionStart | `settings.json` | correct | `mergeHooks` add-if-missing keyed by exact JSON (`claude-code.ts:187-198`) installs cleanly on existing users |
| new `instinct-inject-hook.ts` | symlink install | correct | adapter symlinks every `scripts/*.ts` except install.ts (`claude-code.ts:124-133`) — auto-installs, auto-stays-in-sync |
| `instincts-db.ts` ensure() | shared DB | correct (R6 caveat) | self-ensuring, bypasses `schema_version` short-circuit per `session_evals` precedent |

**Contract compliance:** analyzer consumes `session_evals.findings_json` (the designated input) — correct boundary, doesn't re-parse transcripts, doesn't pollute the judge model. **Data-flow integrity:** the `instinct_occurrences` table is the source of truth; `occurrence_count` is a derived cache (R5). One-way dependency `session-learning → session-eval` (never reverse) keeps the judge's prompt-version hash stable.

---

## Observability requirement (MUST-HAVE — blocks READY)

The loop must not be a black box. Minimum viable observability, mirroring the existing `dreamteam-auto-eval.log`:

1. **A dedicated log** — `~/.claude/dreamteam-learn.log` (separate from auto-eval so the analyzer's noise doesn't bury judge events). Every run emits structured lines:
   - `analyzer start project=<p> findings_in_window=<n>`
   - `signal grouped=<k> below_threshold=<m> materialized=<j>` (BR-1 visibility)
   - `scrub DROPPED candidate reason=<rule> field=<which>` — **one line per drop** (this is the audit trail proving BR-9 fires; the single most important log in the system)
   - `instinct created id=<id> conf=<c> domain=<d>` / `promoted id=<id>` / `pruned id=<id> reason=ttl`
   - `analyzer done created=<a> dropped=<b> promoted=<c> pruned=<d> ms=<t>`
   - inject hook: `inject project=<p> eligible=<n> injected=<k> ms=<t>`
2. **A web view** — extend the existing Sessions/web DB UI with an **Instincts** tab: list active instincts (trigger, confidence, scope, occurrence_count, TTL countdown, evidence), and a counter of scrub-drops. The instincts are *already in SQLite* (the locked design decision §2) specifically so they're queryable — use that. Without a view, the head coach cannot **review** instincts, which BR-8/OQ-3 ("human review resets TTL") structurally requires. **The review action has no UI today — the promotion/TTL model assumes a reviewer exists.**
3. **Counters for the 3am engineer:** drops-this-run, instincts-injected-last-session, total-active-instincts. These answer "is the safety guard working" and "is the loop alive."

Note: the calibration scenario (§6) tests the analyzer prompt offline; the **scrub gate is tested deterministically** (AC-2). Neither gives **production runtime visibility** — that's what the log + view provide.

---

## Bounds / guards — are BR-1 + 30d TTL + cap-6 sufficient?

**Mostly yes, with R4's fix.** Growth is bounded on four axes:
- **Instinct rows:** BR-1 (≥3 distinct sessions) + 30d TTL prune → only repeated, recent patterns persist. Strong bound.
- **Injection:** cap-6 + conf≥0.7 → SessionStart context stays tiny and fast. Strong bound.
- **Orphan occurrences:** 30d TTL — **but only pruned per-active-project (R4)**. Make the prune global to fully close this.
- **Promotion (global rows):** bounded by distinct identity_keys reaching ≥2 projects @≥0.8; own 30d TTL (OQ-2). Bounded, but a global row with no auto-demote (OQ-2) can outlive its usefulness — acceptable per design, visible via the web view.

**One unbounded edge not addressed:** a single very chatty project that ends sessions constantly could accumulate many *distinct* identity_keys at the orphan stage faster than the 30d TTL clears them. Realistic ceiling is small (judge findings are coarse, domains are a bounded vocabulary per §1), so this is **low** — but the web view's total-active counter is the early-warning signal. No hard cap on total instinct rows exists; consider a soft alarm in the log if active instincts exceed, say, 500.

---

## Failure-recovery assessment

| Scenario | Handling | Recommendation |
|---|---|---|
| DB locked (concurrent worker) | **unhandled** | busy_timeout + catch SQLITE_BUSY → skip run (R1) |
| DB missing/corrupt at SessionStart | partial (spec says fail-open) | verify entire hook wrapped → exit 0, no stdout (R7) |
| Analyzer crashes mid-run | handled (atomic txn + try/catch) | verify single `db.transaction()` wraps all writes (R3) |
| Judge saved, analyzer fails | handled by ordering | analyzer after save, isolated catch (R3) — findings safe |
| Interrupted transaction (worker killed) | handled (SQLite rollback) | WAL + atomic txn → no partial state; re-run idempotent |
| Schema drift (new column later) | **unhandled** | document explicit ALTER migration path (R6) |
| Re-scored session double-count | handled | `UNIQUE(instinct_id, project, session_id)` (architecture §1) |
| Poisoned transcript | handled (triple defense) | JUDGE_DEFENSE + deterministic scrub + locality (Kobe's domain) |

---

## Ops-readiness checklist

**Blocking (must fix before merge):**
- [ ] **R1** — `PRAGMA busy_timeout = 5000` in `db.ts:getDb()`; catch SQLITE_BUSY in analyzer txn → skip+log, never crash.
- [ ] **R2** — `~/.claude/dreamteam-learn.log` with the structured lines above, **including one line per scrub-drop**.
- [ ] **Observability** — Instincts web view (list + TTL + scrub-drop counter) — the review action OQ-3 depends on has no UI otherwise.

**Required (verify in code review):**
- [ ] **R3** — analyzer call is after `saveSessionEval`, in its own try/catch inside `runWorker`; all instinct writes in one `db.transaction()`.
- [ ] **R4** — TTL/orphan prune is **global**, not `:project`-scoped.
- [ ] **R7** — inject hook: full-body try/catch → exit 0, no stdout on any error; env gate checked before DB open; end-to-end latency measured on real machine (incl. `bun` cold-start).
- [ ] **R6** — `instincts-db.ts` uses self-ensuring `ensure()` (not db.ts schema_version path); document the future ALTER-migration trap.

**Recommended (not blocking):**
- [ ] **R5** — recompute `occurrence_count` in-txn; add a reconcile check.
- [ ] **R8** — index `session_evals(project, judged_at)` for the analyzer window query.
- [ ] **R9** — document "disable = env var; full removal = delete SessionStart block manually."
- [ ] Soft-alarm log line if total active instincts exceeds a threshold (~500).

**Rollback:** `DREAMTEAM_LEARN=0`/unset disables analyzer + injection cleanly; `DREAMTEAM_AUTO_EVAL=0` disables everything. Tables persist inert. No destructive migration to reverse (additive-only schema). **Rollback is safe.**
