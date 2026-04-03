import type { EvalRun, EvalResult, AgentSummary, ScenarioHistoryEntry } from "../db.ts";
// EvalRun is also the previous baseline type
import { esc, pct, passBar, ms, cost, formatDate, agentChip, scoreBadge, truncate, AGENT_COLORS, agentColor } from "./html.ts";

// Alphabetical order for agents
const AGENT_ORDER = ["bird", "kobe", "magic", "mj", "pippen", "shaq"];

const AGENT_ROLES: Record<string, string> = {
  bird: "Domain Authority",
  mj: "Architect",
  shaq: "Executor",
  kobe: "Code Reviewer",
  pippen: "DevOps",
  magic: "Orchestrator"
};

function confClass(n: number | null): string {
  if (n == null) return "";
  if (n >= 75) return "high";
  if (n >= 50) return "mid";
  return "low";
}

function calFlag(gap: number | null): string {
  if (gap == null) return "";
  const absGap = Math.abs(gap);
  // gap = avg_stated - actual_pass_rate (positive = overconfident)
  if (gap > 5) return "over";
  if (gap < -5) return "under";
  return "ok";
}

function calFlagLabel(gap: number | null): string {
  if (gap == null) return "—";
  if (gap > 5) return "Blind Spot";
  if (gap < -5) return "Underconfident";
  return "Calibrated";
}

function scoreColor(rate: number): string {
  if (rate >= 0.8) return "var(--pass)";
  if (rate >= 0.5) return "var(--partial)";
  return "var(--fail)";
}

function typeClass(type: string): string {
  if (!type) return "";
  const first = type.split("/")[0].trim();
  return first.toLowerCase().replace(/\s+/g, "-");
}

export function EvalRunPage(
  run: EvalRun,
  results: EvalResult[],
  summaries: AgentSummary[],
  agents: string[],
  filterAgent: string,
  filterScore: string,
  previousBaseline: EvalRun | null = null,
  previousBaselineResults: EvalResult[] = [],
  previousBaselineSummaries: AgentSummary[] = [],
  allRuns: EvalRun[] = [],
  persistentNonPass: Array<{ agent: string; scenario_id: string; history: ScenarioHistoryEntry[] }> = [],
  phaseResultIds: Map<string, number> = new Map()
): string {
  const total = results.length;
  const trialCount = run.trials ?? 1;

  // Group results by agent+scenario for trial dots
  const byScenario = new Map<string, EvalResult[]>();
  for (const r of results) {
    const key = `${r.agent}::${r.scenario_id}`;
    if (!byScenario.has(key)) byScenario.set(key, []);
    byScenario.get(key)!.push(r);
  }

  let flakyCount = 0;
  for (const group of byScenario.values()) {
    if (group.length > 1) {
      const scores = new Set(group.map(g => g.score));
      if (scores.size > 1) flakyCount++;
    }
  }

  // Compute pass@k metrics (always compute, show conditionally)
  // pass@1 = total individual trials that pass / total individual trials (per-trial rate)
  // pass@k = fraction of scenarios where at least one trial passes
  // pass^k = fraction of scenarios where ALL trials pass
  let passAt1 = 0, passAtK = 0, passAllK = 0, uniqueScenarios = 0;
  {
    const scenarioGroups = new Map<string, EvalResult[]>();
    for (const r of results) {
      const key = `${r.agent}::${r.scenario_id}`;
      if (!scenarioGroups.has(key)) scenarioGroups.set(key, []);
      scenarioGroups.get(key)!.push(r);
    }
    uniqueScenarios = scenarioGroups.size;
    let atLeastOne = 0, allPass = 0;
    let totalTrials = 0, totalPassTrials = 0;
    for (const group of scenarioGroups.values()) {
      const hasPass = group.some(r => r.score === "pass");
      const allP = group.every(r => r.score === "pass");
      const passCount = group.filter(r => r.score === "pass").length;
      totalTrials += group.length;
      totalPassTrials += passCount;
      if (hasPass) atLeastOne++;
      if (allP) allPass++;
    }
    // pass@1: fraction of individual trial attempts that pass
    passAt1 = totalTrials > 0 ? Math.round((totalPassTrials / totalTrials) * 100) : 0;
    passAtK = uniqueScenarios > 0 ? Math.round((atLeastOne / uniqueScenarios) * 100) : 0;
    passAllK = uniqueScenarios > 0 ? Math.round((allPass / uniqueScenarios) * 100) : 0;
  }

  // Pass counts from run (these are unique scenario counts for multi-trial)
  const passCount = run.pass_count ?? 0;
  const partialCount = run.partial_count ?? 0;
  const failCount = run.fail_count ?? 0;
  const scenariosRun = run.scenarios_run ?? 0;
  const passRate = run.pass_rate ?? 0;
  const passRatePct = Math.round(passRate * 100);
  const partialPct = run.scenarios_run ? Math.round((partialCount / scenariosRun) * 100) : 0;
  const failPct = run.scenarios_run ? Math.round((failCount / scenariosRun) * 100) : 0;

  // Header
  const trialsLabel = trialCount > 1 ? `k=${trialCount} &middot; ${total} total` : `${total} total`;
  const baselineLabel = run.is_complete_baseline ? "complete" : "partial";

  const headerHtml = `
  <div class="header">
    <div class="header-top">
      <div>
        <div class="header-title">Dream Team Eval Report</div>
        <div class="header-sub">${esc(run.run_id)}</div>
      </div>
      <div class="header-meta">
        <div class="meta-item">
          <div class="meta-label">Run Date</div>
          <div class="meta-value">${esc(formatDate(run.timestamp))}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Scenarios</div>
          <div class="meta-value">${scenariosRun} of ${run.scenarios_total ?? scenariosRun} run</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Trials</div>
          <div class="meta-value">${trialsLabel}</div>
        </div>
        ${run.is_complete_baseline ? `
        <div class="meta-item">
          <div class="meta-label">Baseline</div>
          <div class="meta-value">${baselineLabel}</div>
        </div>` : ""}
      </div>
    </div>
    <div class="overall-score">
      <div class="score-numbers">
        <div class="score-pill pass"><div class="score-dot pass"></div>${passCount} Pass</div>
        <div class="score-pill partial"><div class="score-dot partial"></div>${partialCount} Partial</div>
        <div class="score-pill fail"><div class="score-dot fail"></div>${failCount} Fail</div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-label">${scenariosRun} scenarios scored &mdash; ${passRatePct}% pass rate${trialCount > 1 ? ` (worst-score across k=${trialCount})` : ""}</div>
        <div class="progress-bar">
          <div class="progress-segment pass" style="width:${passRatePct}%"></div>
          <div class="progress-segment partial" style="width:${partialPct}%"></div>
          <div class="progress-segment fail" style="width:${failPct}%"></div>
        </div>
      </div>
    </div>
    <div class="passk-metrics">
      <div class="passk-metric">
        <div class="passk-metric-label">pass@1</div>
        <div class="passk-metric-value" style="color:${scoreColor(passAt1 / 100)};">${passAt1}%</div>
        <div class="passk-metric-sub">any single attempt</div>
      </div>
      ${trialCount > 1 ? `
      <div class="passk-metric">
        <div class="passk-metric-label">pass@${trialCount}</div>
        <div class="passk-metric-value" style="color:${scoreColor(passAtK / 100)};">${passAtK}%</div>
        <div class="passk-metric-sub">at least 1 of ${trialCount} passes</div>
      </div>
      <div class="passk-metric">
        <div class="passk-metric-label">pass^${trialCount}</div>
        <div class="passk-metric-value" style="color:${scoreColor(passAllK / 100)};">${passAllK}%</div>
        <div class="passk-metric-sub">all ${trialCount} attempts pass</div>
      </div>
      <div class="passk-metric">
        <div class="passk-metric-label">Flaky</div>
        <div class="passk-metric-value" style="color:${flakyCount > 0 ? "var(--fail)" : "var(--text-muted)"};">${flakyCount}</div>
        <div class="passk-metric-sub">scenarios with mixed results</div>
      </div>
      <div class="passk-metric">
        <div class="passk-metric-label">Saturated</div>
        <div class="passk-metric-value" style="color:var(--text-muted);">0</div>
        <div class="passk-metric-sub">agents at 100% &mdash; add harder scenarios</div>
      </div>` : ""}
    </div>
    <div style="height: 16px;"></div>
    ${summaries.length > 0 ? buildAgentChipRow(summaries, results) : ""}
  </div>`;

  // Calibration section
  let calibrationHtml = "";
  if (summaries.length > 0 && summaries.some(s => s.avg_confidence_stated != null)) {
    calibrationHtml = `
  <div class="section">
    <div class="section-title">
      Calibration Metrics
      <span class="section-badge">stated confidence vs. actual pass rate</span>
    </div>
    <table class="cal-table">
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
        ${summaries.map(s => {
          if (s.avg_confidence_stated == null) return "";
          const color = agentColor(s.agent);
          const actualPct = Math.round((s.pass_rate ?? 0) * 100);
          const statedPct = Math.round(s.avg_confidence_stated);
          // gap = stated - actual (positive = overconfident)
          // DB calibration_gap = actual_pass_rate*100 - avg_stated_conf
          // Display convention (matching standalone report): stated - actual
          // Positive display gap = overconfident (blind spot), negative = underconfident
          const dbGap = s.calibration_gap ?? 0;
          const gap = -dbGap; // negate: positive now means overconfident
          const absGap = Math.abs(gap);
          const gapClass = gap > 5 ? "over" : gap < -5 ? "under" : "ok";
          const gapSign = gap > 0 ? "+" : "";
          const gapColor = gap > 5 ? "var(--fail)" : gap < -5 ? "var(--partial)" : "var(--pass)";
          const flagLabel = calFlagLabel(gap);
          const flagClass = calFlag(gap);
          return `
        <tr>
          <td><span style="color:${color};font-weight:600">${esc(s.agent)}</span></td>
          <td>${statedPct}%</td>
          <td>${actualPct}%</td>
          <td>
            <div class="gap-bar">
              <span class="gap-val" style="color:${gapColor}">${gapSign}${Math.round(gap)}pp</span>
              <div class="gap-indicator"><div class="gap-fill ${gapClass}" style="width:${Math.min(absGap, 50)}%"></div></div>
            </div>
          </td>
          <td><span class="cal-flag ${flagClass}">${esc(flagLabel)}</span></td>
        </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
  }

  // Focus section
  const focusHtml = buildFocusSection(run, results, summaries, byScenario, trialCount, previousBaseline, previousBaselineSummaries);

  // Per-agent sections
  const agentSections = buildAgentSections(results, summaries, run.run_id, byScenario, trialCount);

  // Team pipeline phase sections (one card-group per agent, below team card)
  const teamPhaseSections = buildTeamPhaseSections(results, phaseResultIds, run.run_id);

  // Missing sections (bugs 7-10)
  const flakyScenariosHtml = trialCount > 1 ? buildFlakyScenariosSection(byScenario, summaries) : "";
  const agentReliabilityHtml = trialCount > 1 ? buildAgentReliabilitySection(byScenario, summaries, trialCount) : "";
  const regressionAlertsSectionHtml = buildRegressionAlertsSection(results, previousBaselineResults, previousBaseline);
  const regressionAlertsHtml = buildRegressionDetectionSection(results, previousBaselineResults, summaries, previousBaseline, persistentNonPass);
  const historicalTrendHtml = buildHistoricalTrendSection(allRuns, run.run_id);

  // Filters
  const runIdEncoded = encodeURIComponent(run.run_id);
  const agentOptions = [
    `<option value="" ${filterAgent === "" ? "selected" : ""}>All agents</option>`,
    ...agents.map(a => `<option value="${esc(a)}" ${filterAgent === a ? "selected" : ""}>${esc(a)}</option>`)
  ].join("");

  const scoreFilters = ["", "pass", "partial", "fail"].map(s => {
    const label = s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1);
    const active = filterScore === s ? ` active${s ? " " + s : ""}` : "";
    return `<button class="filter-btn${active}"
      hx-get="/evals/${runIdEncoded}/results?agent=${esc(filterAgent)}&score=${esc(s)}"
      hx-target="#results-table"
      hx-push-url="true"
      onclick="setActiveScore(this, '${esc(s)}')"
    >${label}</button>`;
  }).join("");

  const filtersHtml = `
    <div class="filters">
      <label>Agent:</label>
      <select class="filter-select"
        hx-get="/evals/${runIdEncoded}/results"
        hx-target="#results-table"
        hx-push-url="true"
        hx-include="this"
        name="agent"
      >
        ${agentOptions}
      </select>
      <label>Score:</label>
      ${scoreFilters}
      <span class="htmx-indicator"><span class="spinner"></span></span>
    </div>
  `;

  const tableHtml = ResultsTableFragment(results, run.run_id);

  // Footer
  let metaObj: Record<string, unknown> = {};
  try { if (run.meta) metaObj = JSON.parse(run.meta); } catch { /* skip corrupt meta */ }
  const repoCommit = metaObj.repo_commit ?? "";
  const footerHtml = `
  <div class="footer">
    <div class="footer-meta">
      <div class="footer-meta-row">Run ID: <span>${esc(run.run_id)}</span></div>
      <div class="footer-meta-row">Scenarios: <span>${scenariosRun} run of ${run.scenarios_total ?? scenariosRun} total</span></div>
      ${repoCommit ? `<div class="footer-meta-row">Commit: <span>${esc(repoCommit)}</span></div>` : ""}
      <div class="footer-meta-row">Report generated: <span>${new Date().toISOString().slice(0, 10)}</span></div>
    </div>
    <div class="footer-credit">Generated by Dream Team Eval Runner &middot; dreamteam-web</div>
  </div>`;

  return `
    <a href="/" class="back-link">&#8592; Dashboard</a>
    ${headerHtml}
    ${calibrationHtml}
    ${focusHtml}
    ${agentSections}
    ${teamPhaseSections}
    ${flakyScenariosHtml}
    ${agentReliabilityHtml}
    ${regressionAlertsSectionHtml}
    ${regressionAlertsHtml}
    ${historicalTrendHtml}
    <div class="section" style="margin-bottom: 16px;">
      <details>
      <summary class="section-title" style="cursor:pointer;list-style:none">
        All Results Table
        <span class="section-badge">${total} results</span>
        <span class="chevron" style="margin-left:auto;font-size:12px;color:var(--text-muted)">&#9658;</span>
      </summary>
      <div style="margin-top:14px">
        ${filtersHtml}
        <div class="table-wrap" id="results-table">
          ${tableHtml}
        </div>
      </div>
      </details>
    </div>
    ${footerHtml}
    <script>
    function setActiveScore(btn, score) {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active', 'pass', 'partial', 'fail');
      });
      btn.classList.add('active');
      if (score) btn.classList.add(score);
    }
    // Make section details summary chevron work
    document.querySelectorAll('.section details summary').forEach(s => {
      s.style.listStyle = 'none';
    });
    </script>
  `;
}

