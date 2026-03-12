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
#
# State is tracked in <file>.state (stores last event timestamp as float seconds).
# Intervals are float seconds per asciicast v3 spec.

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
# Returns a fixed 0.100s delay for line-by-line scrolling.
# Writes real wall-clock timestamp to state file for duration reporting.
interval_secs() {
  local cast_file="$1"
  local current
  current=$(now_secs)

  # Store real wall-clock timestamp for reporting accuracy
  write_last_ts "$cast_file" "$current"

  echo "0.100"
}

# Wall-clock timestamp for log-style output
timestamp() {
  date '+%H:%M:%S'
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
    "Coach K") printf '\033[38;2;224;148;64m' ;;
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

  # Opening banner — prominent SESSION START
  local ts_str
  ts_str=$(timestamp)
  local heavy_sep
  heavy_sep=$(escape_json_line $'\033[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m')
  local bl
  bl=$(escape_json_line $'\033[1;37m  SESSION START: '"$title"$'\033[0m')
  local blank
  blank=$(escape_json_line "")
  echo "[0.000, \"o\", ${heavy_sep}]" >> "$file"
  echo "[0.100, \"o\", ${bl}]" >> "$file"
  echo "[0.100, \"o\", ${heavy_sep}]" >> "$file"
  echo "[0.100, \"o\", ${blank}]" >> "$file"

  echo "$file"
}

cmd_event() {
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
  local line data
  # TASK CONTEXT lines use dim color
  if [[ "$text" == TASK\ CONTEXT:* ]]; then
    line=$'\033[2m'"[$ts] $text"$'\033[0m'
  else
    line="[$ts] $text"
  fi
  data=$(escape_json_line "$line")
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
  local marker_data
  marker_data=$(escape_json "$label")
  echo "[${delta}, \"m\", ${marker_data}]" >> "$file"
  local blank
  blank=$(escape_json_line "")

  # Workflow header (Quick Fix, Full Team, PR Review) gets a prominent banner
  if [[ "$label" == Quick\ Fix:* || "$label" == Full\ Team:* || "$label" == PR\ Review:* ]]; then
    local heavy_sep
    heavy_sep=$(escape_json_line $'\033[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m')
    echo "[${delta}, \"o\", ${blank}]" >> "$file"
    echo "[${delta}, \"o\", ${heavy_sep}]" >> "$file"
    local banner
    banner=$(escape_json_line $'\033[1;37m  '"$label"$'\033[0m')
    echo "[${delta}, \"o\", ${banner}]" >> "$file"
    echo "[${delta}, \"o\", ${heavy_sep}]" >> "$file"
    echo "[${delta}, \"o\", ${blank}]" >> "$file"
  else
    # Regular phase: dim thin separators
    local sep
    sep=$(escape_json_line $'\033[2m────────────────────────────────────────────────────────────────────\033[0m')
    echo "[${delta}, \"o\", ${blank}]" >> "$file"
    echo "[${delta}, \"o\", ${sep}]" >> "$file"
    local banner
    banner=$(escape_json_line $'\033[1;37m'"[$ts] $label"$'\033[0m')
    echo "[${delta}, \"o\", ${banner}]" >> "$file"
    echo "[${delta}, \"o\", ${sep}]" >> "$file"
    echo "[${delta}, \"o\", ${blank}]" >> "$file"
  fi
}

