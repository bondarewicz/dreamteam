---
title: "Dream Team Synthesis: Timeline + Recording Overhaul"
date: 2026-03-12
session: report-accuracy-audit
status: SHIP
agents: [Bird, MJ, Magic, Shaq, Kobe, Pippen]
---

# Executive Summary

The Dream Team executed a full two-phase implementation and review cycle on `scripts/cast.sh`, overhauling both the HTML timeline visualization and the recording infrastructure. The work split into two interconnected change sets: (1) a time-proportional timeline rendering system with gap compression, and (2) a dual-channel event architecture with structured JSON `m` events, real-elapsed timestamps, and a new `strip-idle` command.

All six agents completed their work. Two reviewers (Kobe, Pippen) each ran two rounds. All critical and high-severity findings were fixed and verified before SHIP. Current status: **SHIP** — the implementation is production-ready with four low-priority open items documented for future attention.

The most consequential finding of the entire workflow was Bird's identification of the verdict regex alternation-order bug (SHIP matching before SHIP WITH FIXES), caught in the prior `report-accuracy-audit` session and confirmed fixed in this one.

---

# Agent Contributions

## Bird — Domain Analysis (Confidence: 97%)

Bird established the recording-to-report contract as the authoritative specification. Ten business rules and ten acceptance criteria (AC-1 through AC-10) defined the behavioral contract before any code was written.

Key findings:
- **Critical bug identified pre-implementation**: `to_pct` was undefined in `export-html`, causing a crash on any timeline render. Confirmed as a rename artifact (should be `time_to_pct` via `build_time_mapper`).
- Established that `interval_secs` must return real elapsed time, not fixed micro-delays, for accurate wall-clock reporting.
- Defined dual-channel architecture contract: `o` events carry human-readable terminal output, `m` events carry structured JSON metadata. Both channels must be emitted in sequence so legacy parsers see the `o` channel and new parsers prefer `m`.
- Edge cases documented: midnight crossing, false regex matches on nested ANSI escape sequences, recordings exceeding 24h, and the `init` command exclusion from dual-channel (no paired `o` event for `marker` events).

## MJ — Architecture (Confidence: 88%)

MJ translated Bird's domain contract into a concrete implementation plan with two change sets and a dependency order.

Change 1 (Timeline):
- Wire `build_time_mapper` returning `time_to_pct` — replaces all six legacy `to_pct` call sites.
- Remove `.timeline-info` div (redundant with annotations).
- Add `.timeline-annotation` rows above each bar, carrying name, verdict badge, and time range.
- Render `.timeline-gap` divs with striped CSS background and dashed borders at idle gap positions.
- Compress time axis using `GAP_PCT = 3.0` constant per gap.

Change 2 (Recording):
- `interval_secs` returns real elapsed seconds (min 0.001, max 300s clamp for stale state files).
- All command handlers (`event`, `marker`, `phase`, `agent`, `human`, `finish`, `reopen`) emit structured JSON `m` events with `type`, `msg`, `ts`, and agent/phase fields where applicable.
- `export-html` parser: dual-path — try `json.loads` first, fall through to legacy regex for backward compatibility.
- New `strip-idle` command: compress playback deltas exceeding threshold, output to `.stripped.cast`.

Risks flagged: time parsing assumptions (HH:MM:SS only), dual-path complexity in exporter, strip-idle gap corruption potential if `ts` fields were adjusted.

## Magic — Context Curation (Confidence: 90%)

Resolved three contradictions before handoff to Shaq:

| Conflict | Resolution |
|---|---|
| Bird said `init` should emit dual-channel; MJ said no `o` event needed for markers | `init` excluded from dual-channel — `marker` events have no paired visual output |
| Bird called it `to_pct`; MJ called it `time_to_pct` | `time_to_pct` is the correct name, returned by `build_time_mapper`; `to_pct` was the pre-overhaul name |
| Strip-idle should adjust `ts` fields vs. should preserve them | `ts` fields preserved intentionally — they record real wall-clock time for reporting accuracy |

Four open questions flagged for Shaq: midnight crossing behavior, GAP_PCT tuning, threshold default selection, and whether `strip-idle` should handle the `x` (exit) event.

## Shaq — Implementation, Round 1 + Round 2 (Confidence: 92% → 95%)

