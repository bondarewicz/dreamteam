# next.md — Session Learning Loop: continuation pointer

**Last updated:** 2026-06-26 (FEATURE BUILD COMPLETE — Slices 1–9 all signed off). Everything below is LOCAL, nothing committed or pushed. Standing rule: **no public/outward actions without explicit permission.**

---

## ✅ REAL-DATA DRY-RUN CONVERGED (2026-06-26) — 3 blocking issues fixed, pending final security sign-off

Orchestrator ran the real cutover dry-run 3× against the user's actual corpus (backup-first each time; restored after run #1 which exposed the destructive bug). Final dry-run #3:
- **instincts imported=16, dropped=0, worklist=0** (was 1→5→16/16); facts: project=7, reference=1; verify PASSED.
- **NON-DESTRUCTIVE confirmed**: real memory dir byte-for-byte unchanged (mode/sha/count identical before+after), staging sandbox cleaned up, "NO writes to real DB or real memory dir." Ran with NO `--project` (auto-slug resolved correctly).
- Full suite **640 pass / 0 fail**.

Fixes applied (all reviewed):
- **B1 (destructive dry-run) FIXED** — no-execute now sandboxes everything (staging DB via VACUUM INTO, staging dirs, non-locking, preview/diff); only `--execute` touches real. Pippen SIGN OFF. + 2 minors (explicit-`--source` abort, VACUUM-seed cleanup, GUARD-1..4).
- **B0 (slug overload) FIXED** — `canonicalProjectId(cwd)=path.resolve(cwd).replace(/[^A-Za-z0-9]/g,'-')` + `harnessMemoryDir`, auto-default across all commands; one scope for memory-dir + DB. Pippen SIGN OFF, verified == real harness dir.
- **B2 (scrub over-drop) FIXED (2 rounds)** — Bird ruled mis-calibration. Round 1 narrowed code-literal/path detectors. Round 2: migration-scrub = HARD-identifier-only (`MIGRATION_RULES`: secrets/emails/URLs/username-paths/homoglyph/imperative), `scrub(c,{mode:'migration'|'analyzer'})`, candidate scope = name+description only (frontmatter EXCLUDED — fixed the originSessionId→secret-token FP), product/roster allowlist, UUID-not-secret, org/repo Title-case-only. Analyzer mode stays strict (migration-only relaxation; full strict re-scrub deferred to Turso/promotion boundary BR-S3). AC-MIG (16/16 KEEP) + LEAK-1..6 (genuine leaks DROP) co-gates added.

**✅ Kobe security pass: SIGN OFF.** Traced `suggested_content` across the codebase — ZERO references in `memory-projection.ts`; projection emits only trigger/shape/domain/confidence/ingestion_path/occurrence_count, so the un-scrubbed migrated body never reaches the shareable surface in v1. HARD floor empirically intact; UUID-strip can't neuter a real secret; org/repo Title-case correct; analyzer mode unchanged. **No leak path opened. Feature is GENUINELY SHIP-READY (pending user review + go-live).**

### v1.1 forward-guards (Kobe, non-blocking — for the Turso/promotion phase)
- **BR-S3 promotion re-scrub:** `suggested_content` holds the un-scrubbed migrated body — never projected in v1, but the cross-tenant promotion path (v1.1) MUST re-scrub (analyzer mode) or drop `suggested_content` before it crosses tenants. Flagged at import-file-memory.ts:502.
- **Optional defensive hardening:** `selectForProjection` uses `SELECT *` so `suggested_content` rides along in returned rows (never serialized today). Omitting it from the projection column list / mapping would make a future accidental leak (new admin view / export) structurally impossible. Belt-and-suspenders; no current leak.

---
### (historical) original dry-run finding — 3 blocking issues (now fixed above)

