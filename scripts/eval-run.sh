#!/usr/bin/env bash
# eval-run.sh -- Dream Team headless eval orchestrator
#
# Runs all 120 eval scenarios using the claude CLI:
#   Phase 1: Agent runs  (LLM calls — runs in parallel)
#   Phase 2: Grader runs (FREE — deterministic code checks)
#   Phase 3: Rubric scoring (LLM calls — runs in parallel)
#   Phase 4: Result assembly (writes final JSON + HTML report)
#
# Usage:
#   eval-run.sh [options]
#     --parallel N     Concurrency limit (default: 10)
#     --resume DIR     Resume from existing raw outputs in DIR
#     --agent NAME     Run only scenarios for named agent
#     --phase PHASE    Run only a specific phase: agents|graders|score|all (default: all)
#     --dry-run        Show what would run without executing
#
# Requirements:
#   - python3 (stdlib only — no external deps)
#   - claude CLI in PATH

set -euo pipefail

command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"

# ── Argument parsing ──────────────────────────────────────────────────────────

PARALLEL=10
RESUME_DIR=""
AGENT_FILTER=""
PHASE="all"
DRY_RUN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --parallel)
      PARALLEL="$2"; shift 2 ;;
    --resume)
      RESUME_DIR="$2"; shift 2 ;;
    --agent)
      AGENT_FILTER="$2"; shift 2 ;;
    --phase)
      PHASE="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN="yes"; shift ;;
    -h|--help)
      sed -n '/^# Usage:/,/^[^#]/p' "$0" | head -n -1 | sed 's/^# \{0,2\}//'
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Validate phase
case "$PHASE" in
  agents|graders|score|all) ;;
  *) echo "Error: --phase must be one of: agents|graders|score|all" >&2; exit 1 ;;
esac

# ── Hand off to Python3 orchestrator ─────────────────────────────────────────

exec python3 - \
  --parallel "$PARALLEL" \
  --phase "$PHASE" \
  --script-dir "$SCRIPT_DIR" \
  --repo-root "$REPO_ROOT" \
  ${RESUME_DIR:+--resume "$RESUME_DIR"} \
  ${AGENT_FILTER:+--agent "$AGENT_FILTER"} \
  ${DRY_RUN:+--dry-run} \
  << 'PYEOF'
# Full orchestrator — Python3 stdlib only, macOS compatible
import sys
import os
import re
import json
import glob
import subprocess
import datetime
import argparse
import shutil
import tempfile
import concurrent.futures

# ── CLI parsing (receives args from bash) ─────────────────────────────────────

parser = argparse.ArgumentParser(add_help=False)
parser.add_argument('--parallel',    type=int,   default=10)
parser.add_argument('--phase',       default='all')
parser.add_argument('--script-dir',  default='.')
parser.add_argument('--repo-root',   default='.')
parser.add_argument('--resume',      default='')
parser.add_argument('--agent',       default='')
parser.add_argument('--dry-run',     action='store_true')
args = parser.parse_args()

PARALLEL     = args.parallel
PHASE        = args.phase
SCRIPT_DIR   = args.script_dir
REPO_ROOT    = args.repo_root
RESUME_DIR   = args.resume
AGENT_FILTER = args.agent
DRY_RUN      = args.dry_run

EVALS_DIR   = os.path.join(REPO_ROOT, 'evals')
RESULTS_DIR = os.path.join(REPO_ROOT, 'evals', 'results')

# ── Setup run directory ───────────────────────────────────────────────────────

RUN_DATETIME = datetime.datetime.now().strftime('%Y-%m-%d-%H%M')
RAW_DIR      = os.path.join(RESULTS_DIR, 'raw', RUN_DATETIME)

if RESUME_DIR:
    if not os.path.isdir(RESUME_DIR):
        print(f'Error: resume directory does not exist: {RESUME_DIR}', file=sys.stderr)
        sys.exit(1)
    RAW_DIR      = RESUME_DIR
    RUN_DATETIME = os.path.basename(RESUME_DIR)
    print(f'Resuming from: {RAW_DIR}')

