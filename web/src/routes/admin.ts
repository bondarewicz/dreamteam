/**
 * Admin routes — agent model/version editor
 *
 * GET  /admin/models  -> render form pre-filled with current `model:` frontmatter
 * POST /admin/models  -> rewrite agents/<name>.md for each agent that changed.
 *                        Does NOT run scripts/install.ts — the repo is the source of
 *                        truth; syncing to ~/.claude/ is an explicit separate step
 *                        (run `bun scripts/install.ts` in a terminal when ready).
 */
import path from "path";
import fs from "fs";
import { Layout, maybeLayout } from "../views/Layout.ts";
import { AdminModelsPage, type AgentModelRow, type FlashMessage } from "../views/Admin.ts";
import { getAvailableModels } from "../models-api.ts";

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const REPO_ROOT = path.join(import.meta.dir, "../../../");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");

/** List of canonical agents (directory scan). */
function listAgentFiles(): string[] {
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/** Read the `model:` frontmatter value from an agent file, or "" if missing. */
function readAgentModel(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/^model:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function loadRows(): AgentModelRow[] {
  return listAgentFiles().map((fname) => {
    const agent = fname.replace(/\.md$/, "");
    const model = readAgentModel(path.join(AGENTS_DIR, fname));
    return { agent, currentModel: model };
  });
}

/** GET /admin/models */
export async function adminModelsHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  const [rows, modelsResult] = await Promise.all([
    Promise.resolve(loadRows()),
    getAvailableModels(),
  ]);
  const body = AdminModelsPage(rows, modelsResult);
  return html(maybeLayout(req, "Agent Models", body, "/admin/models"));
}

/** Rewrite the `model:` line (or insert after `name:`) in an agent file. */
function writeAgentModel(filePath: string, newModel: string): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const modelLineRe = /^model:\s*.+$/m;
  let next: string;
  if (modelLineRe.test(content)) {
    next = content.replace(modelLineRe, `model: ${newModel}`);
  } else {
    // Insert a model line after the first `name:` line within the frontmatter.
    next = content.replace(/^name:\s*.+$/m, (m) => `${m}\nmodel: ${newModel}`);
  }
  fs.writeFileSync(filePath, next, "utf-8");
}

/** Validate a model string — reject empty, multi-line, or obviously malformed input. */
function validateModelValue(value: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: "model cannot be empty" };
  if (/\s/.test(trimmed)) return { ok: false, reason: "model must not contain whitespace" };
  if (trimmed.length > 100) return { ok: false, reason: "model value too long" };
  // Allow identifiers like `claude-opus-4-7`, `opus`, `opusplan`, `claude-sonnet-4-5-20250929`
  if (!/^[a-zA-Z0-9._:\-\[\]]+$/.test(trimmed)) {
    return { ok: false, reason: "model contains invalid characters" };
  }
  return { ok: true };
}

async function renderFlash(req: Request, flash: FlashMessage): Promise<Response> {
  const modelsResult = await getAvailableModels();
  const body = AdminModelsPage(loadRows(), modelsResult, flash);
  const status = flash.kind === "success" ? 200 : 400;
  return new Response(
    req.headers.get("HX-Request") ? body : Layout("Agent Models", body, "/admin/models"),
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** POST /admin/models */
export async function adminModelsSaveHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  const incoming: Record<string, string> = {};

  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      for (const [k, v] of params.entries()) {
        if (k.startsWith("model__")) incoming[k.slice("model__".length)] = v;
      }
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const models = body.models;
      if (models && typeof models === "object" && !Array.isArray(models)) {
        for (const [k, v] of Object.entries(models as Record<string, unknown>)) {
          if (typeof v === "string") incoming[k] = v;
        }
      }
    }
  } catch (err) {
    return renderFlash(req, {
      kind: "error",
      message: `Could not parse request body: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const agentFiles = new Map(listAgentFiles().map((f) => [f.replace(/\.md$/, ""), f] as const));
  const changes: Array<{ agent: string; from: string; to: string }> = [];

  for (const [agent, newModel] of Object.entries(incoming)) {
    const fname = agentFiles.get(agent);
    if (!fname) {
      return renderFlash(req, { kind: "error", message: `Unknown agent: ${agent}` });
    }
    const validation = validateModelValue(newModel);
    if (!validation.ok) {
      return renderFlash(req, {
        kind: "error",
        message: `Invalid model for ${agent}: ${validation.reason}`,
      });
    }
    const filePath = path.join(AGENTS_DIR, fname);
    const current = readAgentModel(filePath);
    const trimmed = newModel.trim();
    if (current !== trimmed) {
      changes.push({ agent, from: current, to: trimmed });
    }
  }

  if (changes.length === 0) {
    return renderFlash(req, {
      kind: "success",
      message: "No changes — all agents already match the submitted models.",
    });
  }

  for (const { agent, to } of changes) {
    writeAgentModel(path.join(AGENTS_DIR, agentFiles.get(agent)!), to);
  }

  const summary = changes
    .map((c) => `${c.agent}: ${c.from || "(unset)"} → ${c.to}`)
    .join(", ");

  return renderFlash(req, {
    kind: "success",
    message: `Saved ${changes.length} agent spec(s) to agents/*.md: ${summary}. Next: run \`bun scripts/install.ts\` to sync into ~/.claude/, and \`bun scripts/build-site.ts\` to refresh site/index.html.`,
  });
}

