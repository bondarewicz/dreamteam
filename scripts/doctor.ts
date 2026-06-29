/**
 * Provider reachability probes — shared by `dreamteam doctor` (CLI) and the
 * /admin/providers web page (doctor-in-the-browser). One source of truth so the
 * two never drift.
 *
 * Each probe is best-effort and never throws: a provider you don't use is allowed
 * to fail. Claude Code is the only hard requirement (interactive /team + the judge).
 */
import path from "path";
import fs from "fs";
import { harnessMemoryDir } from "./paths.ts";

export type ProviderId = "claude" | "ollama" | "gemini" | "codex";

export type ProviderCheck = {
  id: ProviderId;
  /** Human label, e.g. "Claude Code (claude)". */
  label: string;
  /** Reachable AND authenticated. */
  ok: boolean;
  /** Short status / next-step hint. */
  detail: string;
  /** What Dream Team uses this provider for. */
  role: string;
  /** Whether the whole tool degrades without it. Only Claude is required. */
  required: boolean;
};

const HOME = process.env.HOME ?? "~";

/** Run a binary's `--version`-style probe; first stdout line is the detail. */
async function probeBin(name: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  try {
    const proc = Bun.spawn([name, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { ok: code === 0, detail: out.trim().split("\n")[0] ?? "" };
  } catch {
    return { ok: false, detail: "not on PATH" };
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function checkClaude(): Promise<ProviderCheck> {
  const v = await probeBin("claude", ["--version"]);
  return {
    id: "claude",
    label: "Claude Code (claude)",
    ok: v.ok,
    detail: v.ok ? v.detail : "install: https://claude.com/claude-code",
    role: "interactive /team + the eval judge",
    required: true,
  };
}

export async function checkOllama(): Promise<ProviderCheck> {
  const host = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";
  const up = await reachable(`${host}/api/tags`);
  return {
    id: "ollama",
    label: `Ollama (${host.replace(/^https?:\/\//, "")})`,
    ok: up,
    detail: up ? "serving" : "start: `ollama serve`",
    role: "cross-provider evals on local models",
    required: false,
  };
}

export async function checkGemini(): Promise<ProviderCheck> {
  const v = await probeBin("gemini", ["--version"]);
  const auth = !!process.env.GEMINI_API_KEY || fs.existsSync(path.join(HOME, ".gemini"));
  return {
    id: "gemini",
    label: "Gemini CLI (gemini)",
    ok: v.ok && auth,
    detail: v.ok ? (auth ? v.detail : "installed, but no GEMINI_API_KEY / ~/.gemini auth") : "not on PATH",
    role: "cross-provider evals on Gemini",
    required: false,
  };
}

export async function checkCodex(): Promise<ProviderCheck> {
  const v = await probeBin("codex", ["--version"]);
  const auth = fs.existsSync(path.join(HOME, ".codex")) || !!process.env.OPENAI_API_KEY || !!process.env.CODEX_API_KEY;
  return {
    id: "codex",
    label: "Codex CLI (codex)",
    ok: v.ok && auth,
    detail: v.ok ? (auth ? v.detail : "installed, but not logged in (`codex login`) / no API key") : "not on PATH",
    role: "cross-provider evals on GPT-class models",
    required: false,
  };
}

/** All four probes, run concurrently. Stable order: claude, ollama, gemini, codex. */
export async function checkProviders(): Promise<ProviderCheck[]> {
  return Promise.all([checkClaude(), checkOllama(), checkGemini(), checkCodex()]);
}

// ---------------------------------------------------------------------------
// Memory health check — Slice 9 / Option A (inverted from old disable-based plan)
//
// Option A: autoMemoryEnabled MUST be true (NEVER false). The jotter is neutralized
// at the filesystem layer (dir 0500 / files 0400), not by disabling the feature.
// Therefore:
//   FAIL if autoMemoryEnabled=false or CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (injection disabled).
//   FAIL if MEMORY.md is missing or empty (no projection written yet).
//   FAIL if autoMemoryDirectory is set to a dir that doesn't match the projection dir.
//   WARN if the memory dir is WRITABLE (jotter co-write risk → BR-9 exposure).
//   WARN if MEMORY.md exceeds the 200-line / 25 KB load budget.
//
// Read-only: never writes anything. Safe to run against a fake home.
// Reports LOADABLE state, not LOADED — only a live session confirms actual injection.
// ---------------------------------------------------------------------------

export interface MemoryHealthCheck {
  ok: boolean;
  label: string;
  detail: string;
  warnings: string[];
  /** Raw info for the doctor summary (cutover manifest state, paths, etc.). */
  info: string[];
}

/**
 * Check memory injection health for a project.
 *
 * @param home - injectable home dir (use fake home in tests; real HOME in CLI).
 * @param project - project slug.
 * @param envDisabled - whether CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (pass process.env for real CLI).
 */
export function checkMemoryHealth(
  home: string,
  project: string,
  envDisabled: boolean = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1",
): MemoryHealthCheck {
  const claudeDir = path.join(home, ".claude");
  const memoryDir = harnessMemoryDir(home, project);
  const memoryMdPath = path.join(memoryDir, "MEMORY.md");
  const settingsPath = path.join(claudeDir, "settings.json");

  const warnings: string[] = [];
  const info: string[] = [];

  info.push(`home: ${home}`);
  info.push(`project: ${project}`);
  info.push(`memory dir: ${memoryDir}`);

  // Read settings.json.
  let autoMemoryEnabled: boolean | null = null;
  let autoMemoryDirectory: string | null = null;
  if (fs.existsSync(settingsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (typeof s.autoMemoryEnabled === "boolean") autoMemoryEnabled = s.autoMemoryEnabled;
      if (typeof s.autoMemoryDirectory === "string") autoMemoryDirectory = s.autoMemoryDirectory;
    } catch { /* treat as absent */ }
  }

  info.push(`autoMemoryEnabled: ${autoMemoryEnabled ?? "(absent — default true)"}`);
  if (autoMemoryDirectory) info.push(`autoMemoryDirectory: ${autoMemoryDirectory}`);

  // FAIL: autoMemoryEnabled is false (Option A: NEVER disable).
  if (autoMemoryEnabled === false) {
    return {
      ok: false,
      label: "memory-health",
      detail: "autoMemoryEnabled=false: injection DISABLED — MEMORY.md will NOT be loaded by Claude Code",
      warnings,
      info,
    };
  }

  // FAIL: env var disables injection.
  if (envDisabled) {
    return {
      ok: false,
      label: "memory-health",
      detail: "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1: injection DISABLED — MEMORY.md will NOT be loaded",
      warnings,
      info,
    };
  }

  // FAIL: MEMORY.md missing.
  if (!fs.existsSync(memoryMdPath)) {
    return {
      ok: false,
      label: "memory-health",
      detail: `MEMORY.md not found at ${memoryMdPath} — run 'dreamteam learn' or 'dreamteam cutover'`,
      warnings,
      info,
    };
  }

  // FAIL: MEMORY.md empty.
  let content: string;
  try {
    content = fs.readFileSync(memoryMdPath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      label: "memory-health",
      detail: `Cannot read MEMORY.md: ${e instanceof Error ? e.message : String(e)}`,
      warnings,
      info,
    };
  }
  if (content.trim().length === 0) {
    return {
      ok: false,
      label: "memory-health",
      detail: `MEMORY.md is empty at ${memoryMdPath} — projection may not have run yet`,
      warnings,
      info,
    };
  }

  // FAIL: autoMemoryDirectory is set to a dir that doesn't match the projection dir.
  // Option A: leave autoMemoryDirectory UNSET so default per-project scoping applies.
  // If it's set, it must match our projection dir (otherwise injection targets wrong dir).
  if (autoMemoryDirectory !== null) {
    const resolvedAuto = path.resolve(autoMemoryDirectory);
    const resolvedMemory = path.resolve(memoryDir);
    if (resolvedAuto !== resolvedMemory) {
      return {
        ok: false,
        label: "memory-health",
        detail:
          `autoMemoryDirectory="${autoMemoryDirectory}" does not match projection dir "${memoryDir}". ` +
          `Option A: leave autoMemoryDirectory unset so default per-project scoping applies.`,
        warnings,
        info,
      };
    }
  }

  // WARN: memory dir is WRITABLE — jotter could co-write (BR-9 exposure).
  // Post-cutover the dir should be locked at 0500 (r-x only).
  if (fs.existsSync(memoryDir)) {
    try {
      const stat = fs.statSync(memoryDir);
      if ((stat.mode & 0o200) !== 0) {
        warnings.push(
          "memory dir is WRITABLE — the auto-jotter could co-write with the projection (BR-9 / AC-8 exposure). " +
          "Run 'dreamteam cutover --execute' or manually chmod 0500 the memory dir."
        );
      }
    } catch { /* ignore stat failure */ }
  }

  // WARN: MEMORY.md exceeds load budget (200 lines / 25 KB).
  const lines = content.split("\n").length;
  const bytes = Buffer.byteLength(content, "utf-8");
  if (lines > 200 || bytes > 25 * 1024) {
    warnings.push(
      `MEMORY.md exceeds auto-load budget: ${lines} lines / ${bytes} bytes ` +
      `(limit: 200 lines / 25 KB). Claude Code may truncate or not load it fully.`
    );
  }

  // Check cutover-manifest state (informational).
  const manifestGlob = path.join(home, ".dreamteam", "backups");
  if (fs.existsSync(manifestGlob)) {
    try {
      const runs = fs.readdirSync(manifestGlob)
        .filter(d => d.startsWith("cutover-"))
        .sort()
        .reverse();
      if (runs.length > 0) {
        const latestManifest = path.join(manifestGlob, runs[0], "cutover-manifest.json");
        if (fs.existsSync(latestManifest)) {
          const m = JSON.parse(fs.readFileSync(latestManifest, "utf-8"));
          info.push(`cutover: ${m.completed ? "COMPLETED" : "pending"} (${m.ts})`);
          if (m.rollback) info.push(`  last rollback: ${m.rollback.reason}`);
        }
      }
    } catch { /* ignore manifest read errors */ }
  }

  const detail = [
    `MEMORY.md present (${lines} lines / ${bytes} bytes) — injection LOADABLE`,
    `autoMemoryEnabled: ${autoMemoryEnabled ?? "absent (default true)"}`,
    `dir locked: ${(fs.existsSync(memoryDir) && (fs.statSync(memoryDir).mode & 0o200) === 0) ? "yes (0500)" : "no"}`,
    "Note: doctor confirms LOADABLE, not LOADED — start a fresh session to confirm injection.",
  ].join("; ");

  return { ok: true, label: "memory-health", detail, warnings, info };
}
