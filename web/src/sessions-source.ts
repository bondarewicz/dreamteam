/**
 * sessions-source.ts — Read & normalize Claude Code session logs from
 * ~/.claude/projects/<encoded>/*.jsonl, across ALL projects.
 *
 * Pure-ish I/O layer for the Sessions feature (see docs/session-evals-design.md).
 * No DB here — routes/indexer consume this. File changes (+/-) are derived from
 * Edit/Write tool calls in the trace (the log does NOT carry before/after content;
 * file-history-snapshot only stores backup *references*), so counts are approximate.
 */
import fs from "fs";
import path from "path";
import os from "os";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/** Projects excluded from indexing entirely (automated eval-runner noise). */
const EXCLUDED_PROJECTS = new Set(["-Users-lb-Github-Bondarewicz-dreamteam-evals"]);

// ── types ─────────────────────────────────────────────────────
export type SessionRecord = {
  type: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  sessionId?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, number>;
  };
  aiTitle?: string;
  title?: string;
  isSidechain?: boolean;
  userType?: string;
  [key: string]: unknown;
};

export type ToolCall = { name: string; input: unknown; id?: string };

export type SessionSummary = {
  project: string;        // encoded dir name
  projectPath: string;    // decoded filesystem path
  projectLabel: string;   // short human label
  id: string;             // session id (file stem)
  title: string;
  start: string;          // ISO
  end: string;            // ISO
  durationMs: number;
  branch: string;
  model: string;
  records: number;
  assistantTurns: number;
  userTurns: number;
  toolCalls: number;
  tools: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  headless: boolean;
};

export type SessionDetail = SessionSummary & {
  records_raw: SessionRecord[];
  files: Array<{ path: string; added: number; removed: number }>;
};

// ── helpers ───────────────────────────────────────────────────
function decodeProject(dir: string): string {
  // Claude encodes the cwd by replacing path separators with '-'. The encoding
  // is lossy (real '-' in names is ambiguous), so prefer the session's own cwd
  // when available; this is only a fallback label.
  return dir.replace(/^-/, "/").replace(/-/g, "/");
}
function projectLabel(dir: string): string {
  const parts = dir.replace(/^-Users-[^-]+-/, "").split("-");
  return parts.join("/");
}
function readJsonl(file: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  let content: string;
  try { content = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}
function firstWith<T>(recs: SessionRecord[], pick: (r: SessionRecord) => T | undefined): T | undefined {
  for (const r of recs) { const v = pick(r); if (v !== undefined && v !== null) return v; }
  return undefined;
}
function lastWith<T>(recs: SessionRecord[], pick: (r: SessionRecord) => T | undefined): T | undefined {
  for (let i = recs.length - 1; i >= 0; i--) { const v = pick(recs[i]); if (v !== undefined && v !== null) return v; }
  return undefined;
}
function lineCount(s: unknown): number {
  if (typeof s !== "string" || s === "") return 0;
  return s.split("\n").length;
}

/**
 * Derive per-file added/removed line counts from Edit/Write/MultiEdit tool calls.
 * Approximate: Edit removed=old line count, added=new line count; Write counts
 * the written content as additions (prior content unknown from the log).
 */
function deriveFileChanges(records: SessionRecord[]): Map<string, { added: number; removed: number }> {
  const files = new Map<string, { added: number; removed: number }>();
  const bump = (p: string, add: number, rem: number) => {
    const e = files.get(p) ?? { added: 0, removed: 0 };
    e.added += add; e.removed += rem; files.set(p, e);
  };
  for (const r of records) {
    if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message!.content as Array<Record<string, unknown>>) {
      if (b.type !== "tool_use") continue;
      const name = b.name as string;
      const input = (b.input ?? {}) as Record<string, unknown>;
      const fp = (input.file_path ?? input.filePath ?? input.path) as string | undefined;
      if (!fp) continue;
      if (name === "Edit") {
        bump(fp, lineCount(input.new_string), lineCount(input.old_string));
      } else if (name === "Write") {
        bump(fp, lineCount(input.content), 0);
      } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
        for (const ed of input.edits as Array<Record<string, unknown>>) {
          bump(fp, lineCount(ed.new_string), lineCount(ed.old_string));
        }
      } else if (name === "NotebookEdit") {
        bump(fp, lineCount(input.new_source), lineCount(input.old_source));
      }
    }
  }
  return files;
}

/** A session is "headless" (eval-runner / automated) if it has no human-typed prompts. */
function isHeadless(records: SessionRecord[]): boolean {
  let humanText = 0;
  let synthetic = false;
  for (const r of records) {
    if (r.message?.model === "<synthetic>") synthetic = true;
    if (r.type === "user" && r.isSidechain !== true) {
      const c = r.message?.content;
      const text = typeof c === "string"
        ? c
        : Array.isArray(c) ? c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") : "";
      if (text.trim()) humanText++;
    }
  }
  return humanText === 0 || (synthetic && humanText < 1);
}

