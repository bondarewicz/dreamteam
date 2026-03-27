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
};

// ── List Page ───────────────────────────────────────────────────────────────

function typeClass(type: string): string {
  if (!type) return "";
  const first = type.split("/")[0].trim();
  return first.toLowerCase().replace(/\s+/g, "-");
}

export const KNOWN_AGENTS = ["bird", "kobe", "magic", "mj", "pippen", "shaq"] as const;
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
    const rows = g.scenarios.map(s => `
      <tr>
        <td>
          <a href="/scenarios/${esc(g.agent)}/${esc(s.scenarioId)}" class="sc-scenario-link">
            ${esc(s.scenarioId)}
          </a>
        </td>
        <td>${esc(s.title)}</td>
        <td><span class="sc-category-badge sc-cat-${esc(s.category)}">${esc(s.category || "—")}</span></td>
        <td><span class="sc-type-tag sc-type-${esc(typeClass(s.type))}">${esc(s.type || "—")}</span></td>
      </tr>
    `).join("");

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

    <style>
      .sc-edit-layout { display: flex; flex-direction: column; gap: 20px; max-width: 820px; }
      .sc-field-group { display: flex; flex-direction: column; gap: 6px; }
      .sc-field-narrow { max-width: 280px; }
      .sc-field-label { font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
      .sc-field-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--text-muted); font-size: 11px; }
      .sc-required { color: var(--fail) !important; }
      .sc-text-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
      .sc-text-input:focus { border-color: var(--accent); }
      .sc-textarea { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; resize: vertical; line-height: 1.6; box-sizing: border-box; }
      .sc-textarea:focus { border-color: var(--accent); }
      .sc-textarea-mono { font-family: var(--mono); font-size: 12px; }
      .sc-textarea-tall { min-height: 160px; }
      .sc-select { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; cursor: pointer; }
      .sc-select:focus { border-color: var(--accent); }

      /* Generated grader cards */
      .sc-gen-grader-list { display: flex; flex-direction: column; gap: 8px; }
      .sc-gen-grader-card { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 6px; transition: border-color 0.15s, opacity 0.15s; }
      .sc-gen-grader-accepted { border-color: rgba(74,222,128,0.4); }
      .sc-gen-grader-rejected { opacity: 0.5; }
      .sc-gen-grader-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sc-gen-grader-type { font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--accent); background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.2); border-radius: 4px; padding: 2px 8px; }
      .sc-gen-grader-props { display: flex; flex-wrap: wrap; gap: 6px; }
      .sc-grader-prop-chip { font-family: var(--mono); font-size: 11px; color: var(--text-dim); background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 2px 7px; }
      .sc-grader-prop-key { color: var(--text-muted); }
      .sc-conf-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 10px; padding: 2px 7px; margin-left: auto; }
      .sc-conf-high { background: rgba(74,222,128,0.15); color: var(--pass); border: 1px solid rgba(74,222,128,0.3); }
      .sc-conf-med { background: rgba(251,191,36,0.15); color: var(--partial); border: 1px solid rgba(251,191,36,0.3); }
      .sc-conf-low { background: rgba(248,113,113,0.15); color: var(--fail); border: 1px solid rgba(248,113,113,0.3); }
      .sc-gen-grader-source { font-size: 11px; color: var(--text-muted); font-style: italic; padding-left: 2px; line-height: 1.5; }
      .sc-gen-grader-toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto; flex-shrink: 0; }
      .sc-gen-grader-toggle input[type="checkbox"] { cursor: pointer; width: 14px; height: 14px; accent-color: var(--pass); }
      .sc-gen-grader-toggle-label { font-size: 11px; font-weight: 600; color: var(--text-muted); user-select: none; }
      .sc-gen-grader-accepted .sc-gen-grader-toggle-label { color: var(--pass); }
      .sc-gen-grader-empty { font-size: 13px; color: var(--text-muted); padding: 16px; background: var(--surface-3); border: 1px dashed var(--border); border-radius: 6px; line-height: 1.6; }
      .sc-current-graders-note { font-size: 12px; color: var(--text-muted); margin-bottom: 10px; padding: 8px 12px; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; }
      .sc-current-grader-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 4px 10px; font-size: 12px; font-family: var(--mono); color: var(--text-dim); margin: 0 4px 4px 0; }

      /* Feedback area (below buttons) */
      .sc-feedback-area { display: flex; flex-direction: column; gap: 8px; }
      .sc-feedback-area:empty { display: none; }

      /* Actions */
      .sc-actions { display: flex; gap: 10px; align-items: center; padding-top: 8px; flex-wrap: wrap; }
      .sc-btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; text-decoration: none; }
      .sc-btn-primary:hover { opacity: 0.85; }
      .sc-btn-secondary { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--text-dim); transition: border-color 0.15s; }
      .sc-btn-secondary:hover { border-color: var(--text-muted); color: var(--text); }
      .sc-btn-run { background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.35); border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--pass); transition: all 0.15s; }
      .sc-btn-run:hover:not(:disabled) { background: rgba(74,222,128,0.22); border-color: var(--pass); }
      .sc-btn-run:disabled { opacity: 0.4; cursor: not-allowed; }
      .sc-btn-copy { background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.3); border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--accent); transition: all 0.15s; }
      .sc-btn-copy:hover { background: rgba(88,166,255,0.18); border-color: var(--accent); }
      .sc-btn-ghost { background: none; border: none; color: var(--text-muted); font-size: 13px; cursor: pointer; text-decoration: none; padding: 8px 4px; transition: color 0.15s; }
      .sc-btn-ghost:hover { color: var(--text); }
      .sc-spinner { font-size: 12px; color: var(--text-muted); }
      .sc-dry-run-error { font-size: 12px; color: var(--fail); }

      /* Validation box */
      .sc-validation-box { border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
      .sc-validation-ok { background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.25); }
      .sc-validation-has-errors { background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.25); }
      .sc-validation-has-warnings { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25); }
      .sc-issue { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; }
      .sc-issue-icon { flex-shrink: 0; font-size: 13px; }
      .sc-issue.error { color: var(--fail); }
      .sc-issue.warn { color: var(--partial); }
      .sc-issue.ok { color: var(--pass); }
    </style>

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

