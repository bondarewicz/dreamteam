/**
 * Providers — doctor-in-the-browser (/admin/providers)
 *
 * Read-only reachability + auth status per provider, the same probes as
 * `dreamteam doctor` (shared scripts/doctor.ts). No Max cost: these are
 * `--version` / `/api/tags` probes, never an inference call.
 */
import { esc } from "./html.ts";
import type { ProviderCheck } from "../../../scripts/doctor.ts";
import type { PingResult } from "../../../scripts/provider-ping.ts";

/** Result of a live round-trip test — swapped into #ping-<id> by htmx. */
export function PingResultFragment(r: PingResult): string {
  const cls = r.ok ? "ping-ok" : "ping-err";
  const meta = [
    `${r.latencyMs} ms`,
    r.model ? esc(r.model) : "",
    r.tokens ? `${r.tokens} tok` : "",
    r.costUsd ? `$${r.costUsd.toFixed(4)}` : "",
  ].filter(Boolean).join(" · ");
  const detail = r.ok
    ? `<span class="ping-resp">“${esc(r.response)}”</span>`
    : `<span class="ping-fail">${esc(r.error ?? "failed")}</span>`;
  return `<span class="ping-badge ${cls}">${r.ok ? "live ✓" : "live ✗"}</span> <span class="ping-meta">${esc(meta)}</span> ${detail}`;
}

export function ProvidersPage(checks: ProviderCheck[], manifest: { present: boolean; count: number }): string {
  const rowsHtml = checks
    .map((c) => {
      const statusCls = c.ok ? "status-ok" : c.required ? "status-err" : "status-warn";
      const statusLabel = c.ok ? "ready" : c.required ? "missing" : "unavailable";
      const costNote = c.id === "claude" ? ' title="uses haiku + a one-word prompt — negligible Max usage"' : "";
      return `
      <div class="prov-row">
        <span class="prov-dot ${statusCls}" title="${statusLabel}">${c.ok ? "✓" : "✗"}</span>
        <div class="prov-main">
          <div class="prov-label">${esc(c.label)}${c.required ? ' <span class="prov-req">required</span>' : ' <span class="prov-opt">optional</span>'}</div>
          <div class="prov-role">${esc(c.role)}</div>
          <div class="prov-ping" id="ping-${esc(c.id)}"><span id="spin-${esc(c.id)}" class="htmx-indicator ping-meta">testing…</span></div>
        </div>
        <div class="prov-actions">
          <div class="prov-detail ${statusCls}">${esc(c.detail)}</div>
          <button class="ping-btn"${costNote}
            hx-post="/admin/providers/test"
            hx-vals='{"provider":"${esc(c.id)}"}'
            hx-target="#ping-${esc(c.id)}"
            hx-swap="innerHTML"
            hx-disabled-elt="this"
            hx-indicator="#spin-${esc(c.id)}">Test live ↻</button>
        </div>
      </div>`;
    })
    .join("");

  const requiredOk = checks.filter((c) => c.required).every((c) => c.ok);
  const summary = requiredOk
    ? `<span class="status-ok">Claude Code present</span> — interactive <code>/team</code> and the eval judge will work.`
    : `<span class="status-err">Claude Code missing</span> — install it; interactive <code>/team</code> and the eval judge run on Claude.`;

  const manifestLine = manifest.present
    ? `Install manifest present (${manifest.count} files) — <code>~/.dreamteam/config.json</code>.`
    : `No install manifest — run <code>dreamteam install</code>.`;

  return `
    <div class="filters" style="margin-bottom:20px">
      <a class="filter-btn" href="/admin/models" style="text-decoration:none">Agent Models</a>
      <a class="filter-btn active" href="/admin/providers" style="text-decoration:none">Providers</a>
      <a class="filter-btn" href="/admin/session-judge" style="text-decoration:none">Session Judge Prompt</a>
      <a class="filter-btn" href="/admin/session-judge/calibration" style="text-decoration:none">Judge Calibration</a>
    </div>
    <div class="page-title">
      <h1>Providers</h1>
      <p>Reachability &amp; auth per provider — the same probes as <code>dreamteam doctor</code>. The dots are static (binary present / port open / auth file). <strong>Test live</strong> does a real round-trip: it sends a one-word prompt and shows the model's actual reply + latency — proving inference works, not just presence. (Claude uses <code>haiku</code> → negligible Max cost.)</p>
    </div>

    <div class="source-banner source-ok">${summary}<div style="margin-top:4px">${manifestLine}</div></div>

    <div class="card" style="max-width:760px;padding:8px 0">
      ${rowsHtml}
    </div>

    <p class="form-hint" style="color:var(--text-muted);font-size:12px;margin-top:14px">
      Static dots refresh on page reload. Only the providers you intend to use need to pass — Claude Code alone is enough for interactive <code>/team</code>.
    </p>

    <style>
      .prov-row { display: grid; grid-template-columns: 32px 1fr auto; align-items: start; gap: 14px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
      .prov-row:last-child { border-bottom: none; }
      .prov-dot { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; font-size: 14px; font-weight: 700; margin-top: 2px; }
      .prov-dot.status-ok { background: rgba(34,197,94,0.15); color: #86efac; }
      .prov-dot.status-warn { background: rgba(234,179,8,0.15); color: #fcd34d; }
      .prov-dot.status-err { background: rgba(239,68,68,0.15); color: #fca5a5; }
      .prov-label { font-size: 14px; font-weight: 600; color: var(--text); }
      .prov-role { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
      .prov-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
      .prov-detail { font-size: 12px; font-family: var(--mono, monospace); text-align: right; max-width: 280px; }
      .ping-btn { background: var(--surface-3); border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: border-color 0.15s, color 0.15s; }
      .ping-btn:hover { border-color: var(--accent); color: var(--text); }
      .ping-btn:disabled { opacity: 0.5; cursor: progress; }
      .prov-ping { font-size: 12px; margin-top: 6px; min-height: 1em; }
      .ping-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; padding: 1px 6px; }
      .ping-badge.ping-ok { background: rgba(34,197,94,0.15); color: #86efac; }
      .ping-badge.ping-err { background: rgba(239,68,68,0.15); color: #fca5a5; }
      .ping-meta { color: var(--text-muted); font-family: var(--mono, monospace); }
      .ping-resp { color: #86efac; font-family: var(--mono, monospace); }
      .ping-fail { color: #fca5a5; }
      .prov-detail.status-ok { color: var(--text-dim); }
      .prov-detail.status-warn { color: #fcd34d; }
      .prov-detail.status-err { color: #fca5a5; }
      .prov-req { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #fca5a5; border: 1px solid rgba(239,68,68,0.4); border-radius: 4px; padding: 1px 5px; margin-left: 6px; vertical-align: middle; }
      .prov-opt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; margin-left: 6px; vertical-align: middle; }
      .status-ok { color: #86efac; }
      .status-warn { color: #fcd34d; }
      .status-err { color: #fca5a5; }
      .source-banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; color: var(--text-dim); }
      .source-ok { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.3); }
      .source-banner code { background: var(--surface-3); padding: 1px 4px; border-radius: 3px; }
    </style>
  `;
}