// The 3 fixed scenario type slots shown in the chip dots (matches evals/src/cli.ts convention)
const CHIP_SCENARIO_TYPES = ["happy-path", "edge-case", "escalation"] as const;

function scoreOrd(score: string): number {
  if (score === "fail") return 0;
  if (score === "partial") return 1;
  return 2; // pass or empty
}

/** Normalise a raw scenario_type to one of the 3 chip slots, or null */
function chipSlot(stype: string | null): typeof CHIP_SCENARIO_TYPES[number] | null {
  if (!stype) return null;
  const t = stype.toLowerCase().replace(/ /g, "-");
  if (t.startsWith("happy")) return "happy-path";
  if (t.startsWith("edge")) return "edge-case";
  if (t.startsWith("escalat")) return "escalation";
  return null;
}

function buildAgentChipRow(summaries: AgentSummary[], results: EvalResult[]): string {
  // Sort summaries alphabetically
  const sortedSummaries = [...summaries].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai === -1 && bi === -1) return a.agent.localeCompare(b.agent);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Build per-agent worst-score per chip slot
  const agentTypeScore: Record<string, Record<string, string>> = {};
  for (const r of results) {
    const agent = r.agent.toLowerCase();
    const slot = chipSlot(r.scenario_type);
    if (!slot) continue;
    if (!agentTypeScore[agent]) agentTypeScore[agent] = {};
    const existing = agentTypeScore[agent][slot];
    // Keep worst score across all scenarios in that slot
    if (!existing || scoreOrd(r.score) < scoreOrd(existing)) {
      agentTypeScore[agent][slot] = r.score;
    }
  }

  const chips = sortedSummaries.map(s => {
    const color = agentColor(s.agent);
    const agent = s.agent.toLowerCase();
    const chipName = s.agent.charAt(0).toUpperCase() + s.agent.slice(1);
    const typeScores = agentTypeScore[agent] ?? {};

    let passCount = 0;
    let totalSlots = 0;
    const dots = CHIP_SCENARIO_TYPES.map(stype => {
      const sc = typeScores[stype] ?? "";
      if (sc) totalSlots++;
      if (sc === "pass") { passCount++; return `<div class="dot pass"></div>`; }
      if (sc === "partial") return `<div class="dot partial"></div>`;
      if (sc === "fail") return `<div class="dot fail"></div>`;
      return `<div class="dot" style="background:var(--surface-3)"></div>`;
    }).join("");

    if (totalSlots === 0) totalSlots = 3;
    const scoreClass = passCount === totalSlots ? "perfect" : passCount === 0 ? "bad" : "mixed";

    return `
        <a class="agent-chip" href="#${esc(agent)}">
          <div class="agent-chip-dot" style="background:${color}"></div>
          <span class="agent-chip-name">${esc(chipName)}</span>
          <div class="agent-chip-dots">${dots}</div>
          <span class="agent-chip-score ${scoreClass}">${passCount}/${totalSlots}</span>
        </a>`;
  }).join("");

  return `<div class="agent-summary-row">${chips}\n    </div>`;
}

