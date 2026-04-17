/**
 * Admin — model/version editor for agent frontmatter (/admin/models)
 *
 * Writes changes to agents/<name>.md in the repo (source of truth). Syncing to
 * ~/.claude/ is a separate manual step (`bun scripts/install.ts`).
 */
import { esc } from "./html.ts";
import type { ModelsResult } from "../models-api.ts";
import { CLAUDE_CODE_ALIASES } from "../models-api.ts";

export type AgentModelRow = {
  agent: string;
  currentModel: string;
};

export type FlashMessage = {
  kind: "success" | "error";
  message: string;
};

/** Render the <select> for one agent row. Groups: aliases, API ids, current-unknown. */
function renderSelect(agent: string, currentModel: string, modelsResult: ModelsResult): string {
  const apiIds = modelsResult.models.map((m) => m.id);
  const aliasList: readonly string[] = CLAUDE_CODE_ALIASES;

  const inAliases = aliasList.includes(currentModel);
  const inApi = apiIds.includes(currentModel);
  const unknown = currentModel.length > 0 && !inAliases && !inApi;

  const aliasOptions = aliasList
    .map((alias) => {
      const selected = currentModel === alias ? " selected" : "";
      return `<option value="${esc(alias)}"${selected}>${esc(alias)}</option>`;
    })
    .join("");

  const apiOptions = modelsResult.models
    .map((m) => {
      const selected = currentModel === m.id ? " selected" : "";
      const label = m.displayName && m.displayName !== m.id ? `${m.id} — ${m.displayName}` : m.id;
      return `<option value="${esc(m.id)}"${selected}>${esc(label)}</option>`;
    })
    .join("");

  const unknownOption = unknown
    ? `<optgroup label="Current value (not in list)"><option value="${esc(currentModel)}" selected>${esc(currentModel)}</option></optgroup>`
    : "";

  const sourceLabel = modelsResult.source === "api" ? "Pinned model IDs (Anthropic API)" : "Pinned model IDs (fallback list)";

  return `
    <select id="model-${esc(agent)}" name="model__${esc(agent)}" class="form-input">
      ${unknownOption}
      <optgroup label="Claude Code aliases">${aliasOptions}</optgroup>
      <optgroup label="${esc(sourceLabel)}">${apiOptions}</optgroup>
    </select>
  `;
}

/** Render a small banner describing where the model list came from. */
function renderModelsSource(modelsResult: ModelsResult): string {
  const ageMins = Math.floor((Date.now() - modelsResult.fetchedAt) / 60_000);
  const ageLabel = ageMins <= 0 ? "just now" : `${ageMins}m ago`;
  if (modelsResult.source === "api") {
    return `
      <div class="source-banner source-ok">
        <strong>Live:</strong> ${modelsResult.models.length} model IDs from Anthropic API (fetched ${ageLabel}).
      </div>
    `;
  }
  return `
    <div class="source-banner source-warn">
      <strong>Static list:</strong> ${esc(modelsResult.error ?? "using fallback")}. Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> at repo root for live IDs from the API.
    </div>
  `;
}

export function AdminModelsPage(
  rows: AgentModelRow[],
  modelsResult: ModelsResult,
  flash?: FlashMessage,
): string {
  const rowsHtml = rows
    .map(
      (r) => `
      <div class="admin-row">
        <label class="admin-label" for="model-${esc(r.agent)}">
          <span class="agent-badge ${esc(r.agent)}">${esc(r.agent)}</span>
        </label>
        ${renderSelect(r.agent, r.currentModel, modelsResult)}
      </div>
    `,
    )
    .join("");

  const flashHtml = flash
    ? `
      <div class="flash flash-${flash.kind}">
        <strong>${flash.kind === "success" ? "Saved." : "Error."}</strong>
        ${esc(flash.message)}
      </div>
    `
    : "";

  return `
    <div class="page-title">
      <h1>Agent Models</h1>
      <p>Set the <code>model:</code> frontmatter value for each agent. Saving writes to <code>agents/&lt;name&gt;.md</code> in the repo only — run <code>bun scripts/install.ts</code> separately to sync into <code>~/.claude/</code>.</p>
    </div>

    ${renderModelsSource(modelsResult)}
    ${flashHtml}

    <form method="POST" action="/admin/models" class="card" style="max-width:720px;padding:24px">
      <div class="admin-grid">
        ${rowsHtml}
      </div>

      <div style="display:flex;gap:12px;margin-top:20px;align-items:center">
        <button type="submit" class="btn-primary">Save</button>
        <span class="form-hint" style="color:var(--text-muted);font-size:12px">
          Selected value is written verbatim to <code>agents/&lt;agent&gt;.md</code>'s <code>model:</code> field and used directly by <code>claude --model</code>, eval runs, and docs.
        </span>
      </div>
    </form>

    <style>
      .admin-grid { display: flex; flex-direction: column; gap: 12px; }
      .admin-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 12px; }
      .admin-label { display: flex; align-items: center; }
      .form-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--mono, monospace); padding: 8px 12px; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
      .form-input:focus { border-color: var(--accent); }
      select.form-input { appearance: auto; cursor: pointer; }
      .btn-primary { display: inline-block; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity 0.15s; }
      .btn-primary:hover { opacity: 0.85; }
      .flash { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
      .flash-success { background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.4); color: #86efac; }
      .flash-error { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; }
      .source-banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: var(--text-dim); }
      .source-ok { background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.3); }
      .source-warn { background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.3); color: #fcd34d; }
      .source-banner code { background: var(--surface-3); padding: 1px 4px; border-radius: 3px; }
    </style>
  `;
}
