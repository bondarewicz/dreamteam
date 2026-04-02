/**
 * Scenario browser and editor views — /scenarios
 */
import { esc, agentColor } from "./html.ts";

export const KNOWN_GRADER_TYPES = [
  "json_valid",
  "json_field",
  "contains",
  "not_contains",
  "regex",
  "section_present",
  "field_count",
  "length_bounds",
] as const;

export const KNOWN_CATEGORIES = [
  "capability",
  "regression",
  "happy-path",
  "edge-case",
  "adversarial",
  "draft",
] as const;

export type KnownGraderType = typeof KNOWN_GRADER_TYPES[number];
export type KnownCategory = typeof KNOWN_CATEGORIES[number];

export type Grader = {
  type: string;
  path?: string;
  min_items?: number | string;
  max_items?: number | string;
  min?: number | string;
  max?: number | string;
  type_check?: string;
  value?: string;
  pattern?: string;
  section?: string;
  expected_count?: number | string;
  [key: string]: unknown;
};

export type ParsedScenario = {
  title: string;
  overview: string;
  category: string;
  graders: Grader[];
  prompt: string;
  reference_output: string;
  expected_behavior: string;
  failure_modes: string;
  scoring_rubric: string;
};

export type Phase = {
  phaseNum: number;
  agent: string;
  prompt: string;
  expectedBehavior: string;
  failureModes: string;
  scoringRubric: string;
  graders: Grader[];
  referenceOutput: string;
  humanDecision?: string;
};

export type ParsedTeamScenario = ParsedScenario & {
  isTeam: true;
  phases: Phase[];
  pipelineExpectedBehavior: string;
  pipelineFailureModes: string;
  pipelineScoringRubric: string;
};

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
};

export type ScenarioListItem = {
  agent: string;
  scenarioId: string;
  title: string;
  category: string;
  type: string; // from title parens
  kind: "production" | "draft" | "team";
  draftReady?: boolean;
};

// ── List Page ───────────────────────────────────────────────────────────────

function typeClass(type: string): string {
  if (!type) return "";
  const first = type.split("/")[0].trim();
  return first.toLowerCase().replace(/\s+/g, "-");
}

export const KNOWN_AGENTS = ["bird", "coachk", "kobe", "magic", "mj", "pippen", "shaq", "team"] as const;
export type KnownAgent = typeof KNOWN_AGENTS[number];

export function ScenariosListPage(
  groups: Array<{ agent: string; scenarios: ScenarioListItem[] }>,
  filterAgent: string
): string {
  const agents = groups.map(g => g.agent);
  const newUrl = filterAgent ? `/scenarios/new?agent=${esc(filterAgent)}` : "/scenarios/new";

  const agentFilterHtml = `
    <div class="sc-agent-filter" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:24px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;flex:1">
        <a href="/scenarios" class="sc-filter-btn${filterAgent === "" ? " active" : ""}">All</a>
        ${agents.map(a => `<a href="/scenarios?agent=${esc(a)}" class="sc-filter-btn${filterAgent === a ? " active" : ""}">${esc(a)}</a>`).join("")}
      </div>
      <a href="${newUrl}" class="sc-btn-new-scenario">+ New Scenario</a>
    </div>
  `;

  const filteredGroups = filterAgent
    ? groups.filter(g => g.agent === filterAgent)
    : groups;

  const groupsHtml = filteredGroups.map(g => {
    const rows = g.scenarios.map(s => {
      const isDraft = s.kind === "draft";
      const href = isDraft
        ? `/scenarios/${esc(g.agent)}/drafts/${esc(s.scenarioId)}`
        : `/scenarios/${esc(g.agent)}/${esc(s.scenarioId)}`;
      const draftBadge = isDraft
        ? (s.draftReady
            ? `<span class="sc-ready-badge-row">ready</span> `
            : `<span class="sc-draft-badge-row">draft</span> `)
        : "";
      return `
      <tr class="${isDraft ? "sc-draft-row" : ""}">
        <td>
          <a href="${href}" class="sc-scenario-link">
            ${draftBadge}${esc(s.scenarioId)}
          </a>
        </td>
        <td>${esc(s.title)}</td>
        <td><span class="sc-category-badge sc-cat-${esc(s.category)}">${esc(s.category || "—")}</span></td>
        <td><span class="sc-type-tag sc-type-${esc(typeClass(s.type))}">${esc(s.type || "—")}</span></td>
      </tr>
    `;
    }).join("");

    return `
      <div class="sc-agent-group">
        <div class="sc-agent-group-header">
          <span class="agent-badge ${esc(g.agent)}">${esc(g.agent)}</span>
          <span class="sc-count">${g.scenarios.length} scenario${g.scenarios.length !== 1 ? "s" : ""}</span>
        </div>
        <table class="sc-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Category</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join("");

  const emptyHtml = filteredGroups.length === 0
    ? `<div class="empty-state">No scenarios found.</div>`
    : groupsHtml;

  return `
    <div class="page-title">
      <h1>Scenarios</h1>
      <p>Browse and edit eval scenario files. Changes are validated before saving.</p>
    </div>
    ${agentFilterHtml}
    ${emptyHtml}

    <style>
      .sc-filter-btn { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; text-decoration: none; background: var(--surface-3); border: 1px solid var(--border); color: var(--text-dim); transition: all 0.15s; }
      .sc-filter-btn:hover, .sc-filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
      .sc-btn-new-scenario { display: inline-block; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; background: var(--accent); border: none; color: #fff; transition: opacity 0.15s; white-space: nowrap; }
      .sc-btn-new-scenario:hover { opacity: 0.85; }
      .sc-agent-group { margin-bottom: 28px; }
      .sc-agent-group-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .sc-count { font-size: 12px; color: var(--text-muted); }
      .sc-table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .sc-table th { text-align: left; padding: 8px 14px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); background: var(--surface-3); }
      .sc-table td { padding: 9px 14px; font-size: 13px; border-bottom: 1px solid var(--border-subtle); color: var(--text-dim); }
      .sc-table tbody tr:last-child td { border-bottom: none; }
      .sc-table tbody tr:hover { background: var(--surface-2); }
      .sc-scenario-link { color: var(--text); text-decoration: none; font-family: var(--mono); font-size: 12px; }
      .sc-scenario-link:hover { color: var(--accent); }
      .sc-category-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
      .sc-cat-regression { background: rgba(88,166,255,0.12); color: var(--mj); border: 1px solid rgba(88,166,255,0.25); }
      .sc-cat-capability { background: rgba(188,140,255,0.12); color: var(--shaq); border: 1px solid rgba(188,140,255,0.25); }
      .sc-cat-happy-path { background: rgba(74,222,128,0.12); color: var(--pass); border: 1px solid rgba(74,222,128,0.25); }
      .sc-cat-edge-case { background: rgba(251,191,36,0.12); color: var(--partial); border: 1px solid rgba(251,191,36,0.25); }
      .sc-cat-adversarial { background: rgba(248,113,113,0.12); color: var(--fail); border: 1px solid rgba(248,113,113,0.25); }
      .sc-cat-draft { background: rgba(125,133,144,0.12); color: var(--text-muted); border: 1px solid rgba(125,133,144,0.25); }
      .sc-type-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; font-family: var(--mono); background: rgba(125,133,144,0.12); color: var(--text-muted); border: 1px solid rgba(125,133,144,0.25); }
      .sc-type-happy-path { background: rgba(74,222,128,0.12); color: var(--pass); border: 1px solid rgba(74,222,128,0.25); }
      .sc-type-medium { background: rgba(251,191,36,0.12); color: var(--partial); border: 1px solid rgba(251,191,36,0.25); }
      .sc-type-hard { background: rgba(251,146,60,0.12); color: #fb923c; border: 1px solid rgba(251,146,60,0.25); }
      .sc-type-very-hard { background: rgba(248,113,113,0.12); color: var(--fail); border: 1px solid rgba(248,113,113,0.25); }
      .sc-type-expert { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.30); }
      .sc-type-capability { background: rgba(188,140,255,0.12); color: var(--shaq); border: 1px solid rgba(188,140,255,0.25); }
      .sc-type-edge-case { background: rgba(251,191,36,0.12); color: var(--partial); border: 1px solid rgba(251,191,36,0.25); }
      .sc-type-escalation-case { background: rgba(56,139,253,0.12); color: var(--accent); border: 1px solid rgba(56,139,253,0.25); }
      .sc-type-negative-case { background: rgba(248,113,113,0.12); color: var(--fail); border: 1px solid rgba(248,113,113,0.25); }
      /* Draft rows */
      .sc-draft-row { background: rgba(125,133,144,0.04); }
      .sc-draft-row:hover { background: rgba(125,133,144,0.09) !important; }
      .sc-draft-badge-row { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; background: rgba(125,133,144,0.18); color: var(--text-muted); border: 1px solid rgba(125,133,144,0.3); vertical-align: middle; margin-right: 2px; }
      .sc-draft-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: rgba(125,133,144,0.18); color: var(--text-muted); border: 1px solid rgba(125,133,144,0.35); }
      .sc-ready-badge-row { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; background: rgba(74,222,128,0.18); color: var(--pass); border: 1px solid rgba(74,222,128,0.4); vertical-align: middle; margin-right: 2px; }
    </style>
  `;
}

// ── Edit Page ────────────────────────────────────────────────────────────────

import type { GeneratedGrader } from "../grader-generator.ts";

/**
 * Render a single grader preview card (used in both ScenarioEditPage and GraderPreviewFragment).
 */
function graderPreviewCard(gen: GeneratedGrader, idx: number, accepted: boolean): string {
  const g = gen.grader;
  const confClass = gen.confidence === "high" ? "sc-conf-high" : gen.confidence === "medium" ? "sc-conf-med" : "sc-conf-low";
  const confLabel = gen.confidence === "high" ? "high" : gen.confidence === "medium" ? "medium" : "low";

  // Build human-readable summary of grader properties
  const props = Object.entries(g)
    .filter(([k]) => k !== "type")
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<span class="sc-grader-prop-chip"><span class="sc-grader-prop-key">${esc(k)}</span> ${esc(String(v))}</span>`)
    .join("");

  // Hidden inputs that get submitted with the form when accepted
  const hiddenInputs = accepted
    ? buildGraderHiddenInputs(g, idx)
    : "";

  const cardId = `gen-grader-card-${idx}`;
  const checkboxId = `gen-grader-accept-${idx}`;

  // Always build the full hidden inputs — stored in data attr for JS toggle restore
  const allHiddenInputs = buildGraderHiddenInputs(g, idx);

  return `
    <div class="sc-gen-grader-card ${accepted ? "sc-gen-grader-accepted" : "sc-gen-grader-rejected"}" id="${cardId}" data-idx="${idx}" data-hidden-inputs="${esc(allHiddenInputs)}">
      <div class="sc-gen-grader-header">
        <span class="sc-gen-grader-type">${esc(g.type)}</span>
        ${props ? `<span class="sc-gen-grader-props">${props}</span>` : ""}
        <span class="sc-conf-badge ${confClass}">${confLabel}</span>
        <label class="sc-gen-grader-toggle" title="${accepted ? "Click to reject this grader" : "Click to accept this grader"}">
          <input
            type="checkbox"
            id="${checkboxId}"
            class="sc-gen-grader-checkbox"
            data-idx="${idx}"
            ${accepted ? "checked" : ""}
            onchange="toggleGraderCard(this)"
          >
          <span class="sc-gen-grader-toggle-label">${accepted ? "Accepted" : "Rejected"}</span>
        </label>
      </div>
      <div class="sc-gen-grader-source">${esc(gen.sourceText)}</div>
      <div class="sc-gen-grader-hidden" id="gen-grader-hidden-${idx}">
        ${hiddenInputs}
      </div>
    </div>
  `;
}

