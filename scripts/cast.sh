#!/usr/bin/env bash
# cast.sh -- Asciicast v3 recording helper for Dream Team sessions
#
# Produces an executive summary log: fixed 0.1s micro-delays for
# line-by-line scrolling, wall-clock timestamps on every visible line.
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
#   cast.sh timeline <file>            Generate visual timeline and append to cast file
#   cast.sh preview <file>             Render cast file as terminal text (playback preview)
#   cast.sh export-html <file>        Generate standalone HTML retro report
#   cast.sh strip-idle <file> [--threshold <secs>]  Strip idle gaps (default 30s), output to <file>.stripped.cast
#   cast.sh wrap <file> <command...>   Record real terminal via script(1), merge o+m events on exit
#   cast.sh rec  <file> <title> -- <command...>  Record real terminal with marker sidecar
#
# State is tracked in <file>.state (stores last event timestamp as float seconds).
# Intervals are float seconds per asciicast v3 spec.
#
# REC MODE ARCHITECTURE
# ---------------------
# The "rec" command (cmd_rec) records a real terminal session using asciinema.
# During that session asciinema owns the terminal and writes all visible output
# as "o" events directly into the cast file with its own precise timing.
# cast.sh commands (agent, human, marker, phase, finish, event) cannot append
# to the cast file during this window -- doing so would corrupt asciinema's
# sequential o-event stream.
#
# Dual-path design:
#   Normal path  -- cast.sh writes o and m events directly to the cast file.
#   Rec-mode path -- cast.sh writes timestamped markers to a sidecar file
#                    (<file>.markers) instead.
#
# Session lifecycle:
#   1. cmd_rec creates the rec signal file (.cast-rec-active) containing the
#      session start epoch and the sidecar path, then starts asciinema.
#   2. Any cast.sh command calls _check_rec_mode; if the signal file exists,
#      it reads REC_START and REC_MARKERS from it and returns 0 (rec mode).
#   3. The command calls _write_rec_marker, which computes a delta from
#      REC_START and appends a JSON entry to the sidecar.
#   4. When asciinema exits, cmd_rec removes the signal file (ending rec mode)
#      then calls _merge_markers to sort-merge the sidecar m events into the
#      cast file's existing events by timestamp.
#   5. The sidecar is deleted; the final cast file contains both o and m events.

# OUTPUT FORMAT
# -------------
# All visible "o" events use plain timestamped text (e.g., "[HH:MM:SS] Agent: msg").
# Each o event is paired with a structured JSON "m" event (dual-channel pattern).
# This ensures recordings are readable both as raw terminal output and as
# machine-parseable data for the HTML report exporter.

set -euo pipefail

CAST_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
# Returns real elapsed seconds since last event (deltas below 0.001 or above 300s are reset to 0.001 to guard against stale state).
# Writes real wall-clock timestamp to state file for duration reporting.
interval_secs() {
  local cast_file="$1"
  local current
  current=$(now_secs)
  local last_ts
  last_ts=$(read_last_ts "$cast_file")

  # Store real wall-clock timestamp for reporting accuracy
  write_last_ts "$cast_file" "$current"

  # Compute real elapsed delta (clamped to 300s max to guard against stale state files)
  python3 -c "
import sys
delta = float(sys.argv[1]) - float(sys.argv[2])
if delta < 0.001:
    delta = 0.001
if delta > 300:
    print('WARNING: delta %.1fs exceeds 300s (stale state file?), clamping to 0.001' % delta, file=sys.stderr)
    delta = 0.001
print(f'{delta:.3f}')
" "$current" "$last_ts"
}

# Wall-clock timestamp for log-style output
timestamp() {
  date '+%H:%M:%S'
}

# Check if a cast file is being recorded via cmd_rec (file-based signal).
# Uses a well-known path so ANY cast.sh command (even with a different file path)
# detects that a rec session is active and writes markers to the sidecar.
# Returns 0 if in rec mode, 1 otherwise. Sets REC_START and REC_MARKERS.
_rec_signal_file() {
  local repo_root
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$HOME")
  echo "${repo_root}/.cast-rec-active"
}

_check_rec_mode() {
  local rec_file
  rec_file=$(_rec_signal_file)
  if [[ -f "$rec_file" ]]; then
    # Empty file check
    if [[ ! -s "$rec_file" ]]; then
      echo "WARNING: Removing empty .cast-rec-active" >&2
      rm -f "$rec_file"
      return 1
    fi
    # Signal file format: line 1 = start epoch, line 2 = markers sidecar path, line 3 = PID
    REC_START=$(sed -n '1p' "$rec_file")
    REC_MARKERS=$(sed -n '2p' "$rec_file")
    local rec_pid
    rec_pid=$(sed -n '3p' "$rec_file")
    # Age check (MUST come before PID check): stale if epoch is >3600s old or missing/corrupt
    local now age
    now=$(date +%s)
    if [[ -z "$REC_START" ]] || ! [[ "$REC_START" =~ ^[0-9]+$ ]]; then
      echo "WARNING: Removing corrupt .cast-rec-active (no valid epoch)" >&2
      rm -f "$rec_file"
      return 1
    fi
    age=$(( now - REC_START ))
    if (( age < 0 )); then
      echo "WARNING: Removing .cast-rec-active — REC_START is in the future (clock skew? age ${age}s)" >&2
      rm -f "$rec_file"
      return 1
    fi
    if (( age > 3600 )); then
      echo "WARNING: Removing stale .cast-rec-active (age ${age}s > 3600s)" >&2
      rm -f "$rec_file"
      return 1
    fi
    # Age is <3600s — now check PID if present
    if [[ -n "$rec_pid" ]]; then
      if ! kill -0 "$rec_pid" 2>/dev/null; then
        echo "WARNING: Removing stale .cast-rec-active (PID $rec_pid is dead)" >&2
        rm -f "$rec_file"
        return 1
      fi
      # PID alive and age <3600s: valid active session
      return 0
    fi
    # No PID but age <3600s: backward compat with older signal file format
    echo "WARNING: .cast-rec-active has no PID — session may be orphaned (age ${age}s)" >&2
    return 0
  fi
  return 1
}

# Write a structured marker to the sidecar during rec mode.
# $1 = JSON string of the m-event data (same format as normal-path m events)
_write_rec_marker() {
  local m_data="$1"
  local delta
  delta=$(python3 -c "import time; print(f'{time.time() - $REC_START:.6f}')")
  echo "{\"delta\": $delta, \"data\": $m_data}" >> "$REC_MARKERS"
}

escape_json() {
  python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1"
}

# Escape a string as JSON, appending \r\n for terminal line output.
# Using python directly avoids bash $() stripping trailing newlines.
escape_json_line() {
  python3 -c "import json,sys; print(json.dumps(sys.argv[1] + '\r\n'))" "$1"
}

# Agent color map — returns ANSI escape prefix for a given agent name.
# Uses printf to produce actual ESC character so json.dumps encodes as \u001b[.
agent_color() {
  local name="$1"
  case "$name" in
    Bird)   printf '\033[32m' ;;
    MJ)     printf '\033[34m' ;;
    Shaq)   printf '\033[35m' ;;
    Kobe)   printf '\033[31m' ;;
    Pippen) printf '\033[36m' ;;
    Magic)  printf '\033[33m' ;;
    Human)    printf '\033[1;97m' ;;
    "Coach K") printf '\033[38;2;232;99;140m' ;;
    *)         printf '' ;;
  esac
}

# Color severity badges within a message string.
# Returns the message with badge patterns wrapped in color codes.
color_badges() {
  python3 -c "
import sys, re
msg = sys.argv[1]
reset = '\033[0m'
# Order matters: longer patterns first
msg = re.sub(r'(FINDING \[CRITICAL\]:?)', '\033[1;31m' + r'\1' + reset, msg)
msg = re.sub(r'(FINDING \[IMPORTANT\]:?)', '\033[1;33m' + r'\1' + reset, msg)
msg = re.sub(r'(FINDING \[MEDIUM\]:?)', '\033[1;33m' + r'\1' + reset, msg)
msg = re.sub(r'(FINDING \[HIGH\]:?)', '\033[1;33m' + r'\1' + reset, msg)
msg = re.sub(r'(FINDING \[LOW\]:?)', '\033[2m' + r'\1' + reset, msg)
msg = re.sub(r'(EDGE CASE:)', '\033[2m' + r'\1' + reset, msg)
print(msg, end='')
" "$1"
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

  # o event
  local ts_str
  ts_str=$(timestamp)
  local bl
  bl=$(escape_json_line "[$ts_str] SESSION START: $title")
  echo "[0.000, \"o\", ${bl}]" >> "$file"

  echo "$file"
}

cmd_event() {
  if _check_rec_mode "$1"; then
    local ts; ts=$(date +%H:%M:%S)
    local m_data
    m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'event','msg':sys.argv[1],'ts':sys.argv[2]}))" "$2" "$ts")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"
  local text="$2"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi
  # Guard: do not append to finished files
  if grep -q '"x"' "$file"; then
    echo "ERROR: $file is finished (has exit event). Use 'reopen' first." >&2
    return 1
  fi
  local delta
  delta=$(interval_secs "$file")
  local ts
  ts=$(timestamp)
  # o event
  local line data
  line="[$ts] $text"
  data=$(escape_json_line "$line")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
  # m event
  local m_data
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'event','msg':sys.argv[1],'ts':sys.argv[2]}))" "$text" "$ts")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"
}

cmd_marker() {
  if _check_rec_mode "$1"; then
    local m_data
    m_data=$(escape_json "$2")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"
  local label="$2"
  local delta
  delta=$(interval_secs "$file")
  local data
  data=$(escape_json "$label")
  echo "[${delta}, \"m\", ${data}]" >> "$file"
}

# Phase events: compute delta once, reuse for both marker and banner (single delta reused for paired m+o events)
cmd_phase() {
  if _check_rec_mode "$1"; then
    local ts; ts=$(date +%H:%M:%S)
    local m_data
    m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'phase','msg':sys.argv[1],'ts':sys.argv[2]}))" "$2" "$ts")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi
  # Guard: do not append to finished files
  if grep -q '"x"' "$file"; then
    echo "ERROR: $file is finished (has exit event). Use 'reopen' first." >&2
    return 1
  fi
  local delta
  delta=$(interval_secs "$file")
  local ts
  ts=$(timestamp)
  # m event
  local m_data
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'phase','msg':sys.argv[1],'ts':sys.argv[2]}))" "$label" "$ts")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"
  # o event
  local banner
  banner=$(escape_json_line "[$ts] PHASE: $label")
  echo "[${delta}, \"o\", ${banner}]" >> "$file"
}

cmd_agent() {
  # Rec-mode early return: positional args used directly since local vars are assigned after this block
  if _check_rec_mode "$1"; then
    local ts; ts=$(date +%H:%M:%S)
    local m_data
    m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'agent','agent':sys.argv[1],'msg':sys.argv[2],'ts':sys.argv[3]}))" "$2" "$3" "$ts")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"
  local name="$2"
  local msg="$3"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi
  # Guard: do not append to finished files
  if grep -q '"x"' "$file"; then
    echo "ERROR: $file is finished (has exit event). Use 'reopen' first." >&2
    return 1
  fi
  local delta
  delta=$(interval_secs "$file")
  local ts
  ts=$(timestamp)
  # o event
  local line data
  line="[$ts] $name: $msg"
  data=$(escape_json_line "$line")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
  # m event
  local m_data
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'agent','agent':sys.argv[1],'msg':sys.argv[2],'ts':sys.argv[3]}))" "$name" "$msg" "$ts")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"
}

# Human events: compute delta once, reuse for both marker and banner (single delta reused for paired m+o events)
cmd_human() {
  if _check_rec_mode "$1"; then
    local ts; ts=$(date +%H:%M:%S)
    local m_data
    m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'human','msg':sys.argv[1],'ts':sys.argv[2]}))" "$2" "$ts")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"
  local msg="$2"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi
  # Guard: do not append to finished files
  if grep -q '"x"' "$file"; then
    echo "ERROR: $file is finished (has exit event). Use 'reopen' first." >&2
    return 1
  fi
  local delta
  delta=$(interval_secs "$file")
  local ts
  ts=$(timestamp)
  # m event
  local m_data
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'human','msg':sys.argv[1],'ts':sys.argv[2]}))" "$msg" "$ts")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"
  # o event
  local data
  data=$(escape_json_line "[$ts] Human: $msg")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

