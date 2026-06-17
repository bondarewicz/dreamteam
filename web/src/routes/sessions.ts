/**
 * sessions.ts — routes for the Sessions feature.
 * Index parses on-demand (cached by file mtime in sessions-source).
 */
import { listSessions, listProjects, loadSession } from "../sessions-source.ts";
import { SessionsIndexPage, SessionDetailPage, renderEvaluation, CalibrationPage, renderCalibrationRun } from "../views/Sessions.ts";
import { maybeLayout, Layout } from "../views/Layout.ts";
import { esc } from "../views/html.ts";
import { runSessionJudge, compactTranscript, getJudgeConfig, saveJudgeConfig, getJudgePrompt, judgePromptVersion, isUsingDefaultPrompt, RUBRIC, DEFAULT_QUESTION_TEXT } from "../session-judge.ts";
import type { Verdict } from "../session-judge.ts";
import { getLatestSessionEval, saveSessionEval } from "../sessions-db.ts";
import { listCalibration, getCalibration, saveCalibration, createCalibrationFromSession, runCalibration } from "../calibration.ts";

// last calibration run held in memory so the page can show it without re-running
let _lastCalibration: Awaited<ReturnType<typeof runCalibration>> | null = null;

function html(content: string, status = 200): Response {
  return new Response(content, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const PAGE_SIZE = 25;

/** Shared admin sub-nav (3 session-eval admin pages). */
function ADMIN_SUBNAV(active: string): string {
  const items = [
    { href: "/admin/models", label: "Agent Models" },
    { href: "/admin/providers", label: "Providers" },
    { href: "/admin/session-judge", label: "Session Judge Prompt" },
    { href: "/admin/session-judge/calibration", label: "Judge Calibration" },
  ];
  return `<div class="filters" style="margin-bottom:20px">` +
    items.map(i => `<a class="filter-btn ${i.href === active ? "active" : ""}" href="${i.href}" style="text-decoration:none">${i.label}</a>`).join("") +
    `</div>`;
}

/** GET /sessions — index across all projects (optional ?project=&page=) */
export function sessionsListHandler(req: Request): Response {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") ?? "";
  const parsedPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const projects = listProjects();
  const all = listSessions(project ? { project } : {});
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pageSlice = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const body = SessionsIndexPage(pageSlice, projects, { project, page, totalPages, total });
  return html(maybeLayout(req, "Sessions", body, "/sessions"));
}

/** GET /sessions/:project/:id — session detail with tabs */
export function sessionDetailHandler(req: Request, params: Record<string, string>): Response {
  const { project, id } = params;
  if (!project || !id) return html("Not Found", 404);
  const detail = loadSession(project, id);
  if (!detail) {
    return html(Layout("Not Found", `<div class="empty-state">Session not found: ${esc(id)}</div>`, "/sessions"), 404);
  }
  const stored = getLatestSessionEval(project, id);
  const body = SessionDetailPage(detail, stored);
  return html(maybeLayout(req, detail.title, body, "/sessions"));
}

/** POST /sessions/:project/:id/evaluate — run Coach K judge, persist, return Evaluation fragment */
export async function evaluateSessionHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { project, id } = params;
  if (!project || !id) return html("Not Found", 404);
  const detail = loadSession(project, id);
  if (!detail) return html(`<div class="empty-state">Session not found.</div>`, 404);

  const result = await runSessionJudge(detail, { now: new Date().toISOString() });
  saveSessionEval(project, id, result);
  const stored = getLatestSessionEval(project, id);
  return html(renderEvaluation(detail, stored)); // fragment — htmx swaps #panel-Evaluation
}

/** GET /admin/session-judge — editable Coach K judge prompt (structured sections) */
export function judgePromptHandler(req: Request): Response {
  const cfg = getJudgeConfig();
  const ta = (name: string, val: string, rows: number) =>
    `<textarea name="${name}" rows="${rows}" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px;line-height:1.5;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;resize:vertical">${esc(val)}</textarea>`;
  const sec = (title: string, hint: string, inner: string) =>
    `<div class="section"><div class="section-title">${esc(title)}<span class="section-badge" style="margin-left:auto">${esc(hint)}</span></div>${inner}</div>`;

  const rubricView = RUBRIC.map(c =>
    `<div style="margin-bottom:14px"><div class="mono" style="font-size:12px;color:var(--text-dim);font-weight:700;margin-bottom:4px">${esc(c.label)}${c.gate ? ` <span class="badge fail" style="font-size:9px">VETO GATE</span>` : ""}<span class="muted" style="font-weight:400;margin-left:8px">weight ${c.gate ? "veto" : c.weight}</span></div>` +
    c.questions.map(q => {
      const cur = cfg.questionText[q.id]?.trim() || q.text;
      const edited = cur !== DEFAULT_QUESTION_TEXT[q.id];
      return `<div style="display:flex;gap:8px;align-items:start;margin:0 0 6px 8px">
        <span class="mono" style="font-size:11px;font-weight:700;color:var(--text-dim);width:30px;flex-shrink:0;padding-top:8px">${q.id}${edited ? ` <span style="color:var(--partial)" title="edited">•</span>` : ""}</span>
        ${ta(`q_${q.id}`, cur, 2)}</div>`;
    }).join("") +
    `</div>`).join("");

  const body = `
${ADMIN_SUBNAV("/admin/session-judge")}
<div class="page-title"><h1>Session Judge Prompt</h1><p>Edit Coach K's session-eval prompt as sections — headings, the rubric and the output format are generated, so you never hand-write markdown. Saving bumps the <span class="mono">prompt_version</span> (past scores become "stale").</p></div>
<div class="mono muted" style="font-size:12px;margin-bottom:14px">version: ${esc(judgePromptVersion())} ${isUsingDefaultPrompt() ? "(default — not yet customized)" : "(customized)"}</div>
<form method="POST" action="/admin/session-judge">
  ${sec("Role", "who the judge is + framing", ta("role", cfg.role, 4))}
  ${sec("Verdict definitions", "what pass / warn / fail / n-a mean", `
    <div style="display:grid;grid-template-columns:60px 1fr;gap:8px 12px;align-items:start">
      <span class="badge pass" style="text-align:center">pass</span>${ta("v_pass", cfg.verdicts.pass, 2)}
      <span class="badge partial" style="text-align:center">warn</span>${ta("v_warn", cfg.verdicts.warn, 2)}
      <span class="badge fail" style="text-align:center">fail</span>${ta("v_fail", cfg.verdicts.fail, 2)}
      <span class="badge muted" style="text-align:center">n-a</span>${ta("v_na", cfg.verdicts.na, 2)}
    </div>`)}
  ${sec("Rules", "one rule per line", ta("rules", cfg.rules.join("\n"), 6))}
  ${sec("Rubric questions — editable wording", "IDs · categories · weights · veto are fixed (drive scoring) · • = edited", `<div style="max-height:420px;overflow-y:auto;padding-right:8px">${rubricView}</div>`)}
  <details class="tool-expand" style="margin-bottom:12px"><summary><span class="mono dim" style="font-size:12px">Preview assembled prompt</span><span class="chevron-mark">▸</span></summary>
    <pre style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:11px;max-height:400px;overflow:auto;white-space:pre-wrap">${esc(getJudgePrompt())}</pre></details>
  <div style="display:flex;gap:10px"><button class="filter-btn" type="submit" style="padding:8px 18px">Save</button>
  <a class="filter-btn" href="/sessions" style="padding:8px 18px;text-decoration:none">Back to Sessions</a></div>
</form>`;
  return html(maybeLayout(req, "Session Judge Prompt", body, "/admin/models"));
}

/** POST /admin/session-judge — save edited sections */
export async function judgePromptSaveHandler(req: Request): Promise<Response> {
  const form = await req.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const cfg = getJudgeConfig();
  // Only persist question-text that DIFFERS from the code default (keeps overrides minimal + auto-tracks rubric edits).
  const questionText: Partial<Record<string, string>> = {};
  for (const id of Object.keys(DEFAULT_QUESTION_TEXT)) {
    const v = str(`q_${id}`);
    if (v && v !== DEFAULT_QUESTION_TEXT[id]) questionText[id] = v;
  }
  saveJudgeConfig({
    role: str("role") || cfg.role,
    verdicts: {
      pass: str("v_pass") || cfg.verdicts.pass,
      warn: str("v_warn") || cfg.verdicts.warn,
      fail: str("v_fail") || cfg.verdicts.fail,
      na: str("v_na") || cfg.verdicts.na,
    },
    rules: str("rules").split("\n").map(r => r.trim()).filter(Boolean),
    questionText,
  });
  return new Response(null, { status: 303, headers: { Location: "/admin/session-judge" } });
}

/** GET /admin/session-judge/calibration — calibration page */
export function calibrationHandler(req: Request): Response {
  const body = ADMIN_SUBNAV("/admin/session-judge/calibration") + CalibrationPage(listCalibration(), _lastCalibration);
  return html(maybeLayout(req, "Judge Calibration", body, "/admin/models"));
}

/** POST /admin/session-judge/calibration/run — run judge over all frozen scenarios */
export async function calibrationRunHandler(): Promise<Response> {
  _lastCalibration = await runCalibration({ now: new Date().toISOString() });
  return html(renderCalibrationRun(_lastCalibration)); // fragment
}

/** POST /admin/session-judge/calibration/:id/labels — save human labels */
export async function calibrationSaveLabelsHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const s = getCalibration(params.id);
  if (!s) return html("Not Found", 404);
  const form = await req.formData();
  const labels: Partial<Record<string, Verdict>> = {};
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("label_")) continue;
    const val = String(v);
    if (["pass", "warn", "fail", "n-a"].includes(val)) labels[k.slice("label_".length)] = val as Verdict;
  }
  s.labels = labels;
  s.labeledBy = "human";
  saveCalibration(s);
  return new Response(null, { status: 303, headers: { Location: "/admin/session-judge/calibration" } });
}

/** POST /sessions/:project/:id/calibrate — freeze session as a calibration scenario (draft labels from its eval) */
export function captureCalibrationHandler(req: Request, params: Record<string, string>): Response {
  const { project, id } = params;
  const detail = loadSession(project, id);
  if (!detail) return html(`<span style="color:var(--fail)">session not found</span>`, 404);
  const stored = getLatestSessionEval(project, id);
  const draft: Partial<Record<string, Verdict>> = {};
  if (stored?.verdicts_json) {
    try {
      for (const v of JSON.parse(stored.verdicts_json) as Array<{ id: string; verdict: Verdict }>) draft[v.id] = v.verdict;
    } catch { /* none */ }
  }
  const c = createCalibrationFromSession(
    project, id, detail.title, compactTranscript(detail.records_raw), draft,
    stored ? "Draft labels seeded from the judge's own verdicts — REVIEW & correct before trusting." : "No prior eval — label manually.",
  );
  return html(`<span style="color:var(--pass)">✓ added as ${esc(c.id)} (draft). <a href="/admin/session-judge/calibration">review labels →</a></span>`);
}