export function ValidationResultFragment(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return `<div class="sc-validation-box sc-validation-ok" id="validation-result"><div class="sc-issue ok"><span class="sc-issue-icon">&#10003;</span><span>No issues found — file is ready to save.</span></div></div>`;
  }
  const hasErrors = issues.some(i => i.level === "error");
  const boxClass = hasErrors ? "sc-validation-has-errors" : "sc-validation-has-warnings";
  return `<div class="sc-validation-box ${boxClass}" id="validation-result">${issues.map(renderIssue).join("")}</div>`;
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

    <style>
      .sc-edit-layout { display: flex; flex-direction: column; gap: 20px; max-width: 820px; }
      .sc-field-group { display: flex; flex-direction: column; gap: 6px; }
      .sc-field-narrow { max-width: 280px; }
      .sc-field-label { font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
      .sc-field-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--text-muted); font-size: 11px; }
      .sc-required { color: var(--fail) !important; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; }
      .sc-text-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
      .sc-text-input:focus { border-color: var(--accent); }
      .sc-textarea { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; resize: vertical; line-height: 1.6; box-sizing: border-box; }
      .sc-textarea:focus { border-color: var(--accent); }
      .sc-textarea-mono { font-family: var(--mono); font-size: 12px; }
      .sc-textarea-tall { min-height: 160px; }
      .sc-select { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; cursor: pointer; }
      .sc-select:focus { border-color: var(--accent); }
      .sc-actions { display: flex; gap: 10px; align-items: center; padding-top: 8px; flex-wrap: wrap; }
      .sc-btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; text-decoration: none; }
      .sc-btn-primary:hover { opacity: 0.85; }
      .sc-btn-ghost { background: none; border: none; color: var(--text-muted); font-size: 13px; cursor: pointer; text-decoration: none; padding: 8px 4px; transition: color 0.15s; }
      .sc-btn-ghost:hover { color: var(--text); }
      .sc-spinner { font-size: 12px; color: var(--text-muted); }
      .sc-generate-error { color: var(--fail); font-size: 13px; padding: 12px 16px; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.25); border-radius: 8px; }
    </style>

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
