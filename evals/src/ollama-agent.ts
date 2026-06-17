/**
 * ollama-agent.ts — orchestrator-driven tool loop for ollama-delegated Shaq (S9, Phase 3).
 *
 * Ollama has NO filesystem: it only EMITS tool_call requests via /api/chat; WE
 * execute them. That makes the write gate CONSTRUCTIVE and the strongest of all:
 *   - PLAN phase  → only READ tools are registered → the model literally cannot
 *     write (no write tool exists to call). Reads the real worktree (read-only).
 *   - IMPLEMENT phase (post human-approval) → WRITE tools added, every path
 *     confined to the session sandbox (.dt-delegated); bash runs cwd-pinned there
 *     with a scrubbed env.
 *
 * Defense in depth: even if a write/bash tool_call appears in the plan phase
 * (hallucination), the executor refuses it and the loop records a gate violation.
 */
import fs from "fs";
import path from "path";

const OLLAMA_URL = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";
const MAX_ITERS = 16;
const MAX_TOOL_OUTPUT = 8000;

type Tool = { type: "function"; function: { name: string; description: string; parameters: object } };

const READ_TOOLS: Tool[] = [
  { type: "function", function: { name: "read_file", description: "Read a project file (read-only).", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_dir", description: "List a project directory.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "grep", description: "Search project files for a regex.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } } },
];
const WRITE_TOOLS: Tool[] = [
  { type: "function", function: { name: "write_file", description: "Write a file into the implementation sandbox.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "run_bash", description: "Run a shell command in the sandbox (e.g. build/test).", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } } },
];
export const READ_TOOL_NAMES = READ_TOOLS.map((t) => t.function.name);
export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.function.name);

/** Resolve `p` inside `base`; throw if it escapes (path-confinement). */
export function resolveInside(base: string, p: string): string {
  const abs = path.resolve(base, p);
  const root = path.resolve(base);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes sandbox: ${p}`);
  return abs;
}

export type ToolCtx = { worktree: string; sandbox: string; writeAllowed: boolean; written: Set<string> };

/** Execute one tool call. Read tools hit the worktree (read-only); write tools hit the sandbox and only when allowed. */
export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<{ result: string; gateViolation?: boolean }> {
  try {
    switch (name) {
      case "read_file": {
        const abs = resolveInside(ctx.worktree, String(args.path ?? ""));
        return { result: fs.readFileSync(abs, "utf-8").slice(0, MAX_TOOL_OUTPUT) };
      }
      case "list_dir": {
        const abs = resolveInside(ctx.worktree, String(args.path ?? "."));
        return { result: fs.readdirSync(abs, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n").slice(0, MAX_TOOL_OUTPUT) };
      }
      case "grep": {
        const re = new RegExp(String(args.pattern ?? ""), "i");
        const root = resolveInside(ctx.worktree, String(args.path ?? "."));
        const hits: string[] = [];
        const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (hits.length > 80) return; const p = path.join(d, e.name); if (e.name === "node_modules" || e.name === ".git") continue; if (e.isDirectory()) walk(p); else { try { fs.readFileSync(p, "utf-8").split("\n").forEach((ln, i) => { if (re.test(ln)) hits.push(`${path.relative(ctx.worktree, p)}:${i + 1}: ${ln.trim().slice(0, 160)}`); }); } catch { /* binary */ } } } };
        try { fs.statSync(root).isDirectory() ? walk(root) : null; } catch { /* missing */ }
        return { result: hits.join("\n").slice(0, MAX_TOOL_OUTPUT) || "(no matches)" };
      }
      case "write_file": {
        if (!ctx.writeAllowed) return { result: "ERROR: write_file is not available in plan mode (read-only). Produce a plan; do not write.", gateViolation: true };
        const abs = resolveInside(ctx.sandbox, String(args.path ?? ""));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(args.content ?? ""));
        ctx.written.add(path.relative(ctx.sandbox, abs));
        return { result: `wrote ${path.relative(ctx.sandbox, abs)}` };
      }
      case "run_bash": {
        if (!ctx.writeAllowed) return { result: "ERROR: run_bash is not available in plan mode.", gateViolation: true };
        const proc = Bun.spawn(["bash", "-c", String(args.cmd ?? "")], { cwd: ctx.sandbox, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, stdout: "pipe", stderr: "pipe" });
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        await proc.exited;
        return { result: `$ ${args.cmd}\n${(out + err).slice(0, MAX_TOOL_OUTPUT)}` };
      }
      default:
        return { result: `ERROR: unknown tool ${name}` };
    }
  } catch (e) {
    return { result: `ERROR: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type OllamaLoopResult = {
  output: string;            // final assistant content (the contract JSON)
  writtenFiles: string[];
  iterations: number;
  gateViolation: boolean;    // a write/bash was attempted in plan phase
  error?: string;
};

/**
 * Run the agentic tool loop. phase "plan" registers READ tools only (write-incapable);
 * phase "implement" adds WRITE tools (sandbox-confined). The loop ends when the model
 * stops emitting tool_calls (final content) or hits MAX_ITERS.
 */
export async function runOllamaAgentLoop(opts: {
  modelId: string; system: string; brief: string; phase: "plan" | "implement";
  worktree: string; sandbox: string; timeoutMs: number;
}): Promise<OllamaLoopResult> {
  const writeAllowed = opts.phase === "implement";
  const tools = writeAllowed ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
  const ctx: ToolCtx = { worktree: opts.worktree, sandbox: opts.sandbox, writeAllowed, written: new Set() };
  fs.mkdirSync(opts.sandbox, { recursive: true });

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.brief },
  ];
  let gateViolation = false;
  const deadline = Date.now() + opts.timeoutMs;

  for (let i = 1; i <= MAX_ITERS; i++) {
    if (Date.now() > deadline) return { output: "", writtenFiles: [...ctx.written], iterations: i, gateViolation, error: "ollama loop timeout" };
    let msg: any;
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: opts.modelId, messages, tools, stream: false }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if (!resp.ok) return { output: "", writtenFiles: [...ctx.written], iterations: i, gateViolation, error: `ollama HTTP ${resp.status}` };
      msg = (await resp.json()).message;
    } catch (e) {
      return { output: "", writtenFiles: [...ctx.written], iterations: i, gateViolation, error: `ollama: ${e instanceof Error ? e.message : String(e)}` };
    }
    messages.push(msg);
    const toolCalls = msg?.tool_calls ?? [];
    if (!toolCalls.length) {
      return { output: String(msg?.content ?? ""), writtenFiles: [...ctx.written], iterations: i, gateViolation };
    }
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      const args = (typeof tc.function?.arguments === "string" ? safeJson(tc.function.arguments) : tc.function?.arguments) ?? {};
      const { result, gateViolation: gv } = await executeTool(name, args, ctx);
      if (gv) gateViolation = true;
      messages.push({ role: "tool", tool_name: name, content: result });
    }
  }
  return { output: "", writtenFiles: [...ctx.written], iterations: MAX_ITERS, gateViolation, error: `ollama loop exceeded ${MAX_ITERS} iterations` };
}

function safeJson(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }
