/**
 * Sessions.ts — index + detail views for the Sessions feature.
 * Renders rehydrated Claude Code sessions (see docs/session-evals-design.md).
 * Trace/Chat/Details tabs; Evaluation tab is a placeholder until the judge slice.
 */
import { marked } from "marked";
import type { SessionSummary, SessionDetail, SessionRecord } from "../sessions-source.ts";
import { RUBRIC, ALL_QUESTION_IDS, judgePromptVersion, questionText } from "../session-judge.ts";
import type { CategoryScore, QuestionVerdict, Verdict } from "../session-judge.ts";
import type { StoredEval } from "../sessions-db.ts";
import type { CalibrationScenario, CalibrationRun } from "../calibration.ts";
import { esc } from "./html.ts";

marked.setOptions({ gfm: true, breaks: true });
// NOTE: logs are trusted (local single-user). Sanitize before exposing externally.
function md(s: string): string {
  return marked.parse(s, { async: false }) as string;
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}
function k(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

// ── INDEX ─────────────────────────────────────────────────────
export function SessionsIndexPage(
  sessions: SessionSummary[],
  projects: Array<{ dir: string; label: string; sessions: number }>,
  opts: { project: string; page: number; totalPages: number; total: number },
): string {
  const totalTools = sessions.reduce((a, s) => a + s.toolCalls, 0);
  const totalTok = sessions.reduce((a, s) => a + s.inputTokens + s.outputTokens, 0);

  const projectChips = [
    `<a class="filter-btn ${opts.project ? "" : "active"}" href="/sessions">all</a>`,
    ...projects.map(p =>
      `<a class="filter-btn ${opts.project === p.dir ? "active" : ""}" href="/sessions?project=${encodeURIComponent(p.dir)}">${esc(p.label)} <span class="muted">${p.sessions}</span></a>`),
  ].join("");

  const rows = sessions.map(s => {
    const toolList = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, c]) => `${esc(n)}·${c}`).join("  ");
    return `<a class="session-row" href="/sessions/${encodeURIComponent(s.project)}/${esc(s.id)}">
      <div class="s-main">
        <div class="s-title">${esc(s.title)}</div>
        <div class="s-meta">${esc(s.projectLabel)} · ${esc(s.id.slice(0, 8))} · ${when(s.start)}</div>
      </div>
      <span class="s-branch"><span class="agent-badge mj">${esc(s.branch)}</span></span>
      <span class="s-tools">${esc(toolList)}</span>
      <span class="s-dur">${fmtDur(s.durationMs)}</span>
      <span class="s-stats"><span class="add">+${s.linesAdded}</span> <span class="del">−${s.linesRemoved}</span> · ${k(s.inputTokens + s.outputTokens)}t</span>
    </a>`;
  }).join("\n");

  const pag = opts.totalPages > 1 ? renderPagination(opts.page, opts.totalPages, opts.project) : "";

  return `
<div class="page-title"><h1>Sessions</h1><p>Claude Code sessions across all projects, rehydrated from <span class="mono">~/.claude/projects/…</span></p></div>
<div class="stat-cards">
  <div class="stat-card"><div class="stat-label">${opts.project ? "Sessions (project)" : "Sessions"}</div><div class="stat-value accent">${opts.total}</div></div>
  <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${projects.length}</div></div>
  <div class="stat-card"><div class="stat-label">Tool Calls (page)</div><div class="stat-value">${k(totalTools)}</div></div>
  <div class="stat-card"><div class="stat-label">Tokens (page)</div><div class="stat-value">${k(totalTok)}</div></div>
</div>
<div class="filters">${projectChips}</div>
<div class="run-list">${rows || `<div class="empty-state">No sessions found.</div>`}</div>
${pag}
<style>
.session-row{display:flex;align-items:center;gap:18px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-decoration:none;color:inherit;transition:border-color .1s,background .1s}
.session-row:hover{border-color:var(--accent);background:var(--surface-2);text-decoration:none}
.session-row .s-main{flex:1;min-width:0}
.session-row .s-title{font-weight:600;font-size:13px;color:var(--text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.session-row .s-meta{font-family:var(--mono);font-size:11px;color:var(--text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.session-row .s-branch{flex-shrink:0}
.session-row .s-branch .agent-badge{font-size:10px}
.session-row .s-tools{flex-shrink:0;width:200px;font-family:var(--mono);font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.session-row .s-dur{flex-shrink:0;width:70px;font-family:var(--mono);font-size:12px;color:var(--text-dim);text-align:right}
.session-row .s-stats{flex-shrink:0;width:150px;font-family:var(--mono);font-size:11px;color:var(--text-muted);text-align:right;white-space:nowrap}
.session-row .s-stats .add{color:var(--pass)} .session-row .s-stats .del{color:var(--fail)}
@media (max-width:900px){.session-row .s-tools{display:none}}
</style>`;
}

