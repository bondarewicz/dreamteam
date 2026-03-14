#!/usr/bin/env bash
# eval-graders.sh -- Dream Team code-based grader runner
#
# Runs deterministic code-based graders defined in scenario files against agent output.
# Zero LLM calls — all checks are pure code.
#
# Usage:
#   Single mode:  bash scripts/eval-graders.sh <scenario-file> <agent-output-file>
#   Batch mode:   bash scripts/eval-graders.sh --batch <raw-output-dir>
#
# Output:
#   stdout: JSON array of grader results
#   exit 0: all graders passed (or no graders defined)
#   exit 1: one or more graders failed
#
# Requirements:
#   - python3 (stdlib only — no external dependencies)

set -euo pipefail

command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
EVALS_DIR="${REPO_ROOT}/evals"

# ── Argument validation ────────────────────────────────────────────────────────

if [[ "${1:-}" == "--batch" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Error: --batch requires a raw output directory" >&2
    exit 1
  fi
  RAW_DIR="$2"
  if [[ ! -d "$RAW_DIR" ]]; then
    echo "Error: raw output directory does not exist: $RAW_DIR" >&2
    exit 1
  fi
  PY_ARGS=(--batch "$RAW_DIR" "$EVALS_DIR")
else
  if [[ -z "${1:-}" || -z "${2:-}" ]]; then
    echo "Usage: $0 <scenario-file> <agent-output-file>" >&2
    echo "       $0 --batch <raw-output-dir>" >&2
    exit 1
  fi
  SCENARIO_FILE="$1"
  OUTPUT_FILE="$2"
  if [[ ! -f "$SCENARIO_FILE" ]]; then
    echo "Error: scenario file not found: $SCENARIO_FILE" >&2
    exit 1
  fi
  if [[ ! -f "$OUTPUT_FILE" ]]; then
    echo "Error: agent output file not found: $OUTPUT_FILE" >&2
    exit 1
  fi
  PY_ARGS=(--single "$SCENARIO_FILE" "$OUTPUT_FILE")
fi

# ── Single shared Python implementation ───────────────────────────────────────

python3 - "${PY_ARGS[@]}" << 'PYEOF'
import json, os, sys, glob, re

# sys.argv[1] is --batch or --single; remaining args depend on mode.
mode = sys.argv[1]


# ── Shared helpers ─────────────────────────────────────────────────────────

def extract_graders_from_scenario(scenario_text):
    """
    Parse the graders: block from a scenario file using string/regex only.
    Returns a list of grader dicts, or None if no graders field.
    """
    lines = scenario_text.splitlines()

    # Find the graders: line — match raw line so indented occurrences inside
    # multiline prompt blocks are NOT falsely detected (Finding 3: no .strip()).
    graders_start = None
    for i, line in enumerate(lines):
        if re.match(r'^graders:\s*$', line):
            graders_start = i
            break

    if graders_start is None:
        return None  # No graders field

    # Top-level field names that end the graders block
    top_level_field = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*:\s')

    # Collect grader block lines
    grader_lines = []
    for i in range(graders_start + 1, len(lines)):
        line = lines[i]
        # A non-indented line starting a new field ends the block
        # (but blank lines are fine)
        if line and not line.startswith(' ') and not line.startswith('\t'):
            if top_level_field.match(line) or line.strip().endswith(':'):
                break
        grader_lines.append(line)

    # Parse individual graders from the collected block
    graders = []
    current = None

    def flush(g):
        if g:
            graders.append(g)

    for line in grader_lines:
        stripped = line.strip()
        if not stripped:
            continue

        # New grader entry starts with "- type:"
        m = re.match(r'^-\s+type:\s+(.+)$', stripped)
        if m:
            flush(current)
            current = {'type': m.group(1).strip()}
            continue

        if current is None:
            continue

        # Key: value pairs inside a grader entry
        kv = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$', stripped)
        if not kv:
            continue

        key = kv.group(1)
        val_raw = kv.group(2).strip()

        # Parse value: JSON array, quoted string, or bare string
        if val_raw.startswith('['):
            try:
                val = json.loads(val_raw)
            except Exception:
                # Try to parse as Python-style list of quoted strings
                items = re.findall(r'"([^"]*)"', val_raw)
                val = items if items else [val_raw]
        elif val_raw.startswith('"') and val_raw.endswith('"'):
            # Unescape: scenario files store regex patterns with \\s meaning \s
            val = val_raw[1:-1].replace('\\\\', '\\')
        else:
            # Try int
            try:
                val = int(val_raw)
            except ValueError:
                val = val_raw

        current[key] = val

    flush(current)
    return graders


def extract_output(raw_file_path):
    """
    Read agent output from a raw file.
    If JSON, extract agent_output field. Otherwise return full text.
    """
    with open(raw_file_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    try:
        data = json.loads(content)
        if isinstance(data, dict) and 'agent_output' in data:
            return data['agent_output']
    except Exception:
        pass

    return content


def _find_json_in_output(output):
    """
    Return True if any valid JSON object or array exists anywhere in output.
    Uses a brace-depth scanner so nested structures like {"a": {"b": 1}} are
    correctly detected (Finding 1: replaces flat regex that excluded inner braces).
    """
    # Fast path: entire output is valid JSON
    try:
        json.loads(output.strip())
        return True
    except Exception:
        pass

    # Depth scanner: start at every [ or { and walk to matching closer
    for m in re.finditer(r'[\[{]', output):
        depth = 0
        start = m.start()
        for i in range(start, len(output)):
            if output[i] in '{[':
                depth += 1
            elif output[i] in '}]':
                depth -= 1
            if depth == 0:
                try:
                    json.loads(output[start:i + 1])
                    return True
                except Exception:
                    pass
                break
    return False


def run_grader(grader, output):
    """Run a single grader against output. Returns (passed, detail)."""
    gtype = grader.get('type', '')

    if gtype == 'json_valid':
        if _find_json_in_output(output):
            return True, 'passed'
        return False, 'no valid JSON found in output'

    elif gtype == 'contains':
        values = grader.get('values', [])
        if isinstance(values, str):
            values = [values]
        missing = [v for v in values if v not in output]
        if missing:
            return False, f'missing values: {", ".join(missing)}'
        return True, 'passed'

    elif gtype == 'not_contains':
        values = grader.get('values', [])
        if isinstance(values, str):
            values = [values]
        found = [v for v in values if v in output]
        if found:
            return False, f'forbidden values found: {", ".join(found)}'
        return True, 'passed'

    elif gtype == 'regex':
        pattern = grader.get('pattern', '')
        try:
            if re.search(pattern, output):
                return True, 'passed'
            return False, f'pattern not found: {pattern}'
        except re.error as e:
            return False, f'invalid regex pattern "{pattern}": {e}'

    elif gtype == 'section_present':
        sections = grader.get('sections', [])
        if isinstance(sections, str):
            sections = [sections]
        missing = [s for s in sections if s not in output]
        if missing:
            return False, f'missing sections: {", ".join(missing)}'
        return True, 'passed'

    elif gtype == 'field_count':
        pattern = grader.get('pattern', '')
        min_count = grader.get('min', None)
        max_count = grader.get('max', None)
        try:
            matches = re.findall(pattern, output)
            count = len(matches)
        except re.error as e:
            return False, f'invalid regex pattern "{pattern}": {e}'
        if min_count is not None and count < min_count:
            return False, f'field count {count} below minimum {min_count} for pattern "{pattern}"'
        if max_count is not None and count > max_count:
            return False, f'field count {count} above maximum {max_count} for pattern "{pattern}"'
        return True, 'passed'

    elif gtype == 'length_bounds':
        length = len(output)
        min_len = grader.get('min', None)
        max_len = grader.get('max', None)
        if min_len is not None and length < min_len:
            return False, f'output length {length} below minimum {min_len}'
        if max_len is not None and length > max_len:
            return False, f'output length {length} above maximum {max_len}'
        return True, 'passed'

    else:
        return False, f'unknown grader type: {gtype}'


def run_graders_for_scenario(scenario_file, raw_output_file):
    """
    Run all graders for a scenario against its raw output file.
    Returns a result dict.
    """
    scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]

    with open(scenario_file, 'r', encoding='utf-8', errors='replace') as f:
        scenario_text = f.read()

    graders = extract_graders_from_scenario(scenario_text)

    if not graders:
        return {
            'scenario': scenario_id,
            'graders': [],
            'has_graders': False,
            'all_passed': True
        }

    output = extract_output(raw_output_file)

    results = []
    for grader in graders:
        gtype = grader.get('type', 'unknown')
        config = {k: v for k, v in grader.items() if k != 'type'}
        passed, detail = run_grader(grader, output)
        results.append({
            'type': gtype,
            'config': config,
            'passed': passed,
            'detail': detail
        })

    all_passed = all(r['passed'] for r in results)

    return {
        'scenario': scenario_id,
        'graders': results,
        'has_graders': True,
        'all_passed': all_passed
    }


# ── Batch mode ─────────────────────────────────────────────────────────────

if mode == '--batch':
    raw_dir = sys.argv[2]
    evals_dir = sys.argv[3]

    raw_files = sorted(glob.glob(os.path.join(raw_dir, '*.json')))

    if not raw_files:
        print(json.dumps({'error': f'no JSON files found in {raw_dir}', 'results': [], 'all_passed': True}))
        sys.exit(0)

    all_results = []
    overall_passed = True

    for raw_file in raw_files:
        basename = os.path.splitext(os.path.basename(raw_file))[0]

        # Try to read agent/scenario from the JSON itself first
        scenario_id = None
        agent_name = None
        try:
            with open(raw_file, 'r') as f:
                raw_data = json.load(f)
            scenario_id = raw_data.get('scenario_id')
            agent_name = raw_data.get('agent')
        except Exception:
            pass

        if not scenario_id or not agent_name:
            # Parse from filename: agent-scenario-id[-trial-N]
            known_agents = ['bird', 'mj', 'shaq', 'kobe', 'pippen', 'magic']
            for agent in known_agents:
                if basename.startswith(agent + '-'):
                    agent_name = agent
                    rest = basename[len(agent) + 1:]
                    rest = re.sub(r'-trial-\d+$', '', rest)
                    scenario_id = rest
                    break

        if not scenario_id or not agent_name:
            all_results.append({
                'file': os.path.basename(raw_file),
                'error': f'could not determine agent/scenario from file: {basename}',
                'graders': [],
                'has_graders': False,
                'all_passed': True
            })
            continue

        scenario_file = os.path.join(evals_dir, agent_name, f'{scenario_id}.md')
        if not os.path.exists(scenario_file):
            all_results.append({
                'file': os.path.basename(raw_file),
                'scenario': scenario_id,
                'error': f'scenario file not found: {scenario_file}',
                'graders': [],
                'has_graders': False,
                'all_passed': True
            })
            continue

        result = run_graders_for_scenario(scenario_file, raw_file)
        result['file'] = os.path.basename(raw_file)
        all_results.append(result)

        if not result['all_passed']:
            overall_passed = False

    output_data = {
        'batch': True,
        'raw_dir': raw_dir,
        'results': all_results,
        'all_passed': overall_passed
    }

    print(json.dumps(output_data, indent=2))
    sys.exit(0 if overall_passed else 1)


# ── Single mode ─────────────────────────────────────────────────────────────

elif mode == '--single':
    scenario_file = sys.argv[2]
    output_file = sys.argv[3]

    scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]

    with open(scenario_file, 'r', encoding='utf-8', errors='replace') as f:
        scenario_text = f.read()

    graders = extract_graders_from_scenario(scenario_text)

    if not graders:
        result = {
            'scenario': scenario_id,
            'graders': [],
            'has_graders': False
        }
        print(json.dumps(result, indent=2))
        sys.exit(0)

    output = extract_output(output_file)

    results = []
    for grader in graders:
        gtype = grader.get('type', 'unknown')
        config = {k: v for k, v in grader.items() if k != 'type'}
        passed, detail = run_grader(grader, output)
        results.append({
            'type': gtype,
            'config': config,
            'passed': passed,
            'detail': detail
        })

    all_passed = all(r['passed'] for r in results)

    print(json.dumps(results, indent=2))
    sys.exit(0 if all_passed else 1)

else:
    print(f'Error: unknown mode {mode}', file=sys.stderr)
    sys.exit(1)
PYEOF
