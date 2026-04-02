/**
 * New Eval Run form page — /evals/new
 */

export type ScenarioGroup = {
  agent: string;
  scenarios: string[]; // bare scenario IDs e.g. "scenario-01-foo"
};

export function NewEvalRunPage(
  runInProgress: boolean,
  scenarioGroups: ScenarioGroup[],
  activeRunId?: string
): string {
  if (runInProgress) {
    return `
      <div class="page-title">
        <h1>New Eval Run</h1>
        <p>Configure and launch a new eval run from the web UI.</p>
      </div>
      <div class="card" style="max-width:520px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span style="color:var(--partial);font-size:18px">&#9679;</span>
          <h2 style="margin:0">Run in Progress</h2>
        </div>
        <p style="color:var(--text-dim);margin-bottom:16px">
          An eval run is currently executing. Only one run can be active at a time.
        </p>
        <a href="/evals/live" class="btn-primary" style="display:inline-block">
          View Live Progress
        </a>
      </div>
    `;
  }

  const agents = scenarioGroups.map(g => g.agent);

  const agentCheckboxes = agents.map(agent => `
    <label class="checkbox-label">
      <input type="checkbox" name="agents" value="${agent}" onchange="onAgentToggle(this)">
      <span class="agent-badge ${agent}">${agent}</span>
    </label>
  `).join("");

  const scenarioGroupsHtml = scenarioGroups.map(group => {
    const checkboxes = group.scenarios.map(scenId => `
      <label class="scenario-checkbox-label">
        <input type="checkbox" name="scenarios" value="${group.agent}/${scenId}" class="scenario-cb agent-${group.agent}" onchange="onScenarioToggle(this)">
        <span class="scenario-name">${scenId}</span>
      </label>
    `).join("");

    return `
      <div class="scenario-group" data-agent="${group.agent}">
        <div class="scenario-group-header" onclick="toggleGroup(this)">
          <span class="group-toggle-icon">&#9656;</span>
          <span class="agent-badge ${group.agent}">${group.agent}</span>
          <span class="scenario-group-count">(${group.scenarios.length} scenarios)</span>
          <label class="select-all-label" onclick="event.stopPropagation()">
            <input type="checkbox" class="select-all-cb" data-agent="${group.agent}" onchange="toggleSelectAll(this, '${group.agent}')">
            <span>select all</span>
          </label>
        </div>
        <div class="scenario-group-body" style="display:none">
          <div class="scenario-checkbox-grid">
            ${checkboxes}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="page-title">
      <h1>New Eval Run</h1>
      <p>Configure and launch a new eval run from the web UI.</p>
    </div>
    <form method="POST" action="/api/eval-runs" class="eval-form card" style="max-width:640px">
      <div class="form-group">
        <label class="form-label">Agents</label>
        <div class="checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" id="all-agents" onchange="toggleAll(this)">
            <span style="color:var(--text-dim);font-size:13px">All agents</span>
          </label>
          ${agentCheckboxes}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">
          Scenarios
          <span class="form-hint">(leave all unchecked to run all scenarios)</span>
        </label>
        <div id="scenario-groups">
          ${scenarioGroupsHtml}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="trials">Trials</label>
          <input
            type="number"
            id="trials"
            name="trials"
            class="form-input"
            value="3"
            min="1"
            max="10"
          >
        </div>
        <div class="form-group">
          <label class="form-label" for="parallel">Parallel</label>
          <input
            type="number"
            id="parallel"
            name="parallel"
            class="form-input"
            value="5"
            min="1"
            max="20"
          >
        </div>
      </div>

      <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">
        Start Eval Run
      </button>
    </form>

    <style>
      .eval-form { padding: 24px; }
      .form-group { margin-bottom: 20px; }
      .form-row { display: flex; gap: 16px; }
      .form-row .form-group { flex: 1; }
      .form-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
      .form-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--text-muted); }
      .form-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
      .form-input:focus { border-color: var(--accent); }
      .form-input::placeholder { color: var(--text-muted); }
      .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; }
      .checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
      .checkbox-label input[type=checkbox] { accent-color: var(--accent); width: 14px; height: 14px; }
      .btn-primary { display: inline-block; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity 0.15s; }
      .btn-primary:hover { opacity: 0.85; }

      /* Scenario groups */
      #scenario-groups { display: flex; flex-direction: column; gap: 6px; }
      .scenario-group { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
      .scenario-group.hidden { display: none; }
      .scenario-group-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-3); cursor: pointer; user-select: none; }
      .scenario-group-header:hover { background: var(--surface-2); }
      .group-toggle-icon { font-size: 11px; color: var(--text-muted); transition: transform 0.15s; display: inline-block; width: 12px; }
      .scenario-group-header.open .group-toggle-icon { transform: rotate(90deg); }
      .scenario-group-count { font-size: 12px; color: var(--text-muted); flex: 1; }
      .select-all-label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-dim); cursor: pointer; }
      .select-all-label input[type=checkbox] { accent-color: var(--accent); width: 12px; height: 12px; }
      .scenario-group-body { padding: 10px 12px; background: var(--surface-1, var(--surface-3)); }
      .scenario-checkbox-grid { display: flex; flex-direction: column; gap: 2px; }
      .scenario-checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 2px 0; }
      .scenario-checkbox-label input[type=checkbox] { accent-color: var(--accent); width: 13px; height: 13px; flex-shrink: 0; }
      .scenario-name { font-size: 12px; color: var(--text-dim); font-family: var(--mono, monospace); }
    </style>

    <script>
      function toggleAll(checkbox) {
        const agentBoxes = document.querySelectorAll('input[name="agents"]');
        agentBoxes.forEach(b => {
          b.checked = checkbox.checked;
        });
        // Always keep all scenario groups visible
        const groups = document.querySelectorAll('.scenario-group');
        groups.forEach(g => g.classList.remove('hidden'));
        if (!checkbox.checked) {
          // Deselect all scenario checkboxes and reset select-all toggles (BR-3)
          document.querySelectorAll('input[name="scenarios"]').forEach(cb => { cb.checked = false; });
          document.querySelectorAll('.select-all-cb').forEach(cb => { cb.checked = false; });
        }
      }

      function onAgentToggle(agentCheckbox) {
        const agent = agentCheckbox.value;
        const group = document.querySelector('.scenario-group[data-agent="' + agent + '"]');
        if (!group) return;

        if (!agentCheckbox.checked) {
          // Hide group and deselect all its scenarios (AC-6)
          group.classList.add('hidden');
          const scenarioCbs = group.querySelectorAll('input[name="scenarios"]');
          scenarioCbs.forEach(cb => { cb.checked = false; });
          // Also uncheck the select-all toggle for this group
          const selectAll = group.querySelector('.select-all-cb');
          if (selectAll) selectAll.checked = false;
        } else {
          group.classList.remove('hidden');
        }

        // Sync the "all agents" master checkbox
        const allAgentsBox = document.getElementById('all-agents');
        const agentBoxes = document.querySelectorAll('input[name="agents"]');
        const anyChecked = Array.from(agentBoxes).some(b => b.checked);
        const allChecked = Array.from(agentBoxes).every(b => b.checked);
        allAgentsBox.checked = allChecked;
        allAgentsBox.indeterminate = anyChecked && !allChecked;
      }

      function toggleGroup(header) {
        const body = header.nextElementSibling;
        const isOpen = header.classList.contains('open');
        if (isOpen) {
          header.classList.remove('open');
          body.style.display = 'none';
        } else {
          header.classList.add('open');
          body.style.display = 'block';
        }
      }

      function toggleSelectAll(selectAllCb, agent) {
        const scenarioCbs = document.querySelectorAll('input.agent-' + agent + '[name="scenarios"]');
        scenarioCbs.forEach(cb => { cb.checked = selectAllCb.checked; });
        // Sync parent agent checkbox when select-all changes
        const agentCb = document.querySelector('input[name="agents"][value="' + agent + '"]');
        if (agentCb) {
          agentCb.checked = selectAllCb.checked;
          onAgentToggle(agentCb);
        }
      }

      function onScenarioToggle(cb) {
        const agent = cb.className.match(/agent-(\S+)/)?.[1];
        if (!agent) return;
        const agentCb = document.querySelector('input[name="agents"][value="' + agent + '"]');
        if (!agentCb) return;

        // If any scenario for this agent is checked, ensure agent is checked
        const agentScenarios = document.querySelectorAll('.scenario-cb.agent-' + agent);
        const anyChecked = Array.from(agentScenarios).some(s => s.checked);
        agentCb.checked = anyChecked;

        // Trigger agent toggle to show/hide group
        onAgentToggle(agentCb);
      }
    </script>
  `;
}
