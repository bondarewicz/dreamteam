# Scope Review — Session Learning Loop (Tier 2)

**Author:** Drexler (Deletion-Bias Enforcer) · **Verdict:** ACCEPTABLE — architecture sound, but defer/simplify two items before implementing.

## Defer to v1.1 (can't fire / not needed in v1)
- **Promotion + global scope (BR-7/7a)** — promotion needs the same instinct across ≥2 distinct projects @ avg ≥0.8. In v1 there are zero instincts → zero promotion. It adds ~50 lines of SQL + schema complexity (nullable project, dual-row UNIQUE, scope CHECK, global injection branch) for **zero v1 benefit**. Ship **project-scope only**; add promotion once there's evidence it's wanted.
- **Golden-label calibration scenario** — there are no golden labels until the loop produces real instincts. The **deterministic scrub test (AC-2) is the v1 release gate**; calibration is a v1.1 fast-follow.

## Simplify before implementing
- **Drop the nullable-FK `instinct_occurrences`.** Use **two clean tables**: `signals_buffer` (identity_key, project, session_id, finding_id, evidence, observed_at; `UNIQUE(identity_key, project, session_id)` — no FK) for sub-threshold occurrences, and `instinct_occurrences` (always-valid FK) for post-materialization evidence. Removes the backfill step + the nullable-FK antipattern; TTL prune becomes a single clean DELETE.

## Hard implementation requirement (avoid silent duplication)
- `session-analyzer.ts` must **import** `runClaude` / `extractJson` from `session-judge.ts` and `JUDGE_DEFENSE` from `prompt-defense.ts` — **not copy-paste**. The scrub module rightly *mirrors the shape* of `check-unicode-safety.ts` (exported RULES + scan fn) but is a different rule domain — that's a justified variant, not duplication.

## Abstractions that earn their keep (keep)
`instinct-scrub.ts` (load-bearing, must be independently testable — BR-9), `instincts-db.ts` (correctly avoids the `db.ts` schema_version short-circuit), `session-analyzer.ts` (distinct bounded context — keeps the judge's prompt-version hash stable), `instinct-inject-hook.ts` (required SessionStart entry point).

## Leanest v1 that still honors Bird's invariants
observe (findings) → analyze (project-scope candidates) → **deterministic scrub gate (non-negotiable, AC-2)** → store project instincts → capped injection → TTL prune → off-by-default. Promotion, calibration, and the nullable-FK buffer are NOT in that path.