function renderPagination(page: number, totalPages: number, project: string): string {
  const q = (p: number) => `/sessions?${project ? `project=${encodeURIComponent(project)}&` : ""}page=${p}`;
  const prev = page > 1
    ? `<a class="page-link" href="${q(page - 1)}">‹</a>`
    : `<span class="page-link disabled">‹</span>`;
  const next = page < totalPages
    ? `<a class="page-link" href="${q(page + 1)}">›</a>`
    : `<span class="page-link disabled">›</span>`;
  return `<div class="pagination">${prev}<span class="page-ellipsis">page ${page} / ${totalPages}</span>${next}</div>`;
}

// ── DETAIL ────────────────────────────────────────────────────
function imagesIn(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return (content as any[]).filter(b => b.type === "image" && b.source?.data)
    .map(b => `data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`);
}
function stripImageMarkers(s: string): string {
  return s.replace(/\[Image #\d+\]/g, "").replace(/\[Image: source:[^\]]*\]/g, "").trim();
}
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as any[]).filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
  return "";
}

export function SessionDetailPage(d: SessionDetail, stored?: StoredEval | null): string {
  // tool_use id -> result text
  const toolResults = new Map<string, string>();
  for (const r of d.records_raw) {
    const c = r.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as any[]) {
      if (b.type === "tool_result" && b.tool_use_id) {
        const txt = Array.isArray(b.content)
          ? b.content.filter((x: any) => x.type === "text").map((x: any) => x.text).join("")
          : String(b.content ?? "");
        toolResults.set(b.tool_use_id, txt);
      }
    }
  }

  const header = `
<a class="back-link" href="/sessions">← Sessions</a>
<h1>${esc(d.title)}</h1>
<div class="trace-meta">
  <div class="trace-meta-item"><span class="agent-badge mj">${esc(d.projectLabel)}</span></div>
  <div class="trace-meta-item">${esc(d.model)}</div>
  <div class="trace-meta-item">⌗ ${k(d.inputTokens)} → ${k(d.outputTokens)}</div>
  <div class="trace-meta-item">+${d.linesAdded}/-${d.linesRemoved}</div>
  <div class="trace-meta-item">${d.toolCalls} tools</div>
  <div class="trace-meta-item">${esc(d.branch)}</div>
  <div class="trace-meta-item" style="color:var(--text-muted)">${when(d.start)} · ${fmtDur(d.durationMs)}</div>
</div>`;

  const TABS = ["Chat", "Trace", "Details", "Evaluation"];
  const tabBar = `<div class="tabbar">${TABS.map(t =>
    `<button class="tab${t === "Details" ? " active" : ""}" onclick="showTab('${t}')" id="tabbtn-${t}">${t}</button>`).join("")}</div>`;

  const panels = `
<div class="tabpanel" id="panel-Chat">${renderChat(d, imagesIn)}</div>
<div class="tabpanel" id="panel-Trace">${renderTrace(d, toolResults)}</div>
<div class="tabpanel active" id="panel-Details">${renderDetails(d, toolResults)}</div>
<div class="tabpanel" id="panel-Evaluation">${renderEvaluation(d, stored ?? null)}</div>`;

  return `${header}${tabBar}${panels}
<div class="lb-overlay" id="lb" onclick="this.classList.remove('open')"><img id="lb-img" src=""/></div>
${SESSIONS_DETAIL_CSS}
<script>
function showTab(t){
  for (const p of document.querySelectorAll('.tabpanel')) p.classList.remove('active');
  for (const b of document.querySelectorAll('.tab')) b.classList.remove('active');
  document.getElementById('panel-'+t).classList.add('active');
  document.getElementById('tabbtn-'+t).classList.add('active');
}
function lightbox(src){ document.getElementById('lb-img').src = src; document.getElementById('lb').classList.add('open'); }
</script>`;
}