function buildGraderHiddenInputs(g: Grader, idx: number): string {
  const parts: string[] = [];
  parts.push(`<input type="hidden" name="grader_type_${idx}" value="${esc(g.type)}">`);
  const skip = new Set(["type"]);
  for (const [k, v] of Object.entries(g)) {
    if (skip.has(k) || v === undefined || v === null || v === "") continue;
    parts.push(`<input type="hidden" name="grader_prop_${idx}_${esc(k)}" value="${esc(String(v))}">`);
  }
  return parts.join("\n");
}

export function ScenarioEditPage(
  agent: string,
  scenarioId: string,
  parsed: ParsedScenario,
  issues: ValidationIssue[],
  savedFlash = false,
  generatedGraders?: GeneratedGrader[]
): string {
  const issuesHtml = savedFlash
    ? `<div class="sc-validation-box sc-validation-ok" id="validation-result"><div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>Saved successfully.</span></div></div>`
    : issues.length > 0
      ? `<div class="sc-validation-box ${issues.some(i => i.level === "error") ? "sc-validation-has-errors" : "sc-validation-has-warnings"}" id="validation-result">${issues.map(renderIssue).join("")}</div>`
      : `<div id="validation-result"></div>`;

  const categoryIsKnown = parsed.category !== "" && KNOWN_CATEGORIES.includes(parsed.category as KnownCategory);
  const categoryIsUnknown = parsed.category !== "" && !KNOWN_CATEGORIES.includes(parsed.category as KnownCategory);
  const categoryOptions = KNOWN_CATEGORIES.map(cat =>
    `<option value="${esc(cat)}"${parsed.category === cat ? " selected" : ""}>${esc(cat)}</option>`
  ).join("");
  const emptyOption = !categoryIsKnown
    ? `<option value="" selected>-- select --</option>`
    : `<option value="">-- select --</option>`;
  const unknownOption = categoryIsUnknown
    ? `<option value="${esc(parsed.category)}">${esc(parsed.category)} (unknown)</option>`
    : "";

  // Grader preview section
  // If generatedGraders provided: show the freshly generated preview
  // If existing graders: show current graders as read-only with a note
  let graderSectionHtml: string;
  if (generatedGraders !== undefined) {
    graderSectionHtml = renderGeneratedGraderSection(generatedGraders, agent, scenarioId);
  } else if (parsed.graders.length > 0) {
    graderSectionHtml = renderCurrentGraderSection(parsed.graders, agent, scenarioId);
  } else {
    graderSectionHtml = renderEmptyGraderSection(agent, scenarioId);
  }

  // Compute grader_count for hidden inputs — used if no generated graders (0 graders from form)
  const graderCount = generatedGraders
    ? generatedGraders.filter((_, i) => true).length  // actual count managed by JS
    : 0;

  return `
    <div class="page-title">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/scenarios?agent=${esc(agent)}" style="color:${agentColor(agent)};text-decoration:none;font-size:13px;font-weight:600">&#8592; ${esc(agent)}</a>
        <span style="color:var(--border)">/</span>
        <h1 style="margin:0;font-family:var(--mono);font-size:16px">${esc(scenarioId)}</h1>
      </div>
      <p>Edit scenario fields. Click "Generate Graders" to auto-generate graders from expected behavior and scoring rubric.</p>
    </div>
    <form
      id="scenario-form"
      method="POST"
      action="/api/scenarios/${esc(agent)}/${esc(scenarioId)}"
    >
      <div class="sc-edit-layout">

        <!-- Title -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-title">
            Title
            <span class="sc-field-hint">Must follow: # Eval: {Agent} — Scenario {N} — {Name} ({Type})</span>
          </label>
          <input
            id="f-title"
            name="title"
            type="text"
            class="sc-text-input"
            value="${esc(parsed.title)}"
          >
        </div>

        <!-- Overview -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-overview">Overview</label>
          <textarea id="f-overview" name="overview" class="sc-textarea" rows="3">${esc(parsed.overview)}</textarea>
        </div>

        <!-- Category -->
        <div class="sc-field-group sc-field-narrow">
          <label class="sc-field-label" for="f-category">Category</label>
          <select id="f-category" name="category" class="sc-select">
            ${emptyOption}
            ${unknownOption}
            ${categoryOptions}
          </select>
        </div>

        <!-- Prompt -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-prompt">
            Prompt
            <span class="sc-field-hint sc-required">Required — verbatim input to the agent</span>
          </label>
          <textarea id="f-prompt" name="prompt" class="sc-textarea sc-textarea-mono sc-textarea-tall" rows="10">${esc(parsed.prompt)}</textarea>
        </div>

        <!-- Expected Behavior -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-expected-behavior">Expected Behavior</label>
          <textarea id="f-expected-behavior" name="expected_behavior" class="sc-textarea" rows="6">${esc(parsed.expected_behavior)}</textarea>
        </div>

        <!-- Failure Modes -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-failure-modes">Failure Modes</label>
          <textarea id="f-failure-modes" name="failure_modes" class="sc-textarea" rows="5">${esc(parsed.failure_modes)}</textarea>
        </div>

        <!-- Scoring Rubric -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-scoring-rubric">
            Scoring Rubric
            <span class="sc-field-hint">Should include pass:, partial:, fail: sub-sections</span>
          </label>
          <textarea id="f-scoring-rubric" name="scoring_rubric" class="sc-textarea sc-textarea-mono" rows="8">${esc(parsed.scoring_rubric)}</textarea>
        </div>

        <!-- Reference Output -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-reference-output">
            Reference Output
            <span class="sc-field-hint">Optional — expected verbatim output</span>
          </label>
          <textarea id="f-reference-output" name="reference_output" class="sc-textarea sc-textarea-mono" rows="5">${esc(parsed.reference_output)}</textarea>
        </div>

        <!-- Generated Graders Panel -->
        <div class="sc-field-group" id="graders-section">
          <label class="sc-field-label">
            Generated Graders
            <span class="sc-field-hint">Auto-generated from expected behavior and scoring rubric</span>
          </label>
          <div id="grader-preview-panel">
            ${graderSectionHtml}
          </div>
        </div>

        <!-- Actions -->
        <div class="sc-actions">
          <button
            type="button"
            class="sc-btn-secondary"
            hx-post="/api/scenarios/${esc(agent)}/${esc(scenarioId)}/generate-graders"
            hx-include="#scenario-form"
            hx-target="#grader-preview-panel"
            hx-swap="innerHTML"
            hx-indicator="#gen-graders-spinner"
          >
            Generate Graders
          </button>
          <span id="gen-graders-spinner" class="htmx-indicator sc-spinner">generating...</span>
          <button
            type="button"
            class="sc-btn-secondary"
            hx-post="/api/scenarios/${esc(agent)}/${esc(scenarioId)}/validate"
            hx-include="#scenario-form"
            hx-target="#validation-result"
            hx-swap="outerHTML"
          >
            Validate
          </button>
          <button type="submit" class="sc-btn-primary" id="save-btn">
            Save
          </button>
          ${parsed.graders.length > 0 ? `<button
            id="dry-run-btn"
            type="button"
            class="sc-btn-run"
            hx-post="/api/scenarios/${esc(agent)}/${esc(scenarioId)}/dry-run"
            hx-include="#scenario-form"
            hx-target="#dry-run-error"
            hx-swap="innerHTML"
          >
            Dry Run
          </button>` : ""}
          ${parsed.graders.length > 0 ? `<button
            id="copy-team-prompt-btn"
            type="button"
            class="sc-btn-copy"
            onclick="copyTeamPrompt('${esc(agent)}', '${esc(scenarioId)}')"
          >
            Copy Team Prompt
          </button>` : ""}
          <a href="/scenarios?agent=${esc(agent)}" class="sc-btn-ghost">Cancel</a>
        </div>

        <!-- Feedback area (below all buttons) -->
        <div class="sc-feedback-area">
          ${issuesHtml}
          ${parsed.graders.length > 0 ? `<span id="dry-run-error" class="sc-dry-run-error"></span>` : ""}
          ${!savedFlash && parsed.graders.length === 0 ? `<div id="workflow-hint" style="padding:8px 14px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:6px;font-size:13px;color:var(--partial)">Next step: click <strong>Generate Graders</strong>, then <strong>Save</strong> to enable dry runs.</div>` : ""}
          ${savedFlash && parsed.graders.length > 0 ? `<div id="workflow-hint" style="padding:8px 14px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.25);border-radius:6px;font-size:13px;color:var(--pass)">Graders saved. Ready for <strong>Dry Run</strong>.</div>` : ""}
        </div>

      </div>
    </form>

    <script>
      // Toggle accept/reject on grader card
      function toggleGraderCard(checkbox) {
        const idx = checkbox.dataset.idx;
        const card = document.getElementById('gen-grader-card-' + idx);
        const label = checkbox.closest('.sc-gen-grader-toggle').querySelector('.sc-gen-grader-toggle-label');
        const hiddenDiv = document.getElementById('gen-grader-hidden-' + idx);
        const graderType = card.querySelector('.sc-gen-grader-type').textContent.trim();
        const propChips = card.querySelectorAll('.sc-grader-prop-chip');

        if (checkbox.checked) {
          card.classList.add('sc-gen-grader-accepted');
          card.classList.remove('sc-gen-grader-rejected');
          label.textContent = 'Accepted';
          // Re-build hidden inputs from card data attributes
          if (hiddenDiv) {
            hiddenDiv.innerHTML = card.dataset.hiddenInputs || '';
          }
        } else {
          card.classList.remove('sc-gen-grader-accepted');
          card.classList.add('sc-gen-grader-rejected');
          label.textContent = 'Rejected';
          if (hiddenDiv) {
            hiddenDiv.innerHTML = '';
          }
        }
        // Re-sync grader_count hidden input
        syncGraderCount();
      }

      function syncGraderCount() {
        // Count accepted graders
        const acceptedCheckboxes = document.querySelectorAll('.sc-gen-grader-checkbox:checked');
        // Update or create grader_count hidden in form
        let countEl = document.getElementById('gen-grader-count-hidden');
        if (!countEl) {
          countEl = document.createElement('input');
          countEl.type = 'hidden';
          countEl.name = 'grader_count';
          countEl.id = 'gen-grader-count-hidden';
          document.getElementById('scenario-form').appendChild(countEl);
        }
        countEl.value = String(acceptedCheckboxes.length);
      }

      // On page load, set initial grader_count
      document.addEventListener('DOMContentLoaded', function() {
        syncGraderCount();
      });
      // Also run after htmx swaps (grader panel may be replaced)
      document.addEventListener('htmx:afterSwap', function(evt) {
        if (evt.detail.target && evt.detail.target.id === 'grader-preview-panel') {
          syncGraderCount();
          // Enable Dry Run when graders are generated via htmx (dry-run saves form first)
          var dryRunBtn = document.getElementById('dry-run-btn');
          if (dryRunBtn) {
            var acceptedCount = document.querySelectorAll('.sc-gen-grader-checkbox:checked').length;
            if (acceptedCount > 0) {
              dryRunBtn.disabled = false;
              dryRunBtn.title = 'Save first to persist graders';
            } else {
              dryRunBtn.disabled = true;
              dryRunBtn.title = 'Generate graders and save first';
            }
          }
          // Update workflow hint banner
          var hint = document.getElementById('workflow-hint');
          if (hint) {
            var accepted = document.querySelectorAll('.sc-gen-grader-checkbox:checked').length;
            if (accepted > 0) {
              hint.style.background = 'rgba(251,191,36,0.1)';
              hint.style.border = '1px solid rgba(251,191,36,0.3)';
              hint.style.color = 'var(--partial)';
              hint.innerHTML = 'Graders generated. Click <strong>Save</strong> to persist them, then run <strong>Dry Run</strong>.';
              hint.style.display = '';
            }
          } else {
            // No hint exists yet — inject one in the actions bar if graders appeared
            var accepted2 = document.querySelectorAll('.sc-gen-grader-checkbox:checked').length;
            if (accepted2 > 0) {
              var newHint = document.createElement('div');
              newHint.id = 'workflow-hint';
              newHint.style.cssText = 'padding:8px 14px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:6px;font-size:13px;color:var(--partial)';
              newHint.innerHTML = 'Graders generated. Click <strong>Save</strong> to persist them, then run <strong>Dry Run</strong>.';
              var feedbackArea = document.querySelector('.sc-feedback-area');
              if (feedbackArea) feedbackArea.appendChild(newHint);
            }
          }
        }
      });

      // Keep Dry Run button in sync as user toggles grader accept/reject checkboxes
      document.addEventListener('change', function(evt) {
        if (evt.target && evt.target.classList.contains('sc-gen-grader-checkbox')) {
          var dryRunBtn = document.getElementById('dry-run-btn');
          if (dryRunBtn) {
            var acceptedCount = document.querySelectorAll('.sc-gen-grader-checkbox:checked').length;
            if (acceptedCount > 0) {
              dryRunBtn.disabled = false;
              dryRunBtn.title = 'Save first to persist graders';
            } else {
              dryRunBtn.disabled = true;
              dryRunBtn.title = 'Generate graders and save first';
            }
          }
        }
      });

      function copyTeamPrompt(agent, scenarioId) {
        var form = document.getElementById('scenario-form');
        if (!form) return;
        var title = (form.querySelector('[name="title"]') || {}).value || '';
        var prompt = (form.querySelector('[name="prompt"]') || {}).value || '';
        var expectedBehavior = (form.querySelector('[name="expected_behavior"]') || {}).value || '';
        var scoringRubric = (form.querySelector('[name="scoring_rubric"]') || {}).value || '';

        var text = '/team Implement: ' + title + '\\n\\n'
          + '## Context\\n' + prompt + '\\n\\n'
          + '## Acceptance Criteria (from eval scenario ' + agent + '/' + scenarioId + ')\\n' + expectedBehavior + '\\n\\n'
          + '## Scoring Rubric\\n' + scoringRubric + '\\n\\n'
          + '## Validation\\n'
          + 'After implementation, run dry run on scenario ' + agent + '/' + scenarioId + ' to verify.';

        // Show modal with selectable text
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
        var modal = document.createElement('div');
        modal.style.cssText = 'background:var(--surface-2,#1c1f26);border:1px solid var(--border,#333);border-radius:10px;padding:20px;max-width:700px;width:90%;max-height:80vh;display:flex;flex-direction:column;gap:12px;';
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        header.innerHTML = '<span style="font-weight:600;font-size:14px;color:var(--text,#e6edf3)">Team Prompt</span>';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'background:var(--surface-3,#2d333b);border:1px solid var(--border,#333);border-radius:6px;padding:4px 12px;color:var(--text-dim,#8b949e);cursor:pointer;font-size:12px;';
        closeBtn.onclick = function() { document.body.removeChild(overlay); };
        header.appendChild(closeBtn);
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.readOnly = true;
        ta.style.cssText = 'width:100%;min-height:300px;background:var(--surface,#0d1117);color:var(--text,#e6edf3);border:1px solid var(--border,#333);border-radius:6px;padding:12px;font-family:var(--mono,monospace);font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box;';
        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy to Clipboard';
        copyBtn.style.cssText = 'align-self:flex-start;background:var(--accent,#58a6ff);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;';
        copyBtn.onclick = function() {
          ta.focus(); ta.select();
          document.execCommand('copy');
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        };
        modal.appendChild(header);
        modal.appendChild(ta);
        modal.appendChild(copyBtn);
        overlay.appendChild(modal);
        overlay.onclick = function(e) { if (e.target === overlay) document.body.removeChild(overlay); };
        document.body.appendChild(overlay);
        ta.focus();
        ta.select();
      }
    </script>
  `;
}

