# Review: schema-enforcement (Thread B — collaboration fidelity)
Author: Kobe (Quality & Risk Enforcer)
Date: 2026-05-29
Verdict: SHIP WITH FIXES (safe_to_deploy: false until fixes verified)

## Scope reviewed
Shaq's hardening of the Full Team workflow in `commands/team.md` — TeamCreate enforcement,
`team_name` on every concurrent spawn, roster-verification gate, silent-degradation warning,
TeamDelete cleanup. Quick Fix / PR Review confirmed untouched (AC-B6 ✅). AC-B2 (all concurrent
spawns carry name+team_name+run_in_background) and AC-B4 (warning box) confirmed ✅.

## Critical Findings (all High — must fix before SHIP)

1. **Roster gate is brittle (false-pass AND false-fail)** — `team.md` ~740-751. Reads a
   *hardcoded* `~/.claude/teams/<name>/config.json` and uses a *10-second* join heuristic. If the
   path is wrong → every session false-fails; if members register async → race; if config is
   created eagerly-empty → false-fail or hang.
   **Fix:** replace the filesystem check with **first-message receipt** — wait for each agent's
   first message to Coach K (Team Protocol requires one); receipt *is* proof of bus join; error if
   none within ~30s.

2. **shutdown → TeamDelete ordering** — `team.md` ~1395-1408. "Wait briefly" is undefined; Coach K
   (no wall clock) will call TeamDelete before teammates terminate → TeamDelete fails on active
   members → **zombie team** left behind.
   **Fix:** wait for each background agent's completion notification before TeamDelete; retry once
   after ~10s on active-members error.

3. **"team already exists" can inherit a zombie team** — `team.md` ~659-661. Reusing an existing
   name can adopt phantom members from a crashed session (**exactly the stale `dream-team` we hit
   this session**).
   **Fix:** cleanup-before-create — TeamDelete the existing name first; if it succeeds retry the
   original name; if it fails (a live session owns it) append a suffix; fresh timestamp on 3rd try;
   surface error after 3 attempts.

## Important (should-fix)
- Quick Fix path correctly omits the bus but the doc doesn't say *why* — add a one-line note so a
  future editor doesn't "helpfully" add `team_name` to sequential subagents.
- Mid-flight redirect protocol shuts down then respawns without waiting for termination — two
  same-named agents could briefly coexist on the bus.

## Suggestions
- Use a UUID / full epoch for the team name, not a 6-digit timestamp tail (collides within ~11.5 days).
- Make the roster gate advisory; the *hard* gate should be first-message receipt.

## Verification Status
✅ RESOLVED — Shaq applied all 5 fixes; Kobe re-verified each against the current file with
line-level evidence. **Verdict: SHIP, safe_to_deploy: true** (confidence 92). Fix-verify closed in
one iteration.

- Finding 1 (roster gate) → first-message-receipt is now the hard gate; config.json demoted to
  optional advisory. VERIFIED ~748-755.
- Finding 2 (shutdown→TeamDelete) → waits for completion notifications + retries once on
  active-members. VERIFIED ~1399-1414.
- Finding 3 (zombie team reuse) → 5-step cleanup-before-create. VERIFIED ~661-668.
- Important 4/5 + collision-resistant epoch name → VERIFIED.

Open (non-blocking) suggestion from Kobe: guard the live collaboration test behind `LIVE_BUS_TEST=1`
so it cannot accidentally run (and bill) in CI.

## Collaboration eval (Part 2) — corrected after a real eval run

- `runTeamScenario` confirmed to run **sequential `claude -p` phases with no bus** → the standard
  eval harness **cannot** test live message exchange.
- A real run of the first-cut `scenario-03` (`evals/results/2026-05-29-1631.json`) scored **FAIL**.
  Two root causes: (1) the harness ran Bird & MJ in isolation (no bus), and (2) the scenario
  referenced a **non-existent grader `cross_phase_match`** → unscoreable → hollow fail. Kobe's light
  sanity-check quoted that grader but didn't verify it exists in `graders.ts` (verification miss).
- **Decision (human):** a team *scenario* for collaboration makes no sense when the harness can't do
  the bus, and `collaboration.test.ts` already covers it. So **`scenario-03` was DELETED.** The
  `live_bus` CLI harness type (~200-300 LOC) was **declined**.
- Collaboration coverage = **`evals/src/__tests__/collaboration.test.ts`** only: 7 unit tests
  (always run) + 1 live test now **guarded behind `LIVE_BUS_TEST=1`** so it can't bill in CI. The
  live test passed earlier (108s, Bird→MJ term cross-check over a real bus). Verified:
  `bun test` → 7 pass, 1 skip, 0 fail without the env var.