cmd_finish() {
  if _check_rec_mode "$1"; then
    local ts; ts=$(date +%H:%M:%S)
    local m_data
    m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'finish','msg':'SESSION COMPLETE','ts':sys.argv[1]}))" "$ts")
    _write_rec_marker "$m_data"
    return 0
  fi
  local file="$1"

  if grep -q '"x"' "$file"; then
    echo "WARNING: $file already has an exit event. Use 'reopen' first." >&2
    return 1
  fi

  local ts_str
  ts_str=$(timestamp)
  local delta bl
  delta=$(interval_secs "$file")
  # o event
  bl=$(escape_json_line "[$ts_str] SESSION COMPLETE")
  echo "[${delta}, \"o\", ${bl}]" >> "$file"
  # m event
  local m_data
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'finish','msg':'SESSION COMPLETE','ts':sys.argv[1]}))" "$ts_str")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"

  delta=$(interval_secs "$file")
  echo "[${delta}, \"x\", \"0\"]" >> "$file"

  # Clean up state file
  rm -f "$file.state"
}

# Robust reopen: pattern-match for exit event and SESSION COMPLETE banner (AC4: pattern-match exit event; AC5: handle already-open files)
cmd_reopen() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  # Check if file has an exit event -- if not, it's already open (handle already-open files)
  if ! grep -q '"x"' "$file"; then
    echo "WARNING: $file is already open (no exit event found). No changes made." >&2
    # Restore state file if missing
    if [[ ! -f "$file.state" ]]; then
      write_last_ts "$file" "$(now_secs)"
    fi
    echo "$file"
    return 0
  fi

  # Search backward for SESSION COMPLETE banner anchored to the exit event.
  # Find the exit event first, then look for SESSION COMPLETE only in the 3 lines before it.
  local cut_from

  local exit_line
  exit_line=$(grep -n '"x"' "$file" | tail -1 | cut -d: -f1)

  if [[ -n "$exit_line" ]]; then
    # Look for SESSION COMPLETE in the 3 lines before exit (plain ASCII survives JSON encoding)
    cut_from=$(head -n "$exit_line" "$file" | tail -n 3 | grep -n 'SESSION COMPLETE' | head -1 | cut -d: -f1)
    if [[ -n "$cut_from" ]]; then
      cut_from=$(( exit_line - 3 + cut_from ))
    else
      cut_from=$exit_line
    fi
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

  # Add continuation marker -- single delta for both events (single delta reused for paired m+o events)
  local ts_str bl delta m_data
  ts_str=$(timestamp)
  delta=$(interval_secs "$file")
  m_data=$(python3 -c "import json,sys; print(json.dumps({'type':'event','msg':'Session continued','ts':sys.argv[1]}))" "$ts_str")
  echo "[${delta}, \"m\", ${m_data}]" >> "$file"
  # o event
  bl=$(escape_json_line "[$ts_str] SESSION CONTINUED")
  echo "[${delta}, \"o\", ${bl}]" >> "$file"

  echo "$file"
}

# Convert v3 cast to v2 format, converting structured m events to string labels.
# Returns the path to a v2-ready file (temp file if conversion needed).
_ensure_v2() {
  local file="$1"
  local version
  version=$(python3 -c "import json,sys; print(json.loads(open(sys.argv[1]).readline()).get('version',0))" "$file")

  if [[ "$version" == "2" ]]; then
    echo "$file"
    return 0
  fi

  if [[ "$version" != "3" ]]; then
    echo "ERROR: Unsupported cast version: $version" >&2
    return 1
  fi

  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/cast_v2_XXXXXX.cast")

  python3 - "$file" "$tmp" <<'PYEOF'
import json, sys

src, dst = sys.argv[1], sys.argv[2]

with open(src) as f:
    lines = f.readlines()

# Convert header
hdr = json.loads(lines[0])
v2_hdr = {"version": 2}
term = hdr.get("term", {})
v2_hdr["width"] = term.get("cols", 120)
v2_hdr["height"] = term.get("rows", 40)
if "timestamp" in hdr:
    v2_hdr["timestamp"] = hdr["timestamp"]
if "title" in hdr:
    v2_hdr["title"] = hdr["title"]
if "env" in hdr:
    v2_hdr["env"] = hdr["env"]

out_lines = [json.dumps(v2_hdr)]

# v3 uses relative deltas, v2 uses cumulative timestamps from start
cumulative = 0.0

for raw in lines[1:]:
    raw = raw.strip()
    if not raw:
        continue
    ev = json.loads(raw)
    if len(ev) < 3:
        continue
    delta, etype, data = ev[0], ev[1], ev[2]
    cumulative += delta

    if etype == "o":
        out_lines.append(json.dumps([round(cumulative, 6), "o", data]))
    elif etype == "m":
        # Convert dict data to a readable label string
        if isinstance(data, dict):
            t = data.get("type", "")
            msg = data.get("msg", "")
            agent = data.get("agent", "")
            if t == "phase":
                label = msg
            elif t == "agent" and agent:
                label = f"{agent}: {msg}"
            elif t == "human":
                label = f"Human: {msg}"
            elif t == "finish":
                label = "Session complete" if not msg else msg.capitalize() if msg.isupper() else msg
                # Normalize common finish messages
                if label.upper() == "SESSION COMPLETE":
                    label = "Session complete"
            elif t == "event":
                label = msg
            else:
                label = msg if msg else str(data)
        else:
            label = str(data)
        out_lines.append(json.dumps([round(cumulative, 6), "m", label]))
    # "x" events: drop (v2 has no exit event type)

with open(dst, "w") as f:
    f.write("\n".join(out_lines) + "\n")
PYEOF

  echo "$tmp"
}

