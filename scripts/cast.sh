#!/usr/bin/env bash
# cast.sh — Asciicast v3 recording helper for Dream Team sessions
#
# Usage:
#   cast.sh init  <file> <title>       Create cast file with header
#   cast.sh event <file> <text>        Append output event (terminal text)
#   cast.sh marker <file> <label>      Append marker event (navigation point)
#   cast.sh phase <file> <label>       Shorthand: marker + styled phase banner
#   cast.sh agent <file> <name> <msg>  Agent output with name prefix
#   cast.sh human <file> <msg>         Human input/feedback event
#   cast.sh finish <file>              Append exit event
#   cast.sh reopen <file>              Reopen a finished recording for continuation
#   cast.sh upload <file> [title]      Upload to asciinema, print URL
#   cast.sh validate <file>            Validate cast file structure
#   cast.sh duration <file>            Report playback and wall-clock duration
#
# State is tracked in <file>.state (stores last event timestamp as float seconds).
# Intervals are float seconds per asciicast v3 spec.
#
# Environment variables:
#   CAST_MAX_IDLE  — max idle seconds for playback deltas (default: 5)

set -euo pipefail

CAST_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Idle cap: playback deltas are capped at this value (seconds).
# Wall-clock timestamps in the state file are NOT affected.
MAX_IDLE_SECS="${CAST_MAX_IDLE:-5}"

# Stale state threshold: if delta exceeds this, treat as stale (seconds).
STALE_THRESHOLD=3600

now_secs() {
  python3 -c "import time; print(f'{time.time():.3f}')"
}

read_last_ts() {
  local state_file="$1.state"
  if [[ -f "$state_file" ]]; then
    cat "$state_file"
  else
    now_secs
  fi
}

write_last_ts() {
  local state_file="$1.state"
  echo "$2" > "$state_file"
}

# interval_secs <cast_file>
# Computes the delta since last event, applies idle cap and stale detection.
# Emits marker events to the cast file when capping or detecting anomalies.
# Always writes real wall-clock timestamp to state file for reporting accuracy.
interval_secs() {
  local cast_file="$1"
  local current
  current=$(now_secs)
  local last
  last=$(read_last_ts "$cast_file")

  # Always store real wall-clock timestamp regardless of delta capping
  write_last_ts "$cast_file" "$current"

  local delta
  delta=$(python3 -c "
raw = $current - $last
if raw < 0:
    print('NEGATIVE', f'{0.000:.3f}', f'{raw:.3f}')
elif raw > $STALE_THRESHOLD:
    print('STALE', f'{$MAX_IDLE_SECS:.3f}', f'{raw:.1f}')
elif raw > $MAX_IDLE_SECS:
    # Format original duration as human-readable
    mins = int(raw) // 60
    secs = int(raw) % 60
    if mins > 0:
        orig = f'{mins}m {secs}s'
    else:
        orig = f'{secs}s'
    print('CAPPED', f'{$MAX_IDLE_SECS:.3f}', orig)
else:
    print('OK', f'{raw:.3f}')
")

  local status capped_delta extra
  status=$(echo "$delta" | cut -d' ' -f1)
  capped_delta=$(echo "$delta" | cut -d' ' -f2)
  extra=$(echo "$delta" | cut -d' ' -f3-)

  case "$status" in
    NEGATIVE)
      echo "WARNING: Negative delta detected (${extra}s), clamped to 0.000" >&2
      local warn_data
      warn_data=$(escape_json "[warning: negative delta ${extra}s clamped to 0.000]")
      echo "[${capped_delta}, \"m\", ${warn_data}]" >> "$cast_file"
      ;;
    STALE)
      echo "WARNING: Stale state detected (${extra}s idle), delta capped to ${capped_delta}s" >&2
      local stale_data
      stale_data=$(escape_json "[warning: stale state ${extra} idle, delta capped to ${capped_delta}s]")
      echo "[${capped_delta}, \"m\", ${stale_data}]" >> "$cast_file"
      ;;
    CAPPED)
      local idle_data
      idle_data=$(escape_json "[idle: ${extra} capped to ${capped_delta}s]")
      echo "[${capped_delta}, \"m\", ${idle_data}]" >> "$cast_file"
      ;;
  esac

  echo "$capped_delta"
}

escape_json() {
  python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1"
}