function renderDetails(d: SessionDetail, toolResults: Map<string, string>): string {
  const tools = Object.entries(d.tools).sort((a, b) => b[1] - a[1]);
  const toolRows = tools.map(([name, c]) => {
    const calls: Array<{ input: unknown; id?: string }> = [];
    for (const r of d.records_raw) {
      if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
      for (const b of r.message!.content as any[]) {
        if (b.type === "tool_use" && b.name === name) calls.push({ input: b.input, id: b.id });
      }
    }
    const callRows = calls.map((call, i) => {
      const inputStr = JSON.stringify(call.input, null, 2).slice(0, 600);
      const result = (toolResults.get(call.id ?? "") ?? "").slice(0, 400);
      return `<div class="toolcall-row"><div class="toolcall-head mono">#${i + 1}</div>
        <div class="tool-input">${esc(inputStr)}</div>
        ${result ? `<div class="tool-result-box">${esc(result)}${result.length >= 400 ? " …" : ""}</div>` : ""}</div>`;
    }).join("\n");
    return `<details class="tool-expand"><summary><span class="agent-badge magic" style="min-width:60px;text-align:center">${esc(name)}</span>
      <span class="mono dim" style="font-size:12px;margin-left:8px">${c} call${c > 1 ? "s" : ""}</span><span class="chevron-mark">▸</span></summary>
      <div class="toolcall-list">${callRows}</div></details>`;
  }).join("\n");

  const fileRows = d.files.map(f =>
    `<div style="display:flex;gap:12px;padding:4px 0;font-family:var(--mono);font-size:12px">
      <span style="color:var(--pass)">+${f.added}</span><span style="color:var(--fail)">−${f.removed}</span>
      <span class="dim">${esc(f.path)}</span></div>`).join("\n");

  return `
<div class="session-info">
  <div class="info-group"><span class="info-label">Time Range</span><span class="info-value">${esc(new Date(d.start).toLocaleString())} — ${esc(new Date(d.end).toLocaleTimeString())} <span class="muted">(${fmtDur(d.durationMs)})</span></span></div>
  <div class="info-group"><span class="info-label">Working Directory</span><span class="info-value">${esc(d.projectPath)}</span></div>
  <div class="info-group"><span class="info-label">Branch</span><span class="info-value highlight">${esc(d.branch)}</span></div>
  <div class="info-group"><span class="info-label">Model</span><span class="info-value">${esc(d.model)}</span></div>
  <div class="info-group"><span class="info-label">Session</span><span class="info-value">${esc(d.id)}</span></div>
  <div class="info-group"><span class="info-label">Turns</span><span class="info-value">${d.userTurns} user · ${d.assistantTurns} assistant</span></div>
</div>
<div class="section"><div class="section-title">Token Usage</div>
  <div class="result-summary">
    <div class="result-item"><span class="result-label">Input</span><span class="result-value">${d.inputTokens.toLocaleString()}</span></div>
    <div class="result-item"><span class="result-label">Output</span><span class="result-value">${d.outputTokens.toLocaleString()}</span></div>
    <div class="result-item"><span class="result-label">Records</span><span class="result-value">${d.records}</span></div>
  </div></div>
<div class="section"><div class="section-title">File Changes <span class="section-badge">+${d.linesAdded} / −${d.linesRemoved} · derived from edits</span></div>
  ${fileRows || `<div class="muted mono" style="font-size:12px">No file edits in this session.</div>`}</div>
<div class="section"><div class="section-title">Tool Usage — ${d.toolCalls} calls <span class="section-badge">click to expand</span></div>
  ${toolRows || `<div class="muted mono" style="font-size:12px">No tool calls.</div>`}</div>`;
}

function renderChat(d: SessionDetail, imagesIn: (c: unknown) => string[]): string {
  const bubbles = d.records_raw.filter(r => (r.type === "user" && r.isSidechain !== true) || r.type === "assistant").map(r => {
    const c = r.message?.content;
    const imgs = imagesIn(c);
    const text = stripImageMarkers(textOf(c));
    if (!text.trim() && imgs.length === 0) return "";
    const mine = r.type === "user";
    const imgHtml = imgs.length ? `<div class="bubble-imgs">${imgs.map(src => `<img class="thumb" src="${src}" loading="lazy" onclick="lightbox(this.src)"/>`).join("")}</div>` : "";
    const textHtml = text.trim()
      ? (mine ? `<div class="bubble-text">${esc(text).replace(/\n/g, "<br>")}</div>` : `<div class="bubble-text md">${md(text)}</div>`)
      : "";
    return `<div class="bubble ${mine ? "user" : "assistant"}"><div class="bubble-role mono">${mine ? "you" : esc(d.model)}</div>${textHtml}${imgHtml}</div>`;
  }).filter(Boolean).join("\n");
  return `<div class="chat-thread">${bubbles || `<div class="empty-state">No chat content.</div>`}</div>`;
}

