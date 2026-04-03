#!/bin/bash
# Dream Team Installer — thin wrapper around install.ts
# Preserves muscle memory: `bash scripts/install.sh` still works
command -v bun >/dev/null 2>&1 || { echo "Error: Bun is required. Install: https://bun.sh" >&2; exit 1; }
exec bun "$(dirname "$0")/install.ts" "$@"
