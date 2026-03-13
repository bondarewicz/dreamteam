#!/usr/bin/env bash
# eval-report.sh -- Dream Team eval report generator
#
# Reads all evals/results/*.json files and generates a standalone HTML report
# matching reports/evals/eval-ux-preview.html exactly.
#
# Usage:
#   eval-report.sh generate          Generate HTML from all result files
#   eval-report.sh list               List available result runs
#
# Output:
#   reports/evals/YYYY-MM-DD-eval-report.html
#
# Requirements:
#   - python3 (for all JSON parsing — no jq)
#   - No external dependencies
#   - Works with 0 result files (empty state), partial runs, and multiple runs

set -euo pipefail

command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required for report generation" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
RESULTS_DIR="${REPO_ROOT}/evals/results"
REPORTS_DIR="${REPO_ROOT}/reports/evals"

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
  mkdir -p "$REPORTS_DIR"

  local output_file="${REPORTS_DIR}/$(date +%Y-%m-%d)-eval-report.html"

  echo "Generating eval report..."
  echo "  Reading results from: $RESULTS_DIR"
  echo "  Output: $output_file"

  python3 - "$RESULTS_DIR" "$output_file" << 'PYEOF'
import json, os, sys, glob, datetime, html

results_dir = sys.argv[1]
output_file = sys.argv[2]

# ── Load all result files ──────────────────────────────────────────────────

files = sorted(glob.glob(os.path.join(results_dir, '*.json')))
runs = []

for fpath in files:
    try:
        with open(fpath) as f:
            data = json.load(f)
        runs.append(data)
    except Exception as e:
        print(f'WARNING: Could not parse {os.path.basename(fpath)}: {e}', file=sys.stderr)

# Sort by date ascending
runs.sort(key=lambda r: r.get('date', ''))

today_str = datetime.date.today().isoformat()
report_date = today_str

# Most recent run is the "current" run
current_run = runs[-1] if runs else None

# Find most recent complete baseline (for regression comparison)
prior_baseline = None
for r in reversed(runs[:-1] if runs else []):
    if r.get('is_complete_baseline', False):
        prior_baseline = r
        break

# ── Agent metadata ──────────────────────────────────────────────────────────

AGENT_META = {
    'bird':   {'color': '#3fb950', 'var': '--bird',   'role': 'Domain Authority'},
    'mj':     {'color': '#58a6ff', 'var': '--mj',     'role': 'Architect'},
    'shaq':   {'color': '#bc8cff', 'var': '--shaq',   'role': 'Implementer'},
    'kobe':   {'color': '#f85149', 'var': '--kobe',   'role': 'Reviewer'},
    'pippen': {'color': '#39d2c0', 'var': '--pippen', 'role': 'Stability'},
    'magic':  {'color': '#d29922', 'var': '--magic',  'role': 'Coordinator'},
}

def agent_color_var(agent):
    return AGENT_META.get(agent.lower(), {}).get('var', '--text')

def agent_role(agent):
    return AGENT_META.get(agent.lower(), {}).get('role', agent.capitalize())

def agent_class(agent):
    return f'{agent.lower()}-color'

def score_label(score):
    labels = {'pass': 'Pass', 'partial': 'Partial', 'fail': 'Fail'}
    return labels.get(score, score.capitalize() if score else '—')

def pass_rate_pct(pr):
    if pr is None:
        return '—'
    return f'{round(pr * 100)}%'

def cal_gap_label(gap):
    if gap is None:
        return 'n/a'
    sign = '+' if gap >= 0 else ''
    return f'{sign}{round(gap)}pp'

def cal_gap_class(gap):
    if gap is None:
        return 'ok'
    if gap > 10:
        return 'over'
    if gap < -10:
        return 'under'
    return 'ok'

def cal_flag_label(gap):
    if gap is None:
        return 'No data'
    if gap > 10:
        return 'Overconfident'
    if gap < -10:
        return 'Underconfident'
    return 'Calibrated'

def score_numeric(score):
    return {'pass': 100, 'partial': 50, 'fail': 0}.get(score, 0)

def h(text):
    return html.escape(str(text)) if text is not None else ''

# ── Compute overall summary for current run ───────────────────────────────

if current_run:
    # Recompute from actual results — never trust the summary field
    results_list = current_run.get('results', [])
    total_pass = sum(1 for r in results_list if r.get('score') == 'pass')
    total_partial = sum(1 for r in results_list if r.get('score') == 'partial')
    total_fail = sum(1 for r in results_list if r.get('score') == 'fail')
    scenarios_run = current_run.get('scenarios_run', len(results_list))
    total_scored = total_pass + total_partial + total_fail

    # Warn on mismatch between summary field and actual results
    stated = current_run.get('summary', {})
    if (stated.get('pass', 0) != total_pass or
        stated.get('partial', 0) != total_partial or
        stated.get('fail', 0) != total_fail):
        print(f'  WARNING: summary field mismatch! stated={stated.get("pass",0)}P/{stated.get("partial",0)}p/{stated.get("fail",0)}F '
              f'actual={total_pass}P/{total_partial}p/{total_fail}F — using actual counts', file=sys.stderr)
    overall_pass_rate = (total_pass / total_scored) if total_scored > 0 else 0
    pass_pct = round(overall_pass_rate * 100)
    partial_pct = round((total_partial / total_scored) * 100) if total_scored > 0 else 0
    fail_pct = 100 - pass_pct - partial_pct

    run_id = current_run.get('run_id', 'eval/run-unknown')
    run_date = current_run.get('date', today_str)[:16].replace('T', '  ')
    agent_summaries = current_run.get('agent_summaries', {})
    results = current_run.get('results', [])
    scenarios_total = current_run.get('scenarios_total', total_scored)
    is_complete_baseline = current_run.get('is_complete_baseline', False)
    meta = current_run.get('meta', {})
    repo_commit = meta.get('repo_commit', 'unknown')
