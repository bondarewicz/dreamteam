# Checkpoint: Timeline + Recording Overhaul
Date: 2026-03-12

## Bird's Domain Analysis (97% confidence)

### Business Rules
1. Recording-to-report contract integrity -- every structured marker in .cast must map to exactly one rendered element in HTML report
2. Timeline bars must be positioned proportional to real wall-clock timestamps, not event indices
3. Idle gaps must be compressed to thin visual markers, not hidden entirely -- viewer must know time passed
4. Recordings must capture actual terminal output, not synthetic fabricated events
5. Structured markers (m events) must coexist with real terminal output (o events) in dual-channel architecture
6. The time_to_pct function from build_time_mapper must be wired into timeline rendering -- currently undefined causing crash
7. Backward compatibility -- new exporter must still parse old .cast files that lack structured JSON markers
8. Annotations (agent names, verdicts) must appear above timeline bars, not in a separate column
9. strip-idle must preserve event ordering and marker integrity while removing idle gaps
10. Cost calculations must use real token counts from markers, not estimates

### Acceptance Criteria
- AC-1: Timeline bars positioned proportional to wall-clock time via time_to_pct
- AC-2: Idle gaps render as thin compressed markers with duration label
- AC-3: No crash on undefined to_pct -- must be wired to time_to_pct
- AC-4: Annotations above bars, no side column
- AC-5: .timeline-info column removed entirely
- AC-6: interval_secs() returns real elapsed time
- AC-7: m-type markers with structured JSON for event/phase/agent/human/finish commands
- AC-8: strip-idle preserves all markers in order
- AC-9: Old .cast files fall back to regex parsing
- AC-10: asciinema playback shows terminal output, m events invisible

### Critical Bug
- to_pct is undefined -- export-html crashes on timeline rendering

### Edge Cases
- Midnight crossing (23:59 -> 00:00)
- False regex matches in real terminal output
- Very long recordings (>1hr)

## MJ's Architecture Design (88% confidence)

### Timeline (Change 1)
- Wire build_time_mapper -> time_to_pct into rendering
- Remove .timeline-info, add .timeline-annotation above bars
- Render idle gap markers from build_time_mapper gaps list
- Add compressed time axis ticks

### Recording (Change 2)
- interval_secs() computes real elapsed time
- Dual-channel: m events = structured JSON, o events = terminal output
- Marker schema: {"type": "...", "agent": "...", "msg": "...", "ts": "..."}
- Dual-path exporter: JSON first, regex fallback
- strip-idle command with --threshold flag

## Magic's Handoff Brief
- 3 contradictions resolved (init excluded from dual-channel, to_pct is rename not new function, strip-idle outputs to .stripped.cast)
- 4 open questions (time axis alignment, double interval_secs call, midnight guard in both functions, dual-path complexity)
- Implementation order: prerequisite fix -> Change 1 -> Change 2

## Coach K Task Breakdown
See Phase 2 checkpoint presentation.