if not DRY_RUN and PHASE in ('all', 'agents') and not RESUME_DIR:
    os.makedirs(RAW_DIR, exist_ok=True)

# ── Discover scenarios ────────────────────────────────────────────────────────

SCENARIOS = []

for agent_dir in sorted(glob.glob(os.path.join(EVALS_DIR, '*/'))):
    agent = os.path.basename(agent_dir.rstrip('/'))
    if agent in ('results', ) or agent.startswith('README'):
        continue
    if AGENT_FILTER and agent != AGENT_FILTER:
        continue
    for scenario_file in sorted(glob.glob(os.path.join(agent_dir, 'scenario-*.md'))):
        if os.path.isfile(scenario_file):
            SCENARIOS.append(scenario_file)

TOTAL = len(SCENARIOS)
print(f'Discovered {TOTAL} scenarios')
if AGENT_FILTER:
    print(f'  (filtered to agent: {AGENT_FILTER})')

# ── Dry run ───────────────────────────────────────────────────────────────────

if DRY_RUN:
    print()
    print('DRY RUN -- would execute the following:')
    print(f'  Phase: {PHASE}')
    print(f'  Parallel: {PARALLEL}')
    print(f'  Raw dir: {RAW_DIR}')
    print()
    for scenario_file in SCENARIOS:
        agent       = os.path.basename(os.path.dirname(scenario_file))
        scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]
        raw_output  = os.path.join(RAW_DIR, f'{agent}-{scenario_id}.json')
        if os.path.isfile(raw_output):
            print(f'  SKIP (exists): {agent}/{scenario_id}')
        else:
            print(f'  RUN: {agent}/{scenario_id}')
    print()
    print('Dry run complete. No changes made.')
    sys.exit(0)

# ── Helpers ───────────────────────────────────────────────────────────────────

def extract_field(name, content):
    """Extract a top-level YAML-like multiline field from scenario content."""
    m = re.search(
        r'^' + re.escape(name) + r':\s*\|?\s*\n(.*?)(?=\n[a-zA-Z_][a-zA-Z0-9_]*:\s|\Z)',
        content, re.DOTALL | re.MULTILINE
    )
    return m.group(1).rstrip() if m else ''


def extract_prompt(content):
    """Extract the prompt field, stopping at known next fields."""
    m = re.search(
        r'^prompt:\s*\|?\s*\n(.*?)(?=\n(?:expected_behavior|failure_modes|scoring_rubric|graders|category|reference_output):)',
        content, re.DOTALL | re.MULTILINE
    )
    return m.group(1).strip() if m else ''


def parse_scenario_meta(content):
    """Return (scenario_name, scenario_type, category) from scenario content."""
    title_m = re.search(
        r'^#\s+Eval:.*?—\s+(.+?)(?:\s+\((.+?)\))?\s*$',
        content, re.MULTILINE
    )
    scenario_name = ''
    scenario_type = 'happy-path'
    if title_m:
        scenario_name = title_m.group(1).strip()
        if title_m.group(2):
            raw_type = title_m.group(2).strip().lower()
            if 'edge' in raw_type:
                scenario_type = 'edge-case'
            elif 'adversarial' in raw_type or 'attack' in raw_type:
                scenario_type = 'adversarial'
            elif 'regression' in raw_type:
                scenario_type = 'regression'
            else:
                scenario_type = raw_type

    cat_m = re.search(r'^category:\s*(\S+)', content, re.MULTILINE)
    category = cat_m.group(1).strip() if cat_m else ''

    return scenario_name, scenario_type, category


def parse_score_json(raw):
    """Extract a JSON object from potentially noisy claude output."""
    try:
        return json.loads(raw.strip())
    except Exception:
        pass
    # Scan for embedded JSON object
    for m in re.finditer(r'\{', raw):
        depth = 0
        start = m.start()
        for i in range(start, len(raw)):
            if raw[i] == '{':
                depth += 1
            elif raw[i] == '}':
                depth -= 1
            if depth == 0:
                candidate = raw[start:i + 1]
                try:
                    return json.loads(candidate)
                except Exception:
                    pass
                break
    return None


