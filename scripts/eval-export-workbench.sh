#!/usr/bin/env bash
# eval-export-workbench.sh -- Export eval scenarios to CSV for Anthropic Workbench import
#
# Usage:
#   eval-export-workbench.sh <agent>                Export all scenarios for an agent
#   eval-export-workbench.sh <agent> --open         Export and open the CSV
#   eval-export-workbench.sh <agent> --with-rubric  Export with scoring_rubric column
#   eval-export-workbench.sh --all                  Export all agents (one CSV per agent)
#   eval-export-workbench.sh --all --with-rubric    Export all agents with rubric column
#
# Output:
#   evals/<agent>/workbench-import.csv
#
# The CSV has a single column "scenario_input" containing the prompt from each scenario.
# With --with-rubric, a second column "scoring_rubric" is added.
# In Workbench, set your User Message to {{scenario_input}} and import this CSV.
#
# Requirements:
#   - python3 (stdlib only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
EVALS_DIR="${REPO_ROOT}/evals"

OPEN_AFTER=""
WITH_RUBRIC=""

usage() {
  echo "Usage: eval-export-workbench.sh <agent> [--open] [--with-rubric]"
  echo "       eval-export-workbench.sh --all [--open] [--with-rubric]"
  echo ""
  echo "Agents: $(ls -1 "$EVALS_DIR" | grep -v results | grep -v README | grep -v '^\.' | tr '\n' ' ')"
  exit 1
}

export_agent() {
  local agent="$1"
  local with_rubric="${2:-}"
  local agent_dir="${EVALS_DIR}/${agent}"

  if [[ ! -d "$agent_dir" ]]; then
    echo "Error: agent directory not found: $agent_dir" >&2
    exit 1
  fi

  local out="${agent_dir}/workbench-import.csv"

  python3 -c "
import csv, re, os, sys

agent_dir = sys.argv[1]
out_file = sys.argv[2]
with_rubric = sys.argv[3] == '1'

scenarios = sorted([f for f in os.listdir(agent_dir) if f.startswith('scenario-') and f.endswith('.md')])

def extract_field(content, key):
    pattern = re.compile(
        r'^' + re.escape(key) + r':\s*\|?\s*\n(.*?)(?=\n[a-zA-Z_][a-zA-Z0-9_]*:|\Z)',
        re.DOTALL | re.MULTILINE
    )
    m = pattern.search(content)
    if m:
        # De-indent: remove the common leading whitespace shared by all non-empty lines
        block = m.group(1)
        lines = block.split('\n')
        # Strip trailing blank lines
        while lines and not lines[-1].strip():
            lines.pop()
        # Find minimum indent among non-empty lines
        non_empty = [l for l in lines if l.strip()]
        if non_empty:
            min_indent = min(len(l) - len(l.lstrip()) for l in non_empty)
            lines = [l[min_indent:] if len(l) >= min_indent else l for l in lines]
        return '\n'.join(lines).strip()
    return None

rows = []
skipped = 0
for fname in scenarios:
    fpath = os.path.join(agent_dir, fname)
    with open(fpath) as f:
        content = f.read()

    prompt = extract_field(content, 'prompt')
    if prompt is None:
        print(f'WARN: no extractable prompt in {fname} -- skipping row', file=sys.stderr)
        skipped += 1
        continue

    if with_rubric:
        rubric = extract_field(content, 'scoring_rubric')
        if rubric is None:
            print(f'WARN: no extractable scoring_rubric in {fname} -- leaving column empty', file=sys.stderr)
            rubric = ''
        rows.append([prompt, rubric])
    else:
        rows.append([prompt])

with open(out_file, 'w', newline='') as f:
    writer = csv.writer(f)
    if with_rubric:
        writer.writerow(['scenario_input', 'scoring_rubric'])
    else:
        writer.writerow(['scenario_input'])
    for r in rows:
        writer.writerow(r)

summary = f'  {len(rows)} scenarios'
if skipped:
    summary += f' ({skipped} skipped — see warnings above)'
summary += f' -> {out_file}'
print(summary)
" "$agent_dir" "$out" "${with_rubric:-0}"
}

# Parse args
if [[ $# -lt 1 ]]; then
  usage
fi

AGENTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      for d in "$EVALS_DIR"/*/; do
        name="$(basename "$d")"
        [[ "$name" == "results" || "$name" == "."* ]] && continue
        AGENTS+=("$name")
      done
      shift ;;
    --open)
      OPEN_AFTER="yes"
      shift ;;
    --with-rubric)
      WITH_RUBRIC="1"
      shift ;;
    -h|--help)
      usage ;;
    -*)
      echo "Error: unknown flag: $1" >&2
      usage ;;
    *)
      AGENTS+=("$1")
      shift ;;
  esac
done

if [[ ${#AGENTS[@]} -eq 0 ]]; then
  usage
fi

echo "Exporting for Anthropic Workbench..."

for agent in "${AGENTS[@]}"; do
  export_agent "$agent" "${WITH_RUBRIC:-0}"
done

echo "Done."
echo ""
echo "To use in Workbench:"
echo "  1. Set System Prompt to the agent definition (agents/<name>.md)"
echo "  2. Set User Message to: {{scenario_input}}"
echo "  3. Go to Evaluate tab -> Import Test Cases -> select the CSV"
if [[ -n "$WITH_RUBRIC" ]]; then
  echo "  4. Use the scoring_rubric column as your grading prompt"
fi

if [[ -n "$OPEN_AFTER" && ${#AGENTS[@]} -eq 1 ]]; then
  open "${EVALS_DIR}/${AGENTS[0]}/workbench-import.csv"
fi