else:
    total_pass = total_partial = total_fail = 0
    scenarios_run = scenarios_total = total_scored = 0
    overall_pass_rate = 0.0
    pass_pct = partial_pct = fail_pct = 0
    run_id = 'eval/run-none'
    run_date = today_str
    agent_summaries = {}
    results = []
    is_complete_baseline = False
    meta = {}
    repo_commit = 'unknown'

# Group results by agent
results_by_agent = {}
for r in results:
    agent = r.get('agent', 'unknown')
    results_by_agent.setdefault(agent, []).append(r)

# Determine all agents (from agent_summaries or results)
all_agents = sorted(set(list(agent_summaries.keys()) + list(results_by_agent.keys())))

# Scenario type order
SCENARIO_TYPES = ['happy-path', 'edge-case', 'escalation']
TYPE_LABELS = {'happy-path': 'Happy Path', 'edge-case': 'Edge Case', 'escalation': 'Escalation'}
TYPE_TAGS = {'happy-path': 'S1', 'edge-case': 'S2', 'escalation': 'S3'}

# ── Regression detection ──────────────────────────────────────────────────

regressions = []
persistent_non_pass = []

if prior_baseline and current_run:
    prior_results_map = {}
    for r in prior_baseline.get('results', []):
        key = (r.get('agent'), r.get('scenario_id'))
        prior_results_map[key] = r.get('score')

    current_results_map = {}
    for r in results:
        key = (r.get('agent'), r.get('scenario_id'))
        current_results_map[key] = r.get('score')

    score_rank = {'pass': 2, 'partial': 1, 'fail': 0}
    for key, prior_score in prior_results_map.items():
        current_score = current_results_map.get(key)
        if current_score and score_rank.get(current_score, -1) < score_rank.get(prior_score, -1):
            regressions.append({
                'agent': key[0],
                'scenario_id': key[1],
                'prior_score': prior_score,
                'current_score': current_score,
            })

# Persistent non-pass: scenarios that are non-pass in every run they appeared in
if len(runs) >= 2:
    scenario_history = {}
    for run in runs:
        for r in run.get('results', []):
            key = (r.get('agent'), r.get('scenario_id'))
            scenario_history.setdefault(key, []).append(r.get('score'))

    for key, history in scenario_history.items():
        if all(s in ('partial', 'fail') for s in history) and len(history) >= 2:
            persistent_non_pass.append({
                'agent': key[0],
                'scenario_id': key[1],
                'history': history,
            })

prior_baseline_date = prior_baseline.get('date', '')[:10] if prior_baseline else None

# ── Trend data ────────────────────────────────────────────────────────────

trend_rows = []
prev_pass_count = None
for run in runs:
    s = run.get('summary', {})
    p = s.get('pass', 0)
    pa = s.get('partial', 0)
    f = s.get('fail', 0)
    total = p + pa + f
    pr = round((p / total) * 100) if total > 0 else 0
    run_date_full = run.get('date', '')
    run_date_short = run_date_full[:10]
    # Show date + time (HH:MM) for distinguishing multiple runs per day
    run_date_display = run_date_full[:16].replace('T', ' ') if len(run_date_full) >= 16 else run_date_short
    is_today = run_date_short == today_str
    delta = None
    if prev_pass_count is not None:
        delta = p - prev_pass_count
    trend_rows.append({
        'date': run_date_display,
        'pass': p,
        'partial': pa,
        'fail': f,
        'pass_rate': pr,
        'is_today': is_today,
        'delta': delta,
        'notes': run.get('meta', {}).get('notes', ''),
        'is_baseline': run.get('is_complete_baseline', False),
        'scenarios_total': run.get('scenarios_total', total),
    })
    prev_pass_count = p

# ── Build HTML ────────────────────────────────────────────────────────────

