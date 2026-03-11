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

interval_secs() {
  local cast_file="$1"
  local current
  current=$(now_secs)
  local last
  last=$(read_last_ts "$cast_file")
  local delta
  delta=$(python3 -c "print(f'{$current - $last:.3f}')")
  write_last_ts "$cast_file" "$current"
  echo "$delta"
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

cmd_phase() {
  local file="$1"
  local label="$2"
  cmd_marker "$file" "$label"
  local banner
  banner=$(escape_json "$(printf '\r\n┌─────────────────────────────────────────────────────────────┐\r\n│  ▶ %s\r\n└─────────────────────────────────────────────────────────────┘\r\n\r\n' "$label")")
  local delta
  delta=$(interval_secs "$file")
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

cmd_human() {
  local file="$1"
  local msg="$2"
  cmd_marker "$file" "Human: $msg"
  local delta
  delta=$(interval_secs "$file")
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

cmd_reopen() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file does not exist" >&2
    return 1
  fi

  # Remove the exit event and session complete banner (last 2 lines)
  local line_count
  line_count=$(wc -l < "$file")
  local keep=$(( line_count - 2 ))
  head -n "$keep" "$file" > "$file.tmp" && mv "$file.tmp" "$file"

  # Restore state file with current timestamp
  write_last_ts "$file" "$(now_secs)"

  # Add continuation marker
  local banner
  banner=$(escape_json "$(printf '\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n  🔄 SESSION CONTINUED — %s\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n' "$(date '+%Y-%m-%d %H:%M:%S')")")
  local delta
  delta=$(interval_secs "$file")
  echo "[${delta}, \"m\", \"Session continued\"]" >> "$file"
  delta=$(interval_secs "$file")
  echo "[${delta}, \"o\", ${banner}]" >> "$file"

  echo "$file"
}

cmd_upload() {
  local file="$1"
  local title="${2:-}"
  local args=(upload --visibility unlisted)
  if [[ -n "$title" ]]; then
    args+=(--title "$title")
  fi
  args+=("$file")
  asciinema "${args[@]}" 2>&1 | grep -o 'https://[^ ]*'
}

# --- Main dispatch ---
case "${1:-}" in
  init)   cmd_init "$2" "${3:-}" ;;
  event)  cmd_event "$2" "$3" ;;
  marker) cmd_marker "$2" "$3" ;;
  phase)  cmd_phase "$2" "$3" ;;
  agent)  cmd_agent "$2" "$3" "$4" ;;
  human)  cmd_human "$2" "$3" ;;
  finish) cmd_finish "$2" ;;
  reopen) cmd_reopen "$2" ;;
  upload) cmd_upload "$2" "${3:-}" ;;
  *)
    echo "Usage: cast.sh {init|event|marker|phase|agent|human|finish|reopen|upload} <file> [args...]" >&2
    exit 1
    ;;
esac