/**
 * Returns the current workflow step (1-7) based on draft state.
 *
 * Step 1 — Review content: placeholder text still present
 * Step 2 — Generate Graders: content filled but no graders exist yet
 * Step 3 — Save: graders generated in preview but not yet persisted
 * Step 4 — Validate: graders saved but validation errors exist
 * Step 5 — Set category: graders saved, no errors, but category is still "draft"
 * Step 6 — Dry Run: category set, graders exist, no dry run result yet
 * Step 7 — Promote: dry run complete
 */
function computeWorkflowStep(
  hasPlaceholder: boolean,
  gradersExist: boolean,
  generatedGraders: GeneratedGrader[] | undefined,
  categoryIsDraft: boolean,
  dryRunDone: boolean,
  issues: ValidationIssue[] = []
): number {
  if (hasPlaceholder) return 1;
  if (!gradersExist && generatedGraders === undefined) return 2;
  if (generatedGraders !== undefined && !gradersExist) return 3;
  if (gradersExist) {
    const hasErrors = issues.some(i => i.level === "error");
    if (hasErrors) return 4;
    if (categoryIsDraft) return 5;
    if (!dryRunDone) return 6;
    return 7;
  }
  return 3;
}

const WORKFLOW_STEPS: { label: string; hint: string }[] = [
  {
    label: "Review content",
    hint: "Replace the placeholder text in Expected Behavior, Failure Modes, and Scoring Rubric with real criteria based on the reference output.",
  },
  {
    label: "Generate Graders",
    hint: "Click 'Generate Graders' below to create machine-checkable assertions from your scoring rubric.",
  },
  {
    label: "Save",
    hint: "Review the generated graders, then click 'Save' to persist them.",
  },
  {
    label: "Validate",
    hint: "Click 'Validate' to check for errors before proceeding.",
  },
  {
    label: "Set category",
    hint: "Set the category dropdown to classify this scenario (capability, regression, edge-case, etc.).",
  },
  {
    label: "Dry Run",
    hint: "Click 'Dry Run' to execute a single-trial eval and validate the scenario.",
  },
  {
    label: "Promote",
    hint: "Review the dry run results, then click 'Promote to Production' to finalize.",
  },
];