function buildFocusSection(
  run: EvalRun,
  results: EvalResult[],
  summaries: AgentSummary[],
  byScenario: Map<string, EvalResult[]>,
  trialCount: number,
  previousBaseline: EvalRun | null,
  previousBaselineSummaries: AgentSummary[] = []
): string {
  // Compute trend vs previous baseline
  const currPct = run.pass_rate != null ? Math.round(run.pass_rate * 100) : 0;
  let trendDirection = "stable";
  let trendHeadline = `Stable &mdash; pass rate unchanged at ${currPct}%`;
  let trendDetail = "No prior baseline to compare";
  let prevPct: number | null = null;
  let deltaPct: number | null = null;

  if (previousBaseline) {
    prevPct = previousBaseline.pass_rate != null ? Math.round(previousBaseline.pass_rate * 100) : 0;
    deltaPct = currPct - prevPct;
    if (deltaPct > 0) {
      trendDirection = "improved";
      trendHeadline = `Improving &mdash; pass rate up from ${prevPct}% to ${currPct}%`;
    } else if (deltaPct < 0) {
      trendDirection = "regressed";
      trendHeadline = `Regressed &mdash; pass rate down from ${prevPct}% to ${currPct}%`;
    } else {
      trendDirection = "stable";
      trendHeadline = `Stable &mdash; pass rate unchanged at ${currPct}%`;
    }
    const regressionCount = results.filter(r => r.category === "regression" && r.score !== "pass").length;
    trendDetail = `vs baseline ${esc(previousBaseline.run_id)} &middot; ${regressionCount} regression(s)`;
  }

  const arrowClass = trendDirection === "improved" ? "up" : trendDirection === "regressed" ? "down" : "flat";
  const arrowChar = trendDirection === "improved" ? "&#8593;" : trendDirection === "regressed" ? "&#8595;" : "&#8594;";

  const trendNumbersHtml = prevPct != null && deltaPct != null ? `
    <div class="trend-numbers">
      <div class="trend-num-item">
        <div class="trend-num-label">prev</div>
        <div class="trend-num-value" style="color:var(--text-dim)">${prevPct}%</div>
      </div>
      <div class="trend-num-item">
        <div class="trend-num-label">now</div>
        <div class="trend-num-value" style="color:${trendDirection === "improved" ? "var(--pass)" : trendDirection === "regressed" ? "var(--fail)" : "var(--text-dim)"}">${currPct}%</div>
      </div>
      <div class="trend-num-item">
        <div class="trend-num-label">delta</div>
        <div class="trend-num-value" style="color:${deltaPct > 0 ? "var(--pass)" : deltaPct < 0 ? "var(--fail)" : "var(--text-muted)"}">${deltaPct > 0 ? "+" : ""}${deltaPct}%</div>
      </div>
    </div>` : "";

  // Build action items
  interface ActionItem {
    level: "critical" | "warning" | "info";
    priority: "p1" | "p2" | "p3";
    agent: string;
    text: string;
    detail: string;
  }
  const actionItems: ActionItem[] = [];

  // Group results by scenario (across trials) for analysis
  const byAgentScenario = new Map<string, EvalResult[]>();
  for (const r of results) {
    const key = `${r.agent}::${r.scenario_id}`;
    if (!byAgentScenario.has(key)) byAgentScenario.set(key, []);
    byAgentScenario.get(key)!.push(r);
  }

  // P1: Grader hard gate failures (any trial has a grader fail)
  const graderFailSeen = new Set<string>();
  for (const [key, group] of byAgentScenario.entries()) {
    const [agent] = key.split("::");
    const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
    for (const r of group) {
      if (!r.grader_results) continue;
      try {
        const graders = JSON.parse(r.grader_results) as Array<{ type: string; config?: Record<string, unknown>; passed: boolean }>;
        const failedGraders = graders.filter(g => !g.passed);
        if (failedGraders.length > 0 && !graderFailSeen.has(key)) {
          graderFailSeen.add(key);
          const sname = r.scenario_name ?? r.scenario_id;
          const graderDesc = failedGraders.map(g => {
            let label = g.type;
            if (g.config) {
              const parts: string[] = [];
              if (g.config.path) parts.push(`path=${g.config.path}`);
              if (g.config.min_items != null) parts.push(`min_items=${g.config.min_items}`);
              if (g.config.max_items != null) parts.push(`max_items=${g.config.max_items}`);
              if (g.config.min != null) parts.push(`min=${g.config.min}`);
              if (g.config.max != null) parts.push(`max=${g.config.max}`);
              if (g.config.equals != null) parts.push(`equals=${g.config.equals}`);
              if (parts.length) label += " " + parts.join(", ");
            }
            return label;
          }).join(", ");
          actionItems.push({
            level: "critical", priority: "p1", agent: agent.toLowerCase(),
            text: `<strong>Grader hard gate failed</strong> &mdash; <span class="action-agent ${agent.toLowerCase()}-color">${esc(agentName)}</span> "${esc(sname)}"`,
            detail: `Grader failed: ${esc(graderDesc)}. Check if the prompt needs clarification or if output format drifted.`
          });
        }
      } catch { /* skip */ }
    }
  }

  // P1: Calibration blind spots (high confidence on fail)
  for (const [key, group] of byAgentScenario.entries()) {
    const [agent] = key.split("::");
    const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
    for (const r of group) {
      if (r.score === "fail" && r.confidence_stated != null && r.confidence_stated >= 90) {
        const sname = r.scenario_name ?? r.scenario_id;
        actionItems.push({
          level: "critical", priority: "p1", agent: agent.toLowerCase(),
          text: `<strong>Calibration blind spot</strong> &mdash; <span class="action-agent ${agent.toLowerCase()}-color">${esc(agentName)}</span> "${esc(sname)}" scored <strong>fail</strong> with <strong>${Math.round(r.confidence_stated)}%</strong> confidence`,
          detail: `Agent was ${Math.round(r.confidence_stated)}% confident on a scenario it failed. This indicates the agent cannot detect when it is wrong. Review the scenario rubric and agent prompt for systemic overconfidence patterns.`
        });
      }
    }
  }

  // P1: Regression-category scenarios at fail or partial
  for (const [key, group] of byAgentScenario.entries()) {
    const [agent] = key.split("::");
    const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
    const primaryResult = group.find(r => r.trial_index === 0) ?? group[0];
    if (primaryResult.category === "regression" && primaryResult.score !== "pass") {
      const sname = primaryResult.scenario_name ?? primaryResult.scenario_id;
      actionItems.push({
        level: "critical", priority: "p1", agent: agent.toLowerCase(),
        text: `<strong>Regression-category scenario at ${esc(primaryResult.score)}</strong> &mdash; <span class="action-agent ${agent.toLowerCase()}-color">${esc(agentName)}</span> "${esc(sname)}"`,
        detail: `This scenario is marked as a regression guard. It should pass. Investigate root cause.`
      });
    }
  }

  // P2: Flaky scenarios (mixed trial results)
  if (trialCount > 1) {
    for (const [key, group] of byAgentScenario.entries()) {
      if (group.length <= 1) continue;
      const [agent] = key.split("::");
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      const scores = new Set(group.map(r => r.score));
      if (scores.size > 1) {
        const passCount = group.filter(r => r.score === "pass").length;
        const sname = (group[0].scenario_name ?? group[0].scenario_id);
        // Try to find a failure reason for the flaky detail
        const failResult = group.find(r => r.score !== "pass");
        const detail = failResult?.failure_reason
          ? `${passCount}/${group.length} pass. ${esc(failResult.failure_reason)}`
          : `${passCount}/${group.length} pass. Mixed results across trials &mdash; tighten prompt or relax threshold.`;
        actionItems.push({
          level: "warning", priority: "p2", agent: agent.toLowerCase(),
          text: `<strong>Flaky scenario</strong> &mdash; <span class="action-agent ${agent.toLowerCase()}-color">${esc(agentName)}</span> "${esc(sname)}"`,
          detail
        });
      }
    }
  }

  // Build agent-filter chips (alphabetical)
  const agentNames = [...summaries].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai === -1 && bi === -1) return a.agent.localeCompare(b.agent);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  }).map(s => s.agent);
  const filterChips = [
    `<button class="filter-chip active" data-filter="all">All</button>`,
    ...agentNames.map(a => {
      const label = a.charAt(0).toUpperCase() + a.slice(1);
      return `<button class="filter-chip" data-filter="${esc(a.toLowerCase())}">${esc(label)}</button>`;
    })
  ].join("");

  // Build action items HTML
  const actionItemsHtml = actionItems.length > 0
    ? `<ul class="action-list">
      ${actionItems.map(item => `
      <li class="action-item ${item.level}" data-agent="${esc(item.agent)}">
        <span class="action-priority ${item.priority}">${item.priority.toUpperCase()}</span>
        <div>
          <div class="action-text">${item.text}</div>
          <div class="action-detail">${item.detail}</div>
        </div>
      </li>`).join("")}
    </ul>` : "";

  // Build agent change chips from summaries with delta vs previous baseline
  // Sort alphabetically
  const sortedSummaries = [...summaries].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai === -1 && bi === -1) return a.agent.localeCompare(b.agent);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const agentChangeChips = sortedSummaries.map(s => {
    const color = agentColor(s.agent);
    const chipName = s.agent.charAt(0).toUpperCase() + s.agent.slice(1);
    const passC = s.pass_count ?? 0;
    const partialC = s.partial_count ?? 0;
    const failC = s.fail_count ?? 0;
    const currTotal = passC + partialC + failC;
    const currPct = currTotal > 0 ? Math.round((passC / currTotal) * 100) : 0;

    // Compute delta vs previous baseline per agent (rate-based, not count-based)
    const prevSummary = previousBaselineSummaries.find(p => p.agent.toLowerCase() === s.agent.toLowerCase());
    let deltaHtml = "";
    let noteHtml = "";
    if (prevSummary != null) {
      const prevPass = prevSummary.pass_count ?? 0;
      const prevTotal = prevPass + (prevSummary.partial_count ?? 0) + (prevSummary.fail_count ?? 0);
      const prevPct = prevTotal > 0 ? Math.round((prevPass / prevTotal) * 100) : 0;
      const deltaPct = currPct - prevPct;
      let deltaClass = "same";
      let deltaText = "=";
      if (deltaPct > 0) { deltaClass = "up"; deltaText = `+${deltaPct}%`; }
      else if (deltaPct < 0) { deltaClass = "down"; deltaText = `${deltaPct}%`; }
      deltaHtml = `<span class="change-delta ${deltaClass}">${deltaText}</span>`;
      if (deltaPct < 0) {
        noteHtml = `<span class="change-note">regression</span>`;
      }
    } else {
      // No previous baseline — show absolute pass rate
      const deltaClass = currPct >= 80 ? "up" : currPct >= 50 ? "same" : "down";
      deltaHtml = `<span class="change-delta ${deltaClass}">${currPct}%</span>`;
    }

    return `
    <div class="agent-change-chip" data-agent="${esc(s.agent.toLowerCase())}">
      <div class="change-dot" style="background:${color}"></div>
      <span class="change-name">${esc(chipName)}</span>
      ${deltaHtml}
      ${noteHtml}
    </div>`;
  }).join("");

  return `
  <div class="focus">
    <details open>
    <summary class="focus-title">
      Focus
      <span class="section-badge">what changed &middot; what to do</span>
      <span class="chevron"></span>
    </summary>

    <div class="focus-filter">${filterChips}</div>

    <div class="trend-verdict ${trendDirection}">
      <div class="trend-arrow ${arrowClass}">${arrowChar}</div>
      <div class="trend-body">
        <div class="trend-headline ${trendDirection}">${trendHeadline}</div>
        <div class="trend-detail">${trendDetail}</div>
      </div>
      ${trendNumbersHtml}
    </div>
    ${actionItemsHtml}
    <div class="agent-changes">
      ${agentChangeChips}
    </div>
  </details>
  </div>
  <script>
  (function() {
    function applyFilter(agent) {
      var isAll = agent === 'all';
      document.querySelectorAll('.action-item').forEach(function(el) {
        el.style.display = (isAll || el.dataset.agent === agent) ? '' : 'none';
      });
      document.querySelectorAll('.agent-change-chip').forEach(function(el) {
        el.style.display = (isAll || el.dataset.agent === agent) ? '' : 'none';
      });
      // Agent sections: id equals agent name (e.g. id="bird")
      document.querySelectorAll('.section[id]').forEach(function(el) {
        el.style.display = (isAll || el.id === agent) ? '' : 'none';
      });
    }
    document.addEventListener('click', function(e) {
      var chip = e.target.closest('.filter-chip');
      if (!chip) return;
      var filter = chip.dataset.filter;
      var wasActive = chip.classList.contains('active');
      document.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); });
      if (wasActive && filter !== 'all') {
        document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
        applyFilter('all');
      } else {
        chip.classList.add('active');
        applyFilter(filter);
      }
    });
  })();
  </script>`;
}