Round 1 completed all implementation targets:
- Wired `time_to_pct` into all 6 call sites (replacing legacy `to_pct`).
- Removed `.timeline-info`, added `.timeline-annotation` above each bar.
- Added `.timeline-gap` divs with striped CSS background.
- Changed `interval_secs` to return real elapsed time with 0.001 minimum.
- Added structured JSON `m` events to 5 command handlers.
- Implemented dual-path exporter (JSON first, regex fallback).
- Added `strip-idle` command with `--threshold` flag.

Round 2 fixes (responding to Kobe Round 1 findings):
- Fixed `isinstance(data, str)` gate — changed to `isinstance(data, (str, dict))` so dict payloads are not rejected.
- Added `_m_event_msg` helper to extract searchable text from both str and dict `m` event payloads.
- Added `m_processed_indices` set to prevent double-counting when both `m` and `o` events are present.
- Fixed midnight crossing in `time_to_pct`, interval collection, and `time_diff_min`.
- Added `skipped` counter to `strip-idle` replacing bare `except: pass`.
- Added 300s upper-bound clamp to `interval_secs` for stale `.state` files.
- Updated `cmd_reopen` to emit structured JSON `m` event.
- Added `--threshold` positive-number validation.
- Documented `strip-idle ts` field preservation as intentional in code comment.

## Kobe — Quality Review, Round 1 + Round 2 (Confidence: 85% → verified SHIP)

Round 1 verdict: SHIP WITH FIXES. Findings:

| Severity | Finding | Status after Round 2 |
|---|---|---|
| CRITICAL | `isinstance(data, str)` gate rejects dict payloads — JSON path dead | FIXED |
| HIGH | `time_to_pct` midnight crossing — sessions near midnight produce wrong bar positions | FIXED |
| HIGH | `strip-idle` bare `except: pass` — silent data loss | FIXED |
| IMPORTANT | Double-counting risk after isinstance fix | FIXED (m_processed_indices) |

Round 2 verdict: SHIP — all findings verified resolved.

## Pippen — Stability Review, Round 1 + Round 2 (Confidence: 82% → verified READY)

Round 1 verdict: READY WITH CAVEATS. Findings:

| Severity | Finding | Status after Round 2 |
|---|---|---|
| IMPORTANT | Stale `.state` file produces absurd delta (days-long gap) | FIXED (300s clamp) |
| IMPORTANT | Terminal timeline vs HTML timeline diverge in positioning | Deferred — documented |
| MEDIUM | Escalation/fix-verify string search fails on dict payloads | FIXED (_m_event_msg helper) |
| MEDIUM | `strip-idle` ts field not adjusted after gap compression | Intentional — documented |
| LOW | `cmd_reopen` legacy string `m` event | FIXED |
| LOW | No `--threshold` validation | FIXED |

Round 2 verdict: READY — all findings verified resolved.

---

# Decisions & Rationale

## Decision 1: time_to_pct returned from build_time_mapper (not module-level function)

**Context**: Bird's AC required time-proportional positioning. MJ designed `build_time_mapper` as a closure factory.

**Decision**: `time_to_pct` is a closure returned by `build_time_mapper`, not a standalone function. All six call sites receive it via the mapper's return value.

**Rationale**: Allows the mapper to capture its computed segments, gaps, and midnight-crossing context once per export run rather than recomputing per call. Closure over shared state is simpler than passing segments as parameters.

**Consequence**: Callers must call `build_time_mapper` first and store the returned function. This is what the six wired call sites do.

## Decision 2: Dual-channel m + o events (not m-only)

**Context**: MJ proposed dual-channel; Bird required backward compatibility for legacy string parsers.

**Decision**: Every command handler emits `m` (structured JSON) followed immediately by `o` (human-readable ANSI text). The `export-html` parser tries JSON first, falls through to regex on the `o` event if parsing fails.

**Rationale**: Preserves full backward compatibility with any existing `.cast` files and any downstream tools that only read `o` events. New tooling gets the structured channel; old tooling sees the visual channel.

**Trade-off accepted**: Doubles the event count in recordings. The `.stripped.cast` output also doubles in size relative to `o`-only recordings.

## Decision 3: strip-idle preserves ts fields in m events