/**
 * Renders a horizontal workflow stepper bar for the draft edit page.
 * currentStep is 1-based.
 */
function WorkflowStepper(currentStep: number): string {
  const stepCircles = WORKFLOW_STEPS.map((step, i) => {
    const n = i + 1;
    const isCompleted = n < currentStep;
    const isCurrent = n === currentStep;

    let circleStyle: string;
    let circleContent: string;
    let labelStyle: string;

    if (isCompleted) {
      circleStyle = "background:var(--pass);border-color:var(--pass);color:#0d1117";
      circleContent = "&#10003;";
      labelStyle = "color:var(--pass)";
    } else if (isCurrent) {
      circleStyle = "background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 0 0 3px rgba(56,139,253,0.25)";
      circleContent = String(n);
      labelStyle = "color:var(--accent);font-weight:600";
    } else {
      circleStyle = "background:transparent;border-color:var(--border);color:var(--text-muted)";
      circleContent = String(n);
      labelStyle = "color:var(--text-muted)";
    }

    const connectorColor = isCompleted ? "var(--pass)" : "var(--border)";
    const connectorHtml = i < WORKFLOW_STEPS.length - 1
      ? `<div style="flex:1;height:2px;background:${connectorColor};margin:0 4px;align-self:center;min-width:12px"></div>`
      : "";

    return `
      <div style="display:flex;align-items:center;flex:${i < WORKFLOW_STEPS.length - 1 ? "1" : "0 0 auto"}">
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:48px">
          <div style="width:28px;height:28px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;${circleStyle}">${circleContent}</div>
          <span style="font-size:11px;white-space:nowrap;${labelStyle}">${esc(step.label)}</span>
        </div>
        ${connectorHtml}
      </div>
    `;
  }).join("");

  const currentHint = WORKFLOW_STEPS[currentStep - 1]?.hint ?? "";

  return `
    <div class="sc-workflow-stepper" style="margin-bottom:24px">
      <div style="display:flex;align-items:flex-start;width:100%;overflow-x:auto;padding-bottom:4px">
        ${stepCircles}
      </div>
      ${currentHint ? `<div style="margin-top:10px;padding:8px 14px;background:rgba(56,139,253,0.08);border:1px solid rgba(56,139,253,0.25);border-radius:6px;font-size:13px;color:var(--text)"><span style="color:var(--accent);font-weight:600">Step ${currentStep}:</span> ${esc(currentHint)}</div>` : ""}
    </div>
  `;
}