function buildAgentSections(
  results: EvalResult[],
  summaries: AgentSummary[],
  runId: string,
  byScenario: Map<string, EvalResult[]>,
  trialCount: number
): string {
  // Group all results by agent
  const byAgent = new Map<string, EvalResult[]>();
  for (const r of results) {
    if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
    byAgent.get(r.agent)!.push(r);
  }

  // Get unique scenarios per agent (trial_index=0 is the "display" trial)
  const sections: string[] = [];

  // Order agents alphabetically (bird, kobe, magic, mj, pippen, shaq)
  const agentSet = new Set(byAgent.keys());
  const agentOrder = [...agentSet].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  for (const agent of agentOrder) {
    const agentResults = byAgent.get(agent);
    if (!agentResults || agentResults.length === 0) continue;

    const summary = summaries.find(s => s.agent === agent);
    const color = agentColor(agent);
    const role = AGENT_ROLES[agent.toLowerCase()] ?? "Agent";

    const passC = summary?.pass_count ?? 0;
    const partialC = summary?.partial_count ?? 0;
    const failC = summary?.fail_count ?? 0;
    const totalScenarios = passC + partialC + failC;
    const needReview = partialC + failC;

    // Get unique scenarios (first trial or only result per scenario)
    const scenarioMap = new Map<string, EvalResult[]>();
    for (const r of agentResults) {
      if (!scenarioMap.has(r.scenario_id)) scenarioMap.set(r.scenario_id, []);
      scenarioMap.get(r.scenario_id)!.push(r);
    }

    // Sort scenarios by scenario_id (natural/alphabetical order, matching evals/src/cli.ts)
    const sortedScenarios = Array.from(scenarioMap.entries()).sort(([aId], [bId]) =>
      aId.localeCompare(bId)
    );

    const cards = sortedScenarios.map(([scenarioId, scenarioTrials]) => {
      // Sort trials by trial_index
      scenarioTrials.sort((a, b) => a.trial_index - b.trial_index);
      // Best/worst score for display (use first trial or worst across trials)
      const worstResult = scenarioTrials.reduce((worst, r) => {
        const order = (s: string) => s === "fail" ? 0 : s === "partial" ? 1 : 2;
        return order(r.score) < order(worst.score) ? r : worst;
      }, scenarioTrials[0]);

      const displayResult = scenarioTrials.find(r => r.trial_index === 0) ?? scenarioTrials[0];
      const cardScore = displayResult.score;
      const scenarioName = displayResult.scenario_name ?? displayResult.scenario_id;
      const scenarioType = displayResult.scenario_type ?? "";
      const category = displayResult.category ?? "";

      const confNum = displayResult.confidence_stated;
      const confClass2 = confNum != null ? (confNum >= 75 ? "high" : confNum >= 50 ? "mid" : "low") : "";

      // Grader results
      let graderRowHtml = "";
      if (displayResult.grader_results) {
        try {
          const graders: Array<{type: string; config?: Record<string,unknown>; passed: boolean; detail?: string}> = JSON.parse(displayResult.grader_results);
          const chips = graders.map(g => {
            const chipClass = g.passed ? "grader-pass" : "grader-fail";
            const icon = g.passed ? "&#10003;" : "&#10007;";
            // Build label from type + config
            let label = esc(g.type);
            if (g.config && typeof g.config === "object") {
              const parts: string[] = [];
              if (g.config.path) parts.push(`path=${g.config.path}`);
              if (g.config.min_items != null) parts.push(`min_items=${g.config.min_items}`);
              if (g.config.max_items != null) parts.push(`max_items=${g.config.max_items}`);
              if (g.config.min != null) parts.push(`min=${g.config.min}`);
              if (g.config.max != null) parts.push(`max=${g.config.max}`);
              if (g.config.type_check) parts.push(`type_check=${g.config.type_check}`);
              if (parts.length > 0) label += " " + parts.map(esc).join(" ");
            }
            return `<span class="grader-chip ${chipClass}"><span class="grader-icon">${icon}</span> ${label}</span>`;
          }).join("");
          graderRowHtml = `
        <div class="grader-row">
          <span class="grader-label">Graders</span>
          ${chips}
        </div>`;
        } catch { /* skip */ }
      }

      // Trial dots for multi-trial runs
      let trialRowHtml = "";
      if (trialCount > 1 && scenarioTrials.length > 1) {
        const passTrials = scenarioTrials.filter(r => r.score === "pass").length;
        const dots = scenarioTrials.map(r =>
          `<div class="trial-dot ${esc(r.score)}"></div>`
        ).join("");
        const scores = new Set(scenarioTrials.map(r => r.score));
        const isFlaky = scores.size > 1;
        const allPass = scenarioTrials.every(r => r.score === "pass");
        const reliabilityClass = allPass ? "reliable" : isFlaky ? "flaky" : "consistent_fail";
        const reliabilityLabel = allPass ? "reliable" : isFlaky ? "flaky" : "consistent fail";
        trialRowHtml = `
        <div class="trial-row">
          <span class="trial-label">Trials</span>
          <div class="trial-dots">${dots}</div>
          <span class="trial-stats">${passTrials}/${scenarioTrials.length} pass</span>
          <span class="reliability-badge ${reliabilityClass}">${reliabilityLabel}</span>
        </div>`;
      }

      // Observations as criteria list
      let criteriaHtml = "";
      if (displayResult.observations) {
        try {
          const obs: Array<{type: "positive"|"negative"; text: string}> = JSON.parse(displayResult.observations);
          const items = obs.map(o => {
            const cls = o.type === "positive" ? "met" : "missed";
            const dotCls = o.type === "positive" ? "met" : "missed";
            return `<li class="${cls}"><span class="b-crit-dot ${dotCls}"></span> ${esc(o.text)}</li>`;
          }).join("");
          criteriaHtml = `<ul class="b-criteria">${items}</ul>`;
        } catch { /* skip */ }
      }

      // Phase-level structured observations (team results only)
      const phaseObsHtml = agent === "team" ? phaseObservations(displayResult.agent_output) : "";

      // Footer meta: duration, tokens, cost
      const metaLine = [
        displayResult.duration_ms ? ms(displayResult.duration_ms) : null,
        displayResult.tokens_used ? `${(displayResult.tokens_used/1000).toFixed(1)}k tok` : null,
        displayResult.cost_usd ? cost(displayResult.cost_usd) : null
      ].filter(Boolean).join(" &middot; ");

      // Trace links - use trial_index+1 as label so t1/t2/t3 stay correct
      const runIdEncoded = encodeURIComponent(runId);
      const traceLinks = scenarioTrials
        .filter(r => r.trace)
        .map(r => {
          const label = scenarioTrials.length > 1 ? `t${r.trial_index + 1}` : "trace";
          return `<a class="b-trace-link" href="/evals/${runIdEncoded}/trace/${r.id}">${label}</a>`;
        }).join(" ");

      // Category tag
      const categoryTag = category
        ? `<span class="category-tag ${esc(category)}">${esc(category)}</span>`
        : "";

      // Type tag
      const typeTag = scenarioType
        ? `<span class="b-type-tag ${esc(typeClass(scenarioType))}">${esc(scenarioType)}</span>`
        : "";

      // Failure reason
      let failureHtml = "";
      if (worstResult.failure_reason) {
        failureHtml = `<div class="b-mismatch" style="color:var(--fail)">${esc(worstResult.failure_reason)}</div>`;
      }

      // Justification if no observations
      let justHtml = "";
      if (!displayResult.observations && displayResult.justification) {
        justHtml = `<div style="font-size:11px;color:var(--text-dim);line-height:1.4">${esc(truncate(displayResult.justification, 200))}</div>`;
      }

      const tagsRow = (typeTag || categoryTag)
        ? `<div class="b-tags">${typeTag}${categoryTag}</div>`
        : "";

      return `
      <div class="b-card ${esc(cardScore)}">
        <div class="b-score-group">
          ${confNum != null ? `<span class="b-conf-num ${confClass2}">${confNum}</span>` : ""}
          <div class="b-score ${esc(cardScore)}">${esc(cardScore.charAt(0).toUpperCase() + cardScore.slice(1))}</div>
        </div>
        <div class="b-name" title="${esc(scenarioId)}">${esc(scenarioName)}</div>
        ${tagsRow}
        ${graderRowHtml}
        ${trialRowHtml}
        ${criteriaHtml}
        ${phaseObsHtml}
        ${justHtml}
        ${failureHtml}
        ${metaLine ? `<div class="b-mismatch" style="color:var(--text-dim);font-weight:400">${metaLine}</div>` : ""}
        ${traceLinks}
      </div>`;
    }).join("");

    const triageHtml = needReview > 0 ? `
    <div class="triage-bar">
    <span class="triage-item fail">${failC} fail</span>
    <span class="triage-item partial">${partialC} partial</span>
    <span class="triage-item pass">${passC} pass</span>
    <span class="triage-sep">|</span>
    <span class="triage-label">${needReview} of ${totalScenarios} need review</span>
    </div>` : "";

    sections.push(`
  <div class="section" id="${esc(agent.toLowerCase())}">
    <details open>
    <summary class="section-title">
      <div class="agent-dot" style="background:${color}"></div>
      ${esc(agent)}
      <span class="agent-role">${esc(role)} &middot; ${passC}/${totalScenarios} pass &middot; ${partialC} partial &middot; ${failC} fail</span>
      <span class="chevron"></span>
    </summary>
    ${triageHtml}
    <div class="b-grid">
      ${cards}
    </div>
    </details>
  </div>`);
  }

  return sections.join("\n");
}

// ── phaseObservations: per-phase structured output for team results ───────────
function formatPhaseOutput(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return esc(JSON.stringify(parsed, null, 2));
  } catch {
    return esc(raw);
  }
}

/**
 * Extract display text from a finding object.
 * Kobe's critical_findings and important_issues use { title, risk } — not { text }.
 * Fallback chain: title -> text -> description -> JSON.stringify(f)
 */