cmd_init() {
  local file="$1"
  local title="${2:-Dream Team Session}"
  local dir
  dir=$(dirname "$file")
  mkdir -p "$dir"

  local ts
  ts=$(date +%s)
  local now
  now=$(now_secs)

  local title_json
  title_json=$(escape_json "$title")

  echo "{\"version\":3,\"term\":{\"cols\":120,\"rows\":40},\"timestamp\":${ts},\"title\":${title_json},\"env\":{\"SHELL\":\"$SHELL\"}}" > "$file"
  write_last_ts "$file" "$now"

  # Opening banner
  local banner
  banner=$(escape_json "$(printf '\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n  🏀 DREAM TEAM SESSION: %s\r\n  Started: %s\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n' "$title" "$(date '+%Y-%m-%d %H:%M:%S')")")
  echo "[0.000, \"o\", ${banner}]" >> "$file"

  echo "$file"
}

cmd_event() {
  local file="$1"
  local text="$2"
  local delta
  delta=$(interval_secs "$file")
  local data
  data=$(escape_json "$(printf '%s\r\n' "$text")")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

cmd_marker() {
  local file="$1"
  local label="$2"
  local delta
  delta=$(interval_secs "$file")
  local data
  data=$(escape_json "$label")
  echo "[${delta}, \"m\", ${data}]" >> "$file"
}

# Phase events: compute delta once, reuse for both marker and banner (AC8)
cmd_phase() {
  local file="$1"
  local label="$2"
  local delta
  delta=$(interval_secs "$file")
  local marker_data
  marker_data=$(escape_json "$label")
  echo "[${delta}, \"m\", ${marker_data}]" >> "$file"
  local banner
  banner=$(escape_json "$(printf '\r\n┌─────────────────────────────────────────────────────────────┐\r\n│  ▶ %s\r\n└─────────────────────────────────────────────────────────────┘\r\n\r\n' "$label")")
  echo "[${delta}, \"o\", ${banner}]" >> "$file"
}

cmd_agent() {
  local file="$1"
  local name="$2"
  local msg="$3"
  local delta
  delta=$(interval_secs "$file")
  local data
  data=$(escape_json "$(printf '[%s] %s\r\n' "$name" "$msg")")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

# Human events: compute delta once, reuse for both marker and banner (AC8)
cmd_human() {
  local file="$1"
  local msg="$2"
  local delta
  delta=$(interval_secs "$file")
  local marker_data
  marker_data=$(escape_json "Human: $msg")
  echo "[${delta}, \"m\", ${marker_data}]" >> "$file"
  local data
  data=$(escape_json "$(printf '\r\n👤 HUMAN: %s\r\n\r\n' "$msg")")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

cmd_finish() {
  local file="$1"
  local banner
  banner=$(escape_json "$(printf '\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n  🏁 SESSION COMPLETE — %s\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n' "$(date '+%Y-%m-%d %H:%M:%S')")")
  local delta
  delta=$(interval_secs "$file")
  echo "[${delta}, \"o\", ${banner}]" >> "$file"

  delta=$(interval_secs "$file")
  echo "[${delta}, \"x\", \"0\"]" >> "$file"

  # Clean up state file
  rm -f "$file.state"
}

# Robust reopen: pattern-match for exit event and SESSION COMPLETE banner (AC4, AC5)
cmd_reopen() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  # Check if file has an exit event — if not, it's already open (AC5)
  if ! grep -q '"x"' "$file"; then
    echo "WARNING: $file is already open (no exit event found). No changes made." >&2
    # Restore state file if missing
    if [[ ! -f "$file.state" ]]; then
      write_last_ts "$file" "$(now_secs)"
    fi
    echo "$file"
    return 0
  fi

  # Search backward for SESSION COMPLETE banner and exit event.
  # Find the first line (from end) containing SESSION COMPLETE, and remove from there onward.
  local total_lines cut_from
  total_lines=$(wc -l < "$file")

  # Find the line number of the SESSION COMPLETE banner (last occurrence)
  cut_from=$(grep -n 'SESSION COMPLETE' "$file" | tail -1 | cut -d: -f1)

  if [[ -z "$cut_from" ]]; then
    # No SESSION COMPLETE banner found; fall back to removing just the exit event line
    # Find the last line with "x" event type
    cut_from=$(grep -n '"x"' "$file" | tail -1 | cut -d: -f1)
  fi

  if [[ -z "$cut_from" ]]; then
    echo "ERROR: Could not find exit event or SESSION COMPLETE banner in $file" >&2
    return 1
  fi

  # Keep everything before the cut point
  local keep=$(( cut_from - 1 ))
  head -n "$keep" "$file" > "$file.tmp" && mv "$file.tmp" "$file"

  # Restore state file with current timestamp
  write_last_ts "$file" "$(now_secs)"

  # Add continuation marker — single delta for both events (AC8 pattern)
  local banner
  banner=$(escape_json "$(printf '\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n  🔄 SESSION CONTINUED — %s\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n' "$(date '+%Y-%m-%d %H:%M:%S')")")
  local delta
  delta=$(interval_secs "$file")
  echo "[${delta}, \"m\", \"Session continued\"]" >> "$file"
  echo "[${delta}, \"o\", ${banner}]" >> "$file"

  echo "$file"
}

# Upload with error handling (AC7)
cmd_upload() {
  local file="$1"
  local title="${2:-}"

  # Check that asciinema is available
  if ! command -v asciinema &>/dev/null; then
    echo "ERROR: asciinema is not installed or not in PATH. Install it with: pip install asciinema" >&2
    return 1
  fi

  # Check that file exists
  if [[ ! -f "$file" ]]; then
    echo "ERROR: Cast file $file does not exist" >&2
    return 1
  fi

  local args=(upload --visibility unlisted)
  if [[ -n "$title" ]]; then
    args+=(--title "$title")
  fi
  args+=("$file")

  local output exit_code
  output=$(asciinema "${args[@]}" 2>&1) || exit_code=$?
  exit_code=${exit_code:-0}

  if [[ $exit_code -ne 0 ]]; then
    echo "ERROR: asciinema upload failed (exit code $exit_code):" >&2
    echo "$output" >&2
    return "$exit_code"
  fi

  local url
  url=$(echo "$output" | grep -o 'https://[^ ]*' || true)
  if [[ -z "$url" ]]; then
    echo "ERROR: Upload succeeded but no URL found in output:" >&2
    echo "$output" >&2
    return 1
  fi

  echo "$url"
}

# Validate cast file structure
cmd_validate() {
  local file="$1"
  local errors=0

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  echo "Validating: $file"

  # Check 1: Valid JSON header with version 3
  local header
  header=$(head -1 "$file")
  if ! python3 -c "
import json, sys
h = json.loads(sys.argv[1])
assert h.get('version') == 3, f'Expected version 3, got {h.get(\"version\")}'
print('  [PASS] Header: valid JSON, version 3')
" "$header" 2>&1; then
    echo "  [FAIL] Header: invalid JSON or wrong version" >&2
    errors=$((errors + 1))
  fi

  # Check 2: All event lines are valid JSON arrays
  local line_errors
  line_errors=$(python3 -c "
import json, sys
errors = 0
with open(sys.argv[1]) as f:
    for i, line in enumerate(f, 1):
        if i == 1:
            continue  # skip header
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if not isinstance(ev, list):
                print(f'  [FAIL] Line {i}: not a JSON array')
                errors += 1
            elif len(ev) < 3:
                print(f'  [FAIL] Line {i}: array has fewer than 3 elements')
                errors += 1
        except json.JSONDecodeError as e:
            print(f'  [FAIL] Line {i}: invalid JSON — {e}')
            errors += 1
print(f'EVENT_ERRORS:{errors}')
" "$file" 2>&1)
  echo "$line_errors" | grep -v '^EVENT_ERRORS:' || true
  local event_err_count
  event_err_count=$(echo "$line_errors" | grep '^EVENT_ERRORS:' | cut -d: -f2)
  if [[ "$event_err_count" -gt 0 ]]; then
    errors=$((errors + event_err_count))
  else
    echo "  [PASS] All event lines are valid JSON arrays"
  fi

  # Check 3: No negative deltas
  local neg_count
  neg_count=$(python3 -c "
import json, sys
count = 0
with open(sys.argv[1]) as f:
    for i, line in enumerate(f, 1):
        if i == 1:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 1 and isinstance(ev[0], (int, float)) and ev[0] < 0:
                count += 1
                print(f'  [FAIL] Line {i}: negative delta {ev[0]}')
        except:
            pass
print(f'NEG_COUNT:{count}')
" "$file" 2>&1)
  echo "$neg_count" | grep -v '^NEG_COUNT:' || true
  local neg_err
  neg_err=$(echo "$neg_count" | grep '^NEG_COUNT:' | cut -d: -f2)
  if [[ "$neg_err" -gt 0 ]]; then
    errors=$((errors + neg_err))
  else
    echo "  [PASS] No negative deltas"
  fi

  # Check 4: Exit event check
  local has_exit
  has_exit=$(python3 -c "
import json, sys
lines = []
with open(sys.argv[1]) as f:
    for i, line in enumerate(f, 1):
        if i == 1:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 2:
                lines.append((i, ev))
        except:
            pass
# Check if last event is exit
if lines and lines[-1][1][1] == 'x':
    # Check no other exit events
    exit_count = sum(1 for _, ev in lines if ev[1] == 'x')
    if exit_count == 1:
        print('FINISHED_OK')
    else:
        print(f'MULTI_EXIT:{exit_count}')
else:
    # No exit = open file, check no stray exit events
    exit_count = sum(1 for _, ev in lines if ev[1] == 'x')
    if exit_count == 0:
        print('OPEN_OK')
    else:
        print(f'STRAY_EXIT:{exit_count}')
" "$file" 2>&1)

  case "$has_exit" in
    FINISHED_OK)
      echo "  [PASS] Exactly one exit event at end (finished file)"
      ;;
    OPEN_OK)
      echo "  [PASS] No exit event (open/in-progress file)"
      ;;
    MULTI_EXIT:*)
      echo "  [FAIL] Multiple exit events found (${has_exit#*:})" >&2
      errors=$((errors + 1))
      ;;
    STRAY_EXIT:*)
      echo "  [FAIL] Exit event(s) found but not at end of file (${has_exit#*:})" >&2
      errors=$((errors + 1))
      ;;
  esac

  # Check 5: State file presence
  if [[ "$has_exit" == "FINISHED_OK" ]]; then
    if [[ -f "$file.state" ]]; then
      echo "  [WARN] State file exists for a finished recording"
    else
      echo "  [PASS] No state file (expected for finished recording)"
    fi
  elif [[ "$has_exit" == "OPEN_OK" ]]; then
    if [[ -f "$file.state" ]]; then
      echo "  [PASS] State file present (expected for open recording)"
    else
      echo "  [WARN] No state file for open recording"
    fi
  fi

  if [[ $errors -eq 0 ]]; then
    echo "Validation passed."
    return 0
  else
    echo "Validation failed with $errors error(s)." >&2
    return 1
  fi
}

# Report playback duration (sum of deltas) and wall-clock duration
cmd_duration() {
  local file="$1"

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  python3 -c "
import json, sys

playback = 0.0
with open(sys.argv[1]) as f:
    header = json.loads(f.readline())
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 1 and isinstance(ev[0], (int, float)):
                playback += ev[0]
        except:
            pass

# Format playback time
pm = int(playback) // 60
ps = playback - (pm * 60)
print(f'Playback duration: {pm}m {ps:.1f}s ({playback:.3f}s total)')

# Wall-clock duration from header timestamp
ts = header.get('timestamp')
if ts:
    import time
    elapsed = time.time() - ts
    wm = int(elapsed) // 60
    ws = elapsed - (wm * 60)
    print(f'Wall-clock duration: {wm}m {ws:.1f}s ({elapsed:.1f}s total)')
else:
    print('Wall-clock duration: unknown (no timestamp in header)')
" "$file"
}

# --- Main dispatch ---
case "${1:-}" in
  init)     cmd_init "$2" "${3:-}" ;;
  event)    cmd_event "$2" "$3" ;;
  marker)   cmd_marker "$2" "$3" ;;
  phase)    cmd_phase "$2" "$3" ;;
  agent)    cmd_agent "$2" "$3" "$4" ;;
  human)    cmd_human "$2" "$3" ;;
  finish)   cmd_finish "$2" ;;
  reopen)   cmd_reopen "$2" ;;
  upload)   cmd_upload "$2" "${3:-}" ;;
  validate) cmd_validate "$2" ;;
  duration) cmd_duration "$2" ;;
  *)
    echo "Usage: cast.sh {init|event|marker|phase|agent|human|finish|reopen|upload|validate|duration} <file> [args...]" >&2
    exit 1
    ;;
esac