/**
 * DraftEditPage — same as ScenarioEditPage but with draft-specific UI:
 * - Draft badge in header
 * - Workflow stepper showing current position in draft-to-production process
 * - Form actions point to /api/scenarios/:agent/drafts/:draftId
 * - Promote button shown when dryRunDone is true
 * - Promote blocked by placeholder text / category=draft
 */
export function DraftEditPage(
  agent: string,
  draftId: string,
  parsed: ParsedScenario,
  issues: ValidationIssue[],
  savedFlash = false,
  generatedGraders?: GeneratedGrader[],
  dryRunDone = false
): string {
  const PLACEHOLDER = "DRAFT - Needs human review";
  const hasPlaceholder =
    parsed.expected_behavior.includes(PLACEHOLDER) ||
    parsed.failure_modes.includes(PLACEHOLDER) ||
    parsed.scoring_rubric.includes(PLACEHOLDER);
  const categoryIsDraft = !parsed.category || parsed.category === "draft";
  const gradersExist = parsed.graders.length > 0;

  const currentStep = computeWorkflowStep(
    hasPlaceholder,
    gradersExist,
    generatedGraders,
    categoryIsDraft,
    dryRunDone,
    issues
  );
  const stepperHtml = WorkflowStepper(currentStep);

  // Build flash/error messages
  let flashHtml = "";
  if (savedFlash) {
    flashHtml = `<div class="sc-validation-box sc-validation-ok" id="validation-result"><div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>Draft saved successfully.</span></div></div>`;
  } else if (issues.length > 0) {
    const hasErrors = issues.some(i => i.level === "error");
    flashHtml = `<div class="sc-validation-box ${hasErrors ? "sc-validation-has-errors" : "sc-validation-has-warnings"}" id="validation-result">${issues.map(renderIssue).join("")}</div>`;
  } else {
    flashHtml = `<div id="validation-result"></div>`;
  }

  const categoryIsKnown = parsed.category !== "" && KNOWN_CATEGORIES.includes(parsed.category as KnownCategory);
  const categoryIsUnknown = parsed.category !== "" && !KNOWN_CATEGORIES.includes(parsed.category as KnownCategory);
  const categoryOptions = KNOWN_CATEGORIES.map(cat =>
    `<option value="${esc(cat)}"${parsed.category === cat ? " selected" : ""}>${esc(cat)}</option>`
  ).join("");
  const emptyOption = !categoryIsKnown
    ? `<option value="" selected>-- select --</option>`
    : `<option value="">-- select --</option>`;
  const unknownOption = categoryIsUnknown
    ? `<option value="${esc(parsed.category)}">${esc(parsed.category)} (unknown)</option>`
    : "";

  let graderSectionHtml: string;
  if (generatedGraders !== undefined) {
    graderSectionHtml = renderGeneratedGraderSection(generatedGraders, agent, draftId);
  } else if (parsed.graders.length > 0) {
    graderSectionHtml = renderCurrentGraderSection(parsed.graders, agent, draftId);
  } else {
    graderSectionHtml = renderEmptyGraderSection(agent, draftId);
  }

  // Build promote section
  let promoteHtml = "";
  if (dryRunDone) {
    const promoteBlocked = hasPlaceholder || categoryIsDraft;
    const promoteBlockReason = hasPlaceholder
      ? "Placeholder text must be replaced before promoting."
      : categoryIsDraft
        ? "Category must be set (not 'draft') before promoting."
        : "";
    if (promoteBlocked) {
      promoteHtml = `
        <div class="sc-promote-form">
          <div class="sc-promote-header">
            <span class="sc-promote-title">Ready to promote</span>
            <span class="sc-promote-blocked-reason">${esc(promoteBlockReason)}</span>
          </div>
          <button type="button" class="sc-btn-promote" disabled title="${esc(promoteBlockReason)}">
            Promote to Production
          </button>
        </div>
      `;
    } else {
      promoteHtml = `
        <div class="sc-promote-form">
          <div class="sc-promote-header">
            <span class="sc-promote-title">Dry run complete — ready to promote</span>
            <span class="sc-promote-hint">This will rename the draft to a production scenario file.</span>
          </div>
          <form method="POST" action="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/promote" style="display:inline">
            <button type="submit" class="sc-btn-promote">
              Promote to Production
            </button>
          </form>
        </div>
      `;
    }
  }

  return `
    <div class="page-title">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/scenarios?agent=${esc(agent)}" style="color:${agentColor(agent)};text-decoration:none;font-size:13px;font-weight:600">&#8592; ${esc(agent)}</a>
        <span style="color:var(--border)">/</span>
        <span class="sc-draft-badge">draft</span>
        <h1 style="margin:0;font-family:var(--mono);font-size:16px">${esc(draftId)}</h1>
      </div>
    </div>

    ${stepperHtml}

    ${promoteHtml}

    <form
      id="scenario-form"
      method="POST"
      action="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}"
    >
      <div class="sc-edit-layout">

        <!-- Title -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-title">Title</label>
          <input id="f-title" name="title" type="text" class="sc-text-input" value="${esc(parsed.title)}">
        </div>

        <!-- Overview -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-overview">Overview</label>
          <textarea id="f-overview" name="overview" class="sc-textarea" rows="3">${esc(parsed.overview)}</textarea>
        </div>

        <!-- Category -->
        <div class="sc-field-group sc-field-narrow">
          <label class="sc-field-label" for="f-category">Category</label>
          <select id="f-category" name="category" class="sc-select">
            ${emptyOption}
            ${unknownOption}
            ${categoryOptions}
          </select>
        </div>

        <!-- Prompt -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-prompt">
            Prompt
            <span class="sc-field-hint sc-required">Required — verbatim input to the agent</span>
          </label>
          <textarea id="f-prompt" name="prompt" class="sc-textarea sc-textarea-mono sc-textarea-tall" rows="10">${esc(parsed.prompt)}</textarea>
        </div>

        <!-- Expected Behavior -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-expected-behavior">Expected Behavior</label>
          <textarea id="f-expected-behavior" name="expected_behavior" class="sc-textarea" rows="6">${esc(parsed.expected_behavior)}</textarea>
        </div>

        <!-- Failure Modes -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-failure-modes">Failure Modes</label>
          <textarea id="f-failure-modes" name="failure_modes" class="sc-textarea" rows="5">${esc(parsed.failure_modes)}</textarea>
        </div>

        <!-- Scoring Rubric -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-scoring-rubric">
            Scoring Rubric
            <span class="sc-field-hint">Should include pass:, partial:, fail: sub-sections</span>
          </label>
          <textarea id="f-scoring-rubric" name="scoring_rubric" class="sc-textarea sc-textarea-mono" rows="8">${esc(parsed.scoring_rubric)}</textarea>
        </div>

        <!-- Reference Output -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-reference-output">
            Reference Output
            <span class="sc-field-hint">Optional — expected verbatim output</span>
          </label>
          <textarea id="f-reference-output" name="reference_output" class="sc-textarea sc-textarea-mono" rows="5">${esc(parsed.reference_output)}</textarea>
        </div>

        <!-- Generated Graders Panel -->
        <div class="sc-field-group" id="graders-section">
          <label class="sc-field-label">
            Generated Graders
            <span class="sc-field-hint">Auto-generated from expected behavior and scoring rubric</span>
          </label>
          <div id="grader-preview-panel">
            ${graderSectionHtml}
          </div>
        </div>

        <!-- Actions -->
        <div class="sc-actions">
          <button
            type="button"
            class="sc-btn-secondary"
            hx-post="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/generate-graders"
            hx-include="#scenario-form"
            hx-target="#grader-preview-panel"
            hx-swap="innerHTML"
            hx-indicator="#gen-graders-spinner"
          >
            Generate Graders
          </button>
          <span id="gen-graders-spinner" class="htmx-indicator sc-spinner">generating...</span>
          <button type="submit" class="sc-btn-primary" id="save-btn">
            Save
          </button>
          <button
            type="button"
            class="sc-btn-secondary"
            hx-post="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/validate"
            hx-include="#scenario-form"
            hx-target="#validation-result"
            hx-swap="outerHTML"
          >
            Validate
          </button>
          ${parsed.graders.length > 0 ? `<button
            id="dry-run-btn"
            type="button"
            class="sc-btn-run"
            hx-post="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/dry-run"
            hx-include="#scenario-form"
            hx-target="#dry-run-error"
            hx-swap="innerHTML"
          >
            Dry Run
          </button>` : ""}
          <a href="/scenarios?agent=${esc(agent)}" class="sc-btn-ghost">Cancel</a>
        </div>

        <!-- Feedback area -->
        <div class="sc-feedback-area">
          ${flashHtml}
          ${gradersExist ? `<span id="dry-run-error" class="sc-dry-run-error"></span>` : ""}
        </div>

      </div>
    </form>

    <script>
      function toggleGraderCard(checkbox) {
        const idx = checkbox.dataset.idx;
        const card = document.getElementById('gen-grader-card-' + idx);
        const label = checkbox.closest('.sc-gen-grader-toggle').querySelector('.sc-gen-grader-toggle-label');
        const hiddenDiv = document.getElementById('gen-grader-hidden-' + idx);
        if (checkbox.checked) {
          card.classList.add('sc-gen-grader-accepted');
          card.classList.remove('sc-gen-grader-rejected');
          label.textContent = 'Accepted';
          if (hiddenDiv) hiddenDiv.innerHTML = card.dataset.hiddenInputs || '';
        } else {
          card.classList.remove('sc-gen-grader-accepted');
          card.classList.add('sc-gen-grader-rejected');
          label.textContent = 'Rejected';
          if (hiddenDiv) hiddenDiv.innerHTML = '';
        }
        syncGraderCount();
      }
      function syncGraderCount() {
        const acceptedCheckboxes = document.querySelectorAll('.sc-gen-grader-checkbox:checked');
        let countEl = document.getElementById('gen-grader-count-hidden');
        if (!countEl) {
          countEl = document.createElement('input');
          countEl.type = 'hidden';
          countEl.name = 'grader_count';
          countEl.id = 'gen-grader-count-hidden';
          document.getElementById('scenario-form').appendChild(countEl);
        }
        countEl.value = String(acceptedCheckboxes.length);
      }
      document.addEventListener('DOMContentLoaded', function() { syncGraderCount(); });
      document.addEventListener('htmx:afterSwap', function(evt) {
        if (evt.detail.target && evt.detail.target.id === 'grader-preview-panel') {
          syncGraderCount();
          var dryRunBtn = document.getElementById('dry-run-btn');
          if (dryRunBtn) {
            var accepted = document.querySelectorAll('.sc-gen-grader-checkbox:checked').length;
            dryRunBtn.disabled = accepted === 0;
          }
        }
      });
    </script>
  `;
}