function findingText(f: unknown): string {
  if (typeof f === "string") return f;
  if (f && typeof f === "object") {
    const obj = f as Record<string, unknown>;
    if (typeof obj.title === "string" && obj.title) return obj.title;
    if (typeof obj.text === "string" && obj.text) return obj.text;
    if (typeof obj.description === "string" && obj.description) return obj.description;
    return JSON.stringify(f);
  }
  return String(f);
}

/**
 * Build an HTML snippet showing per-phase observations extracted from a team
 * result's agent_output JSON (array of phase records).
 *
 * For Kobe phases, renders critical_findings and important_issues using
 * findingText() so that { title, risk } objects display their title instead
 * of raw JSON.
 */
function phaseObservations(agentOutput: string | null): string {
  if (!agentOutput) return "";

  let phases: unknown[];
  try {
    const parsed = JSON.parse(agentOutput);
    if (!Array.isArray(parsed)) return "";
    phases = parsed;
  } catch {
    return "";
  }

  const parts: string[] = [];

  for (const phase of phases) {
    if (!phase || typeof phase !== "object") continue;
    const p = phase as Record<string, unknown>;
    const phaseAgent = typeof p.agent === "string" ? p.agent.toLowerCase() : "";
    const phaseNum = p.phase_num;
    if (p.is_fixture) continue; // skip human/fixture phases

    // Only render for agents with known structured output
    if (!["kobe", "bird", "mj", "shaq", "pippen", "magic"].includes(phaseAgent)) continue;

    const rawOutput = typeof p.agent_output === "string" ? p.agent_output : "";
    if (!rawOutput) continue;

    let parsed: Record<string, unknown>;
    try {
      const o = JSON.parse(rawOutput);
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      parsed = o as Record<string, unknown>;
    } catch {
      continue;
    }

    const items: string[] = [];

    if (phaseAgent === "kobe") {
      // critical_findings: { title, risk }
      if (Array.isArray(parsed.critical_findings)) {
        for (const f of parsed.critical_findings) {
          items.push(`<li class="missed"><span class="b-crit-dot missed"></span> ${esc(findingText(f))}</li>`);
        }
      }
      // important_issues: { title, ... }
      if (Array.isArray(parsed.important_issues)) {
        for (const f of parsed.important_issues) {
          items.push(`<li class="missed" style="opacity:0.75"><span class="b-crit-dot missed"></span> ${esc(findingText(f))}</li>`);
        }
      }
    } else if (phaseAgent === "bird") {
      if (Array.isArray(parsed.escalations) && parsed.escalations.length > 0) {
        for (const f of parsed.escalations) {
          items.push(`<li class="missed"><span class="b-crit-dot missed"></span> ${esc(findingText(f))}</li>`);
        }
      }
    }

    if (items.length > 0) {
      const agentLabel = phaseAgent.charAt(0).toUpperCase() + phaseAgent.slice(1);
      const pLabel = phaseNum != null ? ` (phase ${phaseNum})` : "";
      parts.push(`<div style="font-size:10px;font-weight:600;color:var(--text-muted);margin:4px 0 2px;text-transform:uppercase;letter-spacing:0.5px">${esc(agentLabel)}${esc(pLabel)}</div><ul class="b-criteria">${items.join("")}</ul>`);
    }
  }

  if (parts.length === 0) return "";
  return `<div class="b-phase-obs">${parts.join("")}</div>`;
}

// ── Team Phase Sections ──────────────────────────────────────────────────────
/**
 * Build per-phase agent section cards for team eval runs.
 * Each agent that appeared as a phase in any team result gets its own
 * collapsible <details> section below the team card, with one b-card per phase.
 */
function buildTeamPhaseSections(results: EvalResult[], phaseResultIds: Map<string, number>, runId: string): string {
  // Collect all parseable phases from team results
  interface PhaseEntry {
    scenarioId: string;
    scenarioName: string;
    phaseNum: number | null;
    agent: string; // phase-level agent name, lowercased
    agentOutput: string; // raw JSON string of the phase's agent_output
    graderResults: string | null; // raw JSON of phase-level grader results (if any)
    durationMs: number | null;
    tokensUsed: number | null;
    costUsd: number | null;
    isFixture: boolean;
    overallScore: string; // parent result's score used as fallback
  }

  const phases: PhaseEntry[] = [];

  for (const r of results) {
    if (r.agent !== "team") continue;
    if (!r.agent_output) continue;

    let phaseList: unknown[];
    try {
      const parsed = JSON.parse(r.agent_output);
      if (Array.isArray(parsed)) {
        phaseList = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).phases)) {
        phaseList = (parsed as Record<string, unknown>).phases as unknown[];
      } else {
        continue;
      }
    } catch {
      continue;
    }

    for (const phase of phaseList) {
      if (!phase || typeof phase !== "object") continue;
      const p = phase as Record<string, unknown>;
      const phaseAgent = typeof p.agent === "string" ? p.agent.toLowerCase() : "";
      if (!phaseAgent) continue;

      const rawOutput = typeof p.agent_output === "string" ? p.agent_output : "";
      const isFixture = Boolean(p.is_fixture);

      // Phase grader_results may be stored directly in the phase object (array or legacy string)
      const phaseGraderResults = Array.isArray(p.grader_results)
        ? JSON.stringify(p.grader_results)
        : typeof p.grader_results === "string" ? p.grader_results : null;

      // Derive pass/fail from grader_results if present, else use parent score
      let phaseScore = r.score;
      if (Array.isArray(p.grader_results) && p.grader_results.length > 0) {
        const graders = p.grader_results as Array<{ passed: boolean }>;
        const allPass = graders.every(g => g.passed);
        phaseScore = allPass && !p.grader_override ? "pass" : "fail";
      } else if (typeof p.grader_results === "string") {
        try {
          const graders = JSON.parse(p.grader_results) as Array<{ passed: boolean }>;
          const allPass = graders.every(g => g.passed);
          phaseScore = allPass && !p.grader_override ? "pass" : "fail";
        } catch { /* use parent score */ }
      } else if (!p.grader_results || (Array.isArray(p.grader_results) && p.grader_results.length === 0)) {
        phaseScore = p.grader_override ? "fail" : "pass";
      } else if (typeof p.score === "string") {
        phaseScore = p.score;
      }

      phases.push({
        scenarioId: r.scenario_id,
        scenarioName: r.scenario_name ?? r.scenario_id,
        phaseNum: typeof p.phase_num === "number" ? p.phase_num : null,
        agent: phaseAgent,
        agentOutput: rawOutput,
        graderResults: phaseGraderResults,
        durationMs: typeof p.duration_ms === "number" ? p.duration_ms : null,
        tokensUsed: typeof p.tokens_used === "number" ? p.tokens_used : null,
        costUsd: typeof p.cost_usd === "number" ? p.cost_usd : null,
        isFixture,
        overallScore: phaseScore,
      });
    }
  }

  if (phases.length === 0) return "";

  // Group by agent name
  const byAgent = new Map<string, PhaseEntry[]>();
  for (const p of phases) {
    if (!byAgent.has(p.agent)) byAgent.set(p.agent, []);
    byAgent.get(p.agent)!.push(p);
  }

  // Sort agent groups alphabetically using AGENT_ORDER
  const agentOrder = [...byAgent.keys()].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const sections: string[] = [];

  for (const agentKey of agentOrder) {
    const agentPhases = byAgent.get(agentKey)!;
    const color = agentColor(agentKey);
    const agentLabel = agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
    const role = AGENT_ROLES[agentKey] ?? "Agent";

    const passCount = agentPhases.filter(p => !p.isFixture && p.overallScore === "pass").length;
    const totalNonFixture = agentPhases.filter(p => !p.isFixture).length;

    const cards = agentPhases.map(p => {
      const phaseLabel = p.phaseNum != null ? `Phase ${p.phaseNum}` : "Phase";
      const cardScore = p.overallScore;
      const scoreLabelCap = cardScore.charAt(0).toUpperCase() + cardScore.slice(1);
      const cardOpacity = p.isFixture ? ' style="opacity:0.55"' : "";

      // Grader chips from phase-level grader_results
      let graderRowHtml = "";
      if (p.graderResults) {
        try {
          const graders: Array<{type: string; config?: Record<string,unknown>; passed: boolean; detail?: string}> = JSON.parse(p.graderResults);
          const chips = graders.map(g => {
            const chipClass = g.passed ? "grader-pass" : "grader-fail";
            const icon = g.passed ? "&#10003;" : "&#10007;";
            let label = esc(g.type);
            if (g.config && typeof g.config === "object") {
              const parts: string[] = [];
              if (g.config.path) parts.push(`path=${g.config.path}`);
              if (g.config.min_items != null) parts.push(`min_items=${g.config.min_items}`);
              if (g.config.max_items != null) parts.push(`max_items=${g.config.max_items}`);
              if (g.config.min != null) parts.push(`min=${g.config.min}`);
              if (g.config.max != null) parts.push(`max=${g.config.max}`);
              if (g.config.type_check) parts.push(`type_check=${g.config.type_check}`);
              if (parts.length > 0) label += " " + parts.map(esc).join(" ");
            }
            return `<span class="grader-chip ${chipClass}"><span class="grader-icon">${icon}</span> ${label}</span>`;
          }).join("");
          graderRowHtml = `
        <div class="grader-row">
          <span class="grader-label">Graders</span>
          ${chips}
        </div>`;
        } catch { /* skip */ }
      }

      // Output extraction using findingText — per-agent structured output
      const criteriaHtml = phaseFindingHtml(agentKey, p.agentOutput, p.isFixture);

      // Meta line
      const metaLine = [
        p.durationMs ? ms(p.durationMs) : null,
        p.tokensUsed ? `${(p.tokensUsed / 1000).toFixed(1)}k tok` : null,
        p.costUsd ? cost(p.costUsd) : null,
      ].filter(Boolean).join(" &middot; ");

      const fixtureLabel = p.isFixture ? `<span style="color:var(--text-muted);font-size:10px;font-style:italic">(fixture)</span>` : "";

      // Trace link for non-fixture phases that have a persisted result row
      const runIdEncoded = encodeURIComponent(runId);
      const phaseKey = p.phaseNum != null ? `${p.scenarioId}--phase-${p.phaseNum}` : null;
      const resultId = (!p.isFixture && phaseKey) ? (phaseResultIds.get(phaseKey) ?? null) : null;
      const traceLinkHtml = resultId != null
        ? `<a class="b-trace-link" href="/evals/${runIdEncoded}/trace/${resultId}">trace</a>`
        : "";

      return `
      <div class="b-card ${esc(cardScore)}"${cardOpacity}>
        <div class="b-score-group">
          <div class="b-score ${esc(cardScore)}">${esc(scoreLabelCap)}</div>
        </div>
        <div class="b-name">${esc(p.scenarioName)} &mdash; ${esc(phaseLabel)} ${fixtureLabel}</div>
        <div class="b-tags"><span class="b-type-tag">${esc(phaseLabel.toUpperCase())}</span></div>
        ${graderRowHtml}
        ${criteriaHtml}
        ${p.agentOutput ? `
        <details>
          <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);margin-top:8px;user-select:none">
            View full output
          </summary>
          <pre style="font-size:11px;line-height:1.4;max-height:400px;overflow:auto;background:var(--surface-2);padding:12px;border-radius:6px;margin-top:6px;white-space:pre-wrap;word-break:break-word;color:var(--text)">${formatPhaseOutput(p.agentOutput)}</pre>
        </details>` : ""}
        ${metaLine ? `<div class="b-mismatch" style="color:var(--text-dim);font-weight:400">${metaLine}</div>` : ""}
        ${traceLinkHtml}
      </div>`;
    }).join("");

    sections.push(`
  <div class="section" id="team-phase-${esc(agentKey)}">
    <details open>
    <summary class="section-title">
      <div class="agent-dot" style="background:${color}"></div>
      <span class="agent-name">${esc(agentLabel)}</span>
      <span class="agent-role">${esc(role)} &middot; Phase Results &middot; ${passCount}/${totalNonFixture} pass</span>
      <span class="section-badge" style="background:var(--surface-3);color:var(--text-muted);border-color:var(--border)">team pipeline</span>
      <span class="chevron"></span>
    </summary>
    <div class="b-grid">
      ${cards}
    </div>
    </details>
  </div>`);
  }

  return sections.join("\n");
}

