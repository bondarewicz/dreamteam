/**
 * Scenario browser and editor views — /scenarios
 */
import { esc } from "./html.ts";

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

export function ScenariosListPage(
  groups: Array<{ agent: string; scenarios: ScenarioListItem[] }>,
  filterAgent: string
): string {
  const agents = groups.map(g => g.agent);

  const agentFilterHtml = `
    <div class="sc-agent-filter">
      <a href="/scenarios" class="sc-filter-btn${filterAgent === "" ? " active" : ""}">All</a>
      ${agents.map(a => `<a href="/scenarios?agent=${esc(a)}" class="sc-filter-btn${filterAgent === a ? " active" : ""}">${esc(a)}</a>`).join("")}
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
        <td><span class="sc-type-tag">${esc(s.type || "—")}</span></td>
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
      .sc-agent-filter { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
      .sc-filter-btn { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; text-decoration: none; background: var(--surface-3); border: 1px solid var(--border); color: var(--text-dim); transition: all 0.15s; }
      .sc-filter-btn:hover, .sc-filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
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
      .sc-cat-happy-path { background: rgba(74,222,128,0.12); color: var(--pass); border: 1px solid rgba(74,222,128,0.25); }
      .sc-cat-edge-case { background: rgba(251,191,36,0.12); color: var(--partial); border: 1px solid rgba(251,191,36,0.25); }
      .sc-cat-adversarial { background: rgba(248,113,113,0.12); color: var(--fail); border: 1px solid rgba(248,113,113,0.25); }
      .sc-cat-draft { background: rgba(125,133,144,0.12); color: var(--text-muted); border: 1px solid rgba(125,133,144,0.25); }
      .sc-type-tag { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
    </style>
  `;
}

// ── Edit Page ────────────────────────────────────────────────────────────────

