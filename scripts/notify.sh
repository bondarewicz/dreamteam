#!/bin/bash
# notify.sh — Cross-OS notification for Claude Code hooks
# Usage: notify.sh "message" ["subtitle"]
#
# Uses CLAUDE_TAB env var for tab identification.
# Falls back to "Claude Code" if unset.

MSG="${1:-Waiting for input}"
TAB="${CLAUDE_TAB:-Claude Code}"

case "$(uname -s)" in
  Darwin)
    osascript -e "display notification \"$MSG\" with title \"Claude Code\" subtitle \"$TAB\"" 2>/dev/null
    ;;
  Linux)
    if command -v notify-send >/dev/null 2>&1; then
      notify-send "Claude Code — $TAB" "$MSG" 2>/dev/null
    fi
    ;;
esac