/**
 * Build a b-criteria bullet list from a phase's agent_output JSON.
 * Extraction logic is agent-specific:
 *   Bird:  business_context excerpt, N business rules, N acceptance criteria
 *   MJ:    executive_summary excerpt, N options evaluated, recommended approach
 *   Kobe:  Verdict (green SHIP / red otherwise), one_liner, critical_findings as red bullets
 *   Shaq:  what_was_built excerpt, N files changed
 *   All:   Confidence N%
 *   Fixture: muted text label
 */
function phaseFindingHtml(agentKey: string, rawOutput: string, isFixture: boolean): string {
  if (isFixture) {
    return `<ul class="b-criteria"><li class="met" style="opacity:0.6"><span class="b-crit-dot met"></span> Human fixture phase</li></ul>`;
  }
  if (!rawOutput) return "";

  let parsed: Record<string, unknown>;
  try {
    const o = JSON.parse(rawOutput);
    if (!o || typeof o !== "object" || Array.isArray(o)) return "";
    parsed = o as Record<string, unknown>;
  } catch {
    return "";
  }

  const items: string[] = [];

  if (agentKey === "bird") {
    // business_context excerpt
    if (typeof parsed.business_context === "string" && parsed.business_context) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(parsed.business_context, 120))}</li>`);
    }
    // N business rules
    if (Array.isArray(parsed.business_rules)) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${parsed.business_rules.length} business rule${parsed.business_rules.length !== 1 ? "s" : ""}</li>`);
    }
    // N acceptance criteria
    if (Array.isArray(parsed.acceptance_criteria)) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${parsed.acceptance_criteria.length} acceptance criteri${parsed.acceptance_criteria.length !== 1 ? "a" : "on"}</li>`);
    }
    // escalations as red bullets
    if (Array.isArray(parsed.escalations) && parsed.escalations.length > 0) {
      for (const f of parsed.escalations) {
        items.push(`<li class="missed"><span class="b-crit-dot missed"></span> ${esc(findingText(f))}</li>`);
      }
    }
  } else if (agentKey === "mj") {
    // executive_summary excerpt
    if (typeof parsed.executive_summary === "string" && parsed.executive_summary) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(parsed.executive_summary, 120))}</li>`);
    }
    // N options evaluated
    if (Array.isArray(parsed.options_evaluated)) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${parsed.options_evaluated.length} option${parsed.options_evaluated.length !== 1 ? "s" : ""} evaluated</li>`);
    }
    // recommended approach
    const recommended = parsed.recommended_approach ?? parsed.recommendation;
    if (typeof recommended === "string" && recommended) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> Recommended: ${esc(truncate(recommended, 100))}</li>`);
    }
  } else if (agentKey === "kobe") {
    // Verdict: green if SHIP, red otherwise
    const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
    if (verdict) {
      const isShip = verdict.toUpperCase() === "SHIP";
      const cls = isShip ? "met" : "missed";
      items.push(`<li class="${cls}"><span class="b-crit-dot ${cls}"></span> Verdict: ${esc(verdict)}</li>`);
    }
    // one_liner
    if (typeof parsed.one_liner === "string" && parsed.one_liner) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(parsed.one_liner, 120))}</li>`);
    }
    // critical_findings as individual red bullets
    if (Array.isArray(parsed.critical_findings) && parsed.critical_findings.length > 0) {
      for (const f of parsed.critical_findings) {
        items.push(`<li class="missed"><span class="b-crit-dot missed"></span> ${esc(findingText(f))}</li>`);
      }
    }
  } else if (agentKey === "shaq") {
    // what_was_built excerpt
    if (typeof parsed.what_was_built === "string" && parsed.what_was_built) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(parsed.what_was_built, 120))}</li>`);
    } else {
      // implementation_summary.what_was_built
      const impl = parsed.implementation_summary;
      if (impl && typeof impl === "object") {
        const implObj = impl as Record<string, unknown>;
        if (typeof implObj.what_was_built === "string" && implObj.what_was_built) {
          items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(implObj.what_was_built, 120))}</li>`);
        }
        if (Array.isArray(implObj.files_changed)) {
          items.push(`<li class="met"><span class="b-crit-dot met"></span> ${implObj.files_changed.length} file${implObj.files_changed.length !== 1 ? "s" : ""} changed</li>`);
        }
      }
    }
    // top-level files_changed
    if (Array.isArray(parsed.files_changed)) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${parsed.files_changed.length} file${parsed.files_changed.length !== 1 ? "s" : ""} changed</li>`);
    }
  } else {
    // Generic: try to show a brief summary from common fields
    const summary = parsed.executive_summary ?? parsed.summary ?? parsed.what_was_built ?? parsed.business_context;
    if (typeof summary === "string" && summary) {
      items.push(`<li class="met"><span class="b-crit-dot met"></span> ${esc(truncate(summary, 120))}</li>`);
    }
  }

  // Universal: Confidence N% (check top-level confidence field)
  const conf = parsed.confidence;
  if (conf != null) {
    let confNum: number | null = null;
    if (typeof conf === "number") {
      confNum = conf;
    } else if (typeof conf === "object" && conf !== null) {
      const confObj = conf as Record<string, unknown>;
      if (typeof confObj.level === "number") confNum = confObj.level;
    }
    if (confNum != null) {
      const confCls = confNum >= 75 ? "met" : confNum >= 50 ? "met" : "missed";
      items.push(`<li class="${confCls}"><span class="b-crit-dot ${confCls}"></span> Confidence: ${confNum}%</li>`);
    }
  }

  if (items.length === 0) return "";
  return `<ul class="b-criteria">${items.join("")}</ul>`;
}

// ── Bug 7: Flaky Scenarios section ──────────────────────────────────────────
function buildFlakyScenariosSection(
  byScenario: Map<string, EvalResult[]>,
  summaries: AgentSummary[]
): string {
  // Collect flaky groups (mixed trial scores) sorted alphabetically by agent
  type FlakyRow = { agent: string; scenarioName: string; passCount: number; partialCount: number; failCount: number; total: number };
  const rows: FlakyRow[] = [];

  for (const [key, group] of byScenario.entries()) {
    if (group.length <= 1) continue;
    const scores = new Set(group.map(r => r.score));
    if (scores.size <= 1) continue;
    const [agent] = key.split("::");
    const passC = group.filter(r => r.score === "pass").length;
    const partialC = group.filter(r => r.score === "partial").length;
    const failC = group.filter(r => r.score === "fail").length;
    const sname = (group[0].scenario_name ?? group[0].scenario_id);
    rows.push({ agent, scenarioName: sname, passCount: passC, partialCount: partialC, failCount: failC, total: group.length });
  }

  // Sort alphabetically by agent
  rows.sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.scenarioName.localeCompare(b.scenarioName);
  });

  if (rows.length === 0) return "";

  const rowsHtml = rows.map(row => {
    const color = agentColor(row.agent);
    const agentLabel = row.agent.charAt(0).toUpperCase() + row.agent.slice(1);
    const passBarWidth = Math.round((row.passCount / row.total) * 100);
    const partialBarWidth = Math.round((row.partialCount / row.total) * 100);
    const failBarWidth = Math.round((row.failCount / row.total) * 100);

    // Consensus label
    const parts: string[] = [];
    if (row.passCount) parts.push(`${row.passCount}P`);
    if (row.partialCount) parts.push(`${row.partialCount}p`);
    if (row.failCount) parts.push(`${row.failCount}F`);
    const consensusLabel = parts.join(" ");

    // pass@1 for this scenario (fraction of trials that pass)
    const pass1Pct = Math.round((row.passCount / row.total) * 100);
    const pass1Color = pass1Pct >= 67 ? "var(--partial)" : pass1Pct >= 33 ? "var(--fail)" : "var(--fail)";

    // pass@k (at least one pass)
    const hasPassed = row.passCount > 0;
    const passKColor = hasPassed ? "var(--pass)" : "var(--fail)";
    const passKPct = hasPassed ? 100 : 0;

    // Majority score
    const majorityScore = row.passCount >= row.partialCount && row.passCount >= row.failCount ? "pass"
      : row.partialCount >= row.failCount ? "partial" : "fail";

    return `
        <tr>
          <td><span style="color:${color};font-weight:600">${esc(agentLabel)}</span></td>
          <td style="font-size: 12px;">${esc(row.scenarioName)}</td>
          <td class="nowrap">
            <div class="consensus-bar-wrap">
              <div class="consensus-bar">
                <div class="consensus-seg pass" style="width:${passBarWidth}%"></div>
                <div class="consensus-seg partial" style="width:${partialBarWidth}%"></div>
                <div class="consensus-seg fail" style="width:${failBarWidth}%"></div>
              </div>
              <span class="consensus-label">${esc(consensusLabel)}</span>
            </div>
          </td>
          <td style="font-family:var(--mono); color:${pass1Color};">${pass1Pct}%</td>
          <td style="font-family:var(--mono); color:${passKColor};">${passKPct}%</td>
          <td><span class="score-chip ${esc(majorityScore)}">${majorityScore.charAt(0).toUpperCase() + majorityScore.slice(1)}</span></td>
          <td><span class="reliability-badge flaky">flaky</span></td>
        </tr>`;
  }).join("");

  return `
  <div class="section">
    <details open>
    <summary class="section-title">
      Flaky Scenarios
      <span class="section-badge">${rows.length} scenarios with mixed results across k trials</span>
      <span class="chevron"></span>
    </summary>

    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Scenario</th>
          <th>Trials</th>
          <th>pass@1</th>
          <th>pass@k</th>
          <th>Majority</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </details>
  </div>`;
}