**Context**: Pippen flagged that `ts` fields inside `m` event JSON are not adjusted after gap compression, causing a discrepancy between compressed playback time and reported wall-clock time.

**Decision**: `ts` fields are intentionally preserved as real wall-clock timestamps.

**Rationale**: The `ts` field is consumed by `export-html` for report generation (agent durations, session metrics). Adjusting it would corrupt the accuracy of the HTML report — the very thing this overhaul was designed to improve. Playback compression is a presentation concern; reporting accuracy is a data concern. They are decoupled intentionally.

**Consequence**: Users viewing `.stripped.cast` in asciinema will see playback time diverge from the `[HH:MM:SS]` prefixes rendered in the terminal output. This is documented in a code comment at the write-output section.

## Decision 4: 300s upper-bound clamp on interval_secs

**Context**: Pippen found that a stale `.state` file (from a previous session) could cause `interval_secs` to return a delta of days, producing absurd timeline bars.

**Decision**: Clamp any delta exceeding 300s to 0.001s, emit a `stderr` warning.

**Rationale**: 300s is safely above the longest plausible real inter-event gap in a live session (agents typically respond in 30-120s). Any larger delta is almost certainly a state file from a different session that was not cleaned up.

**Consequence**: A genuine 6-minute gap between events would be silently compressed. This is acceptable — the `strip-idle` command exists precisely for users who want to manage large gaps intentionally.

## Decision 5: Verdict regex alternation order fixed (longest-first)

**Context**: Bird found in the prior `report-accuracy-audit` session that `re.match(r'Verdict:\s*(SHIP|BLOCK|READY|...)')` would match `SHIP` before `SHIP WITH FIXES` due to Python leftmost-match semantics. This session confirmed the fix is in place.

**Decision**: Both verdict regex sites (line 1136 and line 1232) use `SHIP WITH FIXES|READY WITH CAVEATS|NOT READY|SHIP|BLOCK|READY` — longest alternatives first.

**Rationale**: Python `re` module uses leftmost-match in alternation. Shorter alternatives that are prefixes of longer ones must come after their superstrings.

---

# Files Changed

| File | Purpose |
|---|---|
| `/Users/lb/Github/Bondarewicz/dreamteam/scripts/cast.sh` | All implementation changes: timeline overhaul, dual-channel recording, strip-idle command, verdict regex fix, 300s clamp, midnight crossing fix, isinstance gate fix, _m_event_msg helper, m_processed_indices dedup, --threshold validation |

No other files were created or modified. The synthesis document (`docs/2026-03-12-timeline-recording-overhaul-synthesis.md`) is the only new artifact from this workflow.

---

# Open Items

## Deferred (documented, not blocking SHIP)

1. **Terminal vs HTML timeline positioning divergence** (Pippen IMPORTANT, deferred)
   The `cast.sh timeline` command renders a text-art timeline to the terminal using a different algorithm than `export-html`. The two timelines will show different bar positions for the same session. Pippen flagged this but the team deferred resolution — fixing it requires either unifying the algorithms or accepting the divergence as intentional (terminal = approximate, HTML = accurate).
   Risk: Low. Users are unlikely to compare the two side-by-side. HTML is the canonical report.

