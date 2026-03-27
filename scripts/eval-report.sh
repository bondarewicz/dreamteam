#!/usr/bin/env bash
# eval-report.sh -- Dream Team eval report runner
#
# Populates the web app DB via migration, then opens the web app at localhost:3000.
# The web app is the single source of truth for eval results.
#
# Usage:
#   eval-report.sh generate              Migrate JSON results into DB and open localhost:3000
#   eval-report.sh list                  List available eval result runs (reads JSON)
#
# Requirements:
#   - bun (for DB migration)
#   - python3 (for list subcommand JSON parsing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
RESULTS_DIR="${REPO_ROOT}/evals/results"
MIGRATE_SCRIPT="${REPO_ROOT}/web/src/migrate.ts"

# ── Subcommand: list ──────────────────────────────────────────────────────────

cmd_list() {
  if [[ ! -d "$RESULTS_DIR" ]]; then
    echo "No results directory found at: $RESULTS_DIR"
    return 0
  fi

  local files
  files=$(ls -1 "${RESULTS_DIR}"/*.json 2>/dev/null || true)

  if [[ -z "$files" ]]; then
    echo "No result files found in: $RESULTS_DIR"
    return 0
  fi

  echo "Available eval runs:"
  echo ""

  command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required for list subcommand" >&2; exit 1; }

  python3 -c "
import json, os, sys, glob

results_dir = sys.argv[1]
files = sorted(glob.glob(os.path.join(results_dir, '*.json')))

for fpath in files:
    try:
        with open(fpath) as f:
            data = json.load(f)
        run_id = data.get('run_id', 'unknown')
        date = data.get('date', '')[:10]
        is_baseline = data.get('is_complete_baseline', False)
        # Recompute from actual results — never trust summary field
        results_list = data.get('results', [])
        pass_count = sum(1 for r in results_list if r.get('score') == 'pass')
        partial_count = sum(1 for r in results_list if r.get('score') == 'partial')
        fail_count = sum(1 for r in results_list if r.get('score') == 'fail')
        scenarios_run = data.get('scenarios_run', len(results_list))
        baseline_label = '[BASELINE]' if is_baseline else '[partial]'
        print(f'  {date}  {baseline_label:12s}  {pass_count}P/{partial_count}p/{fail_count}F  ({scenarios_run} scenarios)  {os.path.basename(fpath)}')
    except Exception as e:
        print(f'  ERROR reading {os.path.basename(fpath)}: {e}')
" "$RESULTS_DIR"
}

# ── Subcommand: generate ──────────────────────────────────────────────────────

cmd_generate() {
  command -v bun >/dev/null 2>&1 || { echo "Error: bun is required for report generation" >&2; exit 1; }

  if [[ ! -f "$MIGRATE_SCRIPT" ]]; then
    echo "Error: migration script not found at: $MIGRATE_SCRIPT" >&2
    exit 1
  fi

  echo "Migrating eval results into DB..."
  bun "$MIGRATE_SCRIPT"

  echo ""
  echo "Opening web app at http://localhost:3000"
  curl -sf http://localhost:3000 >/dev/null 2>&1 || echo "WARNING: Web app not running at localhost:3000. Start it with: bun web/index.ts" >&2
  open "http://localhost:3000" 2>/dev/null || echo "  (open not available — visit http://localhost:3000 manually)"
}

# ── Main dispatch ──────────────────────────────────────────────────────────────

case "${1:-}" in
  generate)   cmd_generate ;;
  list)        cmd_list ;;
  *)
    echo "Usage: eval-report.sh {generate|list}" >&2
    echo "" >&2
    echo "  generate   Migrate JSON results into DB and open localhost:3000" >&2
    echo "  list       Show available eval result runs" >&2
    exit 1
    ;;
esac