cmd_agent() {
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
  local color
  color=$(agent_color "$name")
  local reset
  reset=$(printf '\033[0m')
  # Color severity badges within the message body
  local colored_msg
  colored_msg=$(color_badges "$msg")
  local line data
  if [[ -n "$color" ]]; then
    line="${color}[$ts] [$name]${reset} ${colored_msg}"
  else
    line="[$ts] [$name] ${colored_msg}"
  fi
  data=$(escape_json_line "$line")
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

# Human events: compute delta once, reuse for both marker and banner (AC8)
cmd_human() {
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
  local marker_data
  marker_data=$(escape_json "Human: $msg")
  echo "[${delta}, \"m\", ${marker_data}]" >> "$file"
  local data
  data=$(escape_json_line $'\033[1;97m'"[$ts] HUMAN: $msg"$'\033[0m')
  echo "[${delta}, \"o\", ${data}]" >> "$file"
}

cmd_finish() {
  local file="$1"

  if grep -q '"x"' "$file"; then
    echo "WARNING: $file already has an exit event. Use 'reopen' first." >&2
    return 1
  fi

  local ts_str
  ts_str=$(timestamp)
  local delta bl
  delta=$(interval_secs "$file")
  bl=$(escape_json_line $'\033[1;37m'"[$ts_str] SESSION COMPLETE"$'\033[0m')
  echo "[${delta}, \"o\", ${bl}]" >> "$file"

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

  # Check if file has an exit event -- if not, it's already open (AC5)
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

  # Add continuation marker -- single delta for both events (AC8 pattern)
  local ts_str bl delta
  ts_str=$(timestamp)
  delta=$(interval_secs "$file")
  echo "[${delta}, \"m\", \"Session continued\"]" >> "$file"
  bl=$(escape_json_line "[$ts_str] SESSION CONTINUED")
  echo "[${delta}, \"o\", ${bl}]" >> "$file"

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

  if ! grep -q '"x"' "$file"; then
    echo "ERROR: Cast file is not complete (no exit event). Run 'finish' first." >&2
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

# Export cast file to standalone HTML report
cmd_export_html() {
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

for idx, ev in enumerate(raw_events):
    etype = ev[1]
    data  = ev[2] if len(ev) > 2 else ''

    if not isinstance(data, str):
        continue

    clean = strip_ansi(data).replace('\r\n', '').replace('\r', '').replace('\n', '').strip()

    if etype == 'm':
        if clean.startswith('Phase') or clean.startswith('Synthesis') or clean.startswith('Quick Fix') or ':' in clean[:30]:
            phase_events.append(clean)
            # Phase transitions are Coach K orchestration
            tm_m = re.match(r'\[?(\d{2}:\d{2}:\d{2})\]?', clean)
            coach_events.append({'time': None, 'idx': idx})
        continue

    if etype != 'o':
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
                'summaries': [], 'findings': [],
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
            if not verdict_global and name == 'Kobe':
                verdict_global = vm.group(1)
        # Also catch "Verification: SHIP" pattern
        verm = re.match(r'Verification:\s*(SHIP|BLOCK)', msg)
        if verm:
            d['verdict'] = verm.group(1)

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

# ── compute timeline fractions ────────────────────────────────────────────────

all_times = []
for name, d in agent_data.items():
    all_times.append(d['first_idx'])
    all_times.append(d['last_idx'])
for h_ev in human_events:
    all_times.append(h_ev['idx'])

min_idx = min(all_times) if all_times else 0
max_idx = max(all_times) if all_times else 1
span = max(max_idx - min_idx, 1)

def to_pct(idx):
    return round((idx - min_idx) / span * 100, 1)

# ── compute session metrics ───────────────────────────────────────────────────

escalation_count = sum(1 for ev in raw_events if ev[1] == 'm' and isinstance(ev[2], str) and 'ESCALATION' in ev[2])
fix_verify_count = sum(1 for ev in raw_events if ev[1] == 'm' and isinstance(ev[2], str) and 'Fix-Verify' in ev[2])

# Wall clock
all_first = [agent_data[n]['first_time'] for n in agent_data if agent_data[n]['first_time']]
all_last  = [agent_data[n]['last_time']  for n in agent_data if agent_data[n]['last_time']]
wall_start = min(all_first) if all_first else None
wall_end   = max(all_last)  if all_last  else None

def time_diff_min(t1, t2):
    try:
        fmt = '%H:%M:%S'
        d = datetime.datetime.strptime(t2, fmt) - datetime.datetime.strptime(t1, fmt)
        return int(d.total_seconds() // 60)
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
  .section { padding: 32px 48px; border-bottom: 1px solid var(--border); }
  .section-title { font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px; }
  .timeline { position: relative; padding: 8px 0; }
  .timeline-row { display: flex; align-items: center; height: 40px; gap: 14px; }
  .timeline-label { width: 64px; font-size: 13px; font-weight: 600; text-align: right; flex-shrink: 0; font-family: 'SF Mono','Fira Code',monospace; }
  .timeline-track { flex: 1; height: 26px; position: relative; background: rgba(255,255,255,0.02); border-radius: 4px; }
  .timeline-bar { position: absolute; height: 100%; border-radius: 4px; opacity: 0.8; min-width: 8px; }
  .timeline-info { width: 340px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .timeline-time { font-size: 11px; color: var(--text-dim); font-family: 'SF Mono','Fira Code',monospace; width: 100px; flex-shrink: 0; }
  .timeline-summary { font-size: 12px; color: var(--text-dim); }
  .human-marker { position: absolute; top: -6px; width: 2px; height: calc(100% + 12px); background: var(--human); opacity: 0.25; z-index: 10; }
  .time-axis { display: flex; align-items: center; gap: 14px; margin-top: 8px; padding-left: 78px; }
  .time-axis-track { flex: 1; display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); font-family: 'SF Mono','Fira Code',monospace; }
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
  .lineup-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 32px; }
  .stat { display: flex; flex-direction: column; gap: 4px; }
  .stat-value { font-size: 22px; font-weight: 700; font-family: 'SF Mono','Fira Code',monospace; }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .token-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 24px; }
  .token-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; }
  .token-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .recording-link { padding: 20px 48px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-dim); display: flex; align-items: center; gap: 8px; }
  .recording-link code { background: var(--surface); padding: 3px 8px; border-radius: 4px; font-size: 12px; color: var(--text); }
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
out.append(f'    <div class="stat"><span class="stat-value">{total_event_count}</span><span class="stat-label">Events</span></div>')
out.append(f'    <div class="stat"><span class="stat-value">{len(agent_data)}</span><span class="stat-label">Agents</span></div>')
out.append(f'    <div class="stat"><span class="stat-value">{len(human_events)}</span><span class="stat-label">Human Checkpoints</span></div>')
out.append(f'    <div class="stat"><span class="stat-value">{escalation_count}</span><span class="stat-label">Escalations</span></div>')
out.append(f'    <div class="stat"><span class="stat-value">{fix_verify_count}</span><span class="stat-label">Fix-Verify Loops</span></div>')
if wall_clock_str:
    out.append(f'    <div class="stat"><span class="stat-value">{h(wall_clock_str)}</span><span class="stat-label">Wall Clock</span></div>')
