/**
 * One-off generator: reads real Claude Code session logs for this project and
 * emits a self-contained HTML mockup of the proposed "Sessions" feature
 * (index + 5-tab detail) using the existing web theme.
 *
 * Run: bun scripts/gen-sessions-mockup.ts
 * Output: docs/sessions-mockup.html
 */
import fs from "fs";
import path from "path";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });
/** Render assistant Markdown → HTML. (Real app should sanitize; logs are trusted here.) */
function md(s: string): string {
  return marked.parse(s, { async: false }) as string;
}

const LOG_DIR = path.join(
  process.env.HOME!,
  ".claude/projects/-Users-lb-Github-Bondarewicz-dreamteam",
);
const OUT = path.join(import.meta.dir, "../docs/sessions-mockup.html");
const DETAIL_ID = "8c183f76-6117-41c0-adab-5f9e6b582213"; // this very conversation

function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
function readLines(file: string): any[] {
  const out: any[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}
function firstOf<T>(recs: any[], pick: (r: any) => T | undefined): T | undefined {
  for (const r of recs) { const v = pick(r); if (v !== undefined && v !== null) return v; }
  return undefined;
}
function lastOf<T>(recs: any[], pick: (r: any) => T | undefined): T | undefined {
  for (let i = recs.length - 1; i >= 0; i--) { const v = pick(recs[i]); if (v !== undefined && v !== null) return v; }
  return undefined;
}
function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}
function k(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function timeAgo(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Summary = {
  id: string;
  title: string;
  start: Date; end: Date; durMs: number;
  branch: string; model: string; cwd: string;
  records: number; assistant: number; user: number;
  tools: Record<string, number>; toolTotal: number;
  inTok: number; outTok: number;
  firstPrompt: string;
};

function summarize(file: string): Summary | null {
  const recs = readLines(file);
  if (recs.length === 0) return null;
  const ts = recs.map(r => r.timestamp).filter(Boolean).map((t: string) => new Date(t));
  if (ts.length === 0) return null;
  const start = ts[0], end = ts[ts.length - 1];
  const tools: Record<string, number> = {};
  let inTok = 0, outTok = 0, assistant = 0, user = 0;
  for (const r of recs) {
    if (r.type === "assistant") {
      assistant++;
      const u = r.message?.usage;
      if (u) { inTok += (u.input_tokens ?? 0); outTok += (u.output_tokens ?? 0); }
      for (const c of (r.message?.content ?? [])) {
        if (c.type === "tool_use") tools[c.name] = (tools[c.name] ?? 0) + 1;
      }
    } else if (r.type === "user") user++;
  }
  const firstPrompt = firstOf<string>(recs, r => {
    if (r.type !== "user") return undefined;
    const c = r.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) { const t = c.find((b: any) => b.type === "text"); return t?.text; }
    return undefined;
  }) ?? "";
  return {
    id: path.basename(file, ".jsonl"),
    title: lastOf<string>(recs, r => r.type === "ai-title" ? (r.aiTitle ?? r.title) : undefined)
      ?? (firstPrompt.slice(0, 60) || "(untitled session)"),
    start, end, durMs: end.getTime() - start.getTime(),
    branch: firstOf<string>(recs, r => r.gitBranch) ?? "—",
    model: lastOf<string>(recs, r => r.message?.model) ?? "—",
    cwd: firstOf<string>(recs, r => r.cwd) ?? "—",
    records: recs.length, assistant, user,
    tools, toolTotal: Object.values(tools).reduce((a, b) => a + b, 0),
    inTok, outTok,
    firstPrompt,
  };
}

// ── gather summaries ──────────────────────────────────────────
const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith(".jsonl"))
  .map(f => path.join(LOG_DIR, f));
const summaries = files.map(summarize).filter((s): s is Summary => !!s)
  .sort((a, b) => b.end.getTime() - a.end.getTime());
const indexRows = summaries.slice(0, 14);
const detail = summaries.find(s => s.id === DETAIL_ID) ?? summaries[0];
const detailRecs = readLines(path.join(LOG_DIR, `${detail.id}.jsonl`));