// ── Bug 8: Agent Reliability section ────────────────────────────────────────
function buildAgentReliabilitySection(
  byScenario: Map<string, EvalResult[]>,
  summaries: AgentSummary[],
  trialCount: number
): string {
  // Compute per-agent pass@1, pass@k, pass^k, flaky count
  const agentStats: Record<string, {
    pass1Values: number[];
    atLeastOne: number;
    allPass: number;
    flaky: number;
    total: number;
  }> = {};

  for (const [key, group] of byScenario.entries()) {
    const [agent] = key.split("::");
    if (!agentStats[agent]) agentStats[agent] = { pass1Values: [], atLeastOne: 0, allPass: 0, flaky: 0, total: 0 };
    const stat = agentStats[agent];
    stat.total++;
    const passC = group.filter(r => r.score === "pass").length;
    stat.pass1Values.push(group.length > 0 ? passC / group.length : 0);
    if (passC > 0) stat.atLeastOne++;
    if (passC === group.length) stat.allPass++;
    const scores = new Set(group.map(r => r.score));
    if (group.length > 1 && scores.size > 1) stat.flaky++;
  }

  // Sort alphabetically
  const sortedAgents = [...summaries].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai === -1 && bi === -1) return a.agent.localeCompare(b.agent);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  }).map(s => s.agent);

  const rowsHtml = sortedAgents.map(agent => {
    const color = agentColor(agent);
    const agentLabel = agent.charAt(0).toUpperCase() + agent.slice(1);
    const stat = agentStats[agent.toLowerCase()];
    if (!stat) return "";

    const pass1Pct = stat.pass1Values.length > 0 ? Math.round((stat.pass1Values.reduce((a, b) => a + b, 0) / stat.pass1Values.length) * 100) : 0;
    const passKPct = stat.total > 0 ? Math.round((stat.atLeastOne / stat.total) * 100) : 0;
    const passAllPct = stat.total > 0 ? Math.round((stat.allPass / stat.total) * 100) : 0;

    const scoreColor2 = (p: number) => p >= 80 ? "var(--pass)" : p >= 50 ? "var(--partial)" : "var(--fail)";

    return `
        <tr>
          <td><span style="color:${color};font-weight:600">${esc(agentLabel)}</span></td>
          <td class="num" style="color:${scoreColor2(pass1Pct)}">${pass1Pct}%</td>
          <td class="num" style="color:${scoreColor2(passKPct)}">${passKPct}%</td>
          <td class="num" style="color:${scoreColor2(passAllPct)}">${passAllPct}%</td>
          <td class="num">${stat.flaky}/${stat.total}</td>
          <td><span class="reliability-badge flaky">mostly reliable</span></td>
          <td><span style="font-size:11px; color:var(--text-dim)">good</span></td>
        </tr>`;
  }).join("");

  return `
  <div class="section">
    <div class="section-title">
      Agent Reliability
      <span class="section-badge">pass@k and pass^k across all scenarios</span>
    </div>

    <table class="reliability-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th class="num">pass@1</th>
          <th class="num">pass@${trialCount}</th>
          <th class="num">pass^${trialCount}</th>
          <th class="num">Flaky</th>
          <th>Assessment</th>
          <th>Signal</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>`;
}

// ── Regression Alerts section ────────────────────────────────────────────────
// Shows only regression-category scenarios that dropped from pass to partial/fail.
function buildRegressionAlertsSection(
  results: EvalResult[],
  previousBaselineResults: EvalResult[],
  previousBaseline: EvalRun | null
): string {
  // Build prior score lookup: agent::scenario_id -> score
  const prevScores = new Map<string, string>();
  for (const r of previousBaselineResults) {
    const key = `${r.agent.toLowerCase()}::${r.scenario_id}`;
    const existing = prevScores.get(key);
    // Keep best (highest) prior score
    if (!existing || scoreOrd(r.score) > scoreOrd(existing)) {
      prevScores.set(key, r.score);
    }
  }

  // Find current best score per agent::scenario for regression-category results
  const currBest = new Map<string, { score: string; result: EvalResult }>();
  for (const r of results) {
    if (r.category !== "regression") continue;
    if (r.score === "pass") continue; // only partial/fail qualify
    const key = `${r.agent.toLowerCase()}::${r.scenario_id}`;
    const existing = currBest.get(key);
    // Keep worst current score (fail < partial)
    if (!existing || scoreOrd(r.score) < scoreOrd(existing.score)) {
      currBest.set(key, { score: r.score, result: r });
    }
  }

  // Filter: only those where prior was "pass" (or no prior baseline — surface all)
  const alerts: Array<{
    agent: string;
    scenarioName: string;
    category: string;
    priorScore: string | null;
    currentScore: string;
    graderResults: Array<{ type: string; config?: Record<string, unknown>; passed: boolean; detail?: string }>;
  }> = [];

  for (const [key, curr] of currBest.entries()) {
    const r = curr.result;
    if (previousBaselineResults.length > 0) {
      const prior = prevScores.get(key);
      if (prior !== "pass") continue; // only alert if it was previously passing
      alerts.push({
        agent: r.agent,
        scenarioName: r.scenario_name ?? r.scenario_id,
        category: r.category ?? "regression",
        priorScore: prior,
        currentScore: curr.score,
        graderResults: r.grader_results ? (() => { try { return JSON.parse(r.grader_results!); } catch { return []; } })() : [],
      });
    } else {
      // No prior baseline: surface all regression-category failures
      alerts.push({
        agent: r.agent,
        scenarioName: r.scenario_name ?? r.scenario_id,
        category: r.category ?? "regression",
        priorScore: null,
        currentScore: curr.score,
        graderResults: r.grader_results ? (() => { try { return JSON.parse(r.grader_results!); } catch { return []; } })() : [],
      });
    }
  }

  if (alerts.length === 0) return "";

  // Sort by agent order then scenario name
  alerts.sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
    const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.scenarioName.localeCompare(b.scenarioName);
  });

  const countLabel = `${alerts.length} regression${alerts.length !== 1 ? "s" : ""} detected`;

  const rowsHtml = alerts.map(alert => {
    const agentLabel = alert.agent.charAt(0).toUpperCase() + alert.agent.slice(1);
    const agentCls = `${esc(alert.agent.toLowerCase())}-color`;

    const priorHtml = alert.priorScore
      ? `<span class="score-chip ${esc(alert.priorScore)}">${alert.priorScore.charAt(0).toUpperCase() + alert.priorScore.slice(1)}</span>`
      : `<span style="color:var(--text-muted);font-size:11px">n/a</span>`;

    let graderSummary = "";
    if (alert.graderResults.length > 0) {
      const failed = alert.graderResults.filter(g => !g.passed);
      if (failed.length > 0) {
        const desc = failed.map(g => {
          let label = g.type;
          if (g.config && typeof g.config === "object") {
            const parts: string[] = [];
            if (g.config.path) parts.push(`path=${g.config.path}`);
            if (g.config.min_items != null) parts.push(`min_items=${g.config.min_items}`);
            if (g.config.max_items != null) parts.push(`max_items=${g.config.max_items}`);
            if (parts.length > 0) label += " " + parts.join(" ");
          }
          return esc(label);
        }).join(", ");
        graderSummary = `<span style="font-family:var(--mono); font-size:11px; color:var(--fail);">${desc} FAIL</span>`;
      } else {
        graderSummary = `<span style="font-size:11px; color:var(--text-muted);">all pass</span>`;
      }
    }

    return `        <tr style="background: var(--fail-bg);">
          <td><span class="${agentCls}" style="font-weight:600">${esc(agentLabel)}</span></td>
          <td style="font-size: 12px;">${esc(alert.scenarioName)}</td>
          <td><span class="category-tag ${esc(alert.category)}">${esc(alert.category)}</span></td>
          <td>${priorHtml}</td>
          <td><span class="score-chip ${esc(alert.currentScore)}">${alert.currentScore.charAt(0).toUpperCase() + alert.currentScore.slice(1)}</span></td>
          <td>${graderSummary || "&mdash;"}</td>
          <td style="font-size:11px; color:var(--text-dim)">Investigate grader or prompt</td>
        </tr>`;
  }).join("\n");

  return `
  <div class="section" style="border-left: 4px solid var(--fail);">
    <div class="section-title">
      Regression Alerts
      <span class="section-badge" style="background:var(--fail-bg); color:var(--fail); border-color:var(--fail-border);">${esc(countLabel)}</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Scenario</th>
          <th>Category</th>
          <th>Previous</th>
          <th>Current</th>
          <th>Grader</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
${rowsHtml}
      </tbody>
    </table>
    <div style="margin-top: 10px; font-size: 11px; font-family: var(--mono); color: var(--text-muted); padding: 6px 12px; background: var(--surface-2); border-radius: 6px;">
      Regression alerts fire when a <span style="color:var(--accent)">regression</span>-category scenario drops from pass to partial/fail.
      <span style="color:var(--shaq)">Capability</span>-category scenarios at partial are expected &mdash; no alert.
    </div>
  </div>
`;
}

