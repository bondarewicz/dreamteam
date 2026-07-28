/**
 * provider-ping.ts — live connectivity probe per provider, for the interactive
 * "Test live" button on /admin/providers.
 *
 * Unlike scripts/doctor.ts (which only checks "binary present / port open / auth
 * file exists"), this does a real round-trip: send a trivial prompt and confirm
 * the model actually answers. That proves auth AND inference, not just presence.
 *
 * Invocation shapes mirror evals/src/provider-backends.ts exactly (so a passing
 * ping means evals on that provider will work) — minus the agent system prompt
 * and schema, which a connectivity check doesn't need.
 *
 * Cost: Claude uses `haiku` + a one-word prompt (negligible Max usage, but real).
 * Ollama/Codex are local / subscription.
 */
import path from "path";
import os from "os";
import fs from "fs";
import type { ProviderId } from "./doctor.ts";

const OLLAMA_URL = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";
const PING_PROMPT = "Reply with exactly one word: READY. No punctuation, no explanation.";

export type PingResult = {
  provider: ProviderId;
  ok: boolean;
  /** Model actually used (resolved default for Ollama). */
  model: string;
  latencyMs: number;
  /** Trimmed, truncated model response. */
  response: string;
  tokens?: number;
  costUsd?: number;
  error?: string;
};

const ok = (r: string) => /ready/i.test(r);
const snip = (s: string) => s.trim().slice(0, 200);

async function pingClaude(model: string, timeoutMs: number): Promise<PingResult> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(["claude", "-p", PING_PROMPT, "--model", model, "--output-format", "json"], { stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    let response = "", costUsd: number | undefined, tokens: number | undefined;
    try {
      const j = JSON.parse(out) as { result?: string; total_cost_usd?: number; usage?: Record<string, number> };
      response = String(j.result ?? "").trim();
      costUsd = j.total_cost_usd;
      const u = j.usage ?? {};
      tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    } catch { response = out.trim(); }
    return { provider: "claude", ok: code === 0 && ok(response), model, latencyMs: Date.now() - start, response: snip(response), tokens, costUsd, error: code !== 0 ? `claude exit ${code}` : (ok(response) ? undefined : "unexpected response") };
  } catch (e) {
    return { provider: "claude", ok: false, model, latencyMs: Date.now() - start, response: "", error: e instanceof Error ? e.message : String(e) };
  }
}

async function pingOllama(model: string | undefined, timeoutMs: number): Promise<PingResult> {
  const start = Date.now();
  if (!model) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { models?: Array<{ name?: string }> };
      model = (j.models?.[0]?.name ?? "").replace(/:latest$/, "");
    } catch { /* leave undefined */ }
  }
  if (!model) return { provider: "ollama", ok: false, model: "", latencyMs: Date.now() - start, response: "", error: "no model pulled / not reachable on :11434" };
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: PING_PROMPT }], stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await resp.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; error?: string };
    const response = (j.message?.content ?? "").trim();
    return { provider: "ollama", ok: resp.ok && ok(response), model, latencyMs: Date.now() - start, response: snip(response), tokens: (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0), error: resp.ok ? (j.error ? `ollama: ${j.error}` : (ok(response) ? undefined : "unexpected response")) : `ollama HTTP ${resp.status}` };
  } catch (e) {
    return { provider: "ollama", ok: false, model, latencyMs: Date.now() - start, response: "", error: e instanceof Error ? e.message : String(e) };
  }
}

async function pingCodex(model: string, timeoutMs: number): Promise<PingResult> {
  const start = Date.now();
  const outFile = path.join(os.tmpdir(), `dt-ping-codex-${start}.out`);
  try {
    const proc = Bun.spawn(["codex", "exec", "-", "-m", model, "--output-last-message", outFile, "--sandbox", "read-only", "--skip-git-repo-check"], { stdin: new TextEncoder().encode(PING_PROMPT), stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => { try { proc.kill(); } catch { /* dead */ } }, timeoutMs);
    const [, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(t);
    let response = "";
    try { response = fs.readFileSync(outFile, "utf-8").trim(); } catch { /* no message */ }
    return { provider: "codex", ok: code === 0 && ok(response), model, latencyMs: Date.now() - start, response: snip(response), error: code !== 0 ? `codex exit ${code}` : (response ? (ok(response) ? undefined : "unexpected response") : "empty last message") };
  } catch (e) {
    return { provider: "codex", ok: false, model, latencyMs: Date.now() - start, response: "", error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
  }
}

/** Default model per provider for the connectivity check. */
export const PING_DEFAULTS: Record<ProviderId, string> = {
  claude: "haiku", // cheapest; keeps Max cost negligible
  ollama: "",      // resolved to first pulled model at call time
  codex: "gpt-5.5",
};

/** Live round-trip probe. Never throws — failures come back as { ok:false, error }. */
export async function pingProvider(id: ProviderId, model?: string, timeoutMs = 45000): Promise<PingResult> {
  const m = model?.trim() || PING_DEFAULTS[id];
  switch (id) {
    case "claude": return pingClaude(m, timeoutMs);
    case "ollama": return pingOllama(m || undefined, timeoutMs);
    case "codex": return pingCodex(m, timeoutMs);
  }
}