export function ScenarioEditPage(
  agent: string,
  scenarioId: string,
  parsed: ParsedScenario,
  issues: ValidationIssue[],
  savedFlash = false
): string {
  const graderEditorRows = parsed.graders.map((g, i) => graderRow(g, i)).join("");

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

  return `
    <div class="page-title">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/scenarios?agent=${esc(agent)}" style="color:var(--text-dim);text-decoration:none;font-size:13px">&#8592; ${esc(agent)}</a>
        <span style="color:var(--border)">/</span>
        <h1 style="margin:0;font-family:var(--mono);font-size:16px">${esc(scenarioId)}</h1>
      </div>
      <p>Edit scenario fields. Validation runs before save — invalid grader types will block saving.</p>
    </div>

    ${issuesHtml}

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

        <!-- Graders -->
        <div class="sc-field-group">
          <label class="sc-field-label">
            Graders
            <span class="sc-field-hint">Known types: ${KNOWN_GRADER_TYPES.join(", ")}</span>
          </label>
          <div id="grader-list" class="sc-grader-list">
            ${graderEditorRows}
          </div>
          <button type="button" class="sc-btn-secondary" onclick="addGrader()" style="margin-top:8px">
            + Add Grader
          </button>
        </div>

        <!-- Prompt -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-prompt">
            Prompt
            <span class="sc-field-hint sc-required">Required — verbatim input to the agent</span>
          </label>
          <textarea id="f-prompt" name="prompt" class="sc-textarea sc-textarea-mono sc-textarea-tall" rows="10">${esc(parsed.prompt)}</textarea>
        </div>

        <!-- Reference Output -->
        <div class="sc-field-group">
          <label class="sc-field-label" for="f-reference-output">
            Reference Output
            <span class="sc-field-hint">Optional — expected verbatim output</span>
          </label>
          <textarea id="f-reference-output" name="reference_output" class="sc-textarea sc-textarea-mono" rows="5">${esc(parsed.reference_output)}</textarea>
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

        <!-- Actions -->
        <div class="sc-actions">
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
          <a href="/scenarios?agent=${esc(agent)}" class="sc-btn-ghost">Cancel</a>
        </div>

      </div>
    </form>

    <!-- Hidden inputs for grader data (populated by JS before submit) -->
    <div id="grader-hidden-inputs"></div>

    ${graderTypeDefsScript()}

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

      /* Grader editor */
      .sc-grader-list { display: flex; flex-direction: column; gap: 8px; }
      .sc-grader-row { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .sc-grader-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .sc-grader-type-select { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; font-family: var(--mono); padding: 5px 8px; outline: none; }
      .sc-grader-type-select:focus { border-color: var(--accent); }
      .sc-grader-props { display: flex; flex-wrap: wrap; gap: 8px; }
      .sc-grader-prop { display: flex; flex-direction: column; gap: 3px; }
      .sc-grader-prop label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
      .sc-grader-prop input { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; font-family: var(--mono); padding: 5px 8px; outline: none; width: 160px; }
      .sc-grader-prop input:focus { border-color: var(--accent); }
      .sc-grader-remove { margin-left: auto; background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 12px; cursor: pointer; padding: 4px 10px; transition: all 0.15s; flex-shrink: 0; }
      .sc-grader-remove:hover { border-color: var(--fail); color: var(--fail); }

      /* Actions */
      .sc-actions { display: flex; gap: 10px; align-items: center; padding-top: 8px; flex-wrap: wrap; }
      .sc-btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; text-decoration: none; }
      .sc-btn-primary:hover { opacity: 0.85; }
      .sc-btn-secondary { background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; color: var(--text-dim); transition: border-color 0.15s; }
      .sc-btn-secondary:hover { border-color: var(--text-muted); color: var(--text); }
      .sc-btn-ghost { background: none; border: none; color: var(--text-muted); font-size: 13px; cursor: pointer; text-decoration: none; padding: 8px 4px; transition: color 0.15s; }
      .sc-btn-ghost:hover { color: var(--text); }

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
      // Grader type → property definitions
      const GRADER_PROPS = ${JSON.stringify(graderPropDefs())};
      const KNOWN_TYPES = ${JSON.stringify([...KNOWN_GRADER_TYPES])};

      let graderCount = ${parsed.graders.length};

      function graderTypeOptions(selected) {
        return KNOWN_TYPES.map(t =>
          '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + t + '</option>'
        ).join('');
      }

      function renderGraderProps(idx, type, current) {
        const props = GRADER_PROPS[type] || [];
        if (props.length === 0) return '';
        const inputs = props.map(p => {
          const val = current[p.name] !== undefined ? current[p.name] : '';
          return '<div class="sc-grader-prop">'
            + '<label>' + p.name + '</label>'
            + '<input type="text" data-idx="' + idx + '" data-prop="' + p.name + '" placeholder="' + (p.placeholder || '') + '" value="' + escHtml(String(val)) + '">'
            + '</div>';
        }).join('');
        return '<div class="sc-grader-props">' + inputs + '</div>';
      }

      function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function addGrader() {
        const idx = graderCount++;
        const row = document.createElement('div');
        row.className = 'sc-grader-row';
        row.dataset.idx = idx;
        row.innerHTML =
          '<div class="sc-grader-top">'
            + '<select class="sc-grader-type-select" data-idx="' + idx + '" onchange="onTypeChange(this, ' + idx + ')">'
            + graderTypeOptions('json_valid')
            + '</select>'
            + '<button type="button" class="sc-grader-remove" onclick="removeGrader(this)">Remove</button>'
          + '</div>'
          + renderGraderProps(idx, 'json_valid', {});
        document.getElementById('grader-list').appendChild(row);
      }

      function onTypeChange(select, idx) {
        const row = select.closest('.sc-grader-row');
        const existing = row.querySelector('.sc-grader-props');
        if (existing) existing.remove();
        const newProps = renderGraderProps(idx, select.value, {});
        if (newProps) {
          row.insertAdjacentHTML('beforeend', newProps);
        }
      }

      function removeGrader(btn) {
        btn.closest('.sc-grader-row').remove();
      }

      // Before form submit, collect grader data into hidden inputs
      document.getElementById('scenario-form').addEventListener('submit', function(e) {
        serializeGraders();
      });

      // Also serialize before htmx validate request
      document.addEventListener('htmx:configRequest', function(evt) {
        if (evt.detail.path && evt.detail.path.includes('/validate')) {
          serializeGraders();
          // Include grader data in the request
          const hidden = document.getElementById('grader-hidden-inputs');
          const inputs = hidden.querySelectorAll('input');
          inputs.forEach(inp => {
            evt.detail.parameters[inp.name] = inp.value;
          });
        }
      });

      function serializeGraders() {
        // Remove any previously cloned inputs from the form to prevent duplicates
        document.querySelectorAll('#scenario-form input[name^="grader_"]').forEach(el => el.remove());
        const hidden = document.getElementById('grader-hidden-inputs');
        hidden.innerHTML = '';
        const rows = document.querySelectorAll('#grader-list .sc-grader-row');
        rows.forEach((row, i) => {
          const typeSelect = row.querySelector('.sc-grader-type-select');
          if (!typeSelect) return;
          addHidden(hidden, 'grader_type_' + i, typeSelect.value);
          const propInputs = row.querySelectorAll('.sc-grader-props input');
          propInputs.forEach(inp => {
            const prop = inp.dataset.prop;
            if (prop && inp.value.trim() !== '') {
              addHidden(hidden, 'grader_prop_' + i + '_' + prop, inp.value.trim());
            }
          });
        });
        addHidden(hidden, 'grader_count', String(rows.length));
      }

      function addHidden(container, name, value) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = value;
        container.appendChild(inp);
        // Also append to form so it gets submitted
        document.getElementById('scenario-form').appendChild(inp.cloneNode(true));
      }
    </script>
  `;
}

