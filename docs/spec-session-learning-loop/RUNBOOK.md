# Go-Live Runbook — Session Learning Loop

**Feature:** Unified Learning & Memory Store (Slices 1–9)
**Status:** all code local/uncommitted; the cutover is the only environment-touching step and the user runs it deliberately.
**Last updated:** 2026-06-26

---

## Pre-requisites

- Slices 1–9 are complete, all 557 tests green, nothing committed or pushed.
- `dreamteam install` has been run recently so the symlinks under `~/.claude/scripts/` point at the current repo source.
- `~/.claude/settings.json` exists and is valid JSON. The cutover aborts on malformed JSON — validate and fix it before proceeding.
- You are running as a non-root user. `chmod 0500` on the memory dir does not block root writes; running the cutover as root defeats the jotter-lock mechanism entirely.

---

## Step-by-step cutover

### Step 1 — Dry-run: verify the plan

```sh
dreamteam cutover --project <slug>
```

Without `--execute`, the command is **genuinely non-destructive** — it writes nothing to `~/.claude`
and nothing to the real workspace DB. Specifically it:

1. **Backs up** `~/.claude/projects/<slug>/memory/` and `~/.claude/settings.json` to `~/.dreamteam/backups/cutover-<ts>/` (read of real / write to workspace — always safe).
2. **Creates a throwaway staging sandbox** under `os.tmpdir()`. A staging DB is seeded from the real DB via `VACUUM INTO` (WAL-safe), a staging memory dir is created for projection output, and a staging archive dir receives the archive copies.
3. **Runs migrate + project + verify fully** against the staging sandbox:
   - Migration reads your real `~/.claude/projects/<slug>/memory/*.md` (read-only) and writes migrated rows into the staging DB and copies into the staging archive — not the real ones.
   - Projection writes `MEMORY.md` into the staging memory dir — not the real one.
   - VERIFY runs against the staging output; `dirLocked` is reported as `"n/a (staging)"` (the staging dir is never locked).
4. **Writes a preview diff** (`~/.dreamteam/backups/cutover-<ts>/cutover-dryrun-preview.md`): shows the current real `MEMORY.md` vs the would-be `MEMORY.md`, migration tier counts, and the worklist/mismatch log.
5. **Deletes the staging sandbox** and exits 0.

After a dry-run: the real `~/.claude` is byte-for-byte identical to before. The preview file and backup dir are the only new artifacts, both under `~/.dreamteam/`.

Review the printed output:
- **Migration report**: counts of facts, instincts, dropped (scrub-failed), skipped (unknown/missing type), and mismatched filename/type pairs.
- **Re-authoring worklist** (`~/.dreamteam/reports/migration-worklist.md`): every `feedback` file that failed the scrub gate is listed here with the matched rule and a masked excerpt. These memories are not lost — they are not auto-importable because they contain identifying content. You must re-state them as directives via `dreamteam learn` after cutover.
- **VERIFY result**: all checks must pass before you proceed to step 3.

### Step 2 — Inspect what would migrate

Open the re-authoring worklist and triage each dropped entry. For each:
- Understand why it was dropped (matched rule is shown).
- Decide whether to re-state it as a cleaned directive later (via `dreamteam learn` interactive) or discard it.

If any VERIFY check failed, do not proceed to step 3. Common causes:
- `SelfCheckError` or `TruncationError` during projection: DB state is inconsistent with what the projection expected. Run `dreamteam doctor` to diagnose.
- `dirLocked: false`: writeGuarded's finally-lock failed — an unexpected filesystem condition. Investigate before continuing.
- `bothSectionHeadersPresent: false`: the projection produced a malformed MEMORY.md. Check the DB has at least one fact or approved instinct (an empty DB produces an empty file).

### Step 3 — Execute: atomic go-live

```sh
dreamteam cutover --project <slug> --execute
```

This is the only destructive step. It runs the full sequence:

**STEP 1 — BACKUP:** copies `memory/` dir + `settings.json` to `~/.dreamteam/backups/cutover-<ts>/`; records `cutover-manifest.json` including prior settings values for exact rollback.

**STEP 2 — MIGRATE:** runs `import-file-memory` against the live `~/.claude/projects/<slug>/memory/` dir. Frontmatter `type` is authoritative. `user`/`project`/`reference` files go to `scoped_facts`; `feedback` files pass the scrub gate or are appended to the worklist.