function renderTrace(d: SessionDetail, toolResults: Map<string, string>): string {
  let steps = "";
  let n = 0;
  for (const r of d.records_raw) {
    if (r.type !== "assistant" && !(r.type === "user" && r.isSidechain !== true)) continue;
    const c = r.message?.content;
    const blocks = Array.isArray(c) ? c : typeof c === "string" ? [{ type: "text", text: c }] : [];
    for (const b of blocks as any[]) {
      let label = "", cls = "", body = "";
      if (b.type === "text" && b.text?.trim()) {
        label = r.type === "user" ? "User" : "Assistant"; cls = r.type === "user" ? "user" : "assistant";
        body = r.type === "assistant"
          ? `<div class="step-text-output md">${md(String(b.text))}</div>`
          : `<div class="step-text-output">${esc(String(b.text).slice(0, 800))}</div>`;
      } else if (b.type === "thinking") {
        label = "Thinking"; cls = "assistant";
        body = `<div class="thinking-block">${esc(String(b.thinking ?? "").slice(0, 400))} …</div>`;
      } else if (b.type === "tool_use") {
        label = "Tool Call"; cls = "tool-call";
        const inputStr = JSON.stringify(b.input, null, 2).slice(0, 800);
        const result = (toolResults.get(b.id ?? "") ?? "").slice(0, 500);
        body = `<details class="tool-expand inline"><summary><span class="step-tool-name"><span class="tool-fn">${esc(b.name)}</span></span><span class="chevron-mark">▸ expand</span></summary>
          <div class="tool-input">${esc(inputStr)}</div>
          ${result ? `<div class="tool-result-box">${esc(result)}${result.length >= 500 ? " …" : ""}</div>` : `<div class="muted mono" style="font-size:11px;padding:4px">(no result captured)</div>`}</details>`;
      } else continue;
      n++;
      steps += `<div class="trace-step"><div class="step-gutter"><div class="step-number">${n}</div><div class="step-line"></div></div>
        <div class="step-content"><div class="step-label ${cls}"><div class="step-type-dot"></div>${label}</div>${body}</div></div>`;
    }
  }
  const raw = d.records_raw.map(r => {
    const t = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "";
    return `<div class="event-row"><span class="event-dot" style="background:var(--text-muted)"></span><span class="event-type mono">${esc(r.type)}</span><span class="event-prev dim mono">${esc(recPreview(r))}</span><span class="event-time muted mono">${esc(t)}</span></div>`;
  }).join("\n");
  return `<div class="trace-card"><div class="trace-header"><span class="trace-header-title">Trace</span>
    <div class="trace-stats">${d.records} events · ${d.toolCalls} tools · ${fmtDur(d.durationMs)}</div></div>
    <div class="trace-timeline">${steps}</div></div>
    <details class="tool-expand" style="margin-top:16px"><summary><span class="mono dim" style="font-size:12px">Show raw records (${d.records})</span><span class="chevron-mark">▸</span></summary>
      <div class="events-list">${raw}</div></details>`;
}

function recPreview(r: SessionRecord): string {
  if (r.type === "assistant" || r.type === "user") {
    const c = r.message?.content;
    if (typeof c === "string") return c.slice(0, 120);
    if (Array.isArray(c)) {
      const t = (c as any[]).find(b => b.type === "text"); if (t) return String(t.text).slice(0, 120);
      const tu = (c as any[]).find(b => b.type === "tool_use"); if (tu) return `tool_use → ${tu.name}`;
      const tr = (c as any[]).find(b => b.type === "tool_result"); if (tr) return "tool_result";
      const th = (c as any[]).find(b => b.type === "thinking"); if (th) return "thinking…";
    }
  }
  if (r.type === "ai-title") return (r.aiTitle ?? r.title ?? "") as string;
  return "";
}

const V_CLASS: Record<Verdict, string> = { pass: "pass", warn: "partial", fail: "fail", "n-a": "muted" };
const V_LABEL: Record<Verdict, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", "n-a": "N/A" };

