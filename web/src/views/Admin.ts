/**
 * Admin — harness-neutral model editor for agent frontmatter (/admin/models)
 *
 * Each agent has a model TIER (deep|mid|fast) plus optional per-provider PINS.
 * The tier resolves to a concrete model per provider via the tier table; a pin
 * overrides the tier for that provider. Saving writes the nested `model:` block
 * to agents/<name>.md (repo = source of truth). Syncing to ~/.claude/ is a
 * separate step (`bun scripts/install.ts`), which renders the flat claude model.
 */
import { esc } from "./html.ts";
import type { ModelsResult, Provider } from "../models-api.ts";
import { CLAUDE_CODE_ALIASES } from "../models-api.ts";
import { TIERS, TIER_DEFAULTS, resolveModel, type ModelSpec, type Tier } from "../../../scripts/model-tiers.ts";

export type AgentModelRow = {
  agent: string;
  spec: ModelSpec;
};

export type FlashMessage = {
  kind: "success" | "error";
  message: string;
};

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude (Max — claude -p)",
  ollama: "Ollama (local)",
  gemini: "Gemini (gemini CLI)",
  codex: "Codex (ChatGPT — codex exec)",
};
const PROVIDER_ORDER: Provider[] = ["claude", "ollama", "gemini", "codex"];
const SHORT_LABEL: Record<Provider, string> = { claude: "Claude", ollama: "Ollama", gemini: "Gemini", codex: "Codex" };

/** Tier selector for one agent. */
function tierSelect(agent: string, current: Tier): string {
  const opts = TIERS.map(
    (t) => `<option value="${t}"${t === current ? " selected" : ""}>${t}</option>`,
  ).join("");
  return `<select name="tier__${esc(agent)}" class="form-input tier-input">${opts}</select>`;
}

/** Per-provider pin selector. Empty value = use tier default. */
function pinSelect(agent: string, provider: Provider, spec: ModelSpec, modelsResult: ModelsResult): string {
  const current = spec.pin[provider] ?? "";
  const tierDefault = TIER_DEFAULTS[provider][spec.tier];
  const models = modelsResult.models.filter((m) => m.provider === provider);

  // For claude, the canonical id is bare; for others it's "provider/model" — but
  // a pin stores the BARE model id (resolveModel adds no prefix). So strip prefix.
  const bareId = (id: string) => (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id);

  const defaultOpt = `<option value="">default for ${spec.tier} → ${esc(tierDefault)}</option>`;
  const aliasOpts = provider === "claude"
    ? CLAUDE_CODE_ALIASES.map((a) => `<option value="${esc(a)}"${current === a ? " selected" : ""}>${esc(a)}</option>`).join("")
    : "";
  const modelOpts = models
    .map((m) => {
      const id = bareId(m.id);
      return `<option value="${esc(id)}"${current === id ? " selected" : ""}>${esc(id)}</option>`;
    })
    .join("");
  // Surface an unknown current pin (set by hand / model no longer listed).
  const known = current === "" || (provider === "claude" && (CLAUDE_CODE_ALIASES as readonly string[]).includes(current)) || models.some((m) => bareId(m.id) === current);
  const unknownOpt = !known ? `<option value="${esc(current)}" selected>${esc(current)} (current)</option>` : "";

  return `<select name="pin__${esc(agent)}__${provider}" class="form-input pin-input">${defaultOpt}${unknownOpt}${aliasOpts}${modelOpts}</select>`;
}

function renderModelsSource(modelsResult: ModelsResult): string {
  const ageMins = Math.floor((Date.now() - modelsResult.fetchedAt) / 60_000);
  const ageLabel = ageMins <= 0 ? "just now" : `${ageMins}m ago`;
  const counts: Record<string, number> = {};
  for (const m of modelsResult.models) counts[m.provider] = (counts[m.provider] ?? 0) + 1;
  const byProvider = PROVIDER_ORDER.filter((p) => counts[p]).map((p) => `${p} ${counts[p]}`).join(" · ");
  const claudeLine = modelsResult.source === "api" ? "Claude: live from Anthropic API" : `Claude: static fallback (${esc(modelsResult.error ?? "no DREAMTEAM_MODELS_API_KEY")})`;
  const notes = modelsResult.providerNotes.length ? `<div style="margin-top:4px">⚠ ${modelsResult.providerNotes.map(esc).join(" · ")}</div>` : "";
  const cls = modelsResult.source === "api" ? "source-ok" : "source-warn";
  return `<div class="source-banner ${cls}"><strong>${modelsResult.models.length} models</strong> across providers (${esc(byProvider)}) — fetched ${ageLabel}. <div style="margin-top:4px">${claudeLine}. Ollama: live from <code>:11434</code>. Gemini &amp; Codex: curated.</div>${notes}</div>`;
}