def normalize_grader_json(raw):
    """Normalize grader output to a list."""
    try:
        data = json.loads(raw.strip())
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and 'graders' in data:
            return data['graders']
    except Exception:
        pass
    return []


def run_graders(scenario_file, raw_output_file):
    """Run eval-graders.sh and return (grader_results_list, grader_override_bool)."""
    grader_script = os.path.join(SCRIPT_DIR, 'eval-graders.sh')
    grader_json   = ''
    grader_exit   = 0
    try:
        proc = subprocess.run(
            ['bash', grader_script, scenario_file, raw_output_file],
            capture_output=True, text=True
        )
        grader_json = proc.stdout
        grader_exit = proc.returncode
    except Exception as e:
        grader_exit = 1
        print(f'  ERROR running graders: {e}', file=sys.stderr)

    grader_override = (grader_exit != 0)
    grader_results  = normalize_grader_json(grader_json)
    return grader_results, grader_override

# ── Phase 1: Agent Runs ───────────────────────────────────────────────────────

def run_agent_scenario(scenario_file):
    """Run a single agent scenario. Returns the raw_output_file path."""
    agent       = os.path.basename(os.path.dirname(scenario_file))
    scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]
    raw_output  = os.path.join(RAW_DIR, f'{agent}-{scenario_id}.json')

    if os.path.isfile(raw_output):
        print(f'  SKIP (raw output exists): {agent}/{scenario_id}')
        return raw_output

    print(f'  Running agent: {agent}/{scenario_id}')

    with open(scenario_file, encoding='utf-8', errors='replace') as f:
        content = f.read()

    prompt = extract_prompt(content)
    if not prompt:
        print(f'  WARN: empty prompt extracted for {agent}/{scenario_id}', file=sys.stderr)

    start_ms  = int(datetime.datetime.now().timestamp() * 1000)
    timestamp = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    error_note = ''
    agent_output = ''

    if shutil.which('claude'):
        try:
            proc = subprocess.run(
                ['claude', '-p', '--agent', agent],
                input=prompt,
                capture_output=True,
                text=True
            )
            agent_output = proc.stdout
            if proc.returncode != 0:
                stderr_head = proc.stderr[:300].replace('\n', ' ')
                error_note  = f'claude exited non-zero: {stderr_head}'
                print(f'  ERROR running claude for {agent}/{scenario_id}: {error_note}', file=sys.stderr)
        except Exception as e:
            error_note   = f'claude invocation error: {e}'
            agent_output = ''
            print(f'  ERROR: {error_note}', file=sys.stderr)
    else:
        error_note = 'claude CLI not found in PATH'
        print(f'  ERROR: {error_note}', file=sys.stderr)

    end_ms      = int(datetime.datetime.now().timestamp() * 1000)
    duration_ms = end_ms - start_ms

    record = {
        'agent':               agent,
        'scenario_id':         scenario_id,
        'agent_output':        agent_output,
        'agent_output_excerpt': agent_output[:500],
        'duration_ms':         duration_ms,
        'tokens_used':         0,
        'timestamp':           timestamp,
    }
    if error_note:
        record['error'] = error_note

    with open(raw_output, 'w', encoding='utf-8') as f:
        json.dump(record, f, indent=2, ensure_ascii=False)

    print(f'  Done: {agent}/{scenario_id} ({duration_ms}ms)')
    return raw_output


def phase_agents():
    print()
    print(f'=== Phase 1: Agent Runs (parallel={PARALLEL}) ===')
    os.makedirs(RAW_DIR, exist_ok=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL) as executor:
        futures = [executor.submit(run_agent_scenario, sf) for sf in SCENARIOS]
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f'  ERROR in agent run: {e}', file=sys.stderr)

    print()
    print(f'Phase 1 complete. Raw outputs in: {RAW_DIR}')