CSS = '''
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-2: #1c2128;
    --surface-3: #21262d;
    --border: #30363d;
    --border-subtle: #21262d;
    --text: #e6edf3;
    --text-dim: #7d8590;
    --text-muted: #484f58;
    --pass: #4ade80;
    --pass-bg: rgba(74,222,128,0.10);
    --pass-border: rgba(74,222,128,0.30);
    --partial: #fbbf24;
    --partial-bg: rgba(251,191,36,0.10);
    --partial-border: rgba(251,191,36,0.30);
    --fail: #f87171;
    --fail-bg: rgba(248,113,113,0.10);
    --fail-border: rgba(248,113,113,0.30);
    --bird: #3fb950;
    --mj: #58a6ff;
    --shaq: #bc8cff;
    --kobe: #f85149;
    --pippen: #39d2c0;
    --magic: #d29922;
    --accent: #388bfd;
    --mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 16px;
  }

  /* ══════════════════════════════════════════════════════
     HEADER
     ══════════════════════════════════════════════════════ */
  .header {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px 28px;
    margin-bottom: 24px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
  }

  .header-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.3px;
  }

  .header-sub {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--mono);
    margin-top: 4px;
  }

  .header-meta {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }

  .meta-item { text-align: right; }

  .meta-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .meta-value {
    font-size: 13px;
    font-family: var(--mono);
    color: var(--text-dim);
    margin-top: 2px;
  }

  /* Overall score pills + progress bar */
  .overall-score {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .score-numbers { display: flex; gap: 12px; }

  .score-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
  }

  .score-pill.pass { background: var(--pass-bg); border: 1px solid var(--pass-border); color: var(--pass); }
  .score-pill.partial { background: var(--partial-bg); border: 1px solid var(--partial-border); color: var(--partial); }
  .score-pill.fail { background: var(--fail-bg); border: 1px solid var(--fail-border); color: var(--fail); }

  .score-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .score-dot.pass { background: var(--pass); }
  .score-dot.partial { background: var(--partial); }
  .score-dot.fail { background: var(--fail); }

  .progress-bar-wrap { flex: 1; min-width: 200px; }

  .progress-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
    font-family: var(--mono);
  }

  .progress-bar {
    height: 10px;
    background: var(--surface-3);
    border-radius: 5px;
    overflow: hidden;
    display: flex;
  }

  .progress-segment { height: 100%; }
  .progress-segment.pass { background: var(--pass); }
  .progress-segment.partial { background: var(--partial); }
  .progress-segment.fail { background: var(--fail); }

  /* ── AGENT SUMMARY ROW (replaces matrix) ────────────── */
  .agent-summary-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .agent-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: var(--mono);
    font-size: 12px;
    flex: 1;
    min-width: 140px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-decoration: none;
  }

  .agent-chip:hover {
    border-color: var(--text-muted);
  }

  .agent-chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .agent-chip-name {
    font-weight: 600;
    color: var(--text);
  }

  .agent-chip-score {
    font-weight: 700;
    margin-left: auto;
  }

  .agent-chip-score.perfect { color: var(--pass); }
  .agent-chip-score.mixed { color: var(--partial); }
  .agent-chip-score.bad { color: var(--fail); }

  .agent-chip-dots {
    display: flex;
    gap: 3px;
    margin-left: 4px;
  }

  .agent-chip-dots .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .agent-chip-dots .dot.pass { background: var(--pass); }
  .agent-chip-dots .dot.partial { background: var(--partial); }
  .agent-chip-dots .dot.fail { background: var(--fail); }

  /* ══════════════════════════════════════════════════════
     SECTIONS
     ══════════════════════════════════════════════════════ */
  .section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .section-title .agent-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .section-title .agent-role {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-muted);
    font-weight: 400;
  }

  /* ── TRIAGE BAR ─────────────────────────────────────── */
  .triage-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    margin-bottom: 14px;
    font-size: 11px;
    font-family: var(--mono);
    background: var(--surface-2);
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .triage-item { font-weight: 700; letter-spacing: 0.3px; }
  .triage-item.fail { color: var(--fail); }
  .triage-item.partial { color: var(--partial); }
  .triage-item.pass { color: var(--text-muted); }

  .triage-sep { color: var(--border); }

  .triage-label {
    color: var(--text-dim);
    margin-left: auto;
    font-weight: 500;
  }

  /* ── CARD GRID ──────────────────────────────────────── */
  .b-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
  }

  /* ── CARD BASE ──────────────────────────────────────── */
  .b-card {
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: var(--surface-2);
  }

  .b-card.pass {
    border-left-color: var(--pass);
    order: 2;
  }

  .b-card.partial {
    border-left-color: var(--partial);
    background: var(--partial-bg);
    border-color: var(--partial-border);
    border-left-color: var(--partial);
    order: 1;
  }

  .b-card.fail {
    border-left-color: var(--fail);
    border-left-width: 4px;
    background: var(--fail-bg);
    border-color: var(--fail-border);
    border-left-color: var(--fail);
    order: 0;
  }

  /* ── CARD HEADER ────────────────────────────────────── */
  .b-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .b-agent {
    font-size: 10px;
    font-family: var(--mono);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .b-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .b-type-tag {
    display: inline-block;
    font-size: 9px;
    font-family: var(--mono);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text-muted);
    vertical-align: middle;
  }

  .b-score-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .b-conf-num {
    font-size: 12px;
    font-weight: 700;
    font-family: var(--mono);
    min-width: 22px;
    text-align: right;
  }

  .b-conf-num.high { color: var(--pass); }
  .b-conf-num.mid { color: var(--partial); }
  .b-conf-num.low { color: var(--fail); }

  .b-score {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .b-score.pass { background: var(--pass-bg); color: var(--pass); border: 1px solid var(--pass-border); }
  .b-score.partial { background: var(--partial-bg); color: var(--partial); border: 1px solid var(--partial-border); font-size: 11px; padding: 3px 10px; }
  .b-score.fail { background: var(--fail-bg); color: var(--fail); border: 1px solid var(--fail-border); font-size: 11px; padding: 3px 10px; font-weight: 800; }

  /* ── CRITERIA LIST ──────────────────────────────────── */
  .b-criteria {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .b-criteria li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 11px;
    line-height: 1.4;
  }

  .b-criteria li.met {
    color: var(--text-muted);
    font-size: 10px;
  }

  .b-criteria li.missed {
    color: var(--text);
    font-weight: 500;
  }

  .b-crit-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .b-crit-dot.met { background: var(--pass); opacity: 0.5; }

  .b-crit-dot.missed {
    background: var(--fail);
    width: 8px;
    height: 8px;
    margin-top: 4px;
    box-shadow: 0 0 4px var(--fail);
  }

  .b-criteria-summary {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-muted);
    padding: 2px 0;
  }

  .b-criteria-summary .count { color: var(--pass); font-weight: 600; }

  .b-mismatch {
    font-size: 10px;
    font-family: var(--mono);
    color: var(--partial);
    font-weight: 600;
    padding-top: 6px;
    border-top: 1px solid rgba(255,255,255,0.05);
  }


  /* ══════════════════════════════════════════════════════
     SECTION BADGE
     ══════════════════════════════════════════════════════ */
  .section-badge {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-muted);
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 2px 8px;
    font-weight: 400;
  }

  /* ══════════════════════════════════════════════════════
     TREND TABLE
     ══════════════════════════════════════════════════════ */
  .trend-table { width: 100%; border-collapse: collapse; }

  .trend-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .trend-table td {
    padding: 10px 12px;
    border: 1px solid var(--border);
    font-size: 12px;
    vertical-align: middle;
  }

  .trend-table tr.today td { background: rgba(56,139,253,0.06); }

  .tag-mono { font-family: var(--mono); font-size: 12px; color: var(--text-dim); }

  .bar-cell { min-width: 180px; }

  .bar-row { display: flex; align-items: center; gap: 8px; }

  .bar-track {
    flex: 1;
    height: 8px;
    background: var(--surface-3);
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill { height: 100%; border-radius: 4px; background: var(--accent); }
  .bar-fill.today { background: var(--pass); }

  .bar-num {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    min-width: 40px;
  }

  .delta-badge {
    font-size: 10px;
    font-family: var(--mono);
    padding: 1px 6px;
    border-radius: 8px;
  }

  .delta-badge.up { background: var(--pass-bg); color: var(--pass); border: 1px solid var(--pass-border); }
  .delta-badge.down { background: var(--fail-bg); color: var(--fail); border: 1px solid var(--fail-border); }
  .delta-badge.same { background: var(--surface-3); color: var(--text-muted); border: 1px solid var(--border); }

  /* ══════════════════════════════════════════════════════
     DATA TABLE (regression, persistent non-pass)
     ══════════════════════════════════════════════════════ */
  .data-table { width: 100%; border-collapse: collapse; }

  .data-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .data-table td {
    padding: 10px 12px;
    border: 1px solid var(--border);
    font-size: 12px;
    vertical-align: top;
  }

  .score-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .score-chip.pass { background: var(--pass-bg); color: var(--pass); border: 1px solid var(--pass-border); }
  .score-chip.partial { background: var(--partial-bg); color: var(--partial); border: 1px solid var(--partial-border); }
  .score-chip.fail { background: var(--fail-bg); color: var(--fail); border: 1px solid var(--fail-border); }

  /* ══════════════════════════════════════════════════════
     CALIBRATION TABLE
     ══════════════════════════════════════════════════════ */
  .cal-table { width: 100%; border-collapse: collapse; }

  .cal-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .cal-table td {
    padding: 10px 12px;
    border: 1px solid var(--border);
    font-size: 12px;
    font-family: var(--mono);
    vertical-align: middle;
  }

  .gap-bar { display: inline-flex; align-items: center; gap: 6px; }
  .gap-val { min-width: 36px; }
  .gap-indicator { width: 60px; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
  .gap-fill { height: 100%; border-radius: 3px; }
  .gap-fill.over { background: var(--fail); }
  .gap-fill.under { background: var(--partial); }
  .gap-fill.ok { background: var(--pass); }

  .cal-flag {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 7px;
    border-radius: 8px;
  }

  .cal-flag.over { background: var(--fail-bg); color: var(--fail); border: 1px solid var(--fail-border); }
  .cal-flag.under { background: var(--partial-bg); color: var(--partial); border: 1px solid var(--partial-border); }
  .cal-flag.ok { background: var(--pass-bg); color: var(--pass); border: 1px solid var(--pass-border); }

  /* ══════════════════════════════════════════════════════
     FOOTER
     ══════════════════════════════════════════════════════ */
  .footer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 16px;
  }

  .footer-meta { display: flex; flex-direction: column; gap: 4px; }

  .footer-meta-row { font-size: 11px; font-family: var(--mono); color: var(--text-muted); }
  .footer-meta-row span { color: var(--text-dim); }

  .footer-credit {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--mono);
    text-align: right;
  }

  /* ── EMPTY STATE ─────────────────────────────────────────── */
  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 13px;
  }

  /* ── UTILITIES ───────────────────────────────────────────── */
  .bird-color { color: var(--bird); }
  .mj-color { color: var(--mj); }
  .shaq-color { color: var(--shaq); }
  .kobe-color { color: var(--kobe); }
  .pippen-color { color: var(--pippen); }
  .magic-color { color: var(--magic); }

  .nowrap { white-space: nowrap; }

  /* ══════════════════════════════════════════════════════
     RESPONSIVE
     ══════════════════════════════════════════════════════ */
  @media (max-width: 768px) {
    .header-top { flex-direction: column; }
    .header-meta { justify-content: flex-start; }
    .meta-item { text-align: left; }
    .overall-score { flex-direction: column; align-items: flex-start; }
    .agent-summary-row { flex-direction: column; }
    .agent-chip { min-width: unset; }
    .footer { flex-direction: column; align-items: flex-start; }
    .footer-credit { text-align: left; }
  }
'''