All 9 slices implemented, reviewed, 557 tests green — BUT a real-data cutover dry-run (run by the orchestrator against the user's actual ~/.claude corpus, then restored from backup) exposed defects the fake-HOME + synthetic-fixture tests missed:

- **B1 (CRITICAL — destructive dry-run):** `dreamteam cutover` WITHOUT `--execute` mutated the real env — Step 3 overwrote the real MEMORY.md + locked the dir 0500; Step 2 archived into the real source + (by default) migrates into the real workspace DB. RUNBOOK's "writes nothing to ~/.claude" is FALSE. Only step 5 was `execute`-gated; steps 2–3 must be too. → MJ designing fix (no-execute = fully non-destructive: temp DB + staging projection dir + no lock + preview/diff).
- **B2 (CRITICAL — scrub over-drops real feedback 14/15):** migrating the real corpus, the shareable-tier scrub DROPPED 14 of 15 feedback memories to the worklist (`code-literal: snake_case`/`backtick snippet`/`SQL ref`/`PascalCase`/`function-call`; `filesystem-path: home-relative`/`org-repo`). Real dev guidance inherently contains code-shaped tokens; the adversarial-corpus-tuned scrub treats them all as leaks → migration auto-imports ~1/15, useless. → Bird ruling on calibration (narrow code-literal/path detectors for generic-but-not-identifying tokens; real corpus = new KEEP-invariant fixture; v1-local vs Turso-share tiering).
- **B0 (slug overload):** `--project` defaults to `basename(cwd)`=`dreamteam` but the harness dir is the path-encoded `-Users-lb-Github-Bondarewicz-dreamteam`; overloaded as both memory-dir slug AND DB scope key → default targets nonexistent dir, explicit slug mis-scopes DB vs learn/doctor. → MJ designing canonical auto-derived slug.

**Test gap that hid all three:** tests inject `project`/`home`/`db` explicitly and use synthetic fixtures — so they never exercised the real cwd→slug derivation, the no-execute write surface against a real dir, or the scrub against real dev-feedback. Fix must add: real-derivation test, no-execute-writes-nothing test, real-corpus KEEP-invariant test.

**Process lesson:** "557 tests green + signed off" ≠ ship-ready. A real-data dry-run (orchestrator-run, backup-first, restore-after) is mandatory before declaring done. The user's directive: orchestrator runs dry-runs, finds+fixes issues, reports — never asks the user to run them.

**Known v1 gaps (separate, for review after blockers):** (a) analyzer LLM prompt quality UNTESTED (eval pass recommended); (b) in-conversation directive capture not persisted (R3); (c) embedding/memory_links deferred; (d) chmod-blocks-jotter / read-only-dir-loads confirmed only by live session check.

---

## TL;DR — where we are

- **Spec is DONE and build-ready.** Full SDD in `docs/spec-session-learning-loop/` (`spec.md` = build contract, plus `domain.md`, `architecture.md`, `review.md`, `scope.md`, `operations.md`, `intake.md`, `slice3/4/6-design.md`, `cutover-design.md`, `RUNBOOK.md`, `SUMMARY.md`).
- **Slice 1 (scrub gate) is DONE and SIGNED OFF (2026-06-26).** The Rule 4 wordlist blocker was resolved by adopting **path (C)** (Bird-blessed): wordlist + DR-5 deleted, Rule 4 drops only on positive name-signal. Kobe's independent anti-overfit held-out corpus (`instinct-scrub.heldout.test.ts`, 28 words, 0 false drops). Spec/domain ACs re-baselined by Magic (BR-9.4a′/4b′/over-drop′, DEF-1, AC-2a′/2c′/pos-1/2/3/dual′/resid).
- **Slice 2 (db-driver seam) is DONE and SIGNED OFF (2026-06-26).** `web/src/db-driver.ts` — async wrapper over `bun:sqlite` mirroring `@libsql/client` (`execute`/`batch`/`transaction(fn)`, ResultSet shape, `lastInsertRowid`→bigint). Pippen reviewed → 8 fixes by Shaq (criticals: RETURNING/writing-CTE row loss; `foreign_keys=ON` for §2 CASCADE) → re-verified SIGN OFF. H-4 (WAL+busy_timeout), `DbDriverError`+`DRIVER_ERROR_CODES` (swap-safe constraint branching), seam-rigidity grep guard, Turso-phase landmine commented (delete the RETURNING metadata follow-up at swap, don't port).
- **Slice 3 (two-tier schema + stores) is DONE and SIGNED OFF (2026-06-26).** `web/src/fact-store.ts` (tier-1 scoped_facts, fail-closed tenancy, never scrubbed/pruned) + `web/src/instincts-db.ts` (tier-2 instincts/signals_buffer/instinct_occurrences). Design in `slice3-design.md` (MJ). Bird ruled agent-scoping (BR-AG1–6, BR-EMB1, BR-LNK1 + ACs, folded by Magic). **Forward-compat decision: KEEP dormant nullable `agent_id` (out of v1 key); DEFER `embedding` + `memory_links` (Drexler — `ALTER TABLE ADD COLUMN` is O(1) in SQLite, so no migration-cost reason to carry dead schema; re-intro triggers: Turso/vector phase, Slice 8 wikilinks).** Named `CREATE UNIQUE INDEX` + `COALESCE(col,'')` NULL-trap defused; H-1 identity_key (sha256, `\x1f` delim); BR-1 materialization in one tx; LOCKED projection SQL w/ AC-8 parens. Kobe reviewed → 6 fixes (AC-8 + BR-6 dispositive tests, mutation-checked) → SIGN OFF. **Full suite 333 pass / 0 fail.** All still LOCAL, uncommitted.
- **Slice 4 (ingestion paths) is DONE and SIGNED OFF (2026-06-26).** `web/src/session-analyzer.ts` (auto-inferred: FindingsReader ACL over `session_evals`, empty short-circuit before LLM per H-7, LlmClient port, scrub, recordSignal) + `web/src/directive-capture.ts` (human-directive: authorship guard, scrub, upsertDirective) + `web/src/llm-client.ts` (lifted `claude -p` seam, independent `Promise.race` timeout + SIGTERM→SIGKILL→group-kill, stderr drain) + `getRecentFindings` on sessions-db.ts + judge refactor (behavior-identical). Store amended: `severity` on signals_buffer+occurrences, `suggested_content` on instincts; **H-2 confidence recomputed IN-STORE via SQL `ROUND(:raw,2)` (single rounding authority)** per Bird BR-2.1–2.4; authorship guard per BR-13b–e (Magic folded all into spec.md/domain.md). Kobe + Pippen reviewed → Shaq fixed (criticals: in-session wedge timeout, stderr deadlock, SQL-rounding divergence, phantom session-id guard, warn→fail recompute) → both SIGN OFF. **Full suite 400 pass / 0 fail.** All still LOCAL, uncommitted.
- **Slice 5 (projection writer) is DONE and SIGNED OFF (2026-06-26).** `web/src/memory-projection.ts` — DB→MEMORY.md + topic files, pure function of DB state, writes to an INJECTED outDir (never the live ~/.claude dir — that's the installer slice). Consumes `selectForProjection`/`listForProjection` (no re-implemented SQL). **AC-8 release gate** = post-write self-check re-queries the DB (instinct: status+tenant; fact: tenant+user+project_id via new `getFactById`) and HARD-throws on mismatch — symmetric both tiers. Byte-identical determinism (no now()/random in output), truncation hard-error (top-6 eligible instinct never silently dropped), H-6 laundering closed (index AND topic files only for eligible rows), >500 soft-log via new `countEligible`, ProjectionCtx project/project_id consistency guard at Step 0. Kobe reviewed → 4 hardening fixes → SIGN OFF. **Full suite 433 pass / 0 fail.** All still LOCAL, uncommitted.
- **Slice 6 (`learn` + `instincts` CLI) is DONE and SIGNED OFF (2026-06-26).** `bin/dreamteam.ts` — exported DI `runLearn(opts, deps)` (Humble Object) + thin `cmdLearn`/`cmdInstincts` shells; `scripts/paths.ts` `memoryProjectionDir(project)` + DEFAULT_TENANT/USER. **Non-destructive:** default outDir = `workspaceDir()/memory/<project>` (sibling of ~/.claude); symlink-hardened `~/.claude` guardrail (realpath both sides) refuses writing there absent an installer flag. Always-regenerate (AC-6), raw-line authorship passthrough, free-text directives / select-only auto-inferred, headless captures-to-pending (no forged consent), `--dry-run` = `:memory:` + temp + no-op LLM. Kobe + Pippen reviewed → Shaq fixed (CRITICAL: `--yes`/select must approve ONLY `auto_inferred`, never pending human-directives — BR-13a trust anchor; + symlink hole, raw passthrough, defensive regenerate) → both SIGN OFF. **Full suite 452 pass / 0 fail.** All still LOCAL, uncommitted.
- **Slice 7 (team.md step + learn skill) DONE + SIGNED OFF (2026-06-26).** `commands/team.md` SESSION LEARNING step (invokes `dreamteam learn`, free-text directives, AskUserQuestion-for-directives FORBIDDEN, dual-safe non-destructive pre-cutover) + `commands/learn.md` skill; MEMORY HARVEST marked DEPRECATED (removed at cutover). Pippen signed off. v1 gap (R3): agent-collected in-conversation directives are surfaced-for-awareness only, NOT persisted by the CLI (run `dreamteam learn` interactively to persist a directive); full transcript pass-through deferred.
- **Slice 8 (file-memory migration) DONE + SIGNED OFF (2026-06-26).** `scripts/import-file-memory.ts` (dual-frontmatter parser incl. CRLF-normalized, REQUIRED --source, tier routing, scrub-on-feedback→worklist, archive-copy, dry-run, idempotent, parseFailed counter) + `instincts-db` `ingestion_path='migrated'`/`importMigrated` (0.7/approved/NULL) + **BR-8′ TTL fix** (staleness prunes `auto_inferred` ONLY; migrated/human_directive TTL-exempt like scoped_facts; 3 sites: prune/selectForProjection/countEligible). Bird ruled BR-MIG-1..11 + BR-8′ (folded by Magic). Kobe + Pippen → Shaq fixed criticals (CRLF silent-loss; TTL-expiry-of-curated-memory) → both SIGN OFF. **Full suite 518 pass / 0 fail.** All still LOCAL, uncommitted.
- **Injection mechanism CORRECTED (claude-code-guide + MJ):** the original "disable built-in auto-memory" plan was INVALID — `autoMemoryEnabled:false` disables BOTH read+write (kills loading). **Option A adopted:** keep `autoMemoryEnabled:true`, leave `autoMemoryDirectory` unset (default per-project dir already loads), neutralize the auto-jotter via filesystem read-only lock (dir 0500/files 0400); `regenerate()` wraps in `writeGuarded` (unlock→write→AC-8→re-lock in finally). Supersedes architecture.md's "disable auto-memory" wording; cutover-design.md §4.4 still has the stale disable-based plan — superseded by Option A (clean up at synthesis).
- **Slice 9 (installer/cutover) DONE + SIGNED OFF (2026-06-26).** `scripts/cutover.ts` (atomic backup→migrate→initial-projection→VERIFY→activate→rollback; `--execute` gated; `--home` injectable) + `writeGuarded` on memory-projection (unlock→regenerate+AC-8→re-lock in finally; warns+rethrows on lock-failure-after-success) + inverted `dreamteam doctor` checkMemoryHealth (FAIL if autoMemoryEnabled:false/missing/empty/dir-mismatch; WARN if writable/over-budget) + `cutover` subcommand. **Option A injection** (keep autoMemoryEnabled TRUE; lock dir 0500/files 0400 as sole writer). Pippen (atomicity/rollback/lock) + Kobe (writeGuarded/AC-8/doctor/settings) reviewed → Shaq fixed (VERIFY lock-assertion 0o222, writeGuarded warn+rethrow, malformed-settings abort, no-prior-dir rollback removal, 5c partial flag) → both SIGN OFF. **Full suite 557 pass / 0 fail.** All vs fake HOME — real ~/.claude untouched.
- **Next action: NONE for the build — present to user for review.** Real go-live = user runs `dreamteam cutover` (dry) → review → `--execute` → `doctor` → live-session check (RUNBOOK.md). Optional pre-ship: eval the analyzer prompt (gap a).

### Slice 4 tracked follow-ups (non-blocking, both reviewers agreed)
- **Group-leader spawn:** `process.kill(-pid,9)` in llm-client.ts is a best-effort no-op because Bun.spawn doesn't make the child a group leader — claude's grandchildren can orphan on the rare timeout path (resource leak only; does NOT affect the wedge guarantee or direct-child SIGKILL). Spawn as group leader to make group-kill effective.
- **Injectable spawn for test coverage:** `runClaudeCli`'s real timeout path isn't exercised (T-TC1 tests the Promise.race PATTERN inline because `claude` isn't installed in CI). Refactor to accept an injectable spawn/command so a stub (`sleep`) drives the real function — closes the coverage gap on the critical wedge fix.
- **Surface stderr in-session:** stderr is now drained + returned in `RunResult.stderr` but both consumers discard it, so an in-session LLM failure reason (auth/rate-limit) isn't shown/logged. Wire it when logging lands (deferred to Turso).
- **OQ-7** (exact confidence formula) is now resolved by BR-2.1 — mark RESOLVED in spec.md on a cleanup pass.
- **Analyzer prompt quality is untested:** the `makeClaudeLlmClient` generalize prompt + `surface()` synthetic-row shape are bypassed by the fake LLM in tests. Real `claude -p` prompt quality surfaces at Slice 5 wiring → candidate for an eval pass (per eval discipline).

### Tracked forward items (not v1 blockers)
- **slice3-design.md:73 doc-drift:** shows `COALESCE(agent_id,'')` but the authoritative v1.1 sentinel is `COALESCE(agent_id,'*')` (BR-AG3, spec.md; the code comment is correct). Fix the design doc before the v1.1 index swap copies the wrong sentinel.
- **getById/setStatus/getFactById scopeless (instincts-db.ts + fact-store.ts):** safe in single-tenant v1, documented in-code; at the Turso phase all three MUST take a `TenantCtx` and bind `tenant_id` (BR-S4 fail-closed) — ids are AUTOINCREMENT/enumerable. Update all three together; add the mismatched-tenant regression test when enforcement activates. (`getFactById` powers the projection's AC-8 fact re-query, which already checks tenant+user+project_id against ctx — so the AC-8 path is hardened; the gap is only direct by-id callers.)
- **Migrated `feedback` instincts (Slice 8):** have no session evidence and no in-session keystroke, so they fit neither the H-2 formula nor the BR-13a authorship path. Bird's recommendation: store them `confidence=0.7` (curated, injection-eligible, not ground-truth 0.9), `ingestion_path='human_directive'`, `status='approved'`. Confirm/redirect at Slice 8.

---

## The design (locked decisions — do not re-litigate)

It's the **Unified Learning & Memory Store** — replaces the file-based memory system (which *is* Claude Code's built-in auto-memory) with a DB-backed store.

- **NO hooks.** Capture/approval is an **in-session agent step** (mirrors `team.md` MEMORY HARVEST). Injection rides built-in auto-memory: a **projection writer** regenerates `MEMORY.md` from the DB; the harness auto-loads it (first 200 lines/25KB). This closed Kobe's C-4 (the detached SessionEnd worker can't host an interactive approval).
- **REPLACE built-in auto-memory** for the project (disable it; the projection owns the dir) — atomically (migrate + initial projection BEFORE disabling).
- **Two tiers:** scoped facts (`user`/`project`/`reference` — never scrubbed, tenant-isolated, no TTL) vs shareable instincts (`feedback` + auto-derived — scrubbed, 30d TTL, BR-13 human-approval before injection).
- **Two ingestion paths:** auto-inferred (≥3 sessions, `pending`→reviewed) and human-directive (n=1, confidence 0.9, **human types/edits the text** — byte-identical-to-suggestion rejected; the keystroke is the trust anchor).
- **Turso deferred.** v1 = single-user local `bun:sqlite`; schema carries tenant columns + fail-closed predicates so Turso is a driver/config swap. Cross-tenant tests (AC-S1/S2) are a Turso-phase gate, not v1.
- **v1 release gates:** AC-2 (scrub corpus), AC-M1 (migration tier-correctness), AC-8 (projection-selection).
- Bird's Rule-4 ruling: discriminate by **referent, not capitalization** (BR-9.4a/4b/over-drop). "Over-drop is correct" applies only to genuinely identity-ambiguous tokens, NOT ordinary capitalized English.

---

## Slice 1 — scrub gate: current state

**Files (all NEW/local, uncommitted):**
- `web/src/instinct-scrub.ts` — 8 detectors, DROP-not-redact, whole-candidate drop, C-2 hardening (decode-and-rescan, NFKC+confusable-fold, cross-field concat), two-phase scanning, Rule 4 (DR-1..DR-6), CLI guard, exported `RULES` + `scrub()`.
- `web/src/__tests__/instinct-scrub.test.ts` — AC-2 adversarial corpus + AC-2a/2b/2c + held-out corpora + LCG deterministic fuzz. 134 tests, currently green.
- `web/src/data/english-words.txt` — bundled wordlist (currently Webster's web2 filtered 3-9 chars, 104k words, 873KB). **This is the problem (see below).**
- `.github/workflows/test.yml`, `release.yml` — `bun-version` pinned to `1.3.11` (hermetic gate; prevents ICU/NFKC drift).

**VERIFIED-GOOD by Kobe (do NOT regress these):**
- Dual gate holds same-run: client name in ANY form (plain/lowercase/base64/hex/homoglyph/zero-width/split/evidence-only) → 100% whole-candidate DROP.
- Deterministic (LCG-seeded fuzz, exact counts, no `Math.random`/`crypto.getRandomValues`).
- Rule 8 (`$500`/proprietary-business-rule) **deleted**; its AC-2 Case 7 now asserts KEPT (BR-13 is the backstop for semantic domain rules).
- `matchesFolded()` dead code removed.
- Split-name drop intact (Acme|Corp etc. drop via spaced join).
- **DR-2 per-field fixed** (shape-initial Title-case word keeps its clause-initial exemption even when concatenated).
- Company-name residual is the **accepted BR-13 case**: common-word names (Apple/Oracle/Shell) KEEP bare, DROP under naming-context (`Apple's cluster`, `client named X`). Consistent with Bird's ruling — not wider than intended.

---

## THE BLOCKER — RESOLVED 2026-06-26 (path C adopted)

**Resolution:** Adopted **path (C)**. Bird blessed it as *more* faithful to "referent not orthography" than the wordlist approach, and flagged a hard contradiction (the old verified-good "plain name → 100% DROP" invariant vs (C)). The orchestrator accepted Bird's re-baseline; Magic recorded it in spec.md/domain.md; Kobe authored an independent held-out anti-overfit corpus (`instinct-scrub.heldout.test.ts`) + fixture reclassification; Shaq deleted the wordlist + DR-5, added a narrow acronym-as-name branch (corroborated all-caps DROP, bare all-caps KEEP, allowlisted KEEP), flipped the 3 DR-5-only Globex fixtures DROP→PASS, and added AC-pos-3 fixtures; Kobe re-verified by matchedRule strings (not green alone) and **SIGNED OFF (SHIP, confidence 88)**. Over-drop trap confirmed gone (`ETL`/`RPC`/bare `ACME` → KEEP; `DATABASE_URL` → domain-identifier). The `english-words.txt` bundle (873KB) and all wordlist machinery (`ENGLISH_WORDS_LONG`, `_loadPrimaryWordlist`, `_PRIMARY_WORDS`, `_SUPPLEMENT_WORDS`, `isCommonEnglish`, the `node:fs` import) are removed. The original decision writeup is preserved below for history.

---

## THE BLOCKER (original writeup — historical, now resolved)

**Rule 4's wordlist over-drops legitimate long words.** The detector drops a Title-case token if it's not in the bundled dictionary. The dictionary is **Webster's web2 filtered to 3-9 chars** + a **~200-word hand supplement** for 10-15 chars. Kobe's held-out corpus of ordinary 10+ char English false-drops **11/22 (50%)** — `Verification`, `Confirmation`, `Justification`, `Decomposition`, `Acknowledgement`, etc. (core instinct vocabulary). It's teaching-to-the-test: kept words = what Shaq supplemented; dropped = its blind spots.

**Root cause (structural):** the only wordlist available locally is web2 — no frequency ranking, full = ~2.5MB. So Shaq keeps falling back to "filter web2 + hand-pad." The constraints collide: low over-drop needs all-length coverage; "few hundred KB" rules out full web2; no small frequency list is locally available. Shaq has failed the "use a real all-length frequency list" instruction **3×** for this reason.

Note: **over-drop is NOT recovered by BR-13** (BR-13 catches leaks/false-negatives; an over-dropped instinct is silently never stored). So a 50% over-drop is a real usefulness-killer, not a BR-13-backstopped residual.

### The two fix paths (pick one to start next session)

- **(C) — RECOMMENDED: restructure Rule 4, drop the wordlist entirely.** Drop a Title-case token only on a **positive name-signal** (internal/camelCaps, naming-context `Acme's`/`client named X`, all-caps acronym-as-name), NOT on "not in dictionary." This permanently ends the wordlist loop, removes the bundle-size problem, and matches Bird's "referent not orthography." The residual flips from over-drop (bad, silent loss) to "a bare *uncommon* client name might pass scrub" — which **BR-13 genuinely backstops** (human reviews/authors every candidate before injection). Strictly better failure mode. **Needs a ~2-min Bird blessing** because it shifts the bare-uncommon-name case onto the human gate (changes Rule 4's confidentiality posture).
- **(A) — keep the wordlist:** orchestrator sources a real ~50k all-length frequency list, hands Shaq a zero-latitude instruction to bundle it and delete the filter+supplement. Closes the gap, costs a few hundred KB, leaves a wordlist to maintain.

**Recommended next step:** run **(C)** past **Bird** for the blessing → **Shaq** restructures Rule 4 → **Kobe** re-verifies with a NEW held-out 10+ char corpus (anti-overfit). Keep all verified-good items.

---

## Process notes / lessons (apply next session)

- **Route fixes through the implementer (Shaq).** Do NOT hand-edit agent-produced code — flag concerns as review feedback, the implementer redoes. (See memory `feedback_route_fixes_through_implementer`.) Reviewers (Kobe/Pippen/Drexler) flag; Shaq fixes.
- **Anti-overfit is the recurring trap:** any fixed char cutoff + hand supplement reproduces the over-drop defect. Validate with a reviewer-generated HELD-OUT corpus, never the build input.
- Shaq hit the 100-tool-use ceiling twice → came to rest mid-edit. For big mechanical reworks, give bounded, prescriptive instructions; verify objective state (run tests) rather than trusting a cut-off self-report.
- Package size matters (tarball was trimmed for 1.0.3). Bundle currently 646KB; keep wordlist additions to ~few hundred KB.

---

## Remaining slices (Slice 1 scrub gate ✅ DONE 2026-06-26)

Per `architecture.md` §7, in dependency order — **NEXT = Slice 2 (db-driver seam):**
1. ✅ **DONE** — `web/src/instinct-scrub.ts` scrub gate (path C, signed off).
2. ✅ **DONE** — `web/src/db-driver.ts` async seam over bun:sqlite (Pippen signed off; Turso swap later).
3. ✅ **DONE** — `web/src/fact-store.ts` + `web/src/instincts-db.ts` (Kobe signed off; agent_id dormant, embedding/memory_links deferred).
4. ✅ **DONE** — `web/src/session-analyzer.ts` + `web/src/directive-capture.ts` + `web/src/llm-client.ts` (Kobe + Pippen signed off; 400 tests).
5. ✅ **DONE** — `web/src/memory-projection.ts` projection writer (Kobe signed off; AC-8 gate symmetric both tiers).
6. ✅ **DONE** — `bin/dreamteam.ts` `learn` + `instincts` subcommands (Kobe + Pippen signed off; consent-forge closed).
7. ✅ **DONE** — `commands/team.md` SESSION LEARNING step + `commands/learn.md` skill (Pippen signed off).
8. ✅ **DONE** — `scripts/import-file-memory.ts` migration + BR-8′ TTL fix (Kobe + Pippen signed off).
9. ✅ **DONE** — `scripts/cutover.ts` installer + `writeGuarded` + `dreamteam doctor` (Option A injection; Pippen + Kobe signed off; vs fake HOME, NOT executed on real ~/.claude).

**ALL 9 SLICES DONE. Build complete, 557 tests green, ready for review.**
8. `scripts/import-file-memory.ts` — one-time migration (frontmatter type→tier; DROPped feedback → re-authoring worklist; archive source, don't delete).
9. Installer/`settings.json` — disable built-in auto-memory atomically (after initial projection); `dreamteam doctor` non-empty check.

**Forward-compat schema notes (from the DB design discussion 2026-06-26 — fold into Slice 3 when building the tables):** add `agent_id` (nullable; NULL = team-wide) to `instincts` for per-agent scoping (+ join table if many-to-many); add a nullable `embedding BLOB` column now (free) so RAG via libSQL `vector_top_k` is a later add, not a migration; model `[[wikilink]]` relations as a `memory_links(from_id, to_id)` table, not a graph DB. Retrieval order to grow into: scoped filter (tier + agent) → recency/confidence rank → [later] vector similarity.

HIGH items to honor during build: H-1 (identity_key normalization + collision tests), H-3 (round before float boundary), H-4 (WAL + busy_timeout), H-5 (re-score stability).

---

## Unrelated open thread (NOT this work)

User was investigating the **ParcelVision POC** (separate client repo/branch, not dreamteam): a Temporal `DiscoverActivity` completed in **49ms**, implausibly fast for a real OpenAI call. The "2 minutes" was the Start-To-Close *timeout* (a ceiling), not duration. User asked "didn't we eliminate the redis cache for the POC?" — that context is NOT in the dreamteam sessions. Open question for that project: is the OpenAI call real or mocked/seeded in the local run (input looked like fixtures: `scan-1`, sequential GUIDs)? Verify in the POC code: (1) any remaining cache lookup, (2) is the OpenAI client real or a double. Confidentiality: client identifiers (ParcelVision/tree-named services/etc.) must never go public.