function renderGeneratedGraderSection(graders: GeneratedGrader[], agent: string, scenarioId: string): string {
  if (graders.length === 0) {
    return `<div class="sc-gen-grader-empty">No machine-checkable assertions found — scoring will rely entirely on LLM rubric evaluation.</div>`;
  }
  // Default: accept high and medium confidence, reject low
  const cards = graders.map((g, i) => {
    const accepted = g.confidence !== "low";
    return graderPreviewCard(g, i, accepted);
  }).join("");
  return `<div class="sc-gen-grader-list">${cards}</div>`;
}

function renderCurrentGraderSection(graders: Grader[], _agent: string, _scenarioId: string): string {
  const chips = graders.map(g => {
    const props = Object.entries(g)
      .filter(([k]) => k !== "type")
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `<span style="color:var(--text-muted)">${esc(k)}:</span> ${esc(String(v))}`)
      .join(", ");
    return `<span class="sc-current-grader-chip">${esc(g.type)}${props ? ` <span style="color:var(--text-muted);font-size:10px">(${props})</span>` : ""}</span>`;
  }).join("");

  return `
    <div class="sc-current-graders-note">
      Current graders (from file) — click "Generate Graders" to regenerate from expected behavior and scoring rubric.
    </div>
    <div>${chips}</div>
    <input type="hidden" name="grader_count" value="${graders.length}" id="gen-grader-count-hidden">
    ${graders.map((g, i) => buildGraderHiddenInputs(g, i)).join("\n")}
  `;
}

function renderEmptyGraderSection(_agent: string, _scenarioId: string): string {
  return `
    <div class="sc-gen-grader-empty">
      No graders defined. Click "Generate Graders" to auto-generate from expected behavior and scoring rubric.
    </div>
    <input type="hidden" name="grader_count" value="0" id="gen-grader-count-hidden">
  `;
}

/**
 * GraderPreviewFragment — htmx fragment returned by POST /generate-graders.
 * Replaces the inner HTML of #grader-preview-panel.
 */
export function GraderPreviewFragment(graders: GeneratedGrader[]): string {
  if (graders.length === 0) {
    return `<div class="sc-gen-grader-empty">No machine-checkable assertions found — scoring will rely entirely on LLM rubric evaluation.</div>
<input type="hidden" name="grader_count" value="0" id="gen-grader-count-hidden">`;
  }
  const cards = graders.map((g, i) => {
    const accepted = g.confidence !== "low";
    return graderPreviewCard(g, i, accepted);
  }).join("");
  return `<div class="sc-gen-grader-list">${cards}</div>
<input type="hidden" name="grader_count" id="gen-grader-count-hidden" value="${graders.filter(g => g.confidence !== "low").length}">`;
}


function renderIssue(issue: ValidationIssue): string {
  const icon = issue.level === "error" ? "&#10007;" : "&#9888;";
  return `<div class="sc-issue ${esc(issue.level)}"><span class="sc-issue-icon">${icon}</span><span>${esc(issue.message)}</span></div>`;
}

export function ValidationResultFragment(issues: ValidationIssue[], suggestedTitle?: string): string {
  const hasErrors = issues.some(i => i.level === "error");

  // Build the suggested-title injection block when a suggestion is available and there are no errors
  const titleSuggestionHtml = (suggestedTitle && !hasErrors) ? `
    <input type="hidden" id="suggested-title" value="${esc(suggestedTitle)}">
    <div class="sc-issue ok" style="margin-top:6px"><span class="sc-issue-icon">&#8594;</span><span>Title auto-set to: <strong>${esc(suggestedTitle)}</strong></span></div>
    <script>
      (function() {
        var inp = document.getElementById('suggested-title');
        if (inp) {
          var titleField = document.getElementById('f-title');
          if (titleField) titleField.value = inp.value;
        }
      })();
    </script>` : "";

  if (issues.length === 0) {
    return `<div class="sc-validation-box sc-validation-ok" id="validation-result"><div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>No issues found — file is ready to save.</span></div>${titleSuggestionHtml}</div>`;
  }
  const boxClass = hasErrors ? "sc-validation-has-errors" : "sc-validation-has-warnings";
  return `<div class="sc-validation-box ${boxClass}" id="validation-result">${issues.map(renderIssue).join("")}${titleSuggestionHtml}</div>`;
}

export function SaveSuccessPage(agent: string, scenarioId: string): string {
  return `
    <div class="sc-validation-box sc-validation-ok" id="validation-result">
      <div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>Saved successfully.</span></div>
    </div>
  `;
}

// ── New Scenario Page ────────────────────────────────────────────────────────

/**
 * ScenarioNewPage — form to create a new scenario.
 * Step 1: agent + description only. Step 2 (post-generate): full edit form swapped in via htmx.
 */