# ── Build page content ─────────────────────────────────────────────────────

parts = []

def emit(s):
    parts.append(s)

emit(f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dream Team Eval Report &mdash; {h(report_date)}</title>
<style>
{CSS}
</style>
</head>
<body>
<div class="container">''')

# ── HEADER ─────────────────────────────────────────────────────────────────

if not current_run:
    emit(f'''
  <div class="header">
    <div class="header-top">
      <div>
        <div class="header-title">Dream Team Eval Report</div>
        <div class="header-sub">No eval runs found &mdash; run /eval to generate results</div>
      </div>
    </div>
    <div class="empty-state">No result files found in evals/results/<br>Run /eval to start an evaluation session.</div>
  </div>
''')
else:
    emit(f'''
  <div class="header">
    <div class="header-top">
      <div>
        <div class="header-title">Dream Team Eval Report</div>
        <div class="header-sub">{h(run_id)}&nbsp;&nbsp;--&nbsp;&nbsp;generated by eval-report.sh</div>
      </div>
      <div class="header-meta">
        <div class="meta-item">
          <div class="meta-label">Run Date</div>
          <div class="meta-value">{h(run_date)} UTC</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Scenarios</div>
          <div class="meta-value">{scenarios_run} of {scenarios_total} run</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Baseline</div>
          <div class="meta-value">{'complete' if is_complete_baseline else 'partial'}</div>
        </div>
      </div>
    </div>
    <div class="overall-score">
      <div class="score-numbers">
        <div class="score-pill pass"><div class="score-dot pass"></div>{total_pass} Pass</div>
        <div class="score-pill partial"><div class="score-dot partial"></div>{total_partial} Partial</div>
        <div class="score-pill fail"><div class="score-dot fail"></div>{total_fail} Fail</div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-label">{total_scored} scenarios scored &mdash; {pass_pct}% pass rate</div>
        <div class="progress-bar">
          <div class="progress-segment pass" style="width:{pass_pct}%"></div>
          <div class="progress-segment partial" style="width:{partial_pct}%"></div>
          <div class="progress-segment fail" style="width:{fail_pct}%"></div>
        </div>
      </div>
    </div>
''')

    # ── AGENT SUMMARY CHIPS ────────────────────────────────────────────────────

    # Build per-agent score map indexed by scenario type
    agent_type_score = {}
    for r in results:
        a = r.get('agent', '')
        stype = r.get('scenario_type', '')
        agent_type_score.setdefault(a, {})[stype] = r.get('score', '')

    emit('    <div class="agent-summary-row">')
    for agent in all_agents:
        color_var = agent_color_var(agent)
        type_scores = agent_type_score.get(agent, {})

        # 3 squares in order: happy-path, edge-case, escalation
        dot_html = '<div class="agent-chip-dots">'
        pass_count = 0
        for stype in SCENARIO_TYPES:
            sc = type_scores.get(stype, '')
            if sc == 'pass':
                dot_html += '<div class="dot pass"></div>'
                pass_count += 1
            elif sc == 'partial':
                dot_html += '<div class="dot partial"></div>'
            elif sc == 'fail':
                dot_html += '<div class="dot fail"></div>'
            else:
                dot_html += '<div class="dot" style="background:var(--surface-3)"></div>'
        dot_html += '</div>'

        total_scenarios = len([s for s in SCENARIO_TYPES if type_scores.get(s)])
        if total_scenarios == 0:
            total_scenarios = 3

        # Score class
        if pass_count == total_scenarios:
            score_cls = 'perfect'
        elif pass_count <= 1:
            score_cls = 'bad'
        else:
            score_cls = 'mixed'

        emit(f'''      <a class="agent-chip" href="#{h(agent)}">
        <div class="agent-chip-dot" style="background:var({color_var})"></div>
        <span class="agent-chip-name">{h(agent.capitalize())}</span>
        {dot_html}
        <span class="agent-chip-score {score_cls}">{pass_count}/{total_scenarios}</span>
      </a>''')

    emit('    </div>')
    emit('  </div>')

if not current_run:
    emit('</div></body></html>')
    html_content = '\n'.join(parts)
    with open(output_file, 'w') as f:
        f.write(html_content)
    sys.exit(0)

# ── AGENT SECTIONS ────────────────────────────────────────────────────────────

for agent in all_agents:
    color_var = agent_color_var(agent)
    role = agent_role(agent)
    agent_results = results_by_agent.get(agent, [])
    # Recompute from actual results — never trust agent_summaries field
    a_pass = sum(1 for r in agent_results if r.get('score') == 'pass')
    a_partial = sum(1 for r in agent_results if r.get('score') == 'partial')
    a_fail = sum(1 for r in agent_results if r.get('score') == 'fail')

    # Build pass/fail/partial header line
    pass_label = f"{a_pass}/{a_pass+a_partial+a_fail} pass"
    extras = []
    if a_partial:
        extras.append(f"{a_partial} partial")
    if a_fail:
        extras.append(f"{a_fail} fail")
    role_line = f"{h(role)} &middot; {pass_label}"
    if extras:
        role_line += " &middot; " + " &middot; ".join(extras)

    # Triage bar counts
    non_pass_count = a_partial + a_fail
    triage_parts = []
    if a_fail:
        triage_parts.append(f'<span class="triage-item fail">{a_fail} fail</span>')
    if a_partial:
        triage_parts.append(f'<span class="triage-item partial">{a_partial} partial</span>')
    if a_pass:
        triage_parts.append(f'<span class="triage-item pass">{a_pass} pass</span>')

    review_word = "needs" if non_pass_count == 1 else "need"
    triage_html = '\n    '.join(triage_parts)
    if triage_parts:
        triage_html += '\n    <span class="triage-sep">|</span>'
    triage_html += f'\n    <span class="triage-label">{non_pass_count} of {a_pass+a_partial+a_fail} {review_word} review</span>'

    emit(f'''
  <div class="section" id="{h(agent)}">
    <div class="section-title">
      <div class="agent-dot" style="background:var({color_var})"></div>
      {h(agent.capitalize())}
      <span class="agent-role">{role_line}</span>
    </div>

    <div class="triage-bar">
    {triage_html}
    </div>

    <div class="b-grid">''')

    for r in agent_results:
        score = r.get('score', '')
        stype = r.get('scenario_type', '')
        sid = r.get('scenario_id', '')
        sname = r.get('scenario_name', sid)
        obs_list = r.get('observations', [])
        conf = r.get('confidence_stated')
        duration_ms = r.get('duration_ms')
        tokens_used = r.get('tokens_used')

        type_tag = TYPE_TAGS.get(stype, stype[:3])
        # Extract scenario number from scenario_id (e.g., "scenario-01-..." -> "Scenario 01")
        scenario_num = ''
        if sid.startswith('scenario-'):
            sid_parts = sid.split('-')
            if len(sid_parts) >= 2:
                scenario_num = f'Scenario {sid_parts[1]}'
        type_label = scenario_num or stype

        # Confidence display
        conf_html = ''
        if conf is not None:
            if conf >= 80:
                conf_cls = 'high'
            elif conf >= 60:
                conf_cls = 'mid'
            else:
                conf_cls = 'low'
            conf_html = f'<span class="b-conf-num {conf_cls}">{conf}</span>'

        # Calibration mismatch
        mismatch_html = ''
        if conf is not None and conf >= 80 and score == 'fail':
            mismatch_html = f'<div class="b-mismatch">calibration mismatch &mdash; conf {conf} on fail</div>'

        # Determine if we show collapsed summary or full criteria list
        positive_obs = [ob for ob in obs_list if ob.get('type') == 'positive']
        negative_obs = [ob for ob in obs_list if ob.get('type') == 'negative']
        all_positive = len(negative_obs) == 0 and len(positive_obs) > 0

        if score == 'pass' and all_positive:
            # Collapsed summary
            crit_count = len(positive_obs)
            criteria_html = f'<div class="b-criteria-summary"><span class="count">{crit_count}/{crit_count}</span> criteria met</div>'
        else:
            # Full criteria list: missed first, then met
            criteria_items = ''
            for ob in negative_obs:
                criteria_items += f'<li class="missed"><span class="b-crit-dot missed"></span> {h(ob.get("text", ""))}</li>\n'
            for ob in positive_obs:
                criteria_items += f'<li class="met"><span class="b-crit-dot met"></span> {h(ob.get("text", ""))}</li>\n'
            if criteria_items:
                criteria_html = f'<ul class="b-criteria">\n{criteria_items}</ul>'
            else:
                criteria_html = ''

        # Metrics line (duration + tokens + cost)
        # PRICING_UPDATE: Keep in sync with scripts/cast.sh MODEL_RATES.
        # Blended cost rates ($/M tokens) using 85% input / 15% output ratio.
        #   opus:   (0.85 * $5)  + (0.15 * $25) = $8.00/MTok
        #   sonnet: (0.85 * $3)  + (0.15 * $15) = $4.80/MTok
        COST_PER_MTOK = {'magic': 4.80}
        COST_DEFAULT = 8.00  # opus — conservative fallback
        metrics_parts = []
        if duration_ms is not None:
            duration_s = duration_ms / 1000
            if duration_s >= 60:
                metrics_parts.append(f'{duration_s/60:.1f}m')
            else:
                metrics_parts.append(f'{duration_s:.0f}s')
        if tokens_used is not None:
            if tokens_used >= 1000:
                metrics_parts.append(f'{tokens_used/1000:.1f}k tok')
            else:
                metrics_parts.append(f'{tokens_used} tok')
            rate = COST_PER_MTOK.get(agent, COST_DEFAULT)
            cost_usd = tokens_used * rate / 1_000_000
            metrics_parts.append(f'${cost_usd:.3f}')
        metrics_html = ''
        if metrics_parts:
            metrics_html = f'<div class="b-mismatch" style="color:var(--text-2);font-weight:400">{" &middot; ".join(metrics_parts)}</div>'

        emit(f'''      <div class="b-card {h(score)}">
        <div class="b-header">
          <div>
            <div class="b-agent" style="color:var({color_var})">{h(type_label)}</div>
            <div class="b-name">{h(sname)} <span class="b-type-tag">{h(type_tag)}</span></div>
          </div>
          <div class="b-score-group">
            {conf_html}
            <div class="b-score {h(score)}">{h(score_label(score))}</div>
          </div>
        </div>
        {criteria_html}
        {mismatch_html}
        {metrics_html}
      </div>''')

    emit('''    </div>
  </div>
''')

# ── HISTORICAL TREND ─────────────────────────────────────────────────────────

num_runs = len(trend_rows)
emit(f'''
  <div class="section">
    <div class="section-title">
      Historical Trend
      <span class="section-badge">{num_runs} run{"s" if num_runs != 1 else ""}</span>
    </div>
''')

if not trend_rows:
    emit('<div class="empty-state">No historical data yet.</div>')
else:
    emit(f'''
    <table class="trend-table">
      <thead>
        <tr>
          <th>Run Date</th>
          <th>Pass</th>
          <th>Partial</th>
          <th>Fail</th>
          <th>Pass Rate</th>
          <th>Delta</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
''')
    for row in trend_rows:
        today_cls = ' class="today"' if row['is_today'] else ''
        bar_cls = 'today' if row['is_today'] else ''
        date_html = h(row['date'])
        if row['is_today']:
            date_html += ' <span style="color:var(--accent);font-size:10px">[today]</span>'
        date_style = 'style="color:var(--text)"' if row['is_today'] else ''

        delta = row['delta']
        if delta is None:
            delta_html = '<td>&mdash;</td>'
        elif delta > 0:
            delta_html = f'<td><span class="delta-badge up">+{delta}</span></td>'
        elif delta < 0:
            delta_html = f'<td><span class="delta-badge down">{delta}</span></td>'
        else:
            delta_html = '<td><span class="delta-badge same">0</span></td>'

        notes = h(row['notes']) if row['notes'] else ('Baseline run.' if row['is_baseline'] else '')

        emit(f'''        <tr{today_cls}>
          <td class="tag-mono" {date_style}>{date_html}</td>
          <td class="tag-mono" style="color:var(--pass)">{row["pass"]}</td>
          <td class="tag-mono" style="color:var(--partial)">{row["partial"]}</td>
          <td class="tag-mono" style="color:var(--fail)">{row["fail"]}</td>
          <td class="bar-cell">
            <div class="bar-row">
              <div class="bar-track"><div class="bar-fill {bar_cls}" style="width:{row["pass_rate"]}%"></div></div>
              <div class="bar-num" {"style='color:var(--pass)'" if row["is_today"] else ""}>{row["pass_rate"]}%</div>
            </div>
          </td>
          {delta_html}
          <td style="font-size:11px;color:var(--text-muted)">{notes}</td>
        </tr>
''')
    emit('''      </tbody>
    </table>
''')

emit('  </div>')

# ── REGRESSION DETECTION ──────────────────────────────────────────────────

baseline_label = h(prior_baseline_date) if prior_baseline_date else "none"
emit(f'''
  <div class="section">
    <div class="section-title">
      Regression Detection
      <span class="section-badge">vs. {baseline_label}</span>
    </div>
''')

if not prior_baseline:
    emit('<p style="font-size:12px;color:var(--text-muted);font-family:var(--mono)">No prior complete baseline found. Run a full eval (/eval) to establish a baseline.</p>')
elif not regressions:
    emit('<p style="font-size:12px;color:var(--pass);margin-bottom:12px;font-family:var(--mono)">No regressions detected in this run. All previously passing scenarios still pass.</p>')

if regressions:
    emit('<p style="font-size:12px;color:var(--fail);margin-bottom:12px;font-family:var(--mono)">' + f'{len(regressions)} regression(s) detected vs. prior baseline ({h(prior_baseline_date)}).</p>')

emit('''
    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Scenario</th>
          <th>Previous Score</th>
          <th>Current Score</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
''')

if not regressions:
    baseline_msg = f'No regressions — 0 scenarios degraded from prior run ({h(prior_baseline_date)})' if prior_baseline_date else 'No prior complete baseline to compare against'
    emit(f'        <tr><td style="color:var(--text-muted);font-size:11px;font-style:italic" colspan="5">{baseline_msg}</td></tr>')
else:
    for reg in regressions:
        agent_cls = agent_class(reg['agent'])
        emit(f'''        <tr>
          <td><span class="{agent_cls}" style="font-weight:600">{h(reg["agent"].capitalize())}</span></td>
          <td class="tag-mono">{h(reg["scenario_id"])}</td>
          <td><span class="score-chip {h(reg["prior_score"])}">{h(score_label(reg["prior_score"]))}</span></td>
          <td><span class="score-chip {h(reg["current_score"])}">{h(score_label(reg["current_score"]))}</span></td>
          <td style="font-size:11px;color:var(--text-muted)">Score decreased from {h(reg["prior_score"])} to {h(reg["current_score"])}.</td>
        </tr>
''')

emit('''      </tbody>
    </table>
''')

# Persistent non-pass
if persistent_non_pass:
    emit('''
    <div style="margin-top:16px;">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Persistent non-pass scenarios (carried over from prior runs):</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Scenario</th>
            <th>Score (all runs)</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
''')
    for pnp in persistent_non_pass:
        agent_cls = agent_class(pnp['agent'])
        chips = '&nbsp;'.join(f'<span class="score-chip {h(s)}">{h(score_label(s))}</span>' for s in pnp['history'])
        emit(f'''          <tr>
            <td><span class="{agent_cls}" style="font-weight:600">{h(pnp["agent"].capitalize())}</span></td>
            <td class="tag-mono">{h(pnp["scenario_id"])}</td>
            <td>{chips}</td>
            <td style="font-size:11px;color:var(--text-muted)">Non-pass in all {len(pnp["history"])} runs — consistent issue.</td>
          </tr>
''')
    emit('''        </tbody>
      </table>
    </div>
''')

emit('  </div>')

# ── CALIBRATION METRICS ──────────────────────────────────────────────────────

emit(f'''
  <div class="section">
    <div class="section-title">
      Calibration Metrics
      <span class="section-badge">stated confidence vs. actual pass rate</span>
    </div>
''')

if not agent_summaries:
    emit('<div class="empty-state">No calibration data available.</div>')
else:
    emit('''    <table class="cal-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Avg Stated Conf</th>
          <th>Actual Pass Rate</th>
          <th>Calibration Gap</th>
          <th>Flag</th>
        </tr>
      </thead>
      <tbody>
''')
    for agent in all_agents:
        summ = agent_summaries.get(agent, {})
        a_conf = summ.get('avg_confidence_stated')
        # Recompute pass_rate from actual results
        ar = results_by_agent.get(agent, [])
        if ar:
            a_pr = sum(1 for r in ar if r.get('score') == 'pass') / len(ar)
        else:
            a_pr = summ.get('pass_rate')
        # Recompute calibration_gap from actual data
        conf_values = [r.get('confidence_stated') for r in ar if r.get('confidence_stated') is not None]
        if conf_values and ar:
            a_conf = sum(conf_values) / len(conf_values)
            actual_score = sum(score_numeric(r.get('score', 'fail')) for r in ar) / len(ar)
            a_gap = a_conf - actual_score
        else:
            a_gap = summ.get('calibration_gap')
        agent_cls = agent_class(agent)

        conf_display = f"{round(a_conf)}%" if a_conf is not None else "n/a"
        pr_display = f"{round((a_pr or 0) * 100)}%" if a_pr is not None else "n/a"
        gap_display = cal_gap_label(a_gap)
        gap_cls = cal_gap_class(a_gap)
        flag_label = cal_flag_label(a_gap)

        # Bar width: clamp gap magnitude to 0-100%
        if a_gap is not None:
            bar_width = min(abs(a_gap), 100)
        else:
            bar_width = 0

        emit(f'''        <tr>
          <td><span class="{agent_cls}" style="font-weight:600">{h(agent.capitalize())}</span></td>
          <td>{h(conf_display)}</td>
          <td>{h(pr_display)}</td>
          <td>
            <div class="gap-bar">
              <span class="gap-val" style="color:var(--{'fail' if gap_cls == 'over' else 'partial' if gap_cls == 'under' else 'pass'})">{h(gap_display)}</span>
              <div class="gap-indicator"><div class="gap-fill {gap_cls}" style="width:{bar_width}%"></div></div>
            </div>
          </td>
          <td><span class="cal-flag {gap_cls}">{h(flag_label)}</span></td>
        </tr>
''')
    emit('''      </tbody>
    </table>
''')

emit('  </div>')

# ── FOOTER ───────────────────────────────────────────────────────────────────

emit(f'''
  <div class="footer">
    <div class="footer-meta">
      <div class="footer-meta-row">Run ID: <span>{h(run_id)}</span></div>
      <div class="footer-meta-row">Scenarios: <span>{scenarios_run} run of {scenarios_total} total</span></div>
      <div class="footer-meta-row">Commit: <span>{h(repo_commit)}</span></div>
      <div class="footer-meta-row">Report generated: <span>{h(report_date)}</span></div>
    </div>
    <div class="footer-credit">Generated by Dream Team Eval Runner &middot; scripts/eval-report.sh</div>
  </div>

</div>
</body>
</html>
''')

html_content = '\n'.join(parts)
with open(output_file, 'w') as f:
    f.write(html_content)

print(f'Report written to: {output_file}')
print(f'  Runs included: {len(runs)}')
print(f'  Scenarios scored: {total_scored}')
if total_scored > 0:
    print(f'  Pass rate: {pass_pct}%')
PYEOF

  echo "Done."
  echo "Open with: open \"$output_file\""
}

# ── Main dispatch ──────────────────────────────────────────────────────────────

case "${1:-}" in
  generate)   cmd_generate ;;
  list)        cmd_list ;;
  *)
    echo "Usage: eval-report.sh {generate|list}" >&2
    echo "" >&2
    echo "  generate   Generate HTML report from all evals/results/*.json files" >&2
    echo "  list       Show available eval result runs" >&2
    exit 1
    ;;
esac