export function AdminModelsPage(rows: AgentModelRow[], modelsResult: ModelsResult, flash?: FlashMessage): string {
  const rowsHtml = rows
    .map((r) => {
      const resolved = PROVIDER_ORDER.map((p) => {
        const pinned = r.spec.pin[p] !== undefined;
        return `<span class="rz${pinned ? " rz-pin" : ""}">${esc(SHORT_LABEL[p])} <b>${esc(resolveModel(r.spec, p))}</b></span>`;
      }).join('<span class="rz-sep">·</span>');
      const pins = PROVIDER_ORDER.map(
        (p) => `<label class="pin-row"><span class="pin-label">${esc(PROVIDER_LABELS[p])}</span>${pinSelect(r.agent, p, r.spec, modelsResult)}</label>`,
      ).join("");
      return `
      <div class="admin-agent">
        <div class="admin-agent-head">
          <span class="agent-badge ${esc(r.agent)}">${esc(r.agent)}</span>
          <label class="tier-wrap">tier ${tierSelect(r.agent, r.spec.tier)}</label>
        </div>
        <div class="resolved-line"><span class="resolved-lead">runs as</span> ${resolved}</div>
        <details class="pins-disclosure"${Object.keys(r.spec.pin).length ? " open" : ""}>
          <summary>Override a provider${Object.keys(r.spec.pin).length ? ` (${Object.keys(r.spec.pin).length} pinned)` : ""}</summary>
          <div class="admin-pins">${pins}</div>
        </details>
      </div>`;
    })
    .join("");

  const flashHtml = flash
    ? `<div class="flash flash-${flash.kind}"><strong>${flash.kind === "success" ? "Saved." : "Error."}</strong> ${esc(flash.message)}</div>`
    : "";

  return `
    <div class="filters" style="margin-bottom:20px">
      <a class="filter-btn active" href="/admin/models" style="text-decoration:none">Agent Models</a>
      <a class="filter-btn" href="/admin/providers" style="text-decoration:none">Providers</a>
      <a class="filter-btn" href="/admin/session-judge" style="text-decoration:none">Session Judge Prompt</a>
      <a class="filter-btn" href="/admin/session-judge/calibration" style="text-decoration:none">Judge Calibration</a>
    </div>
    <div class="page-title">
      <h1>Agent Models</h1>
      <p>Each agent has a <strong>tier</strong> (deep / mid / fast) that resolves to a model per provider, plus optional <strong>pins</strong> to override any provider. Saving writes the nested <code>model:</code> block to <code>agents/&lt;name&gt;.md</code> — run <code>bun scripts/install.ts</code> to sync into <code>~/.claude/</code> (renders the flat Claude model).</p>
    </div>

    ${renderModelsSource(modelsResult)}
    ${flashHtml}

    <form method="POST" action="/admin/models" class="card" style="max-width:860px;padding:20px">
      <div class="admin-grid">${rowsHtml}</div>
      <div style="display:flex;gap:12px;margin-top:20px;align-items:center">
        <button type="submit" class="btn-primary">Save</button>
        <span class="form-hint" style="color:var(--text-muted);font-size:12px">A pin set to “tier default” is omitted from frontmatter; the tier provides that provider's model.</span>
      </div>
    </form>

    <style>
      .admin-grid { display: flex; flex-direction: column; gap: 14px; }
      .admin-agent { border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; background: var(--surface-2, var(--surface-3)); }
      .admin-agent-head { display: flex; align-items: center; gap: 14px; }
      .tier-wrap { font-size: 12px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

      /* "runs as" resolved line — the readable summary of the effective models */
      .resolved-line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin: 10px 0 4px; font-size: 12.5px; color: var(--text-dim); }
      .resolved-lead { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); margin-right: 2px; }
      .rz { white-space: nowrap; }
      .rz b { color: var(--text); font-weight: 600; font-family: var(--mono, monospace); }
      .rz-pin b { color: var(--accent); }          /* overridden providers stand out */
      .rz-sep { color: var(--border); }

      /* Override disclosure — collapsed unless the agent has pins */
      .pins-disclosure { margin-top: 8px; }
      .pins-disclosure > summary { cursor: pointer; font-size: 12px; color: var(--text-muted); padding: 4px 0; user-select: none; list-style-position: inside; }
      .pins-disclosure > summary:hover { color: var(--text); }
      .admin-pins { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
      .pin-row { display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 12px; }
      .pin-label { font-size: 12px; color: var(--text-dim); }

      .form-input { width: 100%; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 12px; font-family: var(--mono, monospace); padding: 6px 10px; outline: none; box-sizing: border-box; }
      .form-input:focus { border-color: var(--accent); }
      select.form-input { appearance: auto; cursor: pointer; text-overflow: ellipsis; }
      .tier-input { width: auto; padding: 4px 8px; }
      .btn-primary { display: inline-block; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; }
      .btn-primary:hover { opacity: 0.85; }
      .flash { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
      .flash-success { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.4); color: #86efac; }
      .flash-error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; }
      .source-banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: var(--text-dim); }
      .source-ok { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.3); }
      .source-warn { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.3); color: #fcd34d; }
      .source-banner code { background: var(--surface-3); padding: 1px 4px; border-radius: 3px; }
      @media (max-width: 560px) { .pin-row { grid-template-columns: 1fr; gap: 4px; } }
    </style>
  `;
}