if verdict_global:
    v_color = 'var(--ship)' if 'SHIP' in verdict_global or verdict_global == 'READY' else 'var(--critical)'
    out.append(f'    <div class="stat"><span class="stat-value" style="color:{v_color}">{h(verdict_global)}</span><span class="stat-label">Verdict</span></div>')
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

# ── Timeline ──────────────────────────────────────────────────────────────────
out.append('<div class="section">')
out.append('  <div class="section-title">Timeline</div>')
out.append('  <div class="timeline">')

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
merged = []
for occ in occupied:
    if merged and occ['start_idx'] <= merged[-1]['end_idx'] + 1:
        if occ['end_idx'] > merged[-1]['end_idx']:
            merged[-1]['end_idx'] = occ['end_idx']
            merged[-1]['end_time'] = occ['end_time']
    else:
        merged.append(dict(occ))

# Coach K fills the gaps between merged intervals
coach_segments = []
for i in range(len(merged) - 1):
    gap_start = merged[i]['end_idx']
    gap_end = merged[i + 1]['start_idx']
    if gap_end - gap_start > 1:  # meaningful gap
        t_start = merged[i]['end_time']
        t_end = merged[i + 1]['start_time']
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

human_counter = 0
for row in timeline_rows:
    if row['type'] == 'agent':
        name = row['name']
        d = agent_data[name]
        color_var = AGENT_CSS_VAR.get(name, 'var(--text)')
        start_pct = to_pct(d['first_idx'])
        end_pct   = to_pct(d['last_idx'])
        width_pct = max(end_pct - start_pct, 2)
        t_first = (d['first_time'] or '')[:5]
        t_last  = (d['last_time']  or '')[:5]
        if t_first == t_last:
            time_str = t_first
        else:
            time_str = f'{t_first} &mdash; {t_last}'

        # Summary: show verdict if available, otherwise role label
        completion = ''
        if d['verdict']:
            completion = f'Verdict: {d["verdict"]}'
        else:
            completion = AGENT_ROLES.get(name, name)

        out.append('    <div class="timeline-row">')
        out.append(f'      <div class="timeline-label" style="color:{color_var}">{h(name)}</div>')
        out.append('      <div class="timeline-track">')
        out.append(f'        <div class="timeline-bar" style="left:{start_pct}%;width:{width_pct}%;background:{color_var};"></div>')
        out.append('      </div>')
        out.append('      <div class="timeline-info">')
        out.append(f'        <div class="timeline-time">{time_str}</div>')
        out.append(f'        <div class="timeline-summary" style="color:{color_var}">{h(completion)}</div>')
        out.append('      </div>')
        out.append('    </div>')
    elif row['type'] == 'human':
        hev = row['hev']
        human_counter = human_counter + 1
        start_pct = to_pct(hev['prev_idx'])
        end_pct   = to_pct(hev['idx'])
        width_pct = max(end_pct - start_pct, 2)
        time_str = hev['time'][:5]
        wait_label = f' ({hev["wait_str"]})' if hev.get('wait_str') else ''

        out.append('    <div class="timeline-row">')
        out.append(f'      <div class="timeline-label" style="color:var(--human)">Human</div>')
        out.append('      <div class="timeline-track">')
        out.append(f'        <div class="timeline-bar" style="left:{start_pct}%;width:{width_pct}%;background:var(--human);opacity:0.3;"></div>')
        out.append('      </div>')
        out.append('      <div class="timeline-info">')
        out.append(f'        <div class="timeline-time">{time_str}{wait_label}</div>')
        out.append(f'        <div class="timeline-summary" style="color:var(--human);opacity:0.7">Checkpoint #{human_counter}</div>')
        out.append('      </div>')
        out.append('    </div>')
    elif row['type'] == 'coach':
        seg = row['seg']
        start_pct = to_pct(seg['start_idx'])
        end_pct   = to_pct(seg['end_idx'])
        width_pct = max(end_pct - start_pct, 2)
        t_start = (seg['start_time'] or '')[:5]
        t_end = (seg['end_time'] or '')[:5]
        if t_start == t_end:
            time_str = t_start
        else:
            time_str = f'{t_start} &mdash; {t_end}'
        dur_label = f' ({seg["dur_str"]})' if seg.get('dur_str') else ''

        out.append('    <div class="timeline-row">')
        out.append(f'      <div class="timeline-label" style="color:var(--coach)">Coach K</div>')
        out.append('      <div class="timeline-track">')
        out.append(f'        <div class="timeline-bar" style="left:{start_pct}%;width:{width_pct}%;background:var(--coach);opacity:0.4;"></div>')
        out.append('      </div>')
        out.append('      <div class="timeline-info">')
        out.append(f'        <div class="timeline-time">{time_str}{dur_label}</div>')
        out.append(f'        <div class="timeline-summary" style="color:var(--coach)">Orchestration</div>')
        out.append('      </div>')
        out.append('    </div>')

out.append('  </div>')
if time_axis:
    out.append('  <div class="time-axis">')
    out.append('    <div class="time-axis-track">')
    for t in time_axis:
        out.append(f'      <span>{h(t)}</span>')
    out.append('    </div>')
    out.append('  </div>')
out.append('</div>')

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
                if not s.startswith('Complete') and not s.startswith('Starting'):
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
    out.append('    </tr></thead>')
    out.append('    <tbody>')
    for f in all_findings:
        color_var = AGENT_CSS_VAR.get(f['agent'], 'var(--text)')
        bc = badge_class(f['sev'])
        bl = badge_label(f['sev'])
        out.append('      <tr>')
        out.append(f'        <td style="color:var(--text-muted)">{h(f["id"])}</td>')
        out.append(f'        <td style="color:{color_var}">{h(f["agent"])}</td>')
        out.append(f'        <td><span class="badge badge-{bc}">{h(bl)}</span></td>')
        out.append(f'        <td>{h(f["text"])}</td>')
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

# --- Main dispatch ---
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
  *)
    echo "Usage: cast.sh {init|event|marker|phase|agent|human|finish|reopen|upload|validate|duration|timeline|preview|export-html} <file> [args...]" >&2
    exit 1
    ;;
esac
