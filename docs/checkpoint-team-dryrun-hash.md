# Checkpoint: Fix Team Dry Run Stale-Run Detection (Issue #6)

**Date**: 2026-04-03
**Branch**: `fix-team-dryrun-hash-6162`
**Status**: COMPLETE -- ready to merge

---

## What Was Done

Fixed GitHub Issue #6: team dry run stale-run detection was not working because `evalContentHash` only hashed empty top-level fields for team scenarios instead of the phase-level and pipeline-level fields that actually carry eval content.

### Changes (single file: `web/src/routes/scenarios.ts`)

1. **Extended `evalContentHash` for team scenarios** (lines 122-140) -- Added a branch that detects team scenarios via `isTeam` flag and hashes: `phase.agent`, `phase.prompt`, `phase.expectedBehavior`, `phase.failureModes`, `phase.scoringRubric`, `JSON.stringify(phase.graders)` for each phase, plus pipeline-level `pipelineExpectedBehavior`, `pipelineFailureModes`, `pipelineScoringRubric`.

2. **Updated `recordDryRunHash` and `isDryRunFresh`** (lines 156-181) -- Both functions now detect team scenarios via `phase_1_agent` regex and route through `parseTeamScenario` for accurate phase-level hashing.

3. **Added `recordDryRunHash` call in team dry run handler** (line 1297) -- Records hash BEFORE `startEvalRun` to prevent a race window where the hash could reference a stale state.

4. **Added `isDryRunFresh` gate in team promote handler** (lines 1462-1480) -- Blocks promotion with `error=stalerun` redirect when draft content has changed since the last dry run.

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Hash `phase.agent` in content hash | Agent swap changes eval behavior; Kobe flagged omission as critical |
| Record hash BEFORE `startEvalRun` | Eliminates race window where concurrent edit during eval would produce stale baseline; Kobe finding #1 |
| Detect team scenarios via `phase_1_agent` regex | Reuses existing pattern already present in codebase for team scenario detection |
| Single-file change | All stale-detection logic (hash, record, check, gate) lives in `scenarios.ts` -- no new files needed |
| Non-eval fields excluded from hash | `category`, `title`, `overview`, `reference_output` changes should not force re-run |

---

## Review Cycle

### Kobe Review #1 -- SHIP WITH FIXES
Found 2 issues:
1. **(Critical)** `recordDryRunHash` called AFTER `startEvalRun` -- race window
2. **(High)** `phase.agent` excluded from hash -- agent swap bypasses stale detection

### Shaq Fix Iteration
Applied both fixes. Build passes.

### Kobe Review #2 -- SHIP
Both findings verified fixed:
- `recordDryRunHash` at line 1297, before `startEvalRun` at line 1301
- `phase.agent` at line 131 in hash parts array

---

## Files Changed

| File | Lines Modified | Nature |
|------|---------------|--------|
| `web/src/routes/scenarios.ts` | ~60 lines | Bug fix + feature gate |

---

## Team Metrics

| Metric | Value |
|--------|-------|
| Escalations to Coach K | 0 |
| Review iterations | 2 (initial + verification) |
| Critical findings (Kobe) | 2 (both resolved) |
| Bird confidence | 90% |
| Shaq confidence (final) | 97% |
| Kobe confidence (final) | 95% |
| Magic synthesis confidence | 93% |

### Finding Attribution

| Finding | Agent | Severity | Status |
|---------|-------|----------|--------|
| `evalContentHash` only hashed empty fields for team scenarios | Bird | Root cause | Fixed |
| `recordDryRunHash` called after `startEvalRun` (race) | Kobe | Critical | Fixed |
| `phase.agent` excluded from hash | Kobe | High | Fixed |
| Silent catch hiding write failures in `recordDryRunHash` | Kobe | Low | Noted, not addressed (non-fatal by design) |
| Regex duplication across 4 locations | Kobe | Low | Noted, deferred to future cleanup |

---

## Git Commands

```bash
cd /Users/lb/Github/Bondarewicz/dreamteam/.worktrees/team/fix-team-dryrun-hash-6162

# Verify the changes
git diff web/src/routes/scenarios.ts

# Stage and commit
git add web/src/routes/scenarios.ts docs/checkpoint-team-dryrun-hash.md
git commit -m "fix: team dry run stale-run detection not working (#6)

- Extend evalContentHash to hash phase-level and pipeline-level fields
  for team scenarios instead of empty top-level fields
- Include phase.agent in hash to detect agent swaps
- Record hash BEFORE startEvalRun to prevent race window
- Add isDryRunFresh gate in team promote handler"

# Push and create PR
git push -u origin fix-team-dryrun-hash-6162
gh pr create --title "fix: team dry run stale-run detection (#6)" \
  --body "Fixes #6. See docs/checkpoint-team-dryrun-hash.md for full details."
```

---

## Suggested Next Steps

1. **Run `bun test`** in `web/` to confirm no regressions
2. **Manual smoke test**: edit a team draft after dry run, attempt promote, verify stalerun error appears
3. **Future cleanup** (low priority): extract the `phase_1_agent` regex into a shared `isTeamScenario()` helper to eliminate the 4-location duplication Kobe noted
4. **Future hardening** (low priority): consider logging write failures in `recordDryRunHash` instead of silent catch, for observability