function evaluateButton(d: SessionDetail, label: string): string {
  const url = `/sessions/${encodeURIComponent(d.project)}/${esc(d.id)}/evaluate`;
  return `<button class="filter-btn" style="font-size:13px;padding:7px 16px"
    hx-post="${url}" hx-target="#panel-Evaluation" hx-swap="innerHTML"
    hx-disabled-elt="this" hx-indicator="#eval-spin">
    ${esc(label)}</button>
  <span id="eval-spin" class="htmx-indicator mono" style="margin-left:10px;color:var(--text-dim);font-size:12px"><span class="spinner"></span> Coach K is judging the session… (~1–2 min)</span>`;
}

/** Evaluation tab content — also returned standalone as the htmx fragment after Evaluate. */
export function renderEvaluation(d: SessionDetail, stored: StoredEval | null): string {
  if (!stored) {
    return `
<div class="trend-verdict stable" style="margin-bottom:16px">
  <div class="trend-arrow flat">∅</div>
  <div class="trend-body">
    <div class="trend-headline stable">Not yet evaluated</div>
    <div class="trend-detail">Score this session against the 14-question rubric (Coach K, LLM-as-judge). See <span class="mono">docs/session-evals-design.md</span>.</div>
  </div>
</div>
${evaluateButton(d, "Evaluate session")}`;
  }

  const verdicts: QuestionVerdict[] = stored.verdicts_json ? JSON.parse(stored.verdicts_json) : [];
  const cats: CategoryScore[] = stored.category_scores_json ? JSON.parse(stored.category_scores_json) : [];
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const agg = (stored.aggregate_verdict ?? "n-a") as Verdict;
  const stale = stored.prompt_version !== judgePromptVersion();

  const errBanner = stored.error
    ? `<div style="background:var(--fail-bg);border:1px solid var(--fail-border);border-radius:8px;padding:10px 14px;margin-bottom:14px;color:var(--fail);font-family:var(--mono);font-size:12px">⚠ ${esc(stored.error)}</div>`
    : "";

  const gateBanner = agg === "fail" && cats.find(c => c.key === "safety" && c.verdict === "fail")
    ? `<div style="background:var(--fail-bg);border:1px solid var(--fail-border);border-radius:8px;padding:10px 14px;margin-bottom:14px;color:var(--fail);font-weight:600;font-size:13px">⛔ Safety veto — a Safety question failed, so the session fails regardless of other categories.</div>`
    : "";

  const staleBadge = stale
    ? `<span class="badge partial" title="Scored under an older judge prompt">stale · re-evaluate</span>` : "";

  const header = `
<div class="trend-verdict ${agg === "pass" ? "improved" : agg === "fail" ? "regressed" : "stable"}" style="margin-bottom:16px">
  <div class="trend-arrow ${agg === "pass" ? "up" : agg === "fail" ? "down" : "flat"}">${stored.aggregate ?? "—"}</div>
  <div class="trend-body">
    <div class="trend-headline ${agg === "pass" ? "improved" : agg === "fail" ? "regressed" : "stable"}">${V_LABEL[agg]} · ${stored.aggregate ?? "—"}/5</div>
    <div class="trend-detail mono">model ${esc(stored.model ?? "—")} · prompt ${esc((stored.prompt_version ?? "").slice(0, 8))} · ${when(stored.judged_at)} ${staleBadge}</div>
  </div>
  <div class="trend-numbers">${cats.map(c => `<div class="trend-num-item"><div class="trend-num-label">${esc(c.key.slice(0, 4))}</div><div class="trend-num-value" style="color:var(--${V_CLASS[c.verdict] === "muted" ? "text-muted" : V_CLASS[c.verdict]})">${c.score ?? "—"}</div></div>`).join("")}</div>
</div>`;

  const catCards = RUBRIC.map(cat => {
    const cs = cats.find(c => c.key === cat.key);
    if (!cs) return "";
    const rows = cat.questions.map(q => {
      const v = byId.get(q.id);
      const verdict = (v?.verdict ?? "n-a") as Verdict;
      const ev = v?.evidence?.trim();
      return `<div class="ev-q">
        <div class="ev-q-head"><span class="badge ${V_CLASS[verdict]}" style="min-width:46px;text-align:center">${V_LABEL[verdict]}</span>
          <span class="ev-q-id mono">${q.id}</span><span class="ev-q-text">${esc(questionText(q.id))}</span></div>
        ${ev ? `<div class="ev-q-evidence">“${esc(ev.slice(0, 400))}${ev.length > 400 ? "…" : ""}”</div>` : ""}
      </div>`;
    }).join("");
    const lc = cs.lowConfidence ? `<span class="badge partial" style="font-size:9px" title="Capped — over half of this category was n/a">low-confidence</span>` : "";
    return `<div class="section">
      <div class="section-title">${esc(cs.label)}${cat.gate ? ` <span class="badge fail" style="font-size:9px">VETO GATE</span>` : ""}
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px">${lc}<span class="badge ${V_CLASS[cs.verdict]}">${cs.score ?? "—"}/5</span><span class="muted mono" style="font-size:11px">${cs.applicable}/${cs.total} applicable</span></span></div>
      ${rows}
    </div>`;
  }).join("");

  const calibUrl = `/sessions/${encodeURIComponent(d.project)}/${esc(d.id)}/calibrate`;
  return `${errBanner}${gateBanner}${header}${catCards}
<div style="margin-top:16px;display:flex;gap:10px;align-items:center">${evaluateButton(d, "Re-evaluate")}
  <button class="filter-btn" hx-post="${calibUrl}" hx-target="#calib-msg" hx-swap="innerHTML" title="Freeze this session + these verdicts as draft labels for judge calibration">Add to calibration</button>
  <span id="calib-msg" class="mono muted" style="font-size:12px"></span></div>
${EVAL_CSS}`;
}