# ── Phase 2: Grader Runs ──────────────────────────────────────────────────────

# Stores grader results keyed by "agent-scenario_id"
GRADER_RESULTS  = {}   # key -> list
GRADER_OVERRIDE = {}   # key -> bool


def phase_graders():
    print()
    print('=== Phase 2: Grader Runs (zero LLM calls) ===')

    for scenario_file in SCENARIOS:
        agent       = os.path.basename(os.path.dirname(scenario_file))
        scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]
        raw_output  = os.path.join(RAW_DIR, f'{agent}-{scenario_id}.json')
        key         = f'{agent}-{scenario_id}'

        if not os.path.isfile(raw_output):
            print(f'  SKIP (no raw output): {agent}/{scenario_id}')
            GRADER_RESULTS[key]  = []
            GRADER_OVERRIDE[key] = False
            continue

        grader_results, grader_override = run_graders(scenario_file, raw_output)
        GRADER_RESULTS[key]  = grader_results
        GRADER_OVERRIDE[key] = grader_override

        status = 'FAIL' if grader_override else 'PASS'
        print(f'  {status} (grader): {agent}/{scenario_id}')

    print()
    print('Phase 2 complete.')

# ── Phase 3: Rubric Scoring ───────────────────────────────────────────────────

def score_single_scenario(scenario_file, scored_dir):
    """Score a single scenario. Returns the scored_file path or None."""
    agent       = os.path.basename(os.path.dirname(scenario_file))
    scenario_id = os.path.splitext(os.path.basename(scenario_file))[0]
    raw_output  = os.path.join(RAW_DIR, f'{agent}-{scenario_id}.json')
    scored_file = os.path.join(scored_dir, f'{agent}-{scenario_id}.json')
    key         = f'{agent}-{scenario_id}'

    if not os.path.isfile(raw_output):
        print(f'  SKIP (no raw output for scoring): {agent}/{scenario_id}')
        return None

    print(f'  Scoring: {agent}/{scenario_id}')

    # Load raw output
    with open(raw_output, encoding='utf-8', errors='replace') as f:
        raw_data = json.load(f)

    agent_output = raw_data.get('agent_output', '')

    # Parse scenario fields
    with open(scenario_file, encoding='utf-8', errors='replace') as f:
        content = f.read()

    scenario_name, scenario_type, category = parse_scenario_meta(content)
    fields = {
        'expected_behavior': extract_field('expected_behavior', content),
        'failure_modes':     extract_field('failure_modes',     content),
        'scoring_rubric':    extract_field('scoring_rubric',    content),
        'scenario_name':     scenario_name,
        'scenario_type':     scenario_type,
        'category':          category,
    }

    # Build scoring prompt
    score_prompt = (
        f"You are Coach K scoring an agent's output against a rubric. Return ONLY valid JSON.\n\n"
        f"SCENARIO: {scenario_id}\n"
        f"AGENT: {agent}\n\n"
        f"EXPECTED BEHAVIOR:\n{fields['expected_behavior']}\n\n"
        f"FAILURE MODES:\n{fields['failure_modes']}\n\n"
        f"SCORING RUBRIC:\n{fields['scoring_rubric']}\n\n"
        f"AGENT OUTPUT:\n{agent_output}\n\n"
        f'Score this output. Return JSON:\n'
        f'{{\n'
        f'  "score": "pass|partial|fail",\n'
        f'  "confidence_stated": <0-100>,\n'
        f'  "justification": "<which rubric criteria were met/missed>",\n'
        f'  "observations": [{{"type": "positive|negative", "text": "..."}}]\n'
        f'}}'
    )

    score_json  = ''
    score_error = ''

    if shutil.which('claude'):
        for attempt in range(2):
            try:
                proc = subprocess.run(
                    ['claude', '-p'],
                    input=score_prompt,
                    capture_output=True,
                    text=True
                )
                score_json = proc.stdout
                if proc.returncode != 0:
                    score_error = f'claude scoring exited non-zero: {proc.stderr[:300].replace(chr(10), " ")}'
                    print(f'  ERROR scoring {agent}/{scenario_id}: {score_error}', file=sys.stderr)
            except Exception as e:
                score_error = f'claude invocation error: {e}'
                print(f'  ERROR: {score_error}', file=sys.stderr)

            parsed_score = parse_score_json(score_json)
            if parsed_score is not None:
                break
            if attempt == 0:
                print(f'  RETRY scoring parse for {agent}/{scenario_id}')
                score_json = ''  # will retry
        else:
            parsed_score = None
    else:
        score_error  = 'claude CLI not found in PATH'
        parsed_score = None

    # Get grader data — from phase 2 dict or recompute
    if key in GRADER_RESULTS:
        grader_results  = GRADER_RESULTS[key]
        grader_override = GRADER_OVERRIDE.get(key, False)
    else:
        # Standalone --phase score case: recompute graders
        grader_results, grader_override = run_graders(scenario_file, raw_output)

    # Apply grader hard gate
    final_score = (parsed_score or {}).get('score', 'fail')
    if grader_override or not parsed_score or score_error:
        final_score = 'fail'

    if not parsed_score:
        parsed_score = {}

    if not parsed_score or score_error:
        parsed_score.setdefault('justification', f'scoring parse error: {score_error or "no output"}')
        parsed_score.setdefault('observations',  [{'type': 'negative', 'text': 'scoring failed'}])
        parsed_score.setdefault('confidence_stated', 0)

    result = {
        'agent':                agent,
        'scenario_id':          scenario_id,
        'scenario_type':        fields.get('scenario_type', 'happy-path'),
        'scenario_name':        fields.get('scenario_name', scenario_id),
        'score':                final_score,
        'confidence_stated':    parsed_score.get('confidence_stated', 0),
        'justification':        parsed_score.get('justification', ''),
        'observations':         parsed_score.get('observations', []),
        'agent_output_excerpt': raw_data.get('agent_output_excerpt', agent_output[:500]),
        'duration_ms':          raw_data.get('duration_ms', 0),
        'tokens_used':          raw_data.get('tokens_used', 0),
        'timestamp':            raw_data.get('timestamp', ''),
    }

    if grader_results:
        result['grader_results'] = grader_results
    if grader_override:
        result['grader_override'] = True
    if fields.get('category'):
        result['category'] = fields['category']

    with open(scored_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    score_display = result.get('score', '?')
    print(f'  Scored: {agent}/{scenario_id} -> {score_display}')
    return scored_file


def phase_score():
    print()
    print(f'=== Phase 3: Rubric Scoring (parallel={PARALLEL}) ===')

    scored_dir = os.path.join(RAW_DIR, 'scored')
    os.makedirs(scored_dir, exist_ok=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL) as executor:
        futures = [executor.submit(score_single_scenario, sf, scored_dir) for sf in SCENARIOS]
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f'  ERROR in scoring: {e}', file=sys.stderr)

    print()
    print(f'Phase 3 complete. Scored results in: {scored_dir}')