**STEP 3 — PROJECTION:** `writeGuarded` regenerates `MEMORY.md` + topic files into the live memory dir. Sequence inside writeGuarded: unlock dir (0700/0600 on files) → `regenerate()` → AC-8 post-write self-check → re-lock (dir 0500 / files 0400) in finally. The MEMORY.md written here is the replacement that will be loaded at the next session start.

**STEP 4 — VERIFY:** asserts:
- MEMORY.md exists and is non-empty.
- Both section headers present (`## Your memory` and `## Learned heuristics`).
- Projection is deterministic (regenerate twice = byte-identical output).
- Memory dir is locked (dir not owner/group/other writable after writeGuarded).
- `autoMemoryDirectory` in settings is absent or consistent with the memory dir path.

If VERIFY fails, rollback runs automatically (see Rollback section). Without `--execute`, the cutover would have already stopped here — so this step only runs in `--execute` mode.

**STEP 5 — ACTIVATE** (runs only with `--execute` and after step 4 passes):
- (a) Writes `autoMemoryEnabled: true` to `settings.json`, overwriting any stale `false`. Leaves `autoMemoryDirectory` unset (the default per-project dir is correct).
- (b) Re-locks the memory dir (dir 0500 / files 0400) after the settings write.
- (c) Copies the updated `team.md` (SESSION LEARNING step active, MEMORY HARVEST removed) from repo source into `~/.claude/commands/team.md`.
- (d) Writes the `cutover-complete: true` marker in `cutover-manifest.json`.

**ROLLBACK** is automatic on any failure in steps 2–5: unlocks the dir, restores `settings.json` and the memory dir from backup, restores `team.md` if step 5c had run, and exits non-zero with the failing step and restore actions logged. The DB is left in place (migration is idempotent; a re-run upserts safely).

### Step 4 — Confirm with doctor

```sh
dreamteam doctor
```

A healthy post-cutover state shows:
- `autoMemoryEnabled: true`
- `MEMORY.md: non-empty`
- `dir locked: true`
- `autoMemoryDirectory: [unset or consistent]`
- `DB: reachable`
- `cutover: complete`

Any failure means the cutover did not fully succeed. Check `~/.dreamteam/backups/cutover-<ts>/cutover-manifest.json` for the rollback log. The doctor is read-only and safe to run at any time.

### Step 5 — Live session check (mandatory)

Start ONE fresh Claude Code session for this project — not a continuation of the current one — and:

1. Run `/memory` (or ask "what do you remember about this project?").
2. Confirm MEMORY.md content is loaded: you should see the two sections ("Your memory" / "Learned heuristics") reflected in the response.
3. Ask Claude to recall a specific fact you know was in the migrated file memory (a project name, a preference, a known feedback rule).

**This is the only way to confirm the read-only lock loads cleanly.** The mechanism relies on Claude Code's built-in project-memory loader reading the chmod-locked `MEMORY.md`. The lock prevents jotter writes (EACCES) while leaving the loader's reads intact — but this is a harness runtime behavior that tests against a fake HOME cannot exercise. The live session check is the definitive confirmation.

If memory is NOT loaded in the live session, go to Manual Rollback below.

---

## Rollback

### Automatic (during cutover)

The cutover script rolls back automatically on any failure in steps 2–5:
1. Unlocks the memory dir (so the restore write can proceed).
2. Restores `~/.claude/settings.json` from the backup.
3. Restores `~/.claude/projects/<slug>/memory/` from the backup.
4. Restores `~/.claude/commands/team.md` from backup if step 5c had run.
5. Exits non-zero with the failing step and restore actions listed.

The DB remains in place and can be safely re-imported on a subsequent cutover attempt (all writes are idempotent).

### Manual (if step 5 live check fails after a successful automatic cutover)

```sh
# 1. Unlock the memory dir so you can write to it
chmod 0700 ~/.claude/projects/<slug>/memory/
chmod u+w ~/.claude/projects/<slug>/memory/*.md 2>/dev/null || true

# 2. Restore settings.json from the step-1 backup
cp ~/.dreamteam/backups/cutover-<ts>/settings.json.bak ~/.claude/settings.json

# 3. Restore the memory dir contents
cp -r ~/.dreamteam/backups/cutover-<ts>/memory/. ~/.claude/projects/<slug>/memory/

# 4. Verify the original MEMORY.md is back
cat ~/.claude/projects/<slug>/memory/MEMORY.md

# 5. Start a fresh session and confirm original file-memory loads
# 6. Confirm restored state
dreamteam doctor
```