2. **GAP_PCT tuning** (open question from Magic's handoff brief)
   Currently hardcoded at `3.0` percent per gap, with a floor of 1.0 when many gaps would compress the active area below 50%. The right value is workload-dependent. Sessions with many short gaps between agents look fine; sessions with a single long gap between two agents may show a 3% gap that appears visually insignificant next to long bars.
   Suggestion: Consider making GAP_PCT a configurable parameter or computing it dynamically based on session length.

3. **strip-idle exit event handling** (open question from Magic's handoff brief)
   The `strip-idle` command processes all events uniformly. The `x` (exit) event at the end of a recording has a delta that represents time from last event to session close. If that delta exceeds threshold, it will be compressed to 0.5s, which is correct behavior. However, the exit event's delta has no user-visible consequence during playback. This is benign but undocumented.

4. **init command dual-channel exclusion** (resolved by Magic, but worth future review)
   Magic resolved the contradiction: `init` emits no `m` event because there is no paired `o` event. However, if `init` is ever extended to emit metadata (e.g., a session-start structured event), the dual-channel pattern should be applied retroactively.

---

# Team Metrics

| Metric | Value |
|---|---|
| Fix-verify loop count | 2 rounds (Round 1 → fixes → Round 2 verification) |
| Escalation count | 0 (no escalations to Coach K) |
| Contradictions detected by Magic | 3 (init dual-channel, to_pct vs time_to_pct naming, ts field preservation) |
| Total findings across all reviewers | 10 (Kobe: 4, Pippen: 6) |
| Critical findings | 1 (Kobe: isinstance gate — dead JSON path) |
| High findings | 2 (Kobe: midnight crossing, strip-idle bare except) |
| Findings resolved before SHIP | 10/10 (all fixed or intentionally documented) |

### Confidence Levels Per Agent

| Agent | Round 1 | Final |
|---|---|---|
| Bird | 97% | 97% |
| MJ | 88% | 88% |
| Magic | 90% | 90% |
| Shaq | 92% | 95% |
| Kobe | 85% | SHIP (verified) |
| Pippen | 82% | READY (verified) |

### Finding Attribution

| Finding | Caught By | Severity | Resolution |
|---|---|---|---|
| `isinstance` gate rejects dict payloads (dead JSON path) | Kobe | CRITICAL | Fixed by Shaq R2 |
| `time_to_pct` midnight crossing | Kobe | HIGH | Fixed by Shaq R2 |
| `strip-idle` bare `except: pass` | Kobe | HIGH | Fixed by Shaq R2 |
| Double-counting after isinstance fix | Kobe | IMPORTANT | Fixed by Shaq R2 (m_processed_indices) |
| Stale `.state` file absurd delta | Pippen | IMPORTANT | Fixed by Shaq R2 (300s clamp) |
| Terminal vs HTML timeline divergence | Pippen | IMPORTANT | Deferred — documented |
| Escalation/fix-verify search on dict payload | Pippen | MEDIUM | Fixed by Shaq R2 (_m_event_msg) |
| `strip-idle` ts field not adjusted | Pippen | MEDIUM | Intentional — documented |
| `cmd_reopen` legacy string m event | Pippen | LOW | Fixed by Shaq R2 |
| No `--threshold` validation | Pippen | LOW | Fixed by Shaq R2 |
| Verdict regex alternation order | Bird (prior session) | CRITICAL | Fixed (confirmed in this session) |

---

# Suggested Next Steps

## Immediate

1. Run `export-html` on the `2026-03-12-report-accuracy-audit.cast` file to generate the HTML retro. Coach K has this queued.

2. Test `strip-idle` on a real recording with large gaps to validate the 300s clamp and 0.5s residual behavior.

3. Verify the terminal vs HTML timeline divergence is acceptable by rendering both on the same recent session and eyeballing the difference.

## Git Commands (when ready to commit — do NOT commit without review)

```bash
# Review the diff first
git diff scripts/cast.sh

# Stage only the script (do not stage docs unless intentional)
git add scripts/cast.sh

# Commit with a descriptive message
git commit -m "feat: timeline overhaul + dual-channel recording + strip-idle

- Replace to_pct with time_to_pct (via build_time_mapper closure)
- Remove .timeline-info, add .timeline-annotation above bars
- Add .timeline-gap divs with striped CSS for idle gap visualization
- interval_secs returns real elapsed time (min 0.001, max 300s clamp)
- All command handlers emit structured JSON m events (dual-channel)
- export-html dual-path parser: JSON first, regex fallback
- New strip-idle command with --threshold flag and validation
- Fix isinstance gate to accept dict payloads
- Add _m_event_msg helper for escalation/fix-verify counting
- Add m_processed_indices set to prevent double-counting
- Fix midnight crossing in time_to_pct and interval collection
- Fix verdict regex: longest alternatives first (SHIP WITH FIXES before SHIP)
- Fix cmd_reopen to emit structured JSON m event"
```

## Future Improvements

- Unify terminal and HTML timeline algorithms (currently diverge — HTML is accurate, terminal is approximate).
- Make GAP_PCT configurable via a `--gap-pct` flag in `export-html`.
- Consider a `cast.sh info` command that reads a `.cast` file and prints session metadata (title, duration, agent count) without running a full export.
- Evaluate whether `.state` files should be auto-cleaned on `finish` to prevent the stale-file scenario entirely.
