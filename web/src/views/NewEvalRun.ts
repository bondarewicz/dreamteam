/**
 * New Eval Run form page — /evals/new
 */

export function NewEvalRunPage(runInProgress: boolean, activeRunId?: string): string {
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

  const agents = ["bird", "kobe", "magic", "mj", "pippen", "shaq"];
  const agentCheckboxes = agents.map(agent => `
    <label class="checkbox-label">
      <input type="checkbox" name="agents" value="${agent}">
      <span class="agent-badge ${agent}">${agent}</span>
    </label>
  `).join("");

  return `
    <div class="page-title">
      <h1>New Eval Run</h1>
      <p>Configure and launch a new eval run from the web UI.</p>
    </div>
    <form method="POST" action="/api/eval-runs" class="eval-form card" style="max-width:520px">
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
        <label class="form-label" for="scenario">Scenario filter <span class="form-hint">(glob pattern, e.g. scenario-0[1-5]*)</span></label>
        <input
          type="text"
          id="scenario"
          name="scenario"
          class="form-input"
          placeholder="Leave empty to run all scenarios"
          autocomplete="off"
        >
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
      .form-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--sans); padding: 8px 12px; outline: none; transition: border-color 0.15s; }
      .form-input:focus { border-color: var(--accent); }
      .form-input::placeholder { color: var(--text-muted); }
      .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; }
      .checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
      .checkbox-label input[type=checkbox] { accent-color: var(--accent); width: 14px; height: 14px; }
      .btn-primary { display: inline-block; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity 0.15s; }
      .btn-primary:hover { opacity: 0.85; }
    </style>

    <script>
      function toggleAll(checkbox) {
        const boxes = document.querySelectorAll('input[name="agents"]');
        boxes.forEach(b => { b.checked = checkbox.checked; b.disabled = checkbox.checked; });
      }
    </script>
  `;
}