// Map tool_use id -> result text (from following user tool_result blocks)
const toolResults = new Map<string, string>();
for (const r of detailRecs) {
  const c = r.message?.content;
  if (!Array.isArray(c)) continue;
  for (const b of c) {
    if (b.type === "tool_result" && b.tool_use_id) {
      const txt = Array.isArray(b.content)
        ? b.content.filter((x: any) => x.type === "text").map((x: any) => x.text).join("")
        : String(b.content ?? "");
      toolResults.set(b.tool_use_id, txt);
    }
  }
}
function imagesIn(content: any): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: any) => b.type === "image" && b.source?.data)
    .map((b: any) => `data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`);
}
function stripImageMarkers(s: string): string {
  return s.replace(/\[Image #\d+\]/g, "").replace(/\[Image: source:[^\]]*\]/g, "").trim();
}

// ── SESSIONS INDEX ────────────────────────────────────────────
const totalTok = summaries.reduce((a, s) => a + s.inTok + s.outTok, 0);
const totalTools = summaries.reduce((a, s) => a + s.toolTotal, 0);
const indexHtml = `
<div class="stat-cards">
  <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value accent">${summaries.length}</div></div>
  <div class="stat-card"><div class="stat-label">Tool Calls</div><div class="stat-value">${k(totalTools)}</div></div>
  <div class="stat-card"><div class="stat-label">Tokens</div><div class="stat-value">${k(totalTok)}</div></div>
  <div class="stat-card"><div class="stat-label">Project</div><div class="stat-value" style="font-size:14px;padding-top:8px">dreamteam</div></div>
</div>
<div class="filters">
  <span class="muted mono" style="font-size:11px">FILTER</span>
  <button class="filter-btn active">all</button>
  <button class="filter-btn">main</button>
  <button class="filter-btn">worktrees</button>
  <select class="filter-select"><option>model: all</option><option>claude-opus-4-8</option></select>
  <input class="filter-select" placeholder="search title…" style="min-width:200px"/>
</div>
<div class="run-list">
${indexRows.map(s => {
  const toolList = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, c]) => `${esc(n)}·${c}`).join("  ");
  return `<a class="run-row" href="#detail" style="grid-template-columns: minmax(260px,2fr) 120px 110px minmax(0,1fr) 90px;">
    <div>
      <div class="text" style="font-weight:600;font-size:13px;line-height:1.3">${esc(s.title)}</div>
      <div class="run-date" style="margin-top:3px">${esc(s.id.slice(0, 8))} · ${timeAgo(s.start)}</div>
    </div>
    <div class="run-date">${fmtDur(s.durMs)}</div>
    <div class="run-meta"><span class="agent-badge mj" style="font-size:10px">${esc(s.branch)}</span></div>
    <div class="run-counts mono" style="color:var(--text-muted);font-size:11px">${esc(toolList)}</div>
    <div class="run-scenarios">${s.records} ev · ${k(s.inTok + s.outTok)} tok</div>
  </a>`;
}).join("\n")}
</div>`;

// ── DETAIL: header ────────────────────────────────────────────
const detailToolList = Object.entries(detail.tools).sort((a, b) => b[1] - a[1]);
const headerHtml = `
<a class="back-link" href="#index">&#8592; Sessions</a>
<h1>${esc(detail.title)}</h1>
<div class="trace-meta">
  <div class="trace-meta-item"><span class="agent-badge mj">claude</span> <span>${esc(detail.model)}</span></div>
  <div class="trace-meta-item">&#9201; ${k(detail.inTok)} &#8594; ${k(detail.outTok)}</div>
  <div class="trace-meta-item">&#128295; ${detail.toolTotal} tools</div>
  <div class="trace-meta-item">${esc(detail.branch)}</div>
  <div class="trace-meta-item" style="color:var(--text-muted)">${timeAgo(detail.start)} · ${fmtDur(detail.durMs)}</div>
</div>`;

// ── DETAIL: tabs ──────────────────────────────────────────────
const TABS = ["Chat", "Trace", "Details", "Evaluation"];
const tabBarHtml = `<div class="tabbar">${TABS.map(t =>
  `<button class="tab${t === "Details" ? " active" : ""}" onclick="showTab('${t}')" id="tabbtn-${t}">${t}</button>`,
).join("")}</div>`;

// DETAILS tab
const detailsHtml = `
<div class="session-info">
  <div class="info-group"><span class="info-label">Sessions</span><span class="info-value highlight">1</span></div>
  <div class="info-group"><span class="info-label">Time Range</span><span class="info-value">${esc(detail.start.toLocaleString())} — ${esc(detail.end.toLocaleTimeString())} <span class="muted">(${fmtDur(detail.durMs)})</span></span></div>
  <div class="info-group"><span class="info-label">Working Directory</span><span class="info-value">${esc(detail.cwd)}</span></div>
  <div class="info-group"><span class="info-label">Branch</span><span class="info-value highlight">${esc(detail.branch)}</span></div>
  <div class="info-group"><span class="info-label">Model</span><span class="info-value">${esc(detail.model)}</span></div>
  <div class="info-group"><span class="info-label">User</span><span class="info-value">Łukasz Bondarewicz</span></div>
</div>
<div class="section">
  <div class="section-title">Token Usage</div>
  <div class="result-summary">
    <div class="result-item"><span class="result-label">Input</span><span class="result-value">${detail.inTok.toLocaleString()}</span></div>
    <div class="result-item"><span class="result-label">Output</span><span class="result-value">${detail.outTok.toLocaleString()}</span></div>
    <div class="result-item"><span class="result-label">Total</span><span class="result-value">${(detail.inTok + detail.outTok).toLocaleString()}</span></div>
    <div class="result-item"><span class="result-label">Records</span><span class="result-value">${detail.records}</span></div>
  </div>
</div>
<div class="section">
  <div class="section-title">File Changes <span class="section-badge">derived from file-history-snapshot</span></div>
  <div class="muted mono" style="font-size:12px">+172 / −24 across 2 files <span style="color:var(--text-muted)">(illustrative — computed from snapshot diffs)</span></div>
</div>
<div class="section">
  <div class="section-title">Tool Usage — ${detail.toolTotal} calls <span class="section-badge">click a tool to expand calls</span></div>
  ${detailToolList.map(([name, c]) => {
    // gather individual calls of this tool
    const calls: Array<{ input: any; id: string }> = [];
    for (const r of detailRecs) {
      if (r.type !== "assistant") continue;
      for (const b of (r.message?.content ?? [])) {
        if (b.type === "tool_use" && b.name === name) calls.push({ input: b.input, id: b.id });
      }
    }
    const callRows = calls.map((call, i) => {
      const inputStr = JSON.stringify(call.input, null, 2).slice(0, 600);
      const result = (toolResults.get(call.id) ?? "").slice(0, 400);
      return `<div class="toolcall-row">
        <div class="toolcall-head mono">#${i + 1} <span class="muted">~timing from Δ</span></div>
        <div class="tool-input">${esc(inputStr)}</div>
        ${result ? `<div class="tool-result-box">${esc(result)}${result.length >= 400 ? " …" : ""}</div>` : ""}
      </div>`;
    }).join("\n");
    return `<details class="tool-expand">
      <summary><span class="agent-badge magic" style="min-width:60px;text-align:center">${esc(name)}</span>
        <span class="mono dim" style="font-size:12px;margin-left:8px">${c} call${c > 1 ? "s" : ""}</span>
        <span class="chevron-mark">▸</span></summary>
      <div class="toolcall-list">${callRows}</div>
    </details>`;
  }).join("\n")}
</div>`;

// EVENTS tab
const eventTypeColor: Record<string, string> = {
  assistant: "var(--shaq)", user: "var(--accent)", system: "var(--text-dim)",
  "file-history-snapshot": "var(--pippen)", "ai-title": "var(--magic)",
  mode: "var(--text-muted)", "permission-mode": "var(--text-muted)",
};
function recPreview(r: any): string {
  if (r.type === "assistant" || r.type === "user") {
    const c = r.message?.content;
    if (typeof c === "string") return c.slice(0, 120);
    if (Array.isArray(c)) {
      const t = c.find((b: any) => b.type === "text");
      if (t) return String(t.text).slice(0, 120);
      const tu = c.find((b: any) => b.type === "tool_use");
      if (tu) return `tool_use → ${tu.name}`;
      const tr = c.find((b: any) => b.type === "tool_result");
      if (tr) return `tool_result`;
      const th = c.find((b: any) => b.type === "thinking");
      if (th) return `thinking…`;
    }
  }
  if (r.type === "ai-title") return r.aiTitle ?? r.title ?? "";
  if (r.type === "file-history-snapshot") return "snapshot recorded";
  if (r.type === "mode") return `mode: ${r.mode ?? ""}`;
  if (r.type === "permission-mode") return `permission: ${r.permissionMode ?? ""}`;
  return "";
}
const rawRecordsHtml = `
<div class="events-list">
${detailRecs.map(r => {
  const color = eventTypeColor[r.type] ?? "var(--text-muted)";
  const t = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "";
  return `<div class="event-row">
    <span class="event-dot" style="background:${color}"></span>
    <span class="event-type mono" style="color:${color}">${esc(r.type)}</span>
    <span class="event-prev dim mono">${esc(recPreview(r))}</span>
    <span class="event-time muted mono">${esc(t)}</span>
  </div>`;
}).join("\n")}
</div>`;

// CHAT tab
const chatHtml = `<div class="chat-thread">
${detailRecs.filter(r => r.type === "user" || r.type === "assistant").map(r => {
  const c = r.message?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) text = c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const imgs = imagesIn(c);
  text = stripImageMarkers(text);
  if (!text.trim() && imgs.length === 0) return "";
  const mine = r.type === "user";
  const imgHtml = imgs.length
    ? `<div class="bubble-imgs">${imgs.map(src => `<img class="thumb" src="${src}" loading="lazy" onclick="lightbox(this.src)" />`).join("")}</div>`
    : "";
  const textHtml = text.trim()
    ? (mine
        ? `<div class="bubble-text">${esc(text).replace(/\n/g, "<br>")}</div>`
        : `<div class="bubble-text md">${md(text)}</div>`)
    : "";
  return `<div class="bubble ${mine ? "user" : "assistant"}">
    <div class="bubble-role mono">${mine ? "you" : esc(detail.model)}</div>
    ${textHtml}${imgHtml}
  </div>`;
}).filter(Boolean).join("\n")}
</div>`;

// TRACE tab — turn grouped
let traceHtml = `<div class="trace-card"><div class="trace-header"><span class="trace-header-title">Trace</span>
  <div class="trace-stats">${detailRecs.length} events · ${detail.toolTotal} tools · ${fmtDur(detail.durMs)}</div></div>
  <div class="trace-timeline">`;
let step = 0;
for (const r of detailRecs) {
  if (r.type !== "assistant" && r.type !== "user") continue;
  const c = r.message?.content;
  const blocks = Array.isArray(c) ? c : typeof c === "string" ? [{ type: "text", text: c }] : [];
  for (const b of blocks) {
    let label = "", cls = "", body = "";
    if (b.type === "text" && b.text?.trim()) {
      label = r.type === "user" ? "User" : "Assistant"; cls = r.type === "user" ? "user" : "assistant";
      body = r.type === "assistant"
        ? `<div class="step-text-output md">${md(String(b.text))}</div>`
        : `<div class="step-text-output">${esc(String(b.text).slice(0, 600))}${b.text.length > 600 ? " …" : ""}</div>`;
    } else if (b.type === "thinking") {
      label = "Thinking"; cls = "assistant";
      body = `<div class="thinking-block">${esc(String(b.thinking).slice(0, 400))} …</div>`;
    } else if (b.type === "tool_use") {
      label = "Tool Call"; cls = "tool-call";
      const inputStr = JSON.stringify(b.input, null, 2).slice(0, 800);
      const result = (toolResults.get(b.id) ?? "").slice(0, 500);
      body = `<details class="tool-expand inline">
        <summary><span class="step-tool-name"><span class="tool-fn">${esc(b.name)}</span></span><span class="chevron-mark">▸ expand</span></summary>
        <div class="tool-input">${esc(inputStr)}</div>
        ${result ? `<div class="tool-result-box">${esc(result)}${result.length >= 500 ? " …" : ""}</div>` : `<div class="muted mono" style="font-size:11px;padding:4px">(no result captured)</div>`}
      </details>`;
    } else if (b.type === "tool_result") {
      continue; // shown nested under its Tool Call above
    } else continue;
    step++;
    traceHtml += `<div class="trace-step">
      <div class="step-gutter"><div class="step-number">${step}</div><div class="step-line"></div></div>
      <div class="step-content"><div class="step-label ${cls}"><div class="step-type-dot"></div>${label}</div>${body}</div>
    </div>`;
  }
}
traceHtml += `</div></div>
<details class="tool-expand" style="margin-top:16px">
  <summary><span class="mono dim" style="font-size:12px">Show raw records (${detailRecs.length})</span><span class="chevron-mark">▸</span></summary>
  <div class="muted mono" style="font-size:11px;margin:8px 0">The flat firehose — every record type, replacing the separate Events tab.</div>
  ${rawRecordsHtml}
</details>`;

// EVALUATION tab
const evalHtml = `
<div class="trend-verdict stable" style="margin-bottom:16px">
  <div class="trend-arrow flat">∅</div>
  <div class="trend-body">
    <div class="trend-headline stable">No eval linked to this session</div>
    <div class="trend-detail">When a session's <span class="mono">sessionId</span> matches an <span class="mono">eval_results</span> row, that scenario's score, graders, and observations render here — closing the loop.</div>
  </div>
</div>
<div class="section">
  <div class="section-title">Illustrative — what an eval-linked session shows</div>
  <div class="trace-meta" style="margin-bottom:12px">
    <div class="trace-meta-item"><span class="score-badge pass">Pass</span></div>
    <div class="trace-meta-item mono">bird / scenario-06-fintech-domain-rules</div>
    <div class="trace-meta-item muted">conf: 0.9</div>
  </div>
  <div class="grader-row">
    <span class="grader-label">graders</span>
    <span class="grader-chip grader-pass"><span class="grader-icon">&#10003;</span> json_path path=invariants min_items=3</span>
    <span class="grader-chip grader-pass"><span class="grader-icon">&#10003;</span> contains "escalation"</span>
    <span class="grader-chip grader-fail"><span class="grader-icon">&#10007;</span> max_items=5</span>
  </div>
  <ul class="obs-list" style="margin-top:12px">
    <li class="obs-item"><span class="obs-dot positive"></span><span class="obs-text">Correctly classified the rule as an invariant and flagged the jurisdiction conflict.</span></li>
    <li class="obs-item"><span class="obs-dot negative"></span><span class="obs-text">Listed 6 acceptance criteria where the reference caps at 5 — minor over-production.</span></li>
  </ul>
</div>`;

const panels = `
<div class="tabpanel" id="panel-Chat">${chatHtml}</div>
<div class="tabpanel" id="panel-Trace">${traceHtml}</div>
<div class="tabpanel active" id="panel-Details">${detailsHtml}</div>
<div class="tabpanel" id="panel-Evaluation">${evalHtml}</div>`;

// ── PAGE ──────────────────────────────────────────────────────
const extraCss = `
.mockup-banner{background:var(--partial-bg);border:1px solid var(--partial-border);color:var(--partial);border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:12px;font-family:var(--mono)}
.viewtoggle{display:flex;gap:8px;margin-bottom:20px}
.viewtoggle button{font-family:var(--mono);font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer}
.viewtoggle button.active{border-color:var(--accent);color:var(--text);background:var(--surface-3)}
.tabbar{display:flex;gap:4px;border-bottom:1px solid var(--border);margin:20px 0 20px}
.tab{font-family:var(--sans);font-size:13px;font-weight:600;padding:10px 18px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;margin-bottom:-1px}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);border-bottom-color:var(--accent)}
.tabpanel{display:none}
.tabpanel.active{display:block}
.events-list{display:flex;flex-direction:column;gap:1px}
.event-row{display:grid;grid-template-columns:14px 150px 1fr 90px;align-items:center;gap:10px;padding:7px 10px;border-radius:6px}
.event-row:hover{background:var(--surface-2)}
.event-dot{width:8px;height:8px;border-radius:50%}
.event-type{font-size:11px;font-weight:600}
.event-prev{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.event-time{font-size:11px;text-align:right}
.chat-thread{display:flex;flex-direction:column;gap:14px}
.bubble{max-width:80%;padding:12px 16px;border-radius:10px;border:1px solid var(--border)}
.bubble.user{align-self:flex-end;background:var(--surface-3)}
.bubble.assistant{align-self:flex-start;background:var(--surface)}
.bubble-role{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.bubble-text{font-size:13px;line-height:1.6;color:var(--text);word-break:break-word}
.bubble-text.md{white-space:normal}
.bubble-text:not(.md){white-space:pre-wrap}
.md h1,.md h2,.md h3{margin:14px 0 6px;line-height:1.3;color:var(--text)}
.md h1{font-size:17px}.md h2{font-size:15px}.md h3{font-size:13px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-dim)}
.md h1:first-child,.md h2:first-child,.md h3:first-child,.md p:first-child{margin-top:0}
.md p{margin:8px 0}
.md ul,.md ol{margin:8px 0;padding-left:22px}
.md li{margin:3px 0}
.md strong{color:var(--text);font-weight:700}
.md em{color:var(--text-dim)}
.md a{color:var(--accent)}
.md code{font-family:var(--mono);font-size:12px;background:var(--surface-3);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.md pre{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:10px 0}
.md pre code{background:none;border:none;padding:0;font-size:12px;line-height:1.5}
.md blockquote{border-left:3px solid var(--border);margin:8px 0;padding:2px 0 2px 12px;color:var(--text-dim)}
.md table{border-collapse:collapse;margin:10px 0;font-size:12px}
.md th,.md td{border:1px solid var(--border);padding:5px 10px;text-align:left}
.md th{background:var(--surface-2);color:var(--text-dim);font-size:11px;text-transform:uppercase}
.md hr{border:none;border-top:1px solid var(--border);margin:14px 0}
.step-text-output.md{font-family:var(--sans);white-space:normal;max-height:none}
#view-detail{display:none}
.playback{display:flex;align-items:center;justify-content:center;gap:20px;padding:14px;color:var(--text-dim);font-size:20px}
.playback span{cursor:pointer}
.bubble-imgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.bubble-imgs img.thumb{width:110px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:zoom-in;transition:transform .15s,border-color .15s}
.bubble-imgs img.thumb:hover{transform:scale(1.05);border-color:var(--accent)}
.lb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;align-items:center;justify-content:center;cursor:zoom-out;padding:32px}
.lb-overlay.open{display:flex}
.lb-overlay img{max-width:95%;max-height:95%;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6)}
.bubble.user{max-width:90%}
details.tool-expand summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 0}
details.tool-expand summary::-webkit-details-marker{display:none}
details.tool-expand .chevron-mark{margin-left:auto;font-size:11px;color:var(--text-muted);font-family:var(--mono)}
details.tool-expand[open] .chevron-mark{color:var(--accent)}
details.tool-expand:not(.inline){border-bottom:1px solid var(--border-subtle)}
.toolcall-row{padding:8px 0 12px}
.toolcall-head{font-size:11px;color:var(--text-dim);margin-bottom:6px}
`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sessions — mockup</title>
<link rel="stylesheet" href="../web/static/theme.css">
<style>${extraCss}</style>
</head><body>
<nav>
  <a class="nav-brand" href="#index">dream<span>team</span></a>
  <a href="#index">Dashboard</a><a href="#index">Scenarios</a>
  <a href="#index" style="color:var(--text)">Sessions</a>
</nav>
<div class="container">
  <div class="mockup-banner">⚑ STATIC MOCKUP — generated from ${summaries.length} real session logs in this project. Data is real; layout is for feedback only. No backend wired up.</div>
  <div class="viewtoggle">
    <button class="active" onclick="showView('index')" id="vb-index">① Sessions index</button>
    <button onclick="showView('detail')" id="vb-detail">② Session detail (tabs)</button>
  </div>

  <div id="view-index" class="view">
    <div class="page-title"><h1>Sessions</h1><p>Every Claude Code session in this project, rehydrated from <span class="mono">~/.claude/projects/…</span></p></div>
    ${indexHtml}
  </div>

  <div id="view-detail" class="view">
    ${headerHtml}
    ${tabBarHtml}
    <div class="playback"><span>⏮</span><span>▶</span><span>⏭</span></div>
    ${panels}
  </div>
</div>
<div class="lb-overlay" id="lb" onclick="this.classList.remove('open')"><img id="lb-img" src=""/></div>
<script>
function lightbox(src){ document.getElementById('lb-img').src = src; document.getElementById('lb').classList.add('open'); }
function showView(v){
  document.getElementById('view-index').style.display = v==='index'?'block':'none';
  document.getElementById('view-detail').style.display = v==='detail'?'block':'none';
  document.getElementById('vb-index').classList.toggle('active', v==='index');
  document.getElementById('vb-detail').classList.toggle('active', v==='detail');
  window.scrollTo(0,0);
}
function showTab(t){
  for (const p of document.querySelectorAll('.tabpanel')) p.classList.remove('active');
  for (const b of document.querySelectorAll('.tab')) b.classList.remove('active');
  document.getElementById('panel-'+t).classList.add('active');
  document.getElementById('tabbtn-'+t).classList.add('active');
}
// deep-link: clicking a session row jumps to detail
for (const a of document.querySelectorAll('a[href="#detail"]')) a.addEventListener('click', e=>{e.preventDefault();showView('detail');});
if (location.hash==='#detail') showView('detail');
</script>
</body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  ${summaries.length} sessions summarized, detail = ${detail.id} ("${detail.title}")`);
console.log(`  ${detailRecs.length} records in detail session, ${detail.toolTotal} tool calls`);
