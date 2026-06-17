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