// ── Bug 9: Regression Detection section ─────────────────────────────────────
function buildRegressionDetectionSection(
  results: EvalResult[],
  previousBaselineResults: EvalResult[],
  summaries: AgentSummary[],
  previousBaseline: EvalRun | null,
  persistentNonPass: Array<{ agent: string; scenario_id: string; history: ScenarioHistoryEntry[] }>
): string {
  // If no baseline and no persistent non-pass, nothing to show
  if (previousBaselineResults.length === 0 && persistentNonPass.length === 0) return "";

  // ── Part 1: Regressions vs prior baseline ──────────────────────────────────
  let part1Html = "";
  const regressions: Array<{
    agent: string; scenarioId: string; prevScore: string; currScore: string;
  }> = [];

  if (previousBaselineResults.length > 0) {
    // Build prev results lookup: agent::scenario_id -> canonical score (trial_index=0 only)
    // This matches evals/src/cli.ts which uses r.get('score') — the stored top-level score per result entry
    const prevScores = new Map<string, string>();
    for (const r of previousBaselineResults) {
      if (r.trial_index !== 0) continue; // only use canonical trial
      const key = `${r.agent.toLowerCase()}::${r.scenario_id}`;
      prevScores.set(key, r.score);
    }

    // Find current canonical scores per agent::scenario (trial_index=0 only, all scenarios)
    // Matches evals/src/cli.ts: current_results_map[key] = r.get('score') where results has one entry per scenario
    const currScores = new Map<string, { score: string; agent: string; scenarioId: string }>();
    for (const r of results) {
      if (r.trial_index !== 0) continue; // only use canonical trial
      const key = `${r.agent.toLowerCase()}::${r.scenario_id}`;
      currScores.set(key, { score: r.score, agent: r.agent, scenarioId: r.scenario_id });
    }

    // Find regressions: was pass in prev, is non-pass now
    for (const [key, curr] of currScores.entries()) {
      const prev = prevScores.get(key);
      if (!prev || prev !== "pass") continue;
      if (curr.score === "pass") continue;
      regressions.push({
        agent: curr.agent,
        scenarioId: curr.scenarioId,
        prevScore: prev,
        currScore: curr.score,
      });
    }

    // Sort alphabetically by agent then scenario
    regressions.sort((a, b) => {
      const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
      const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
      if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.scenarioId.localeCompare(b.scenarioId);
    });

    const baselineDate = previousBaseline?.run_id
      ? previousBaseline.run_id.replace("eval/run-", "").slice(0, 10)
      : "prior baseline";

    const regressionCountMsg = regressions.length > 0
      ? `<p style="font-size:12px;color:var(--fail);margin-bottom:12px;font-family:var(--mono)">${regressions.length} regression(s) detected vs. prior baseline (${esc(baselineDate)}).</p>`
      : `<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;font-family:var(--mono)">No regressions detected vs. prior baseline (${esc(baselineDate)}).</p>`;

    const regRowsHtml = regressions.map(row => {
      const color = agentColor(row.agent);
      const agentLabel = row.agent.charAt(0).toUpperCase() + row.agent.slice(1);
      const noteText = row.currScore === "fail"
        ? `Score decreased from ${row.prevScore} to ${row.currScore}.`
        : `Score decreased from ${row.prevScore} to ${row.currScore}.`;
      return `
        <tr>
          <td><span class="${esc(row.agent.toLowerCase())}-color" style="font-weight:600">${esc(agentLabel)}</span></td>
          <td class="tag-mono">${esc(row.scenarioId)}</td>
          <td><span class="score-chip ${esc(row.prevScore)}">${row.prevScore.charAt(0).toUpperCase() + row.prevScore.slice(1)}</span></td>
          <td><span class="score-chip ${esc(row.currScore)}">${row.currScore.charAt(0).toUpperCase() + row.currScore.slice(1)}</span></td>
          <td style="font-size:11px;color:var(--text-muted)">${noteText}</td>
        </tr>`;
    }).join("");

    const regTableHtml = regressions.length > 0 ? `
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
        ${regRowsHtml}
      </tbody>
    </table>` : "";

    part1Html = regressionCountMsg + regTableHtml;
  }

  // ── Part 2: Persistent non-pass scenarios ──────────────────────────────────
  let part2Html = "";
  if (persistentNonPass.length > 0) {
    // Sort alphabetically by agent then scenario_id
    const sorted = [...persistentNonPass].sort((a, b) => {
      const ai = AGENT_ORDER.indexOf(a.agent.toLowerCase());
      const bi = AGENT_ORDER.indexOf(b.agent.toLowerCase());
      if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.scenario_id.localeCompare(b.scenario_id);
    });

    const persistRowsHtml = sorted.map(row => {
      const color = agentColor(row.agent);
      const agentLabel = row.agent.charAt(0).toUpperCase() + row.agent.slice(1);
      const runCount = row.history.length;
      const chipsHtml = row.history.map(h =>
        `<span class="score-chip ${esc(h.score)}">${h.score.charAt(0).toUpperCase() + h.score.slice(1)}</span>`
      ).join("&nbsp;");
      return `
          <tr>
            <td><span class="${esc(row.agent.toLowerCase())}-color" style="font-weight:600">${esc(agentLabel)}</span></td>
            <td class="tag-mono">${esc(row.scenario_id)}</td>
            <td>${chipsHtml}</td>
            <td style="font-size:11px;color:var(--text-muted)">Non-pass in all ${runCount} runs &mdash; consistent issue.</td>
          </tr>`;
    }).join("");

    part2Html = `
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
          ${persistRowsHtml}
        </tbody>
      </table>
    </div>`;
  }

  if (!part1Html && !part2Html) return "";

  // Determine badge date
  const badgeDate = previousBaseline?.run_id
    ? previousBaseline.run_id.replace("eval/run-", "").slice(0, 10)
    : "";

  return `
  <div class="section">
    <details open>
    <summary class="section-title">
      Regression Detection
      ${badgeDate ? `<span class="section-badge">vs. ${esc(badgeDate)}</span>` : ""}
      <span class="chevron"></span>
    </summary>

${part1Html}

${part2Html}

  </details>
  </div>`;
}

// ── Bug 10: Historical Trend section ────────────────────────────────────────
function buildHistoricalTrendSection(allRuns: EvalRun[], currentRunId: string): string {
  if (allRuns.length === 0) return "";

  // Sort ascending by timestamp (oldest first)
  const sorted = [...allRuns].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let prevPassCount: number | null = null;
  const rowsHtml = sorted.map(run => {
    const isToday = run.run_id === currentRunId;
    const passRate = run.pass_rate != null ? Math.round(run.pass_rate * 100) : 0;
    const passC = run.pass_count ?? 0;
    const partialC = run.partial_count ?? 0;
    const failC = run.fail_count ?? 0;

    let deltaHtml = "&mdash;";
    if (prevPassCount !== null) {
      const delta = passC - prevPassCount;
      const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "same";
      const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
      deltaHtml = delta === 0
        ? `<span class="delta-badge same">0</span>`
        : `<span class="delta-badge ${deltaClass}">${deltaText}</span>`;
    }
    prevPassCount = passC;

    const barClass = isToday ? " today" : "";
    const todayLabel = isToday ? ` <span style="color:var(--accent);font-size:10px">[today]</span>` : "";
    const rowClass = isToday ? ' class="today"' : "";
    const dateStyle = isToday ? ' style="color:var(--text)"' : "";

    // Format timestamp
    const ts = run.timestamp.length >= 16 ? run.timestamp.slice(0, 16).replace("T", " ") : run.timestamp;

    return `
        <tr${rowClass}>
          <td class="tag-mono"${dateStyle}>${esc(ts)}${todayLabel}</td>
          <td class="tag-mono" style="color:var(--pass)">${passC}</td>
          <td class="tag-mono" style="color:var(--partial)">${partialC}</td>
          <td class="tag-mono" style="color:var(--fail)">${failC}</td>
          <td class="bar-cell">
            <div class="bar-row">
              <div class="bar-track"><div class="bar-fill${barClass}" style="width:${passRate}%"></div></div>
              <div class="bar-num"${isToday ? " style='color:var(--pass)'" : ""}>${passRate}%</div>
            </div>
          </td>
          <td>${deltaHtml}</td>
          <td style="font-size:11px;color:var(--text-muted)">Preliminary scoring by Coach K. Human review pending via HTML report.</td>
        </tr>`;
  }).join("");

  return `
  <div class="section">
    <details open>
    <summary class="section-title">
      Historical Trend
      <span class="section-badge">${sorted.length} runs</span>
      <span class="chevron"></span>
    </summary>

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
        ${rowsHtml}
      </tbody>
    </table>

  </details>
  </div>`;
}

export function ResultsTableFragment(results: EvalResult[], runId: string): string {
  if (results.length === 0) {
    return `<div class="empty-state">No results match the current filters.</div>`;
  }

  const runIdEncoded = encodeURIComponent(runId);

  const rows = results.map(r => {
    const trialBadge = r.trial_index > 0
      ? ` <span class="badge" style="font-size:10px;background:var(--surface-3);color:var(--text-muted);border:1px solid var(--border)">t${r.trial_index + 1}</span>`
      : "";

    const excerpt = truncate(r.justification, 100);

    return `
      <tr>
        <td class="mono" style="max-width:220px;word-break:break-word">${esc(r.scenario_id)}${trialBadge}</td>
        <td>${agentChip(r.agent)}</td>
        <td>${scoreBadge(r.score)}</td>
        <td class="mono">${r.confidence_stated != null ? r.confidence_stated : "—"}</td>
        <td class="mono">${ms(r.duration_ms)}</td>
        <td class="mono">${cost(r.cost_usd)}</td>
        <td class="dim" style="max-width:300px;font-size:12px">${esc(excerpt)}</td>
        <td>
          <a href="/evals/${runIdEncoded}/trace/${r.id}" class="expand-btn">trace &#8594;</a>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Agent</th>
          <th>Score</th>
          <th>Confidence</th>
          <th>Duration</th>
          <th>Cost</th>
          <th>Justification</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}
