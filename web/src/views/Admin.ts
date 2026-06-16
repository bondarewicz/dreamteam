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

/** Provider → display label + order for the picker's <optgroup>s. */
const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude (Max — claude -p)",
  ollama: "Ollama (local)",
  gemini: "Gemini (gemini CLI)",
  codex: "Codex (ChatGPT — codex exec)",
};
const PROVIDER_ORDER = ["claude", "ollama", "gemini", "codex"];

/** Render the <select> for one agent row, grouped by provider. */
function renderSelect(agent: string, currentModel: string, modelsResult: ModelsResult): string {
  const allIds = modelsResult.models.map((m) => m.id);
  const aliasList: readonly string[] = CLAUDE_CODE_ALIASES;

  const inAliases = aliasList.includes(currentModel);
  const inList = allIds.includes(currentModel);
  const unknown = currentModel.length > 0 && !inAliases && !inList;

  const aliasOptions = aliasList
    .map((alias) => `<option value="${esc(alias)}"${currentModel === alias ? " selected" : ""}>${esc(alias)}</option>`)
    .join("");

  // One optgroup per provider, in PROVIDER_ORDER.
  const providerGroups = PROVIDER_ORDER.map((prov) => {
    const models = modelsResult.models.filter((m) => m.provider === prov);
    if (models.length === 0) return "";
    const opts = models
      .map((m) => {
        const label = m.displayName && m.displayName !== m.id ? `${m.id} — ${m.displayName}` : m.id;
        return `<option value="${esc(m.id)}"${currentModel === m.id ? " selected" : ""}>${esc(label)}</option>`;
      })
      .join("");
    return `<optgroup label="${esc(PROVIDER_LABELS[prov] ?? prov)}">${opts}</optgroup>`;
  }).join("");

  const unknownOption = unknown
    ? `<optgroup label="Current value (not in list)"><option value="${esc(currentModel)}" selected>${esc(currentModel)}</option></optgroup>`
    : "";

  return `
    <select id="model-${esc(agent)}" name="model__${esc(agent)}" class="form-input">
      ${unknownOption}
      <optgroup label="Claude Code aliases">${aliasOptions}</optgroup>
      ${providerGroups}
    </select>
  `;
}

/** Render a small banner describing the multi-provider model list + sourcing. */
function renderModelsSource(modelsResult: ModelsResult): string {
  const ageMins = Math.floor((Date.now() - modelsResult.fetchedAt) / 60_000);
  const ageLabel = ageMins <= 0 ? "just now" : `${ageMins}m ago`;
  const counts: Record<string, number> = {};
  for (const m of modelsResult.models) counts[m.provider] = (counts[m.provider] ?? 0) + 1;
  const byProvider = PROVIDER_ORDER.filter((p) => counts[p]).map((p) => `${p} ${counts[p]}`).join(" · ");

  const claudeLine = modelsResult.source === "api"
    ? `Claude: live from Anthropic API`
    : `Claude: static fallback (${esc(modelsResult.error ?? "no DREAMTEAM_MODELS_API_KEY")})`;
  const notes = modelsResult.providerNotes.length
    ? `<div style="margin-top:4px">⚠ ${modelsResult.providerNotes.map(esc).join(" · ")}</div>`
    : "";
  const cls = modelsResult.source === "api" ? "source-ok" : "source-warn";

  return `
    <div class="source-banner ${cls}">
      <strong>${modelsResult.models.length} models</strong> across providers (${esc(byProvider)}) — fetched ${ageLabel}.
      <div style="margin-top:4px">${claudeLine}. Ollama: live from <code>:11434</code>. Gemini &amp; Codex: curated (their CLIs can't list models).</div>
      ${notes}
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
    <div class="filters" style="margin-bottom:20px">
      <a class="filter-btn active" href="/admin/models" style="text-decoration:none">Agent Models</a>
      <a class="filter-btn" href="/admin/session-judge" style="text-decoration:none">Session Judge Prompt</a>
      <a class="filter-btn" href="/admin/session-judge/calibration" style="text-decoration:none">Judge Calibration</a>
    </div>
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