// ── CALIBRATION ("eval the evaluator") ────────────────────────
const VERDICT_OPTS: Array<Verdict | ""> = ["", "pass", "warn", "fail", "n-a"];

export function CalibrationPage(scenarios: CalibrationScenario[], lastRun: CalibrationRun | null): string {
  const promptV = judgePromptVersion();
  const editors = scenarios.map(s => {
    const rows = RUBRIC.map(cat => {
      const qrows = cat.questions.map(q => {
        const cur = s.labels[q.id] ?? "";
        const opts = VERDICT_OPTS.map(v =>
          `<option value="${v}"${v === cur ? " selected" : ""}>${v === "" ? "— unlabeled —" : v}</option>`).join("");
        return `<tr><td class="mono" style="color:var(--text-dim);width:42px">${q.id}</td>
          <td><select name="label_${q.id}" class="filter-select" style="width:120px">${opts}</select></td>
          <td class="muted" style="font-size:11px">${esc(questionText(q.id).slice(0, 90))}…</td></tr>`;
      }).join("");
      return qrows;
    }).join("");
    const labeledCount = Object.keys(s.labels).length;
    return `<details class="tool-expand" style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;padding:0 14px">
      <summary style="padding:12px 0">
        <span style="font-weight:600">${esc(s.id)}</span>
        <span class="muted" style="margin-left:10px">${esc(s.title.slice(0, 50))}</span>
        <span class="badge ${s.labeledBy === "human" ? "pass" : "partial"}" style="margin-left:10px;font-size:9px">${s.labeledBy}</span>
        <span class="muted mono" style="margin-left:8px;font-size:11px">${labeledCount}/14 labeled</span>
        <span class="chevron-mark">▸</span></summary>
      <form method="POST" action="/admin/session-judge/calibration/${esc(s.id)}/labels" style="padding-bottom:14px">
        <div class="muted" style="font-size:12px;margin-bottom:8px">${esc(s.note)}</div>
        <table style="font-size:12px"><tbody>${rows}</tbody></table>
        <button class="filter-btn" type="submit" style="margin-top:10px">Save labels (marks human-reviewed)</button>
        <a class="filter-btn" href="/sessions/${encodeURIComponent(s.project)}/${esc(s.session_id)}" style="margin-left:8px;text-decoration:none">view session</a>
      </form>
    </details>`;
  }).join("");

  return `
<div class="page-title"><h1>Judge Calibration</h1><p>Eval the evaluator — run the current judge over frozen labeled sessions and measure agreement vs human golden labels (mechanical, no second LLM). <a href="/admin/session-judge">edit judge prompt →</a></p></div>
<details class="tool-expand" style="margin-bottom:14px;border:1px solid var(--border);border-radius:8px;padding:0 14px">
  <summary style="padding:12px 0"><span style="font-weight:600">How calibration works</span><span class="chevron-mark">▸</span></summary>
  <div style="font-size:13px;line-height:1.7;color:var(--text-dim);padding-bottom:14px">
    <p><b>The idea:</b> calibration scores the <em>judge</em>, not the session. You give it sessions where you already know the right answer (golden labels), let the judge score them, and measure how often it agrees with you.</p>
    <p><b>A scenario</b> = a <b>frozen transcript</b> (snapshotted, so runs are reproducible) + your <b>golden labels</b> (verdict per question; leave a question unlabeled to skip it) + a <span class="mono">draft</span>/<span class="mono">human</span> flag.</p>
    <p><b>Run calibration</b> feeds each frozen transcript through the <em>current</em> judge prompt and compares its verdicts to your labels by exact match — no second LLM, so no infinite regress. It reports <b>agreement %</b> (overall + per scenario), a <b>✓/✗ grid</b> (hover a cell for label vs judged), and a <b>signed gap</b> (judge harsher vs softer than you).</p>
    <p><b>The loop:</b> edit the judge prompt/rubric → version bumps → Run → did agreement rise and ✗ cells turn ✓? Labels start as Claude-proposed <span class="mono">draft</span>; reviewing &amp; saving flips them to <span class="mono">human</span> (the irreplaceable step — the judge is only as good as your labels). Add more via <b>"Add to calibration"</b> on any session's Evaluation tab.</p>
  </div>
</details>
<div class="mono muted" style="font-size:12px;margin-bottom:14px">current prompt version: ${esc(promptV)} · ${scenarios.length} scenarios</div>
<button class="filter-btn" style="font-size:13px;padding:8px 18px" hx-post="/admin/session-judge/calibration/run" hx-target="#calib-results" hx-swap="innerHTML" hx-disabled-elt="this" hx-indicator="#calib-spin">Run calibration</button>
<span id="calib-spin" class="htmx-indicator mono" style="margin-left:10px;color:var(--text-dim);font-size:12px"><span class="spinner"></span> judging ${scenarios.length} frozen sessions… (~1 min)</span>
<div id="calib-results" style="margin:18px 0">${lastRun ? renderCalibrationRun(lastRun) : ""}</div>
<h2 style="margin-top:24px">Scenarios &amp; labels</h2>
<p class="muted" style="font-size:12px;margin-bottom:12px">Labels are the ground truth the judge is measured against. Drafts are Claude-proposed — review and correct, then Save.</p>
${editors || `<div class="empty-state">No calibration scenarios yet. Use "Add to calibration" on a session's Evaluation tab.</div>`}
${EVAL_CSS}`;
}

export function renderCalibrationRun(run: CalibrationRun): string {
  const pct = Math.round(run.agreement * 100);
  const cls = pct >= 85 ? "improved" : pct >= 65 ? "stable" : "regressed";
  const bias = run.meanSignedGap;
  const biasLabel = Math.abs(bias) < 0.1 ? "well-calibrated" : bias > 0 ? `judge ${bias.toFixed(2)} HARSHER than labels` : `judge ${Math.abs(bias).toFixed(2)} SOFTER than labels`;

  const grid = run.scenarios.map(sr => {
    const cells = ALL_QUESTION_IDS.map(id => {
      const q = sr.questions.find(x => x.id === id)!;
      if (q.label === null) return `<td class="cal-cell" title="${id}: unlabeled" style="color:var(--text-muted)">·</td>`;
      const mark = q.match ? "✓" : "✗";
      const color = q.match ? "var(--pass)" : "var(--fail)";
      return `<td class="cal-cell" title="${id}: label=${q.label} judged=${q.judged}" style="color:${color}">${mark}</td>`;
    }).join("");
    return `<tr><td class="mono" style="white-space:nowrap;padding-right:12px">${esc(sr.id)} <span class="muted">${Math.round(sr.agreement * 100)}%</span></td>${cells}</tr>`;
  }).join("");
  const headCells = ALL_QUESTION_IDS.map(id => `<td class="cal-cell mono" style="color:var(--text-muted);font-size:9px">${id}</td>`).join("");

  return `
<div class="trend-verdict ${cls}">
  <div class="trend-arrow ${cls === "improved" ? "up" : cls === "regressed" ? "down" : "flat"}">${pct}%</div>
  <div class="trend-body">
    <div class="trend-headline ${cls}">${run.totalMatched}/${run.totalLabeled} labeled verdicts matched</div>
    <div class="trend-detail mono">prompt ${esc(run.promptVersion.slice(0, 8))} · ${biasLabel} · ${when(run.ranAt)}</div>
  </div>
</div>
<div style="overflow-x:auto;margin-top:12px"><table class="cal-grid"><thead><tr><td></td>${headCells}</tr></thead><tbody>${grid}</tbody></table></div>
<style>.cal-grid{border-collapse:collapse;font-size:12px}.cal-grid td{padding:4px 6px;text-align:center}.cal-cell{width:24px;font-weight:700}.cal-grid tbody tr:hover{background:var(--surface-2)}</style>`;
}

const EVAL_CSS = `<style>
.ev-q{padding:8px 0;border-top:1px solid var(--border-subtle)}
.ev-q:first-of-type{border-top:none}
.ev-q-head{display:flex;align-items:baseline;gap:10px}
.ev-q-id{color:var(--text-dim);font-size:12px;font-weight:700;flex-shrink:0}
.ev-q-text{font-size:12px;color:var(--text-dim);line-height:1.5}
.ev-q-evidence{margin:6px 0 2px 56px;font-family:var(--mono);font-size:11px;color:var(--text-muted);font-style:italic;border-left:2px solid var(--border);padding-left:10px}
</style>`;

const SESSIONS_DETAIL_CSS = `<style>
.tabbar{display:flex;gap:4px;border-bottom:1px solid var(--border);margin:20px 0}
.tab{font-family:var(--sans);font-size:13px;font-weight:600;padding:10px 18px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;margin-bottom:-1px}
.tab:hover{color:var(--text)} .tab.active{color:var(--text);border-bottom-color:var(--accent)}
.tabpanel{display:none} .tabpanel.active{display:block}
.events-list{display:flex;flex-direction:column;gap:1px;margin-top:8px}
.event-row{display:grid;grid-template-columns:14px 160px 1fr 90px;align-items:center;gap:10px;padding:6px 10px;border-radius:6px}
.event-row:hover{background:var(--surface-2)} .event-dot{width:8px;height:8px;border-radius:50%}
.event-type{font-size:11px;font-weight:600;color:var(--text-dim)} .event-prev{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .event-time{font-size:11px;text-align:right}
.chat-thread{display:flex;flex-direction:column;gap:14px}
.bubble{max-width:82%;padding:12px 16px;border-radius:10px;border:1px solid var(--border)}
.bubble.user{align-self:flex-end;background:var(--surface-3);max-width:90%} .bubble.assistant{align-self:flex-start;background:var(--surface)}
.bubble-role{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.bubble-text{font-size:13px;line-height:1.6;color:var(--text);word-break:break-word}
.bubble-text:not(.md){white-space:pre-wrap}
.md h1,.md h2,.md h3{margin:14px 0 6px;line-height:1.3;color:var(--text)} .md h1{font-size:17px}.md h2{font-size:15px}.md h3{font-size:13px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-dim)}
.md h1:first-child,.md h2:first-child,.md h3:first-child,.md p:first-child{margin-top:0}
.md p{margin:8px 0} .md ul,.md ol{margin:8px 0;padding-left:22px} .md li{margin:3px 0}
.md strong{color:var(--text);font-weight:700} .md em{color:var(--text-dim)} .md a{color:var(--accent)}
.md code{font-family:var(--mono);font-size:12px;background:var(--surface-3);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.md pre{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:10px 0} .md pre code{background:none;border:none;padding:0}
.md table{border-collapse:collapse;margin:10px 0;font-size:12px} .md th,.md td{border:1px solid var(--border);padding:5px 10px;text-align:left} .md th{background:var(--surface-2);color:var(--text-dim)}
.md blockquote{border-left:3px solid var(--border);margin:8px 0;padding:2px 0 2px 12px;color:var(--text-dim)} .md hr{border:none;border-top:1px solid var(--border);margin:14px 0}
.step-text-output.md{font-family:var(--sans);white-space:normal;max-height:none}
.bubble-imgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.bubble-imgs img.thumb{width:110px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:zoom-in;transition:transform .15s,border-color .15s}
.bubble-imgs img.thumb:hover{transform:scale(1.05);border-color:var(--accent)}
.lb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;align-items:center;justify-content:center;cursor:zoom-out;padding:32px} .lb-overlay.open{display:flex} .lb-overlay img{max-width:95%;max-height:95%;border-radius:8px}
details.tool-expand summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 0} details.tool-expand summary::-webkit-details-marker{display:none}
details.tool-expand .chevron-mark{margin-left:auto;font-size:11px;color:var(--text-muted);font-family:var(--mono)} details.tool-expand[open] .chevron-mark{color:var(--accent)}
details.tool-expand:not(.inline){border-bottom:1px solid var(--border-subtle)} .toolcall-row{padding:8px 0 12px} .toolcall-head{font-size:11px;color:var(--text-dim);margin-bottom:6px}
</style>`;