function graderPropDefs(): Record<string, Array<{ name: string; placeholder?: string }>> {
  return {
    json_valid: [],
    json_field: [
      { name: "path", placeholder: "e.g. business_rules" },
      { name: "min_items", placeholder: "number" },
      { name: "max_items", placeholder: "number" },
      { name: "min", placeholder: "number" },
      { name: "max", placeholder: "number" },
      { name: "type_check", placeholder: "string | boolean | number | array" },
    ],
    contains: [{ name: "value", placeholder: "text to search for" }],
    not_contains: [{ name: "value", placeholder: "text that must be absent" }],
    regex: [{ name: "pattern", placeholder: "regex pattern" }],
    section_present: [{ name: "section", placeholder: "section name" }],
    field_count: [
      { name: "expected_count", placeholder: "number" },
    ],
    length_bounds: [
      { name: "min", placeholder: "min chars" },
      { name: "max", placeholder: "max chars" },
    ],
  };
}

function graderTypeDefsScript(): string {
  return ""; // logic inlined in ScenarioEditPage
}

function graderRow(g: Grader, i: number): string {
  const typeOptions = KNOWN_GRADER_TYPES.map(t =>
    `<option value="${esc(t)}"${g.type === t ? " selected" : ""}>${esc(t)}</option>`
  ).join("");

  const unknownType = g.type && !KNOWN_GRADER_TYPES.includes(g.type as KnownGraderType);
  const unknownOption = unknownType
    ? `<option value="${esc(g.type)}" selected>${esc(g.type)} (unknown)</option>`
    : "";

  const defs = graderPropDefs()[g.type] ?? [];
  const propFields = defs.map(p => {
    const val = g[p.name] !== undefined ? String(g[p.name]) : "";
    return `
      <div class="sc-grader-prop">
        <label>${esc(p.name)}</label>
        <input type="text" data-idx="${i}" data-prop="${esc(p.name)}" placeholder="${esc(p.placeholder ?? "")}" value="${esc(val)}">
      </div>
    `;
  }).join("");

  const propsHtml = defs.length > 0
    ? `<div class="sc-grader-props">${propFields}</div>`
    : "";

  return `
    <div class="sc-grader-row" data-idx="${i}">
      <div class="sc-grader-top">
        <select class="sc-grader-type-select" data-idx="${i}" onchange="onTypeChange(this, ${i})">
          ${unknownOption}
          ${typeOptions}
        </select>
        <button type="button" class="sc-grader-remove" onclick="removeGrader(this)">Remove</button>
      </div>
      ${propsHtml}
    </div>
  `;
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