// Cache summaries by file identity (path + mtime + size) so the index page
// doesn't re-parse hundreds of unchanged .jsonl files on every request.
const _summaryCache = new Map<string, SessionSummary | null>();

function summarizeCached(project: string, file: string): SessionSummary | null {
  let key: string;
  try {
    const st = fs.statSync(file);
    key = `${file}:${st.mtimeMs}:${st.size}`;
  } catch { return null; }
  if (_summaryCache.has(key)) return _summaryCache.get(key)!;
  const s = summarize(project, file);
  _summaryCache.set(key, s);
  return s;
}

function summarize(project: string, file: string): SessionSummary | null {
  const recs = readJsonl(file);
  if (recs.length === 0) return null;
  const stamps = recs.map(r => r.timestamp).filter(Boolean) as string[];
  if (stamps.length === 0) return null;
  const start = stamps[0], end = stamps[stamps.length - 1];

  const tools: Record<string, number> = {};
  let inTok = 0, outTok = 0, assistantTurns = 0, userTurns = 0, toolCalls = 0;
  for (const r of recs) {
    if (r.type === "assistant") {
      assistantTurns++;
      const u = r.message?.usage;
      if (u) { inTok += u.input_tokens ?? 0; outTok += u.output_tokens ?? 0; }
      if (Array.isArray(r.message?.content)) {
        for (const b of r.message!.content as Array<Record<string, unknown>>) {
          if (b.type === "tool_use") { toolCalls++; const n = b.name as string; tools[n] = (tools[n] ?? 0) + 1; }
        }
      }
    } else if (r.type === "user" && r.isSidechain !== true) {
      userTurns++;
    }
  }

  const changes = deriveFileChanges(recs);
  let added = 0, removed = 0;
  for (const v of changes.values()) { added += v.added; removed += v.removed; }

  const firstPrompt = firstWith<string>(recs, r => {
    if (r.type !== "user" || r.isSidechain === true) return undefined;
    const c = r.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) { const t = (c as any[]).find(b => b.type === "text"); return t?.text; }
    return undefined;
  }) ?? "";

  return {
    project,
    projectPath: firstWith(recs, r => r.cwd) ?? decodeProject(project),
    projectLabel: projectLabel(project),
    id: path.basename(file, ".jsonl"),
    title: lastWith<string>(recs, r => r.type === "ai-title" ? (r.aiTitle ?? r.title) : undefined)
      ?? (firstPrompt.trim().slice(0, 80) || "(untitled session)"),
    start, end,
    durationMs: new Date(end).getTime() - new Date(start).getTime(),
    branch: firstWith(recs, r => r.gitBranch) ?? "—",
    model: lastWith<string>(recs, r => r.message?.model) ?? "—",
    records: recs.length,
    assistantTurns, userTurns, toolCalls, tools,
    inputTokens: inTok, outputTokens: outTok,
    filesChanged: changes.size, linesAdded: added, linesRemoved: removed,
    headless: isHeadless(recs),
  };
}

// ── public API ────────────────────────────────────────────────
export function listProjects(): Array<{ dir: string; label: string; sessions: number }> {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const out: Array<{ dir: string; label: string; sessions: number }> = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    if (EXCLUDED_PROJECTS.has(dir)) continue;
    const full = path.join(PROJECTS_DIR, dir);
    let n = 0;
    try {
      if (!fs.statSync(full).isDirectory()) continue;
      n = fs.readdirSync(full).filter(f => f.endsWith(".jsonl")).length;
    } catch { continue; }
    if (n > 0) out.push({ dir, label: projectLabel(dir), sessions: n });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

export type ListOpts = { project?: string; includeHeadless?: boolean; limit?: number };

/** List session summaries (newest first). Excludes excluded projects + headless by default. */
export function listSessions(opts: ListOpts = {}): SessionSummary[] {
  const projects = opts.project ? [opts.project] : listProjects().map(p => p.dir);
  const summaries: SessionSummary[] = [];
  for (const dir of projects) {
    if (EXCLUDED_PROJECTS.has(dir)) continue;
    const full = path.join(PROJECTS_DIR, dir);
    let files: string[] = [];
    try { files = fs.readdirSync(full).filter(f => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const s = summarizeCached(dir, path.join(full, f));
      if (!s) continue;
      if (s.headless && !opts.includeHeadless) continue;
      summaries.push(s);
    }
  }
  summaries.sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());
  return opts.limit ? summaries.slice(0, opts.limit) : summaries;
}

export function loadSession(project: string, id: string): SessionDetail | null {
  const file = path.join(PROJECTS_DIR, project, `${id}.jsonl`);
  const summary = summarize(project, file);
  if (!summary) return null;
  const records = readJsonl(file);
  const changes = deriveFileChanges(records);
  return {
    ...summary,
    records_raw: records,
    files: [...changes.entries()].map(([path, c]) => ({ path, ...c })).sort((a, b) => (b.added + b.removed) - (a.added + a.removed)),
  };
}