After manual rollback, the DB state from the migration is still present. A future cutover attempt will upsert safely without duplication.

---

## Doc-only caveats (not enforced in code)

**Do not run as root.** `chmod 0500` on the memory dir does not prevent root from writing to it. Running the cutover, or any subsequent `dreamteam learn` call, as root defeats the jotter-lock and allows two-writer collision between the auto-jotter and the projection writer.

**Malformed settings.json aborts the cutover.** The script reads and parses `~/.claude/settings.json` at step 1. A malformed file causes an abort before any backup is written. Fix it with a JSON validator before running the cutover.

**The deprecated MEMORY HARVEST in team.md is neutralized by the read-only lock post-cutover.** Even if an old-team.md session accidentally reaches the HARVEST write path, any attempt to create a new `.md` file in the locked memory dir will fail with EACCES. The projection remains the sole writer. That said, step 5c copies the updated `team.md` (HARVEST removed) during cutover. If step 5c was skipped (source `team.md` not found in repo), run `dreamteam repair` to propagate it.

---

## Known v1 gaps

**(a) Analyzer LLM prompt — VALIDATED against real `claude -p` (2026-06-29).**
Tested end-to-end on 26 real warn/fail findings (20 sessions) with real `claude -p`, 3 trials. The generalize prompt produces good, well-shaped, correctly-domained candidates (e.g. "over-claims authorship of pre-existing code", "duplicates work the user already had", "loop fails to converge"). Two real defects were found and fixed during this validation:
- **Timeout too short (FIXED):** real latency is ~56s, but the LLM call used a 30s budget, so the analyzer silently returned `[]` every run. Raised to `ANALYZER_LLM_TIMEOUT_MS = 120_000` and the timeout is now surfaced (`console.warn` + `AnalyzerResult.llmTimedOut`) instead of swallowed.
- **Scrub over-drop (FIXED, Bird→Shaq→Kobe):** the DROP gate scrubbed the never-projected `evidence` field and dropped 100% of valid candidates. The gate is now scoped to the projected fields (`trigger` + `behavioral_shape`, cross-field preserved — BR-SG-3/5), and `evidence` is masked via `maskEvidence()` before local storage (BR-SG-4). Drop rate fell from 100% → ~20%, and the residual drops are *correct* (a projected field literally contained a path token). Kobe security SIGN OFF: the no-identifier-on-shareable-surface invariant is structurally guaranteed (`evidence_scrubbed` lives only on `signals_buffer`/`instinct_occurrences`, never on the `instincts` table or in projection).

Residual (optional, non-blocking): a prompt tweak instructing the LLM to generalize away literal paths/identifiers in `trigger`/`behavioral_shape` would lift the ~20% projected-field drops further. The auto-inferred path is now functional and safe for daily injection.

**(b) Agent-driven in-conversation directive capture is not persisted in v1 (R3).**
The team.md SESSION LEARNING step surfaces directive candidates in-conversation, but the CLI cannot receive them from the agent's context without a live TTY. To persist a directive you stated in-session, run `dreamteam learn` interactively in a terminal after the session ends — the readline prompt will let you type/edit and confirm the directive text (BR-13a authorship guard applies).

**(c) Embedding and memory_links are deferred.**
The `embedding BLOB` column exists in the schema but is unwritten in v1. `[[wikilink]]` text in migrated memories is preserved verbatim but not resolved. These are v1.1/Turso-phase additions requiring no migration — `ALTER TABLE ADD COLUMN` is O(1) in SQLite for the embedding; the `memory_links` table is a new addition.

**(d) The chmod-blocks-jotter and read-only-dir-loads assumptions are confirmed only by the step 5 live check.**
The jotter-lock (dir 0500 / files 0400 blocks writes) and the loader-reads-locked-dir (Claude Code project-memory reads MEMORY.md despite 0500 dir) are both empirical claims that tests against a fake HOME cannot falsify. The step 5 live session check is the only runtime confirmation available.