# Upload with error handling (error handling with clear messages)
cmd_upload() {
  # In rec mode, the team alias handles upload after session ends — skip here
  if _check_rec_mode "$1" 2>/dev/null; then
    echo "SKIP: Upload deferred — team alias will upload after session ends." >&2
    echo "(rec mode active)"
    return 0
  fi

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

  # v3 files have "x" exit events; v2 files from cmd_rec don't — check only for v3
  local version
  version=$(python3 -c "import json,sys; print(json.loads(open(sys.argv[1]).readline()).get('version',0))" "$file" 2>/dev/null || echo "0")
  if [[ "$version" == "3" ]] && ! grep -q '"x"' "$file"; then
    echo "ERROR: Cast file is not complete (no exit event). Run 'finish' first." >&2
    return 1
  fi

  # Strip idle time before upload — no one wants to watch waiting
  local stripped_file="${file}.stripped.cast"
  cmd_strip_idle "$file"
  local work_file="$stripped_file"

  # Convert to v2 if needed, converting structured m events to string labels
  local upload_file
  upload_file=$(_ensure_v2 "$work_file") || return $?

  local args=(upload --visibility unlisted)
  if [[ -n "$title" ]]; then
    args+=(--title "$title")
  fi
  args+=("$upload_file")

  local output exit_code
  output=$(asciinema "${args[@]}" 2>&1) || exit_code=$?
  exit_code=${exit_code:-0}

  # Clean up temp files
  if [[ "$upload_file" != "$work_file" ]]; then
    rm -f "$upload_file"
  fi
  rm -f "$stripped_file"

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
            print(f'  [FAIL] Line {i}: invalid JSON -- {e}')
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

  # Check 3: Exit event check
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

  # Check 4: State file presence
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

# Generate visual timeline summary and append to cast file
cmd_timeline() {
  local file="$1"

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi
  # Guard: do not append to finished files
  if grep -q '"x"' "$file"; then
    echo "ERROR: $file is finished (has exit event). Use 'reopen' first." >&2
    return 1
  fi

  local timeline_output
  timeline_output=$(python3 -c "
import json, sys, re, datetime

file_path = sys.argv[1]

# ANSI color map for agents (terminal bar output)
AGENT_COLORS = {
    'Bird':   '\033[32m',
    'MJ':     '\033[34m',
    'Shaq':   '\033[35m',
    'Kobe':   '\033[31m',
    'Pippen': '\033[36m',
    'Magic':  '\033[33m',
    'Human':  '\033[1;97m',
    'Coach K': '\033[38;2;232;99;140m',
}
# ANSI background colors for bars
AGENT_BG = {
    'Bird':   '\033[42m',
    'MJ':     '\033[44m',
    'Shaq':   '\033[45m',
    'Kobe':   '\033[41m',
    'Pippen': '\033[46m',
    'Magic':  '\033[43m',
    'Human':  '\033[107m',
    'Coach K': '\033[48;2;232;99;140m',
}
RESET = '\033[0m'
DIM   = '\033[2m'
BOLD_WHITE = '\033[1;37m'

# Strip ANSI escape codes from a string for pattern matching
def strip_ansi(s):
    return re.sub(r'\033\[[0-9;]*m', '', s)

# Read header for start timestamp
with open(file_path) as f:
    header = json.loads(f.readline())
start_epoch = header.get('timestamp', 0)

# Parse all events, tracking by index (all deltas are 0.1s)
events = []
event_index = 0
with open(file_path) as f:
    f.readline()  # skip header
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 3:
                events.append((event_index, ev[1], ev[2]))
                event_index += 1
        except:
            pass

if not events:
    print('')
    sys.exit(0)

total_events = event_index

# Extract wall-clock timestamps from [HH:MM:SS] prefixes in output
def extract_time(data):
    if not isinstance(data, str):
        return None
    m = re.search(r'\[(\d{2}:\d{2}:\d{2})\]', data)
    return m.group(1) if m else None

# Track agents and human checkpoints
agents = {}  # name -> {first_idx, last_idx, first_time, last_time, summaries}
human_checkpoints = []

for idx, etype, data in events:
    if etype != 'o' or not isinstance(data, str):
        continue

    # Strip ANSI codes before pattern matching
    clean = strip_ansi(data).replace('\r\n', '').replace('\r', '').replace('\n', '').strip()
    ts_str = extract_time(clean)

    # Check for agent pattern: [HH:MM:SS] [AgentName] ...
    m = re.match(r'\[\d{2}:\d{2}:\d{2}\]\s*\[([A-Za-z]+)\]\s*(.*)', clean)
    if m:
        name = m.group(1)
        summary = m.group(2).strip()
        if name not in agents:
            agents[name] = {'first_idx': idx, 'last_idx': idx, 'first_time': ts_str, 'last_time': ts_str, 'summaries': []}
        agents[name]['last_idx'] = idx
        agents[name]['last_time'] = ts_str or agents[name]['last_time']
        if summary:
            agents[name]['summaries'].append(summary)
        continue

    # Check for human pattern: [HH:MM:SS] HUMAN: ...
    hm = re.match(r'.*\[\d{2}:\d{2}:\d{2}\]\s*HUMAN:\s*(.*)', clean)
    if hm:
        msg = hm.group(1).strip()
        human_checkpoints.append({'idx': idx, 'time': ts_str, 'summary': msg})

if not agents and not human_checkpoints:
    print('')
    sys.exit(0)

# Build ordered list of participants by first appearance
participants = []
all_entries = []

for name, info in agents.items():
    all_entries.append((info['first_idx'], info['last_idx'], name, info['first_time'], info['last_time'], info['summaries']))

for hc in human_checkpoints:
    all_entries.append((hc['idx'], hc['idx'], 'Human', hc['time'], hc['time'], [hc['summary']]))

all_entries.sort(key=lambda x: x[0])

# Deduplicate Human entries -- merge consecutive
seen = set()
for first_idx, last_idx, name, first_time, last_time, summaries in all_entries:
    if name == 'Human':
        if 'Human' not in seen:
            participants.append({'name': 'Human', 'first_idx': first_idx, 'last_idx': last_idx, 'first_time': first_time, 'last_time': last_time, 'summaries': list(summaries)})
            seen.add('Human')
        else:
            for p in participants:
                if p['name'] == 'Human':
                    p['last_idx'] = max(p['last_idx'], last_idx)
                    p['last_time'] = last_time or p['last_time']
                    p['summaries'].extend(summaries)
    else:
        if name not in seen:
            participants.append({'name': name, 'first_idx': first_idx, 'last_idx': last_idx, 'first_time': first_time, 'last_time': last_time, 'summaries': list(summaries)})
            seen.add(name)

# Timeline bar width
BAR_WIDTH = 25

agent_count = sum(1 for p in participants if p['name'] != 'Human')
human_count = len(human_checkpoints)

# Build the timeline
lines = []
lines.append(BOLD_WHITE + 'TIMELINE:' + RESET)
lines.append(DIM + '\u2550' * 68 + RESET)

for p in participants:
    name = p['name']
    color = AGENT_COLORS.get(name, '')
    bg    = AGENT_BG.get(name, '')

    # Compute bar position using event index
    if total_events > 0:
        start_frac = p['first_idx'] / total_events
        end_frac = p['last_idx'] / total_events
    else:
        start_frac = 0
        end_frac = 1

    start_pos = int(start_frac * BAR_WIDTH)
    end_pos = max(start_pos + 1, int(end_frac * BAR_WIDTH) + 1)
    end_pos = min(end_pos, BAR_WIDTH)

    # Build colored bar: dim dots outside, foreground-colored bars inside
    bar = ''
    inactive_before = ''
    active_segment = ''
    inactive_after = ''
    for i in range(BAR_WIDTH):
        if i < start_pos:
            inactive_before += '\u00b7'
        elif i < end_pos:
            active_segment += '\u2500'
        else:
            inactive_after += '\u00b7'

    bar = ''
    if inactive_before:
        bar += DIM + inactive_before + RESET
    if active_segment:
        bar += color + active_segment + RESET
    if inactive_after:
        bar += DIM + inactive_after + RESET

    # Time range
    t_first = p.get('first_time') or '??:??:??'
    t_last = p.get('last_time') or '??:??:??'
    if t_first == t_last:
        time_range = t_first
    else:
        time_range = f'{t_first}-{t_last}'

    # First line: colored agent name, bar, time range, completion summary
    completion = ''
    for s in p['summaries']:
        if s.startswith('Complete') or s.startswith('Verdict') or s.startswith('Task:'):
            completion = s
            break
    if not completion and p['summaries']:
        completion = p['summaries'][0]

    label = color + f'  {name:<8} ' + RESET
    lines.append(f'{label}{bar}  {time_range}  {completion}')

    # Subsequent lines: list all findings/changes/rules/decisions (dim)
    for s in p['summaries']:
        if s.startswith('FINDING') or s.startswith('CHANGED') or s.startswith('RULE') or s.startswith('AC:') or s.startswith('DECISION') or s.startswith('RISK') or s.startswith('EDGE CASE'):
            lines.append(DIM + f'           {s}' + RESET)

lines.append(DIM + f'  Events: {total_events} | Agents: {agent_count} | Human checkpoints: {human_count}' + RESET)
lines.append(DIM + '\u2550' * 68 + RESET)

for line in lines:
    print(line)
" "$file")

  # If no timeline data, skip
  if [[ -z "$timeline_output" ]]; then
    echo "WARNING: No agent or human events found -- skipping timeline" >&2
    return 0
  fi

  # Append marker event for navigation
  local delta
  delta=$(interval_secs "$file")
  local marker_data
  marker_data=$(escape_json "Session Timeline")
  echo "[${delta}, \"m\", ${marker_data}]" >> "$file"

  # Emit each timeline line as a separate event (line by line, like the rest of the log)
  while IFS= read -r tl_line; do
    delta=$(interval_secs "$file")
    local tl_data
    tl_data=$(escape_json_line "$tl_line")
    echo "[${delta}, \"o\", ${tl_data}]" >> "$file"
  done <<< "$timeline_output"
}

# Render cast file as terminal text (what the recording looks like on playback)
cmd_preview() {
  local file="$1"

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  python3 -c "
import json, sys

with open(sys.argv[1]) as f:
    f.readline()  # skip header
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if ev[1] == 'o':
                text = ev[2].replace('\r\n', '\n').replace('\r', '')
                print(text, end='')
        except:
            pass
" "$file"
}

# Export cast file to standalone HTML report.
#
# Generates a self-contained HTML file with:
#   - Header with session metadata and verdict badge
#   - Lineup card with per-agent token usage and cost estimates
#   - Time-proportional timeline with idle-gap compression
#   - Agent activity cards with findings, verdicts, and narratives
#   - Consolidated findings table with status tracking
#   - Files changed, carry-forward items, and recording link
#
# Data flow: cast file -> parse m/o events -> extract structured data -> generate HTML
# Cost model: blended input/output rates per model (see MODEL_RATES in Python below)
# PRICING_UPDATE: When Anthropic changes model pricing, update MODEL_RATES dict below.
cmd_export_html() {
  # In rec mode, the team alias handles report generation after session ends — skip here
  if _check_rec_mode "$1" 2>/dev/null; then
    echo "SKIP: Report deferred — team alias will generate after session ends." >&2
    return 0
  fi

  local file="$1"
  local asciinema_url="${2:-}"

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  local out_file="${file%.cast}.html"
  if [[ "$file" == "$out_file" ]]; then
    out_file="${file}.html"
  fi

  python3 << 'PYEOF' - "$file" "$out_file" "$asciinema_url" "${HOME}/.claude/agents"
import json, sys, re, datetime, html as html_mod, os

cast_file = sys.argv[1]
out_file  = sys.argv[2]
asciinema_url = sys.argv[3] if len(sys.argv) > 3 else ''
agents_dir = sys.argv[4] if len(sys.argv) > 4 else ''

# ── helpers ──────────────────────────────────────────────────────────────────

def strip_ansi(s):
    return re.sub(r'\033\[[0-9;]*m|\x1b\[[0-9;]*m', '', s)

def h(s):
    return html_mod.escape(str(s))

def fmt_duration(secs):
    if not secs:
        return '&mdash;'
    m, s = divmod(int(secs), 60)
    if m > 0:
        return f'{m}m{s:02d}s'
    return f'{s}s'

AGENT_CSS_VAR = {
    'Bird':   'var(--bird)',
    'MJ':     'var(--mj)',
    'Shaq':   'var(--shaq)',
    'Kobe':   'var(--kobe)',
    'Pippen': 'var(--pippen)',
    'Magic':  'var(--magic)',
    'Human':  'var(--human)',
    'Coach K': 'var(--coach)',
}

AGENT_ROLES = {
    'Bird':   'Domain Analysis',
    'MJ':     'Architecture',
    'Shaq':   'Implementation',
    'Kobe':   'Quality Review',
    'Pippen': 'Stability Review',
    'Magic':  'Synthesis & Retro',
    'Coach K': 'Orchestration',
}

# PRICING_UPDATE: Update these rates when Anthropic changes model pricing (claude.ai/pricing).
# Blended cost rates ($/M tokens) using 85% input / 15% output ratio (agentic workflows are input-dominant).
# Pricing source: Anthropic public pricing (claude.ai/pricing).
#   opus:     (0.85 * $5)  + (0.15 * $25) = $8.00/MTok
#   sonnet:   (0.85 * $3)  + (0.15 * $15) = $4.80/MTok
#   opusplan: ~40% opus + 60% sonnet blend = $6.00/MTok  (Coach K orchestration pattern)
#   haiku:    (0.85 * $1)  + (0.15 * $5)  = $1.60/MTok
MODEL_RATES = {
    'opus':     8.00,
    'sonnet':   4.80,
    'opusplan': 6.00,
    'haiku':    1.60,
}
DEFAULT_RATE = MODEL_RATES['opus']  # conservative fallback for unknown models

def resolve_model(agent_name, agents_dir):
    """Read model: field from agent YAML frontmatter. Returns a key into MODEL_RATES."""
    if not agents_dir:
        return 'opus'
    # Convention: "Bird" -> bird.md, "Coach K" -> coachk.md (lowercase, strip spaces)
    filename = agent_name.lower().replace(' ', '') + '.md'
    path = os.path.join(agents_dir, filename)
    try:
        with open(path) as f:
            content = f.read(2048)
        # Parse only within YAML frontmatter (between --- delimiters)
        fm_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
        if not fm_match:
            return 'opus'
        fm = fm_match.group(1)
        m = re.search(r'^model:\s*(\S+)', fm, re.MULTILINE)
        if not m:
            return 'opus'
        model_val = m.group(1).strip().lower().strip('"').strip("'")
        # Exact match first, then substring match (longer keys checked first to avoid 'opus' matching 'opusplan')
        if model_val in MODEL_RATES:
            return model_val
        for key in sorted(MODEL_RATES, key=len, reverse=True):
            if key in model_val:
                return key
        return 'opus'
    except (FileNotFoundError, OSError):
        return 'opus'

def badge_class(sev):
    sev = sev.upper()
    if 'CRITICAL' in sev: return 'critical'
    if 'IMPORTANT' in sev: return 'important'
    if 'MEDIUM' in sev or 'HIGH' in sev: return 'medium'
    if 'LOW' in sev: return 'low'
    if 'RULE' in sev: return 'rule'
    if sev.startswith('AC'): return 'ac'
    if 'DECISION' in sev: return 'decision'
    if 'RISK' in sev: return 'risk'
    if 'CHANGED' in sev or 'CHANGE' in sev: return 'changed'
    if 'EDGE' in sev: return 'edge'
    return 'low'

def badge_label(sev):
    sev = sev.strip().rstrip(':')
    labels = {
        'FINDING [CRITICAL]': 'Critical',
        'FINDING [IMPORTANT]': 'Important',
        'FINDING [HIGH]': 'High',
        'FINDING [MEDIUM]': 'Medium',
        'FINDING [LOW]': 'Low',
        'RULE': 'Rule',
        'AC': 'AC',
        'DECISION': 'Decision',
        'RISK': 'Risk',
        'CHANGED': 'Changed',
        'EDGE CASE': 'Edge Case',
    }
    return labels.get(sev, sev.title())

# ── parse cast file ───────────────────────────────────────────────────────────

with open(cast_file) as f:
    header = json.loads(f.readline())
    raw_events = []
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 3:
                raw_events.append(ev)
        except:
            pass

title = header.get('title', 'Dream Team Session')
if title.startswith('Dream Team: '):
    title = title[len('Dream Team: '):]
ts_epoch = header.get('timestamp', 0)
session_date = datetime.datetime.fromtimestamp(ts_epoch).strftime('%Y-%m-%d') if ts_epoch else ''

# ── extract structured events ─────────────────────────────────────────────────

agent_data = {}   # name -> {first_time, last_time, first_idx, last_idx, summaries, findings, confidence, tokens, tools, duration_s, verdict}
human_events = [] # {time, msg, idx}
phase_events = [] # {label}
task_contexts = []
coach_events = [] # {time, idx} — tracks Coach K orchestration moments
verdict_global = None
total_event_count = len(raw_events)
# Track indices whose data was already extracted from structured m events,
# so the o-event regex fallback does not double-count them.
m_processed_indices = set()

for idx, ev in enumerate(raw_events):
    etype = ev[1]
    data  = ev[2] if len(ev) > 2 else ''

    if not isinstance(data, (str, dict)):
        continue

    clean = strip_ansi(data).replace('\r\n', '').replace('\r', '').replace('\n', '').strip() if isinstance(data, str) else ''

    if etype == 'm':
        # Dual-path: try structured JSON first (new format), fall through to legacy string parsing
        structured = None
        try:
            parsed = json.loads(data) if isinstance(data, str) else data if isinstance(data, dict) else None
            if isinstance(parsed, dict) and 'type' in parsed:
                structured = parsed
        except (json.JSONDecodeError, TypeError):
            pass

        if structured:
            mtype = structured.get('type', '')
            m_msg = structured.get('msg', '')
            m_ts = structured.get('ts', '')
            m_agent = structured.get('agent', '')

            if mtype == 'phase':
                phase_events.append(m_msg)
                coach_events.append({'time': m_ts or None, 'idx': idx})
            elif mtype == 'agent' and m_agent:
                if m_agent not in agent_data:
                    agent_data[m_agent] = {
                        'first_time': m_ts, 'last_time': m_ts,
                        'first_idx': idx, 'last_idx': idx,
                        'summaries': [], 'findings': [], 'verdicts': [],
                        'confidence': None, 'tokens': None,
                        'tools': None, 'duration_s': None, 'verdict': None,
                    }
                d = agent_data[m_agent]
                d['last_time'] = m_ts or d['last_time']
                d['last_idx'] = idx
                if m_msg:
                    d['summaries'].append(m_msg)
                # Parse confidence
                conf_m = re.search(r'confidence:\s*(\d+)%', m_msg)
                if conf_m:
                    d['confidence'] = int(conf_m.group(1))
                # Parse token usage from "Complete --" lines
                if m_msg.startswith('Complete --'):
                    tm = re.search(r'tokens:\s*([\d,]+)', m_msg)
                    if tm:
                        d['tokens'] = (d.get('tokens') or 0) + int(tm.group(1).replace(',', ''))
                    tolm = re.search(r'tools:\s*([\d,]+)', m_msg)
                    if tolm:
                        d['tools'] = (d.get('tools') or 0) + int(tolm.group(1).replace(',', ''))
                    durm = re.search(r'duration:\s*([\d,]+)s', m_msg)
                    if durm:
                        d['duration_s'] = (d.get('duration_s') or 0) + int(durm.group(1).replace(',', ''))
                # Parse verdict
                vm = re.match(r'Verdict:\s*(SHIP WITH FIXES|READY WITH CAVEATS|NOT READY|SHIP|BLOCK|READY)', m_msg)
                if vm:
                    d['verdict'] = vm.group(1)
                    d['verdicts'].append(vm.group(1))
                    if m_agent == 'Kobe':
                        verdict_global = vm.group(1)
                verm = re.match(r'Verification:\s*(SHIP|BLOCK)', m_msg)
                if verm:
                    d['verdict'] = verm.group(1)
                    d['verdicts'].append(verm.group(1))
                    if m_agent == 'Kobe':
                        verdict_global = verm.group(1)
                # Parse findings
                finding_prefixes = [
                    ('FINDING [CRITICAL]', 'FINDING [CRITICAL]'),
                    ('FINDING [IMPORTANT]', 'FINDING [IMPORTANT]'),
                    ('FINDING [HIGH]', 'FINDING [HIGH]'),
                    ('FINDING [MEDIUM]', 'FINDING [MEDIUM]'),
                    ('FINDING [LOW]', 'FINDING [LOW]'),
                    ('RULE:', 'RULE'), ('AC:', 'AC'), ('DECISION:', 'DECISION'),
                    ('RISK:', 'RISK'), ('CHANGED:', 'CHANGED'), ('EDGE CASE:', 'EDGE CASE'),
                ]
                for prefix, sev_key in finding_prefixes:
                    if m_msg.startswith(prefix):
                        text = m_msg[len(prefix):].strip().lstrip(':').strip()
                        d['findings'].append({'sev': sev_key, 'text': text, 'agent': m_agent})
                        break
                m_processed_indices.add(idx - 1)  # skip paired o event
            elif mtype == 'human':
                human_events.append({'time': m_ts, 'msg': m_msg, 'idx': idx})
                m_processed_indices.add(idx - 1)  # skip paired o event
            elif mtype == 'event':
                # Task context from event markers
                if m_msg.startswith('TASK CONTEXT:'):
                    task_contexts.append(m_msg[len('TASK CONTEXT:'):].strip())
                    coach_events.append({'time': m_ts or None, 'idx': idx})
                m_processed_indices.add(idx - 1)  # skip paired o event
            elif mtype == 'finish':
                m_processed_indices.add(idx - 1)  # skip paired o event
            continue
        else:
            # Legacy string m event parsing (old .cast files without structured JSON)
            if clean.startswith('Phase') or clean.startswith('Synthesis') or clean.startswith('Quick Fix') or ':' in clean[:30]:
                phase_events.append(clean)
                coach_events.append({'time': None, 'idx': idx})
            continue

    if etype != 'o':
        continue

    # Skip o events already extracted via their paired structured m event
    if idx in m_processed_indices:
        continue

    # Task context
    tc = re.match(r'\[\d{2}:\d{2}:\d{2}\]\s*TASK CONTEXT:\s*(.*)', clean)
    if tc:
        task_contexts.append(tc.group(1).strip())
        tc_time = re.match(r'\[(\d{2}:\d{2}:\d{2})\]', clean)
        coach_events.append({'time': tc_time.group(1) if tc_time else None, 'idx': idx})
        continue

    # Agent event
    am = re.match(r'\[(\d{2}:\d{2}:\d{2})\]\s*\[([A-Za-z][A-Za-z ]*[A-Za-z]|[A-Za-z]+)\]\s*(.*)', clean)
    if am:
        ts_str, name, msg = am.group(1), am.group(2), am.group(3).strip()
        if name not in agent_data:
            agent_data[name] = {
                'first_time': ts_str, 'last_time': ts_str,
                'first_idx': idx, 'last_idx': idx,
                'summaries': [], 'findings': [], 'verdicts': [],
                'confidence': None, 'tokens': None,
                'tools': None, 'duration_s': None, 'verdict': None,
            }
        d = agent_data[name]
        d['last_time'] = ts_str
        d['last_idx'] = idx
        if msg:
            d['summaries'].append(msg)

        # Parse confidence from any "confidence: N%" pattern
        conf_m = re.search(r'confidence:\s*(\d+)%', msg)
        if conf_m:
            d['confidence'] = int(conf_m.group(1))

        # Parse token usage only from "Complete --" lines to avoid stacking accidental matches
        if msg.startswith('Complete --'):
            tm = re.search(r'tokens:\s*([\d,]+)', msg)
            if tm:
                d['tokens'] = (d.get('tokens') or 0) + int(tm.group(1).replace(',', ''))
            tolm = re.search(r'tools:\s*([\d,]+)', msg)
            if tolm:
                d['tools'] = (d.get('tools') or 0) + int(tolm.group(1).replace(',', ''))
            durm = re.search(r'duration:\s*([\d,]+)s', msg)
            if durm:
                d['duration_s'] = (d.get('duration_s') or 0) + int(durm.group(1).replace(',', ''))

        # Parse verdict
        vm = re.match(r'Verdict:\s*(SHIP WITH FIXES|READY WITH CAVEATS|NOT READY|SHIP|BLOCK|READY)', msg)
        if vm:
            d['verdict'] = vm.group(1)
            d['verdicts'].append(vm.group(1))
            if name == 'Kobe':
                verdict_global = vm.group(1)
        # Also catch "Verification: SHIP" pattern
        verm = re.match(r'Verification:\s*(SHIP|BLOCK)', msg)
        if verm:
            d['verdict'] = verm.group(1)
            d['verdicts'].append(verm.group(1))
            if name == 'Kobe':
                verdict_global = verm.group(1)

        # Parse findings
        finding_prefixes = [
            ('FINDING [CRITICAL]', 'FINDING [CRITICAL]'),
            ('FINDING [IMPORTANT]', 'FINDING [IMPORTANT]'),
            ('FINDING [HIGH]', 'FINDING [HIGH]'),
            ('FINDING [MEDIUM]', 'FINDING [MEDIUM]'),
            ('FINDING [LOW]', 'FINDING [LOW]'),
            ('RULE:', 'RULE'),
            ('AC:', 'AC'),
            ('DECISION:', 'DECISION'),
            ('RISK:', 'RISK'),
            ('CHANGED:', 'CHANGED'),
            ('EDGE CASE:', 'EDGE CASE'),
        ]
        for prefix, sev_key in finding_prefixes:
            if msg.startswith(prefix):
                text = msg[len(prefix):].strip().lstrip(':').strip()
                d['findings'].append({'sev': sev_key, 'text': text, 'agent': name})
                break
        continue

    # Human event
    hm = re.match(r'\[(\d{2}:\d{2}:\d{2})\]\s*HUMAN:\s*(.*)', clean)
    if hm:
        human_events.append({'time': hm.group(1), 'msg': hm.group(2).strip(), 'idx': idx})
        continue

    # SESSION COMPLETE for finish time
    if 'SESSION COMPLETE' in clean:
        sm = re.match(r'\[(\d{2}:\d{2}:\d{2})\]', clean)

# Synthesize Coach K entry from coach_events (if not already in agent_data from explicit logging)
if coach_events and 'Coach K' not in agent_data:
    c_indices = [ce['idx'] for ce in coach_events]
    c_times = [ce['time'] for ce in coach_events if ce['time']]
    agent_data['Coach K'] = {
        'first_time': min(c_times) if c_times else None,
        'last_time': max(c_times) if c_times else None,
        'first_idx': min(c_indices),
        'last_idx': max(c_indices),
        'summaries': [], 'findings': [],
        'confidence': None, 'tokens': None,
        'tools': len(coach_events),
        'duration_s': None, 'verdict': None,
    }
# If Coach K was explicitly logged (via "Complete --"), merge in synthesized tools count
elif 'Coach K' in agent_data and not agent_data['Coach K']['tools'] and coach_events:
    agent_data['Coach K']['tools'] = len(coach_events)

# Order participants
participant_order = sorted(agent_data.keys(), key=lambda n: agent_data[n]['first_idx'])

# ── compute timeline fractions (time-proportional with idle-gap compression) ───

def build_time_mapper(agent_data, human_events):
    """Build a function that maps HH:MM:SS -> percentage on compressed timeline."""
    fmt = '%H:%M:%S'

    def to_secs(t):
        d = datetime.datetime.strptime(t, fmt)
        return d.hour * 3600 + d.minute * 60 + d.second

    # Collect all activity intervals (with midnight crossing guard)
    intervals = []
    for name, d in agent_data.items():
        if d['first_time'] and d['last_time']:
            t1 = to_secs(d['first_time'])
            t2 = to_secs(d['last_time'])
            if t2 < t1:
                t2 += 86400  # midnight crossing
            intervals.append((t1, t2))
    for hev in human_events:
        t = to_secs(hev['time'])
        intervals.append((t, t))

    if not intervals:
        return (lambda t: 0.0), [], []

    # Merge overlapping intervals
    intervals.sort()
    merged = [list(intervals[0])]
    for s, e in intervals[1:]:
        if s <= merged[-1][1] + 1:  # allow 1s tolerance
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    # Calculate active time and gaps
    total_active = sum(e - s for s, e in merged)
    if total_active <= 0:
        total_active = 1
    num_gaps = max(len(merged) - 1, 0)
    GAP_PCT = 3.0
    active_pct = 100.0 - num_gaps * GAP_PCT
    if active_pct < 50 and num_gaps:
        GAP_PCT = max((100.0 - 50) / num_gaps, 1.0)
        active_pct = 100.0 - num_gaps * GAP_PCT

    # Build segment map: each merged interval maps to a range of percentages
    segments = []  # (time_start, time_end, pct_start, pct_end)
    pct_cursor = 0.0
    for i, (s, e) in enumerate(merged):
        dur = e - s
        pct_width = (dur / total_active) * active_pct if total_active > 0 else 0
        segments.append((s, e, pct_cursor, pct_cursor + pct_width))
        pct_cursor += pct_width
        if i < len(merged) - 1:
            pct_cursor += GAP_PCT  # gap

    # Store gap positions for rendering gap markers
    gaps = []
    for i in range(len(merged) - 1):
        gap_time_start = merged[i][1]
        gap_time_end   = merged[i + 1][0]
        gap_pct        = segments[i][3]  # right edge of previous segment
        gap_dur        = gap_time_end - gap_time_start
        gaps.append({'pct': gap_pct, 'dur_s': gap_dur, 'gap_width': GAP_PCT})

    def time_to_pct(time_str):
        t = to_secs(time_str)
        # Midnight crossing: if t falls before the first segment and the
        # session spans past midnight (last segment end > 86400), wrap t.
        if t < segments[0][0] and segments[-1][1] > 86400:
            t += 86400
        for ts, te, ps, pe in segments:
            if ts <= t <= te:
                if te == ts:
                    return ps
                frac = (t - ts) / (te - ts)
                return ps + frac * (pe - ps)
        # Before first segment
        if t < segments[0][0]:
            return 0.0
        # After last segment
        return segments[-1][3]

    return time_to_pct, gaps, segments

time_to_pct, timeline_gaps, timeline_segments = build_time_mapper(agent_data, human_events)

# ── compute session metrics ───────────────────────────────────────────────────

def _m_event_msg(ev):
    """Extract the searchable message string from an m event's data payload."""
    d = ev[2] if len(ev) > 2 else ''
    if isinstance(d, dict):
        return d.get('msg', '')
    if isinstance(d, str):
        try:
            parsed = json.loads(d)
            if isinstance(parsed, dict):
                return parsed.get('msg', '')
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
        return d
    return ''

escalation_count = sum(1 for ev in raw_events if ev[1] == 'm' and 'ESCALATION' in _m_event_msg(ev))
fix_verify_count = sum(1 for ev in raw_events if ev[1] == 'm' and 'Fix-Verify' in _m_event_msg(ev))

# Wall clock
all_first = [agent_data[n]['first_time'] for n in agent_data if agent_data[n]['first_time']]
all_last  = [agent_data[n]['last_time']  for n in agent_data if agent_data[n]['last_time']]
wall_start = min(all_first) if all_first else None
wall_end   = max(all_last)  if all_last  else None

def time_diff_min(t1, t2):
    try:
        fmt = '%H:%M:%S'
        d1 = datetime.datetime.strptime(t1, fmt)
        d2 = datetime.datetime.strptime(t2, fmt)
        diff = d2 - d1
        # Midnight crossing guard: if t2 < t1, assume next day
        if diff.total_seconds() < 0:
            diff = diff + datetime.timedelta(seconds=86400)
        return int(diff.total_seconds() // 60)
    except:
        return 0

wall_clock_str = ''
if wall_start and wall_end:
    mins = time_diff_min(wall_start, wall_end)
    if mins > 0:
        wall_clock_str = f'{mins}m'
    else:
        wall_clock_str = '< 1m'

# Resolve each agent's model once to avoid redundant filesystem I/O across both loops
agent_models = {name: resolve_model(name, agents_dir) for name in agent_data}

# Token usage and cost — per-model blended rates (see MODEL_RATES above)
total_tokens = sum(d['tokens'] for d in agent_data.values() if d['tokens'])
total_cost = sum(
    (d['tokens'] / 1_000_000) * MODEL_RATES.get(agent_models[name], DEFAULT_RATE)
    for name, d in agent_data.items()
    if d['tokens']
) if total_tokens else 0

# Compute Coach K duration as wall-clock minus all agent durations
if 'Coach K' in agent_data and wall_start and wall_end and not agent_data['Coach K']['duration_s']:
    try:
        fmt = '%H:%M:%S'
        total_wall_s = int((datetime.datetime.strptime(wall_end, fmt) - datetime.datetime.strptime(wall_start, fmt)).total_seconds())
        other_agent_s = sum(d['duration_s'] or 0 for n, d in agent_data.items() if n != 'Coach K')
        coach_dur = max(total_wall_s - other_agent_s, 0)
        if coach_dur > 0:
            agent_data['Coach K']['duration_s'] = coach_dur
    except:
        pass

# Time axis labels
def build_time_axis():
    if not all_first or not all_last:
        return []
    try:
        fmt = '%H:%M:%S'
        t0 = datetime.datetime.strptime(wall_start, fmt)
        t1 = datetime.datetime.strptime(wall_end, fmt)
        dur = (t1 - t0).total_seconds()
        if dur <= 0:
            return [wall_start[:5], wall_end[:5]]
        steps = 5
        axis = []
        for i in range(steps + 1):
            t = t0 + datetime.timedelta(seconds=dur * i / steps)
            axis.append(t.strftime('%H:%M'))
        return axis
    except:
        return []

time_axis = build_time_axis()

# ── collect all findings across all agents ────────────────────────────────────

all_findings = []
finding_counter = {}
for name in participant_order:
    d = agent_data[name]
    prefix = name[0].upper()
    finding_counter[name] = finding_counter.get(name, 0)
    for f in d['findings']:
        finding_counter[name] += 1
        f['id'] = f'{prefix}{finding_counter[name]}'
        # Determine status for actionable findings only
        if f['sev'].startswith('FINDING'):
            # Use the finding agent's own verdict if they have one (Kobe, Pippen),
            # otherwise fall back to the global verdict (for Bird, MJ findings)
            verdict = agent_data[name].get('verdict', '') or verdict_global or ''
            if fix_verify_count > 0 and verdict in ('SHIP', 'READY'):
                f['status'] = 'FIXED'
            elif verdict in ('SHIP WITH FIXES', 'BLOCK', 'NOT READY'):
                f['status'] = 'OPEN'
            else:
                f['status'] = None
        else:
            f['status'] = None
        all_findings.append(f)

# ── collect changed files ─────────────────────────────────────────────────────

changed_files = []
for name in participant_order:
    for f in agent_data[name]['findings']:
        if f['sev'] == 'CHANGED':
            parts = f['text'].split(' -- ', 1)
            path = parts[0].strip()
            desc = parts[1].strip() if len(parts) > 1 else ''
            changed_files.append({'path': path, 'desc': desc})

# ── collect carry-forward items ───────────────────────────────────────────────

cf_items = []
for name in participant_order:
    for s in agent_data[name]['summaries']:
        if 'carry-forward' in s.lower() or re.search(r'\bCF-\d+', s):
            cf_items.append({'agent': name, 'text': s})

# ── Magic retro sections ──────────────────────────────────────────────────────

magic_what_happened = ''
magic_went_well = ''
magic_watch = ''
magic_calibration = ''

if 'Magic' in agent_data:
    combined = ' '.join(s for s in agent_data['Magic']['summaries'] if not s.startswith('Complete') and not s.startswith('Starting'))
    wh = re.search(r"What happened[:\s]+(.*?)(?=What went well|What to watch|Confidence calibration|$)", combined, re.IGNORECASE | re.DOTALL)
    ww = re.search(r"What went well[:\s]+(.*?)(?=What happened|What to watch|Confidence calibration|$)", combined, re.IGNORECASE | re.DOTALL)
    wt = re.search(r"What to watch[:\s]+(.*?)(?=What happened|What went well|Confidence calibration|$)", combined, re.IGNORECASE | re.DOTALL)
    cc = re.search(r"Confidence calibration[:\s]+(.*?)$", combined, re.IGNORECASE | re.DOTALL)
    if wh: magic_what_happened = wh.group(1).strip()
    if ww: magic_went_well = ww.group(1).strip()
    if wt: magic_watch = wt.group(1).strip()
    if cc: magic_calibration = cc.group(1).strip()

# ── build time axis string ────────────────────────────────────────────────────

meta_time = ''
if wall_start and wall_end:
    meta_time = f'{wall_start[:5]} &mdash; {wall_end[:5]}'
    if wall_clock_str:
        meta_time += f' ({wall_clock_str})'

meta_agents = f'{len(agent_data)} agents'
meta_human = f'{len(human_events)} human checkpoint{"s" if len(human_events) != 1 else ""}'

# ── verdict badge HTML ────────────────────────────────────────────────────────

def verdict_badge_html(v):
    if not v:
        return ''
    cls = 'verdict-ship' if 'SHIP' in v or v == 'READY' else 'verdict-block'
    return f'<div class="verdict-badge {cls}">{h(v)}</div>'

# ── CSS ───────────────────────────────────────────────────────────────────────

CSS = """
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-2: #1c2128;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #7d8590;
    --text-muted: #484f58;
    --bird: #3fb950;
    --bird-bg: rgba(63,185,80,0.1);
    --mj: #58a6ff;
    --mj-bg: rgba(88,166,255,0.1);
    --shaq: #bc8cff;
    --shaq-bg: rgba(188,140,255,0.1);
    --kobe: #f85149;
    --kobe-bg: rgba(248,81,73,0.1);
    --pippen: #39d2c0;
    --pippen-bg: rgba(57,210,192,0.1);
    --magic: #d29922;
    --magic-bg: rgba(210,153,34,0.1);
    --coach: #e8638c;
    --human: #f0f6fc;
    --critical: #f85149;
    --important: #d29922;
    --medium: #d29922;
    --low: #7d8590;
    --ship: #3fb950;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  code, .mono { font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace; }
  a { color: var(--mj); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .header { padding: 40px 48px 32px; border-bottom: 1px solid var(--border); }
  .header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .header h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
  .verdict-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; flex-shrink: 0; }
  .verdict-ship { background: rgba(63,185,80,0.12); color: var(--ship); border: 1px solid rgba(63,185,80,0.3); }
  .verdict-block { background: rgba(248,81,73,0.12); color: var(--critical); border: 1px solid rgba(248,81,73,0.3); }
  .meta-row { display: flex; flex-wrap: wrap; gap: 20px; color: var(--text-dim); font-size: 13px; margin-bottom: 16px; }
  .meta-row span { display: flex; align-items: center; gap: 6px; }
  .context-block { padding: 14px 18px; background: var(--surface-2); border-left: 3px solid var(--text-muted); border-radius: 0 6px 6px 0; font-size: 14px; color: var(--text-dim); line-height: 1.7; }
  .section { padding: 32px 48px; border-bottom: 1px solid var(--border); overflow-x: clip; }
  .section-title { font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px; }
  .timeline-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .track-row { display: grid; grid-template-columns: 80px 1fr; border-bottom: 1px solid var(--border); }
  .track-row:last-child { border-bottom: none; }
  .track-row.human-row { background: rgba(240, 246, 252, 0.03); }
  .track-row.axis-row { background: var(--surface-2); border-top: 1px solid var(--border); }
  .track-label { padding: 0 10px 0 14px; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid var(--border); display: flex; align-items: center; font-family: 'SF Mono','Fira Code','Cascadia Code',monospace; }
  .track-label.bird { color: var(--bird); }
  .track-label.coach { color: var(--coach); }
  .track-label.shaq { color: var(--shaq); }
  .track-label.kobe { color: var(--kobe); }
  .track-label.mj { color: var(--mj); }
  .track-label.magic { color: var(--magic); }
  .track-label.pippen { color: var(--pippen); }
  .track-label.human { color: var(--human); }
  .track-label.axis { color: var(--text-muted); font-size: 10px; font-weight: 400; }
  .track-area { position: relative; height: 52px; padding: 0; }
  .track-area::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(to right, transparent, transparent calc(25% - 1px), var(--surface-2) calc(25% - 1px), var(--surface-2) 25%); pointer-events: none; opacity: 0.6; }
  .bar { position: absolute; bottom: 8px; height: 18px; border-radius: 3px; min-width: 12px; max-width: 100%; }
  .bar.bird { background: var(--bird); }
  .bar.coach { background: var(--coach); }
  .bar.shaq { background: var(--shaq); }
  .bar.kobe { background: var(--kobe); }
  .bar.mj { background: var(--mj); }
  .bar.magic { background: var(--magic); }
  .bar.pippen { background: var(--pippen); }
  .bar.human { background: transparent; border: 1px dashed rgba(240, 246, 252, 0.35); }
  .annotation { position: absolute; bottom: 30px; display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; pointer-events: none; }
  .annotation .ann-time { font-size: 9px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .annotation .ann-dur { font-size: 9px; color: var(--text-muted); }
  .annotation .ann-role { font-size: 9px; color: var(--text-dim); }
  .annotation .ann-sep { font-size: 9px; color: var(--text-muted); }
  .axis-area { position: relative; height: 28px; }
  .axis-tick { position: absolute; top: 0; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); }
  .axis-tick .tick-line { width: 1px; height: 6px; background: var(--border); }
  .axis-tick .tick-label { font-size: 9px; color: var(--text-muted); margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .agent-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .agent-card-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; }
  .agent-name { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; }
  .agent-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .agent-role { color: var(--text-dim); font-weight: 400; font-size: 13px; margin-left: 4px; }
  .agent-meta { display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--text-dim); }
  .confidence-pill { padding: 3px 10px; border-radius: 10px; background: rgba(255,255,255,0.06); font-size: 11px; font-family: 'SF Mono','Fira Code',monospace; }
  .verdict-pill { padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 700; background: rgba(63,185,80,0.12); color: var(--ship); }
  .agent-card-body { padding: 4px 20px 16px; border-top: 1px solid var(--border); }
  .agent-narrative { font-size: 14px; line-height: 1.7; color: var(--text-dim); padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .agent-narrative:last-child { border-bottom: none; }
  .finding { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; line-height: 1.5; }
  .finding:last-child { border-bottom: none; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; flex-shrink: 0; letter-spacing: 0.3px; margin-top: 2px; white-space: nowrap; }
  .badge-critical { background: rgba(248,81,73,0.15); color: var(--critical); }
  .badge-important { background: rgba(210,153,34,0.15); color: var(--important); }
  .badge-medium { background: rgba(210,153,34,0.15); color: var(--medium); }
  .badge-low { background: rgba(125,133,144,0.15); color: var(--low); }
  .badge-rule { background: rgba(88,166,255,0.08); color: var(--mj); }
  .badge-ac { background: rgba(63,185,80,0.08); color: var(--bird); }
  .badge-decision { background: rgba(88,166,255,0.12); color: var(--mj); }
  .badge-risk { background: rgba(248,81,73,0.08); color: var(--critical); }
  .badge-changed { background: rgba(188,140,255,0.1); color: var(--shaq); }
  .badge-edge { background: rgba(248,81,73,0.08); color: var(--critical); border: 1px solid rgba(248,81,73,0.15); }
  .finding-text { color: var(--text); }
  .human-card { background: transparent; border: 1px dashed rgba(240,246,252,0.15); border-radius: 8px; padding: 14px 20px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; }
  .human-dot-inline { width: 8px; height: 8px; border-radius: 50%; background: var(--human); opacity: 0.5; flex-shrink: 0; }
  .human-label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .human-text { font-size: 14px; color: var(--human); opacity: 0.85; }
  .human-time { font-size: 11px; color: var(--text-muted); margin-left: auto; font-family: 'SF Mono','Fira Code',monospace; flex-shrink: 0; }
  .findings-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .findings-table th { text-align: left; padding: 10px 14px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  .findings-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
  .findings-table tr:hover { background: rgba(255,255,255,0.01); }
  .file-ref { font-family: 'SF Mono','Fira Code',monospace; font-size: 12px; color: var(--mj); background: rgba(88,166,255,0.06); padding: 1px 6px; border-radius: 4px; }
  .file-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .file-card-header { padding: 10px 16px; display: flex; align-items: center; gap: 10px; font-family: 'SF Mono','Fira Code',monospace; font-size: 13px; }
  .file-icon { color: var(--text-dim); font-size: 14px; }
  .file-card-body { padding: 8px 16px 12px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-dim); line-height: 1.6; }
  .cf-item { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--text-muted); border-radius: 0 8px 8px 0; padding: 14px 18px; margin-bottom: 8px; }
  .cf-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .cf-id { font-family: 'SF Mono','Fira Code',monospace; font-size: 11px; color: var(--text-muted); background: rgba(255,255,255,0.04); padding: 2px 8px; border-radius: 4px; }
  .cf-text { font-size: 13px; line-height: 1.6; }
  .lineup-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .lineup-table th { text-align: left; padding: 10px 14px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  .lineup-table th:first-child, .lineup-table td:first-child { padding-left: 0; }
  .lineup-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 32px; }
  .stat { display: flex; flex-direction: column; gap: 4px; cursor: help; position: relative; }
  .stat .stat-tooltip { display: none; position: absolute; bottom: calc(100% + 8px); left: 0; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: var(--text-dim); white-space: nowrap; z-index: 100; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  .stat .stat-tooltip::after { content: ''; position: absolute; top: 100%; left: 16px; border: 5px solid transparent; border-top-color: var(--border); }
  .stat:hover .stat-tooltip { display: block; }
  .stat-value { font-size: 22px; font-weight: 700; font-family: 'SF Mono','Fira Code',monospace; }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .token-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 24px; }
  .token-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .token-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .recording-link { padding: 20px 48px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-dim); display: flex; align-items: center; gap: 8px; }
  .recording-link code { background: var(--surface); padding: 3px 8px; border-radius: 4px; font-size: 12px; color: var(--text); }
  .status-fixed { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; background: rgba(63,185,80,0.15); color: var(--ship); }
  .status-open { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; background: rgba(248,81,73,0.15); color: var(--critical); }
"""

# ── generate HTML ─────────────────────────────────────────────────────────────

out = []
out.append('<!DOCTYPE html>')
out.append('<html lang="en">')
out.append('<head>')
out.append('<meta charset="UTF-8">')
out.append('<meta name="viewport" content="width=device-width, initial-scale=1.0">')
out.append(f'<title>Dream Team Session: {h(title)}</title>')
out.append(f'<style>{CSS}</style>')
out.append('</head>')
out.append('<body>')

# ── Header ────────────────────────────────────────────────────────────────────
out.append('<div class="header">')
out.append('  <div class="header-top">')
out.append('    <div>')
out.append(f'    <h1>{h(title)}</h1>')
out.append('    <div class="meta-row">')
if session_date: out.append(f'      <span>{h(session_date)}</span>')
if meta_time:    out.append(f'      <span>{meta_time}</span>')
out.append(f'      <span>{h(meta_agents)} &middot; {h(meta_human)}</span>')
out.append('    </div>')
out.append('    </div>')
out.append('  </div>')
if task_contexts:
    out.append('  <div class="context-block">')
    out.append('<br>'.join(h(tc) for tc in task_contexts))
    out.append('  </div>')
out.append('</div>')

# ── Lineup Card (merged with Session Metrics) ─────────────────────────────────
out.append('<div class="section">')
out.append('  <div class="section-title">Lineup Card</div>')

# Stats grid first
out.append('  <div class="stats-grid">')
out.append(f'    <div class="stat"><span class="stat-tooltip">Total events logged in the recording</span><span class="stat-value">{total_event_count}</span><span class="stat-label">Events</span></div>')
out.append(f'    <div class="stat"><span class="stat-tooltip">AI agents that participated in this session</span><span class="stat-value">{len(agent_data)}</span><span class="stat-label">Agents</span></div>')
out.append(f'    <div class="stat"><span class="stat-tooltip">Points where a human reviewed and approved</span><span class="stat-value">{len(human_events)}</span><span class="stat-label">Human Checkpoints</span></div>')
out.append(f'    <div class="stat"><span class="stat-tooltip">Issues agents couldn\'t resolve alone and escalated to Coach K</span><span class="stat-value">{escalation_count}</span><span class="stat-label">Escalations</span></div>')
out.append(f'    <div class="stat"><span class="stat-tooltip">Rounds of Shaq fixing + Kobe/Pippen re-verifying</span><span class="stat-value">{fix_verify_count}</span><span class="stat-label">Fix-Verify Loops</span></div>')
if wall_clock_str:
    out.append(f'    <div class="stat"><span class="stat-tooltip">Real elapsed time from first to last event</span><span class="stat-value">{h(wall_clock_str)}</span><span class="stat-label">Wall Clock</span></div>')
if verdict_global:
    v_color = 'var(--ship)' if 'SHIP' in verdict_global or verdict_global == 'READY' else 'var(--critical)'
    out.append(f'    <div class="stat"><span class="stat-tooltip">Final quality gate decision from Kobe</span><span class="stat-value" style="color:{v_color}">{h(verdict_global)}</span><span class="stat-label">Verdict</span></div>')
out.append('  </div>')

# Combined lineup + token table
out.append('  <table class="lineup-table" style="margin-top:24px">')
out.append('    <thead><tr>')
out.append('      <th>Agent</th><th>Role</th><th>Confidence</th><th>Tokens</th><th>Tools</th><th>Duration</th><th>Est. Cost</th>')
out.append('    </tr></thead>')
out.append('    <tbody>')
total_tools = 0
total_dur_s = 0
for name in participant_order:
    d = agent_data[name]
    color_var = AGENT_CSS_VAR.get(name, 'var(--text)')
    role = AGENT_ROLES.get(name, '')
    conf = f'{d["confidence"]}%' if d['confidence'] else '&mdash;'
    toks = d['tokens'] or 0
    toks_str = f'{toks:,}' if toks else '&mdash;'
    tools_val = d['tools']
    tools_str = str(tools_val) if tools_val else '&mdash;'
    dur_str = fmt_duration(d['duration_s'])
    agent_rate = MODEL_RATES.get(agent_models[name], DEFAULT_RATE)
    cost = toks / 1_000_000 * agent_rate if toks else 0
    cost_str = f'${cost:.3f}' if toks else '&mdash;'
    total_tools += tools_val or 0
    total_dur_s += d['duration_s'] or 0
    out.append('      <tr>')
    out.append(f'        <td style="color:{color_var}">{h(name)}</td>')
    out.append(f'        <td>{h(role)}</td>')
    out.append(f'        <td>{conf}</td>')
    out.append(f'        <td class="mono">{toks_str}</td>')
    out.append(f'        <td class="mono">{tools_str}</td>')
    out.append(f'        <td class="mono">{dur_str}</td>')
    out.append(f'        <td class="mono">{cost_str}</td>')
    out.append('      </tr>')
if total_tokens:
    out.append('      <tr style="border-top:2px solid var(--border);font-weight:600">')
    out.append(f'        <td colspan="3">Total</td>')
    out.append(f'        <td class="mono">{total_tokens:,}</td>')
    out.append(f'        <td class="mono">{total_tools if total_tools else "&mdash;"}</td>')
    out.append(f'        <td class="mono">{fmt_duration(total_dur_s) if total_dur_s else "&mdash;"}</td>')
    out.append(f'        <td class="mono">${total_cost:.3f}</td>')
    out.append('      </tr>')
out.append('    </tbody></table>')
out.append('</div>')

# ── Timeline (Option B: Time-Proportional Bars) ─────────────────────────────
out.append('<div class="section">')
out.append('  <div class="section-title">Timeline</div>')
out.append('  <div class="timeline-container">')

# CSS class for agent label coloring (lowercase, no spaces)
AGENT_CSS_CLASS = {
    'Bird': 'bird', 'MJ': 'mj', 'Shaq': 'shaq', 'Kobe': 'kobe',
    'Pippen': 'pippen', 'Magic': 'magic', 'Coach K': 'coach', 'Human': 'human',
}

# Build ordered list of timeline rows: agents + human + coach K segments
timeline_rows = []
for name in participant_order:
    d = agent_data[name]
    timeline_rows.append({'type': 'agent', 'name': name, 'start_idx': d['first_idx']})

# Collect all occupied intervals (agent bars + human events) sorted by start
occupied = []
for name in participant_order:
    d = agent_data[name]
    occupied.append({'start_idx': d['first_idx'], 'end_idx': d['last_idx'], 'start_time': d['first_time'], 'end_time': d['last_time']})
for hev in human_events:
    occupied.append({'start_idx': hev['idx'], 'end_idx': hev['idx'], 'start_time': hev['time'], 'end_time': hev['time']})
occupied.sort(key=lambda x: x['start_idx'])

# For human rows: bar spans from previous event to human event (shows wait time)
for i, hev in enumerate(human_events):
    prev_idx = hev['idx']
    prev_time = None
    for occ in reversed(occupied):
        if occ['end_idx'] < hev['idx']:
            prev_idx = occ['end_idx']
            prev_time = occ['end_time']
            break
    hev['prev_idx'] = prev_idx
    hev['prev_time'] = prev_time
    if prev_time:
        try:
            fmt = '%H:%M:%S'
            t0 = datetime.datetime.strptime(prev_time, fmt)
            t1 = datetime.datetime.strptime(hev['time'], fmt)
            wait_secs = int((t1 - t0).total_seconds())
            hev['wait_str'] = fmt_duration(wait_secs) if wait_secs > 0 else ''
        except:
            hev['wait_str'] = ''
    else:
        hev['wait_str'] = ''
    timeline_rows.append({'type': 'human', 'hev': hev, 'start_idx': hev['prev_idx']})

# Coach K segments: gaps between occupied intervals where Coach K is orchestrating
# Merge overlapping occupied intervals first
merged_occ = []
for occ in occupied:
    if merged_occ and occ['start_idx'] <= merged_occ[-1]['end_idx'] + 1:
        if occ['end_idx'] > merged_occ[-1]['end_idx']:
            merged_occ[-1]['end_idx'] = occ['end_idx']
            merged_occ[-1]['end_time'] = occ['end_time']
    else:
        merged_occ.append(dict(occ))

coach_segments = []
for i in range(len(merged_occ) - 1):
    gap_start = merged_occ[i]['end_idx']
    gap_end = merged_occ[i + 1]['start_idx']
    if gap_end - gap_start > 1:
        t_start = merged_occ[i]['end_time']
        t_end = merged_occ[i + 1]['start_time']
        dur_str = ''
        if t_start and t_end:
            try:
                fmt = '%H:%M:%S'
                secs = int((datetime.datetime.strptime(t_end, fmt) - datetime.datetime.strptime(t_start, fmt)).total_seconds())
                dur_str = fmt_duration(secs) if secs > 0 else ''
            except:
                pass
        coach_segments.append({'start_idx': gap_start, 'end_idx': gap_end, 'start_time': t_start, 'end_time': t_end, 'dur_str': dur_str})
        timeline_rows.append({'type': 'coach', 'seg': coach_segments[-1], 'start_idx': gap_start})

timeline_rows.sort(key=lambda r: r['start_idx'])

# ── Consolidated swimlane rendering ──────────────────────────────────────────
# Instead of one row per event, render one row per swimlane (agent/Human/Coach K)
# with multiple bars inside the same track-area.

# Build swimlane order: agents by first appearance, then Human, then Coach K
swimlane_order = []
for row in timeline_rows:
    if row['type'] == 'agent' and row['name'] not in swimlane_order:
        swimlane_order.append(row['name'])
# Interleave Human row after the agent it follows (based on first human checkpoint position)
human_rows = [r for r in timeline_rows if r['type'] == 'human']
coach_rows = [r for r in timeline_rows if r['type'] == 'coach']

# Collect bars for each swimlane
agent_bars = {}  # name -> already rendered via single bar from first_time to last_time
human_bars = []
coach_bars = []

for row in timeline_rows:
    if row['type'] == 'human':
        hev = row['hev']
        start_pct = time_to_pct(hev['prev_time']) if hev.get('prev_time') else 0.0
        end_pct   = time_to_pct(hev['time']) if hev.get('time') else 100.0
        width_pct = max(end_pct - start_pct, 2)
        human_bars.append({'start': start_pct, 'width': width_pct, 'hev': hev})
    elif row['type'] == 'coach':
        seg = row['seg']
        start_pct = time_to_pct(seg['start_time']) if seg.get('start_time') else 0.0
        end_pct   = time_to_pct(seg['end_time']) if seg.get('end_time') else 100.0
        width_pct = max(end_pct - start_pct, 2)
        coach_bars.append({'start': start_pct, 'width': width_pct, 'seg': seg})

# Ensure bar is visible: enforce minimum width, shift left if needed to stay in bounds
def clamp_bar(left, width):
    min_w = 3.0
    width = max(width, min_w)
    left = min(left, 100.0 - min_w)
    if left + width > 100.0:
        left = max(0.0, 100.0 - width)
    return left, width

# Render agent rows (one row per agent, single bar; skip Coach K — shown via gap segments)
for name in swimlane_order:
    if name == 'Coach K':
        continue
    d = agent_data[name]
    css_cls = AGENT_CSS_CLASS.get(name, '')
    start_pct = time_to_pct(d['first_time']) if d['first_time'] else 0.0
    end_pct   = time_to_pct(d['last_time']) if d['last_time'] else 100.0
    width_pct = max(end_pct - start_pct, 2)
    start_pct, width_pct = clamp_bar(start_pct, width_pct)
    t_first = (d['first_time'] or '')[:5]
    t_last  = (d['last_time']  or '')[:5]
    ann_time = t_first if t_first == t_last else f'{t_first}\u2013{t_last}'
    ann_dur = fmt_duration(d['duration_s']) if d['duration_s'] else ''
    ann_role = ''
    if d.get('verdicts') and len(d['verdicts']) > 1:
        unique_verdicts = list(dict.fromkeys(d['verdicts']))
        ann_role = ' \u2192 '.join(unique_verdicts) if len(unique_verdicts) > 1 else unique_verdicts[0]
    elif d['verdict']:
        ann_role = d['verdict']
    else:
        ann_role = AGENT_ROLES.get(name, name)

    # Position annotation above the (possibly shifted) bar
    bar_left, bar_width = clamp_bar(start_pct, width_pct)
    if bar_left > 50:
        # Anchor at right edge of bar, items flow right-to-left
        right_val = max(0.5, 100.0 - bar_left - bar_width)
        ann_style = f'right: {right_val:.1f}%; flex-direction: row-reverse;'
    else:
        ann_style = f'left: {bar_left:.1f}%;'

    out.append(f'  <div class="track-row">')
    out.append(f'    <div class="track-label {css_cls}">{h(name)}</div>')
    out.append(f'    <div class="track-area">')
    out.append(f'      <div class="annotation" style="{ann_style}">')
    out.append(f'        <span class="ann-time">{h(ann_time)}</span>')
    if ann_dur:
        out.append(f'        <span class="ann-sep">&middot;</span>')
        out.append(f'        <span class="ann-dur">{ann_dur}</span>')
    if ann_role:
        out.append(f'        <span class="ann-sep">&middot;</span>')
        out.append(f'        <span class="ann-role">{h(ann_role)}</span>')
    out.append(f'      </div>')
    out.append(f'      <div class="bar {css_cls}" style="left: {start_pct:.1f}%; width: {width_pct:.1f}%;"></div>')
    out.append(f'    </div>')
    out.append(f'  </div>')

# Render consolidated Human row (one row, multiple bars)
if human_bars:
    out.append(f'  <div class="track-row human-row">')
    out.append(f'    <div class="track-label human">Human</div>')
    out.append(f'    <div class="track-area">')
    first = human_bars[0]
    total_checkpoints = len(human_bars)
    ann_text = f'{total_checkpoints} checkpoint{"s" if total_checkpoints != 1 else ""}'
    out.append(f'      <div class="annotation" style="left: {first["start"]:.1f}%; max-width: 30%;">')
    out.append(f'        <span class="ann-role">{h(ann_text)}</span>')
    out.append(f'      </div>')
    for bar in human_bars:
        bl, bw = clamp_bar(bar['start'], bar['width'])
        out.append(f'      <div class="bar human" style="left: {bl:.1f}%; width: {bw:.1f}%;"></div>')
    out.append(f'    </div>')
    out.append(f'  </div>')

# Render consolidated Coach K row (one row, multiple bars)
if coach_bars:
    out.append(f'  <div class="track-row">')
    out.append(f'    <div class="track-label coach">Coach K</div>')
    out.append(f'    <div class="track-area">')
    first_c = coach_bars[0]
    out.append(f'      <div class="annotation" style="left: {first_c["start"]:.1f}%; max-width: 30%;">')
    out.append(f'        <span class="ann-role">Orchestration</span>')
    out.append(f'      </div>')
    for bar in coach_bars:
        bl, bw = clamp_bar(bar['start'], bar['width'])
        out.append(f'      <div class="bar coach" style="left: {bl:.1f}%; width: {bw:.1f}%;"></div>')
    out.append(f'    </div>')
    out.append(f'  </div>')

# Time axis row with tick marks
if timeline_segments:
    out.append('  <div class="track-row axis-row">')
    out.append('    <div class="track-label axis">time</div>')
    out.append('    <div class="axis-area">')
    rendered_ticks = set()
    for ts_start, ts_end, pct_start, pct_end in timeline_segments:
        h_s = int(ts_start // 3600)
        m_s = int((ts_start % 3600) // 60)
        label_s = f'{h_s:02d}:{m_s:02d}'
        if label_s not in rendered_ticks:
            out.append(f'      <div class="axis-tick" style="left: {pct_start:.1f}%;"><div class="tick-line"></div><div class="tick-label">{h(label_s)}</div></div>')
            rendered_ticks.add(label_s)
        h_e = int(ts_end // 3600)
        m_e = int((ts_end % 3600) // 60)
        label_e = f'{h_e:02d}:{m_e:02d}'
        if label_e not in rendered_ticks:
            # Last tick at 99% to avoid overflow
            pct_val = min(pct_end, 99.0)
            out.append(f'      <div class="axis-tick" style="left: {pct_val:.1f}%;"><div class="tick-line"></div><div class="tick-label">{h(label_e)}</div></div>')
            rendered_ticks.add(label_e)
    out.append('    </div>')
    out.append('  </div>')

out.append('  </div>')  # close timeline-container
out.append('</div>')  # close section

# ── Agent Activity ────────────────────────────────────────────────────────────
out.append('<div class="section">')
out.append('  <div class="section-title">Agent Activity</div>')

for name in participant_order:
    if name == 'Coach K':
        continue  # Coach K shown in lineup + timeline only
    d = agent_data[name]
    color_var = AGENT_CSS_VAR.get(name, 'var(--text)')
    role = AGENT_ROLES.get(name, '')
    t_first = (d['first_time'] or '')[:5]
    t_last  = (d['last_time']  or '')[:5]
    time_str = t_first if t_first == t_last else f'{t_first} &mdash; {t_last}'

    out.append('  <div class="agent-card">')
    out.append('    <div class="agent-card-header">')
    out.append('      <div class="agent-name">')
    out.append(f'        <div class="agent-dot" style="background:{color_var}"></div>')
    out.append(f'        {h(name)}')
    if role:
        out.append(f'        <span class="agent-role">&mdash; {h(role)}</span>')
    out.append('      </div>')
    out.append('      <div class="agent-meta">')
    if d['confidence']:
        out.append(f'        <span class="confidence-pill">{d["confidence"]}%</span>')
    if d['verdict']:
        v_label = d['verdict']
        v_style = 'color:var(--ship)' if 'SHIP' in v_label or v_label == 'READY' else 'color:var(--critical)'
        out.append(f'        <span class="verdict-pill" style="{v_style}">{h(v_label)}</span>')
    out.append(f'        <span>{time_str}</span>')
    out.append('      </div>')
    out.append('    </div>')
    out.append('    <div class="agent-card-body">')

    # Magic gets special retro rendering
    if name == 'Magic' and (magic_what_happened or magic_went_well or magic_watch):
        if magic_what_happened:
            out.append(f'      <div class="agent-narrative"><strong>What happened:</strong> {h(magic_what_happened)}</div>')
        if magic_went_well:
            out.append(f'      <div class="agent-narrative"><strong>What went well:</strong> {h(magic_went_well)}</div>')
        if magic_watch:
            out.append(f'      <div class="agent-narrative"><strong>What to watch:</strong> {h(magic_watch)}</div>')
        if magic_calibration:
            out.append(f'      <div class="agent-narrative"><strong>Confidence calibration:</strong> {h(magic_calibration)}</div>')
    else:
        # Narrative: first Task: line, or first non-metadata summary
        narrative = ''
        for s in d['summaries']:
            if s.startswith('Task:'):
                narrative = s[5:].strip()
                break
        if not narrative:
            for s in d['summaries']:
                if not s.startswith('Complete') and not s.startswith('Starting') and not s.startswith('Verdict:') and not s.startswith('Verification:'):
                    narrative = s
                    break
        if narrative:
            out.append(f'      <div class="agent-narrative">{h(narrative)}</div>')

    # Findings
    for f in d['findings']:
        sev = f['sev']
        bc = badge_class(sev)
        bl = badge_label(sev)
        out.append('      <div class="finding">')
        out.append(f'        <span class="badge badge-{bc}">{h(bl)}</span>')
        out.append(f'        <span class="finding-text">{h(f["text"])}</span>')
        out.append('      </div>')

    out.append('    </div>')
    out.append('  </div>')

    # Insert human checkpoint cards after the agent whose last_idx precedes them
    for hev in human_events:
        next_agent_idx = None
        for n2 in participant_order:
            if agent_data[n2]['first_idx'] > hev['idx']:
                next_agent_idx = n2
                break
        prev_agent = None
        for n2 in participant_order:
            if agent_data[n2]['last_idx'] <= hev['idx']:
                prev_agent = n2
        if prev_agent == name:
            out.append('  <div class="human-card">')
            out.append('    <div class="human-dot-inline"></div>')
            out.append('    <div>')
            out.append('      <div class="human-label">Human Checkpoint</div>')
            out.append(f'      <div class="human-text">{h(hev["msg"])}</div>')
            out.append('    </div>')
            out.append(f'    <div class="human-time">{h(hev["time"][:5])}</div>')
            out.append('  </div>')

out.append('</div>')

# ── All Findings ──────────────────────────────────────────────────────────────
if all_findings:
    out.append('<div class="section">')
    out.append('  <div class="section-title">All Findings</div>')
    out.append('  <table class="findings-table">')
    out.append('    <thead><tr>')
    out.append('      <th style="width:30px">#</th>')
    out.append('      <th style="width:60px">Agent</th>')
    out.append('      <th style="width:100px">Type</th>')
    out.append('      <th>Finding</th>')
    out.append('      <th style="width:70px">Status</th>')
    out.append('    </tr></thead>')
    out.append('    <tbody>')
    for f in all_findings:
        color_var = AGENT_CSS_VAR.get(f['agent'], 'var(--text)')
        bc = badge_class(f['sev'])
        bl = badge_label(f['sev'])
        status = f.get('status')
        if status == 'FIXED':
            status_html = '<span class="status-fixed">Fixed</span>'
        elif status == 'OPEN':
            status_html = '<span class="status-open">Open</span>'
        else:
            status_html = ''
        out.append('      <tr>')
        out.append(f'        <td style="color:var(--text-muted)">{h(f["id"])}</td>')
        out.append(f'        <td style="color:{color_var}">{h(f["agent"])}</td>')
        out.append(f'        <td><span class="badge badge-{bc}">{h(bl)}</span></td>')
        out.append(f'        <td>{h(f["text"])}</td>')
        out.append(f'        <td>{status_html}</td>')
        out.append('      </tr>')
    out.append('    </tbody></table>')
    out.append('</div>')

# ── Files Changed ─────────────────────────────────────────────────────────────
if changed_files:
    out.append('<div class="section">')
    out.append('  <div class="section-title">Files Changed</div>')
    for cf in changed_files:
        out.append('  <div class="file-card">')
        out.append('    <div class="file-card-header">')
        out.append('      <span class="file-icon">+</span>')
        out.append(f'      <span>{h(cf["path"])}</span>')
        out.append('    </div>')
        if cf['desc']:
            out.append(f'    <div class="file-card-body">{h(cf["desc"])}</div>')
        out.append('  </div>')
    out.append('</div>')

# ── Carry-Forward ─────────────────────────────────────────────────────────────
if cf_items:
    out.append('<div class="section">')
    out.append('  <div class="section-title">Carry-Forward Items</div>')
    for i, cf in enumerate(cf_items, 1):
        out.append('  <div class="cf-item">')
        out.append('    <div class="cf-header">')
        out.append(f'      <span class="cf-id">CF-{i}</span>')
        agent_color_cf = AGENT_CSS_VAR.get(cf["agent"], "var(--text)")
        out.append(f'      <span style="color:{agent_color_cf};font-size:12px">{h(cf["agent"])}</span>')
        out.append('    </div>')
        out.append(f'    <div class="cf-text">{h(cf["text"])}</div>')
        out.append('  </div>')
    out.append('</div>')

# ── Recording Link ────────────────────────────────────────────────────────────
import os
out.append('<div class="recording-link">')
if asciinema_url:
    out.append(f'  Session recording: <a href="{h(asciinema_url)}" target="_blank" rel="noopener">{h(asciinema_url)}</a>')
else:
    out.append(f'  Session recording: <code>{h(os.path.basename(cast_file))}</code>')
out.append('</div>')

out.append('</body>')
out.append('</html>')

# Write output
with open(out_file, 'w') as f:
    f.write('\n'.join(out))

print(out_file)
PYEOF

  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    echo "ERROR: export-html failed (exit code $exit_code)" >&2
    return $exit_code
  fi
}

# Strip idle gaps from a recording, producing a contiguous playback file
cmd_strip_idle() {
  local file="$1"
  shift
  local threshold=30

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --threshold)
        threshold="$2"
        shift 2
        ;;
      *)
        echo "ERROR: Unknown option $1" >&2
        return 1
        ;;
    esac
  done

  # Validate threshold is a positive number
  if ! python3 -c "import sys; t=float(sys.argv[1]); assert t > 0" "$threshold" 2>/dev/null; then
    echo "ERROR: --threshold must be a positive number, got: $threshold" >&2
    return 1
  fi

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  local out_file="${file}.stripped.cast"

  python3 -c "
import json, sys

cast_file = sys.argv[1]
out_file  = sys.argv[2]
threshold = float(sys.argv[3])

with open(cast_file) as f:
    header_line = f.readline()
    header = json.loads(header_line)
    events = []
    skipped = 0
    for line_num, line in enumerate(f, 2):
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 3:
                events.append(ev)
            else:
                skipped += 1
                print(f'WARNING: strip-idle: skipped malformed event at line {line_num}', file=sys.stderr)
        except Exception:
            skipped += 1
            print(f'WARNING: strip-idle: skipped unparseable event at line {line_num}', file=sys.stderr)

if skipped:
    print(f'WARNING: strip-idle: {skipped} event(s) skipped total', file=sys.stderr)

if not events:
    # Write header only
    with open(out_file, 'w') as f:
        f.write(header_line)
    print(out_file)
    sys.exit(0)

# Compute cumulative time, identify gaps > threshold, and remove gap time
# Each event's delta is ev[0]. Cumulative time builds from deltas.
cumulative = 0.0
cum_times = []
for ev in events:
    cumulative += ev[0]
    cum_times.append(cumulative)

# Identify gaps: intervals where a single delta > threshold
total_removed = 0.0
adjusted_deltas = []
for i, ev in enumerate(events):
    delta = ev[0]
    if delta > threshold:
        # Compress: keep a small residual (0.5s) to show transition
        removed = delta - 0.5
        adjusted_deltas.append(0.5)
        total_removed += removed
    else:
        adjusted_deltas.append(delta)

# Write output
# NOTE: strip-idle only adjusts the asciicast delta (ev[0]) for playback timing.
# The ts field inside structured m event JSON payloads is intentionally preserved
# as-is because it records the real wall-clock timestamp for reporting accuracy.
with open(out_file, 'w') as f:
    f.write(header_line)
    for i, ev in enumerate(events):
        ev_out = [adjusted_deltas[i]] + ev[1:]
        f.write(json.dumps(ev_out) + '\n')

print(out_file)
" "$file" "$out_file" "$threshold"
}

# Merge marker events from sidecar into an existing asciinema cast file.
# The cast file already has properly timed "o" events from asciinema rec.
# We just insert "m" events at the right cumulative timestamps.
_merge_markers() {
  local file="$1" markers="$2"

  # Skip if no markers
  if [[ ! -s "$markers" ]]; then
    return 0
  fi

  python3 - "$file" "$markers" << 'PYEOF'
import json, sys

cast_file = sys.argv[1]
markers_file = sys.argv[2]

# Read existing cast file (header + o events from asciinema rec)
with open(cast_file) as f:
    lines = f.readlines()

header = lines[0]
hdr = json.loads(header)
is_v3 = hdr.get('version', 0) == 3

events = []
for line in lines[1:]:
    line = line.strip()
    if not line:
        continue
    try:
        events.append(json.loads(line))
    except:
        pass

# Read markers — deltas are ABSOLUTE (seconds from session start)
markers = []
with open(markers_file) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            m = json.loads(line)
            data = m.get('data', m.get('label', ''))
            markers.append([m['delta'], 'm', data])
        except:
            pass

# NOTE: v3 uses relative deltas, v2 uses cumulative timestamps.
# Marker deltas are absolute from session start. The merge logic
# converts v3 relative deltas to cumulative before sorting with markers,
# then converts back to relative deltas.
if is_v3:
    # v3 events use RELATIVE deltas. Markers use ABSOLUTE from start.
    # Convert v3 to cumulative, merge, sort, convert back to relative.
    cumulative = 0.0
    for ev in events:
        cumulative += ev[0]
        ev[0] = cumulative
    all_events = events + markers
    all_events.sort(key=lambda e: e[0])
    prev = 0.0
    for ev in all_events:
        cur = ev[0]
        ev[0] = round(cur - prev, 6)
        prev = cur
else:
    # v2: timestamps already cumulative — merge and sort directly
    all_events = events + markers
    all_events.sort(key=lambda e: e[0])

# Write back
with open(cast_file, 'w') as f:
    f.write(header)
    for ev in all_events:
        f.write(json.dumps(ev) + '\n')

print(f"Merged {len(markers)} markers into recording ({len(events)} events)")
PYEOF
}

# LEGACY/UNUSED: This function is not called anywhere. cmd_rec uses _merge_markers instead. Kept for reference; safe to remove.
_merge_recording() {
  local file="$1" raw="$2" markers="$3" start_epoch="$4"

  python3 - "$file" "$raw" "$markers" "$start_epoch" << 'PYEOF'
import json, sys, os

cast_file = sys.argv[1]
raw_file = sys.argv[2]
markers_file = sys.argv[3]
start_epoch = float(sys.argv[4])

# Read header (first line, already written by cmd_rec)
with open(cast_file) as f:
    header_line = f.readline()

# Read raw script output
raw_text = ''
if os.path.exists(raw_file):
    with open(raw_file, 'rb') as f:
        raw_text = f.read().decode('utf-8', errors='replace')

# Read marker events from sidecar
marker_events = []
if os.path.exists(markers_file):
    with open(markers_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
                marker_events.append(m)
            except:
                pass

# Determine session duration from markers or raw output
if marker_events:
    session_duration = max(m['delta'] for m in marker_events)
else:
    # Estimate from raw output size (rough: 1 second per 500 chars, min 1s)
    session_duration = max(1.0, len(raw_text) / 500.0)

# Split raw output into chunks by newlines
chunks = []
if raw_text:
    lines = raw_text.split('\n')
    for i, line in enumerate(lines):
        if i < len(lines) - 1:
            chunks.append(line + '\n')
        elif line:  # last line, no trailing newline if empty
            chunks.append(line)

# Distribute chunk timestamps proportionally across session duration
all_events = []
if chunks:
    n = len(chunks)
    for i, chunk in enumerate(chunks):
        if n == 1:
            t = 0.001
        else:
            t = (i / (n - 1)) * session_duration
            if t < 0.001:
                t = 0.001
        all_events.append((t, 'o', chunk))

# Add marker events as m events (v2 format: cumulative timestamp)
for m in marker_events:
    all_events.append((m['delta'], 'm', m['label']))

# Sort all events by timestamp
all_events.sort(key=lambda e: e[0])

# Write header + all events to cast file (v2 cumulative format)
with open(cast_file, 'w') as f:
    # Rewrite header as v2
    hdr = json.loads(header_line)
    v2_hdr = {"version": 2}
    term = hdr.get("term", {})
    v2_hdr["width"] = term.get("cols", 120)
    v2_hdr["height"] = term.get("rows", 40)
    if "timestamp" in hdr:
        v2_hdr["timestamp"] = hdr["timestamp"]
    if "title" in hdr:
        v2_hdr["title"] = hdr["title"]
    if "env" in hdr:
        v2_hdr["env"] = hdr["env"]
    f.write(json.dumps(v2_hdr) + '\n')
    for t, etype, data in all_events:
        f.write(json.dumps([round(t, 6), etype, data]) + '\n')
PYEOF
}

# Record a real terminal session via script(1) with marker sidecar.
# Usage: cast.sh rec <file> <title> -- <command...>
cmd_rec() {
  local file="$1"; shift
  local title="$1"; shift

  # Skip the -- separator if present
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi

  if [[ $# -eq 0 ]]; then
    echo "ERROR: rec requires a command to run. Usage: cast.sh rec <file> <title> -- <command...>" >&2
    return 1
  fi

  if ! command -v asciinema &>/dev/null; then
    echo "ERROR: asciinema is required for rec. Install: pip install asciinema" >&2
    return 1
  fi

  local dir
  dir=$(dirname "$file")
  mkdir -p "$dir"

  # Create sidecar for markers and rec signal file
  local markers_file="${file}.markers"
  local rec_file
  rec_file=$(_rec_signal_file)
  : > "$markers_file"

  local start_epoch
  start_epoch=$(python3 -c "import time; print(f'{time.time():.6f}')")

  # Write rec signal file — cast.sh commands check for this to detect rec mode
  # Line 1: start epoch, Line 2: markers sidecar path, Line 3: PID
  printf '%s\n%s\n%s\n' "$start_epoch" "$markers_file" "$$" > "$rec_file"

  # Cleanup trap — removes signal file if session is interrupted (Ctrl+C, crash)
  trap "rm -f '$rec_file' '$markers_file'" EXIT INT TERM

  # Use asciinema rec — captures real terminal with proper timing natively
  # --cols/--rows: force PTY size so the app adapts its layout for clean playback
  #   (210 cols makes web player text tiny and breaks TUI positioning on narrow viewports)
  # --idle-time-limit: cap idle gaps at 5s in the recording for better pacing
  # --overwrite: asciinema writes its own header + events; any prior file content is intentionally replaced
  local rec_cols="${REC_COLS:-120}"
  local rec_rows="${REC_ROWS:-40}"
  local rec_idle="${REC_IDLE_LIMIT:-5}"
  local exit_code=0
  asciinema rec --overwrite --cols "$rec_cols" --rows "$rec_rows" --idle-time-limit "$rec_idle" --title "$title" -c "$*" "$file" || exit_code=$?

  # Remove rec signal file (stops rec mode detection)
  rm -f "$rec_file"
  trap - EXIT INT TERM

  # Merge markers into the asciinema-produced cast file
  _merge_markers "$file" "$markers_file"

  # Clean up temp files
  rm -f "$markers_file"

  echo "Recording saved: $file"
  return $exit_code
}

# Wrap a command with real terminal capture via script(1).
# Usage: cast.sh wrap <file> <command...>
# CAST_FILE env var is exported for the child process.
# Note: rec-mode detection uses .cast-rec-active signal files, not CAST_FILE.
# Real terminal output is captured by script(1) and merged on exit.
cmd_wrap() {
  local file="$1"; shift
  if [[ $# -eq 0 ]]; then
    echo "ERROR: wrap requires a command to run. Usage: cast.sh wrap <file> <command...>" >&2
    return 1
  fi

  local dir
  dir=$(dirname "$file")
  mkdir -p "$dir"

  local title="${CAST_TITLE:-Dream Team Session}"
  local ts
  ts=$(date +%s)
  local title_json
  title_json=$(escape_json "$title")

  # Write asciicast header
  echo "{\"version\":3,\"term\":{\"cols\":120,\"rows\":40},\"timestamp\":${ts},\"title\":${title_json},\"env\":{\"SHELL\":\"$SHELL\"}}" > "$file"

  local raw_file="${file}.raw"

  # Run the command inside script(1) for real terminal capture
  CAST_FILE="$file" script -q "$raw_file" "$@"
  local exit_code=$?

  # Convert raw script output to asciicast "o" events and merge with existing m events
  python3 -c "
import json, sys, os, time

cast_file = sys.argv[1]
raw_file  = sys.argv[2]

# Read existing events (m events written by cast.sh commands during the wrapped session)
with open(cast_file) as f:
    header_line = f.readline()
    m_events = []
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, list) and len(ev) >= 3:
                m_events.append(ev)
        except:
            pass

# Read raw script output as a single block
raw_text = ''
if os.path.exists(raw_file):
    with open(raw_file, 'rb') as f:
        raw_text = f.read().decode('utf-8', errors='replace')

# Write merged output: header + raw output as single o event + m events
with open(cast_file, 'w') as f:
    f.write(header_line)
    if raw_text:
        f.write(json.dumps([0.001, 'o', raw_text]) + '\n')
    for ev in m_events:
        f.write(json.dumps(ev) + '\n')

# Clean up raw file
os.remove(raw_file)
" "$file" "$raw_file"

  return $exit_code
}

# ── Main dispatch ──
case "${1:-}" in
  init)        cmd_init "$2" "${3:-}" ;;
  event)       cmd_event "$2" "$3" ;;
  marker)      cmd_marker "$2" "$3" ;;
  phase)       cmd_phase "$2" "$3" ;;
  agent)       cmd_agent "$2" "$3" "$4" ;;
  human)       cmd_human "$2" "$3" ;;
  finish)      cmd_finish "$2" ;;
  reopen)      cmd_reopen "$2" ;;
  upload)      cmd_upload "$2" "${3:-}" ;;
  validate)    cmd_validate "$2" ;;
  duration)    cmd_duration "$2" ;;
  timeline)    cmd_timeline "$2" ;;
  preview)     cmd_preview "$2" ;;
  export-html) cmd_export_html "$2" "${3:-}" ;;
  strip-idle)  cmd_strip_idle "$2" "${@:3}" ;;
  wrap)        cmd_wrap "$2" "${@:3}" ;;
  rec)         cmd_rec "$2" "$3" "${@:4}" ;;
  *)
    echo "Usage: cast.sh {init|event|marker|phase|agent|human|finish|reopen|upload|validate|duration|timeline|preview|export-html|strip-idle|wrap|rec} <file> [args...]" >&2
    exit 1
    ;;
esac