export function ScenarioNewPage(preselectedAgent = ""): string {
  const agentOptions = KNOWN_AGENTS.map(a =>
    `<option value="${esc(a)}"${preselectedAgent === a ? " selected" : ""}>${esc(a)}</option>`
  ).join("");

  return `
    <div class="page-title">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/scenarios" style="color:var(--text-muted);text-decoration:none;font-size:13px;font-weight:600">&#8592; Scenarios</a>
        <span style="color:var(--border)">/</span>
        <h1 style="margin:0;font-size:18px">New Scenario</h1>
      </div>
      <p>Select an agent and describe what the scenario should test. Click "Generate Scenario" to have Bird generate all fields including the eval prompt.</p>
    </div>

    <div class="sc-edit-layout" style="max-width:820px">

      <!-- Step 1: Agent + Description -->
      <form id="new-scenario-form">

        <div style="display:flex;flex-direction:column;gap:20px">

          <!-- Agent -->
          <div class="sc-field-group sc-field-narrow">
            <label class="sc-field-label" for="ns-agent">Agent <span class="sc-required">Required</span></label>
            <select id="ns-agent" name="agent" class="sc-select" required>
              <option value="">-- select agent --</option>
              ${agentOptions}
            </select>
          </div>

          <!-- Description -->
          <div class="sc-field-group">
            <label class="sc-field-label" for="ns-description">
              Scenario Description
              <span class="sc-field-hint sc-required">Required — describe what this scenario should test (not the eval prompt itself)</span>
            </label>
            <textarea
              id="ns-description"
              name="description"
              class="sc-textarea sc-textarea-tall"
              rows="8"
              placeholder="e.g., Test Bird's ability to identify domain rules when the input contains contradictory business requirements"
              required
            ></textarea>
          </div>

          <!-- Generate button -->
          <div class="sc-actions">
            <button
              type="button"
              class="sc-btn-primary"
              id="generate-btn"
              hx-post="/api/scenarios/generate"
              hx-include="#new-scenario-form"
              hx-target="#generated-fields"
              hx-swap="innerHTML"
              hx-indicator="#generate-spinner"
              hx-disabled-elt="this"
              hx-on:htmx:confirm="if(!document.querySelector('[name=agent]').value || !document.querySelector('[name=description]').value.trim()) { evt.preventDefault(); alert('Please select an agent and enter a scenario description.'); }"
            >
              Generate Scenario
            </button>
            <span id="generate-spinner" class="htmx-indicator sc-spinner">generating...</span>
            <a href="/scenarios" class="sc-btn-ghost">Cancel</a>
          </div>
        </div>

      </form>

      <!-- Step 2: Generated fields appear here (htmx swap target) -->
      <div id="generated-fields"></div>

    </div>

  `;
}

/**
 * ScenarioGenerateFragment — htmx fragment returned by POST /api/scenarios/generate.
 * Renders the full edit form pre-filled with AI-generated content.
 * This replaces the inner HTML of #generated-fields.
 */
export function ScenarioGenerateFragment(
  agent: string,
  generated: ParsedScenario,
  errorMessage?: string
): string {
  if (errorMessage) {
    return `<div class="sc-generate-error">${esc(errorMessage)}</div>`;
  }

  const categoryIsKnown = generated.category !== "" && KNOWN_CATEGORIES.includes(generated.category as KnownCategory);
  const categoryIsUnknown = generated.category !== "" && !KNOWN_CATEGORIES.includes(generated.category as KnownCategory);
  const categoryOptions = KNOWN_CATEGORIES.map(cat =>
    `<option value="${esc(cat)}"${generated.category === cat ? " selected" : ""}>${esc(cat)}</option>`
  ).join("");
  const emptyOption = !categoryIsKnown
    ? `<option value="" selected>-- select --</option>`
    : `<option value="">-- select --</option>`;
  const unknownOption = categoryIsUnknown
    ? `<option value="${esc(generated.category)}">${esc(generated.category)} (unknown)</option>`
    : "";

  return `
    <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--pass)">&#10003; Generated</span>
        <span style="font-size:12px;color:var(--text-muted)">Review and edit the fields below, then click Save to create the scenario file.</span>
      </div>

      <form
        id="new-scenario-save-form"
        method="POST"
        action="/api/scenarios/new"
        style="display:flex;flex-direction:column;gap:20px"
      >
        <input type="hidden" name="agent" value="${esc(agent)}">

        <!-- Title -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-title">
            Title
            <span class="sc-field-hint">Format: Eval: {Agent} — Scenario {N} — {Name} ({Type})</span>
          </label>
          <input
            id="ns-title"
            name="title"
            type="text"
            class="sc-text-input"
            value="${esc(generated.title)}"
          >
        </div>

        <!-- Overview -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-overview">Overview</label>
          <textarea id="ns-overview" name="overview" class="sc-textarea" rows="3">${esc(generated.overview)}</textarea>
        </div>

        <!-- Category -->
        <div class="sc-field-group sc-field-narrow">
          <label class="sc-field-label" for="ns-category">Category</label>
          <select id="ns-category" name="category" class="sc-select">
            ${emptyOption}
            ${unknownOption}
            ${categoryOptions}
          </select>
        </div>

        <!-- Prompt (read-only display, value carried from the generation step) -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-prompt-save">
            Prompt
            <span class="sc-field-hint sc-required">Required</span>
          </label>
          <textarea id="ns-prompt-save" name="prompt" class="sc-textarea sc-textarea-mono sc-textarea-tall" rows="10">${esc(generated.prompt)}</textarea>
        </div>

        <!-- Expected Behavior -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-expected-behavior">Expected Behavior</label>
          <textarea id="ns-expected-behavior" name="expected_behavior" class="sc-textarea" rows="6">${esc(generated.expected_behavior)}</textarea>
        </div>

        <!-- Failure Modes -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-failure-modes">Failure Modes</label>
          <textarea id="ns-failure-modes" name="failure_modes" class="sc-textarea" rows="5">${esc(generated.failure_modes)}</textarea>
        </div>

        <!-- Scoring Rubric -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-scoring-rubric">
            Scoring Rubric
            <span class="sc-field-hint">Should include pass:, partial:, fail: sub-sections</span>
          </label>
          <textarea id="ns-scoring-rubric" name="scoring_rubric" class="sc-textarea sc-textarea-mono" rows="8">${esc(generated.scoring_rubric)}</textarea>
        </div>

        <!-- Reference Output (optional, left empty by default) -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="ns-reference-output">
            Reference Output
            <span class="sc-field-hint">Optional — expected verbatim output</span>
          </label>
          <textarea id="ns-reference-output" name="reference_output" class="sc-textarea sc-textarea-mono" rows="4">${esc(generated.reference_output)}</textarea>
        </div>

        <!-- Actions -->
        <div class="sc-actions">
          <button type="submit" class="sc-btn-primary">
            Save Scenario
          </button>
          <a href="/scenarios" class="sc-btn-ghost">Cancel</a>
        </div>

        <!-- Feedback area (below all buttons) -->
        <div id="new-validation-result"></div>

      </form>
    </div>
  `;
}

// ── Team Scenario Edit Page ──────────────────────────────────────────────────

/**
 * TeamScenarioEditPage — view for editing a team scenario draft.
 * Uses <details>/<summary> for collapsible phases.
 * Each phase shows: agent label, prompt textarea, expected_behavior textarea, graders list.
 * Human phases show fixture text with a read-only indicator.
 * Pipeline section at bottom for pipeline_expected_behavior, pipeline_failure_modes,
 * pipeline_scoring_rubric textareas.
 * Form posts to the save route; form fields use phase_N_ prefix.
 */