# ── Phase 4: Result Assembly ──────────────────────────────────────────────────

def phase_assemble():
    scored_dir   = os.path.join(RAW_DIR, 'scored')
    final_output = os.path.join(RESULTS_DIR, f'{RUN_DATETIME}.json')

    print()
    print('=== Phase 4: Result Assembly ===')
    print(f'  Reading scored results from: {scored_dir}')
    print(f'  Writing final result to: {final_output}')

    os.makedirs(RESULTS_DIR, exist_ok=True)

    # Load all scored result files
    scored_files = sorted(glob.glob(os.path.join(scored_dir, '*.json')))
    results = []
    for fpath in scored_files:
        try:
            with open(fpath, encoding='utf-8', errors='replace') as f:
                data = json.load(f)
            results.append(data)
        except Exception as e:
            print(f'  WARN: could not read scored file {fpath}: {e}', file=sys.stderr)

    scenarios_run = len(results)

    # Count scores
    pass_count    = sum(1 for r in results if r.get('score') == 'pass')
    partial_count = sum(1 for r in results if r.get('score') == 'partial')
    fail_count    = sum(1 for r in results if r.get('score') == 'fail')
    pass_rate     = round(pass_count / scenarios_run, 4) if scenarios_run > 0 else 0.0

    # Per-agent summaries
    agent_buckets = {}
    for r in results:
        a = r.get('agent', 'unknown')
        if a not in agent_buckets:
            agent_buckets[a] = {'pass': 0, 'partial': 0, 'fail': 0, 'confidences': []}
        s = r.get('score', 'fail')
        agent_buckets[a][s] = agent_buckets[a].get(s, 0) + 1
        c = r.get('confidence_stated')
        if c is not None:
            agent_buckets[a]['confidences'].append(c)

    agent_summaries = {}
    for agent, bucket in agent_buckets.items():
        total_a  = bucket['pass'] + bucket['partial'] + bucket['fail']
        pr       = round(bucket['pass'] / total_a, 4) if total_a > 0 else 0.0
        confs    = bucket['confidences']
        avg_conf = round(sum(confs) / len(confs), 1) if confs else None
        calib_gap = round(avg_conf / 100 - pr, 4) if avg_conf is not None else None
        agent_summaries[agent] = {
            'pass':                    bucket['pass'],
            'partial':                 bucket['partial'],
            'fail':                    bucket['fail'],
            'pass_rate':               pr,
            'avg_confidence_stated':   avg_conf,
            'calibration_gap':         calib_gap,
        }

    # Get git commit SHA
    repo_commit = 'unknown'
    try:
        repo_commit = subprocess.check_output(
            ['git', '-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass

    now_iso     = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    is_complete = (scenarios_run == TOTAL)

    final = {
        'run_id':                f'eval/run-{RUN_DATETIME}',
        'date':                  now_iso,
        'is_complete_baseline':  is_complete,
        'scenarios_total':       TOTAL,
        'scenarios_run':         scenarios_run,
        'summary': {
            'pass':      pass_count,
            'partial':   partial_count,
            'fail':      fail_count,
            'pass_rate': pass_rate,
        },
        'results':         results,
        'agent_summaries': agent_summaries,
        'meta': {
            'repo_commit': repo_commit,
            'trials':      1,
            'notes':       'Preliminary scoring by Coach K. Human review pending via HTML report.',
        },
    }

    with open(final_output, 'w', encoding='utf-8') as f:
        json.dump(final, f, indent=2, ensure_ascii=False)

    print(f'  Written: {final_output}')
    print(f'  Scenarios run: {scenarios_run}/{TOTAL}')
    print(f'  Summary: {pass_count}P / {partial_count}p / {fail_count}F  (pass_rate={pass_rate})')

    print()
    print('Generating HTML report...')
    report_script = os.path.join(SCRIPT_DIR, 'eval-report.sh')
    proc = subprocess.run(['bash', report_script, 'generate'], capture_output=False)
    if proc.returncode != 0:
        print('  WARN: report generation failed (non-fatal)')

    print()
    print('=== Run Complete ===')
    print(f'  Result file: {final_output}')

# ── Main orchestration ────────────────────────────────────────────────────────

print()
print('eval-run.sh -- Dream Team Eval Orchestrator')
print(f'  Run datetime : {RUN_DATETIME}')
print(f'  Raw dir      : {RAW_DIR}')
print(f'  Phase        : {PHASE}')
print(f'  Parallel     : {PARALLEL}')
print(f'  Scenarios    : {TOTAL}')
print()

if PHASE == 'all':
    phase_agents()
    phase_graders()
    phase_score()
    phase_assemble()
elif PHASE == 'agents':
    phase_agents()
elif PHASE == 'graders':
    phase_graders()
elif PHASE == 'score':
    phase_graders()   # Need grader data for override flags
    phase_score()
    phase_assemble()

PYEOF