export function TeamScenarioEditPage(
  agent: string,
  draftId: string,
  parsed: ParsedTeamScenario,
  issues: ValidationIssue[],
  savedFlash = false,
  dryRunDone = false
): string {
  let flashHtml = "";
  if (savedFlash) {
    flashHtml = `<div class="sc-validation-box sc-validation-ok" id="validation-result"><div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>Team scenario saved successfully.</span></div></div>`;
  } else if (issues.length > 0) {
    const hasErrors = issues.some(i => i.level === "error");
    flashHtml = `<div class="sc-validation-box ${hasErrors ? "sc-validation-has-errors" : "sc-validation-has-warnings"}" id="validation-result">${issues.map(renderIssue).join("")}</div>`;
  } else {
    flashHtml = `<div id="validation-result"></div>`;
  }

  const phasesHtml = parsed.phases.map(phase => {
    const pn = phase.phaseNum;
    const isHuman = phase.agent === "human";
    const gradersChips = phase.graders.length > 0
      ? phase.graders.map(g => `<span class="sc-current-grader-chip">${esc(g.type)}</span>`).join(" ")
      : `<span style="color:var(--text-muted);font-size:12px">No phase graders defined</span>`;

    const promptField = isHuman
      ? `
        <div class="sc-field-group">
          <label class="sc-field-label">
            Human Decision Fixture
            <span class="sc-field-hint">Read-only — fixture injected automatically during eval</span>
          </label>
          <textarea
            name="phase_${pn}_prompt"
            class="sc-textarea sc-textarea-mono"
            rows="4"
            readonly
            style="opacity:0.7;cursor:not-allowed"
          >${esc(phase.prompt)}</textarea>
        </div>`
      : `
        <div class="sc-field-group">
          <label class="sc-field-label">
            Prompt
            <span class="sc-field-hint sc-required">Required — verbatim input to ${esc(phase.agent)}</span>
          </label>
          <textarea name="phase_${pn}_prompt" class="sc-textarea sc-textarea-mono sc-textarea-tall" rows="8">${esc(phase.prompt)}</textarea>
        </div>`;

    const expectedBehaviorField = !isHuman ? `
      <div class="sc-field-group">
        <label class="sc-field-label">Expected Behavior</label>
        <textarea name="phase_${pn}_expected_behavior" class="sc-textarea" rows="5">${esc(phase.expectedBehavior)}</textarea>
      </div>` : "";

    const gradersSection = !isHuman ? `
      <div class="sc-field-group">
        <label class="sc-field-label">
          Phase Graders
          <span class="sc-field-hint">Machine-checkable assertions for this phase</span>
        </label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0">${gradersChips}</div>
        <div id="grader-preview-panel-phase-${pn}"></div>
        <button
          type="button"
          class="sc-btn-secondary"
          style="margin-top:6px;font-size:12px"
          hx-post="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/generate-graders?phase=${pn}"
          hx-include="#scenario-form"
          hx-target="#grader-preview-panel-phase-${pn}"
          hx-swap="innerHTML"
        >
          Generate Graders for Phase ${pn} (${esc(phase.agent)})
        </button>
      </div>` : "";

    const agentBadgeStyle = isHuman
      ? `style="color:var(--text-muted);background:rgba(125,133,144,0.15);border:1px solid rgba(125,133,144,0.3);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700"`
      : `class="agent-badge ${esc(phase.agent)}"`;

    return `
      <details class="sc-phase-details" open>
        <summary class="sc-phase-summary">
          <span style="font-weight:600;font-size:13px">Phase ${pn}</span>
          <span ${agentBadgeStyle}>${esc(phase.agent)}</span>
          ${isHuman ? `<span style="color:var(--text-muted);font-size:11px;margin-left:4px">(fixture)</span>` : ""}
        </summary>
        <div class="sc-phase-body">
          <input type="hidden" name="phase_${pn}_agent" value="${esc(phase.agent)}">
          ${promptField}
          ${expectedBehaviorField}
          ${gradersSection}
        </div>
      </details>
    `;
  }).join("\n");

  const promoteHtml = dryRunDone ? `
    <div class="sc-promote-form">
      <div class="sc-promote-header">
        <span class="sc-promote-title">Dry run complete — ready to promote</span>
        <span class="sc-promote-hint">This will write the team scenario to evals/team/.</span>
      </div>
      <form method="POST" action="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/promote" style="display:inline">
        <button type="submit" class="sc-btn-promote">Promote to Production</button>
      </form>
    </div>
  ` : "";

  return `
    <div class="page-title">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/scenarios?agent=${esc(agent)}" style="color:${agentColor(agent)};text-decoration:none;font-size:13px;font-weight:600">&#8592; ${esc(agent)}</a>
        <span style="color:var(--border)">/</span>
        <span class="sc-draft-badge">team draft</span>
        <h1 style="margin:0;font-family:var(--mono);font-size:16px">${esc(draftId)}</h1>
      </div>
      <p>Edit team scenario phases. Phases execute sequentially; human phases inject fixture text.</p>
    </div>

    ${promoteHtml}

    <form
      id="scenario-form"
      method="POST"
      action="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}"
    >
      <!-- Hidden flag to indicate this is a team scenario -->
      <input type="hidden" name="is_team" value="1">
      <input type="hidden" name="phase_count" value="${parsed.phases.length}">

      <div class="sc-edit-layout">

        <!-- Title -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-title">Title</label>
          <input id="f-title" name="title" type="text" class="sc-text-input" value="${esc(parsed.title)}">
        </div>

        <!-- Overview -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-overview">Overview</label>
          <textarea id="f-overview" name="overview" class="sc-textarea" rows="3">${esc(parsed.overview)}</textarea>
        </div>

        <!-- Category -->
        <div class="sc-field-group sc-field-narrow">
          <label class="sc-field-label" for="f-category">Category</label>
          <select id="f-category" name="category" class="sc-select">
            ${KNOWN_CATEGORIES.map(cat => `<option value="${esc(cat)}"${parsed.category === cat ? " selected" : ""}>${esc(cat)}</option>`).join("")}
          </select>
        </div>

        <!-- Phases -->
        <div class="sc-field-group">
          <label class="sc-field-label">
            Phases
            <span class="sc-field-hint">${parsed.phases.length} phase${parsed.phases.length !== 1 ? "s" : ""} — click to expand/collapse</span>
          </label>
          <div class="sc-phases-list">
            ${phasesHtml}
          </div>
        </div>

        <!-- Pipeline: Expected Behavior -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-pipeline-expected">
            Pipeline Expected Behavior
            <span class="sc-field-hint">What the full team pipeline should achieve</span>
          </label>
          <textarea id="f-pipeline-expected" name="pipeline_expected_behavior" class="sc-textarea" rows="8">${esc(parsed.pipelineExpectedBehavior)}</textarea>
        </div>

        <!-- Pipeline: Failure Modes -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-pipeline-failure">Pipeline Failure Modes</label>
          <textarea id="f-pipeline-failure" name="pipeline_failure_modes" class="sc-textarea" rows="6">${esc(parsed.pipelineFailureModes)}</textarea>
        </div>

        <!-- Pipeline: Scoring Rubric -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-pipeline-rubric">
            Pipeline Scoring Rubric
            <span class="sc-field-hint">Should include pass:, partial:, fail: sub-sections</span>
          </label>
          <textarea id="f-pipeline-rubric" name="pipeline_scoring_rubric" class="sc-textarea sc-textarea-mono" rows="10">${esc(parsed.pipelineScoringRubric)}</textarea>
        </div>

        <!-- Actions -->
        <div class="sc-actions">
          <button type="submit" class="sc-btn-primary">Save</button>
          <button
            id="dry-run-btn"
            type="button"
            class="sc-btn-run"
            hx-post="/api/scenarios/${esc(agent)}/drafts/${esc(draftId)}/dry-run"
            hx-include="#scenario-form"
            hx-target="#dry-run-error"
            hx-swap="innerHTML"
          >
            Dry Run
          </button>
          <a href="/scenarios?agent=${esc(agent)}" class="sc-btn-ghost">Cancel</a>
        </div>

        <!-- Feedback area -->
        <div class="sc-feedback-area">
          ${flashHtml}
          <span id="dry-run-error" class="sc-dry-run-error"></span>
        </div>

      </div>
    </form>

    <style>
      .sc-phase-details { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; background: var(--surface); overflow: hidden; }
      .sc-phase-summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; list-style: none; background: var(--surface-3); user-select: none; }
      .sc-phase-summary::-webkit-details-marker { display: none; }
      .sc-phase-summary::before { content: "\\25B6"; font-size: 10px; color: var(--text-muted); transition: transform 0.15s; display: inline-block; }
      details[open] .sc-phase-summary::before { transform: rotate(90deg); }
      .sc-phase-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
      .sc-phases-list { display: flex; flex-direction: column; gap: 0; }
    </style>
  `;
}
