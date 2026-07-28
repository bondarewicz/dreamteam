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
import { ProvidersPage, PingResultFragment } from "../views/Providers.ts";
import { getAvailableModels } from "../models-api.ts";
import { checkProviders, type ProviderId } from "../../../scripts/doctor.ts";
import { pingProvider } from "../../../scripts/provider-ping.ts";
import { readConfig } from "../../../scripts/paths.ts";
import { readModelSpec, setModelBlock } from "../../../scripts/frontmatter.ts";
import { renderModelSpecYaml, PROVIDERS, TIERS, type ModelSpec, type Provider, type Tier } from "../../../scripts/model-tiers.ts";

const KNOWN_PROVIDER_IDS: ProviderId[] = ["claude", "ollama", "codex"];

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

function loadRows(): AgentModelRow[] {
  return listAgentFiles().map((fname) => {
    const agent = fname.replace(/\.md$/, "");
    const spec = readModelSpec(fs.readFileSync(path.join(AGENTS_DIR, fname), "utf-8"));
    return { agent, spec };
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

/** GET /admin/providers — doctor-in-the-browser (read-only reachability). */
export async function adminProvidersHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  const checks = await checkProviders();
  const cfg = readConfig();
  const manifest = { present: !!cfg, count: cfg?.installed.length ?? 0 };
  const body = ProvidersPage(checks, manifest);
  return html(maybeLayout(req, "Providers", body, "/admin/models"));
}

/** POST /admin/providers/test — live round-trip probe for one provider (htmx fragment). */
export async function adminProvidersTestHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  let provider = "", model: string | undefined;
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { provider?: string; model?: string };
      provider = (body.provider ?? "").trim();
      model = body.model?.trim() || undefined;
    } else {
      const params = new URLSearchParams(await req.text());
      provider = (params.get("provider") ?? "").trim();
      model = params.get("model")?.trim() || undefined;
    }
  } catch { /* fall through to validation */ }

  if (!KNOWN_PROVIDER_IDS.includes(provider as ProviderId)) {
    return html(`<span class="ping-badge ping-err">live ✗</span> <span class="ping-fail">unknown provider: ${provider.replace(/[<>&]/g, "")}</span>`, 400);
  }

  const result = await pingProvider(provider as ProviderId, model);
  return html(PingResultFragment(result));
}

/** Validate a single pin model id — bare token, no whitespace/slashes. */
function validatePin(value: string): { ok: true } | { ok: false; reason: string } {
  if (value.length > 100) return { ok: false, reason: "value too long" };
  if (/\s/.test(value)) return { ok: false, reason: "must not contain whitespace" };
  if (!/^[a-zA-Z0-9._:\-]+$/.test(value)) return { ok: false, reason: "invalid characters (bare model id only)" };
  return { ok: true };
}

/** Build a ModelSpec for an agent from the submitted tier__/provider__/pin__ fields. */
function specFromForm(agent: string, fields: URLSearchParams): { spec: ModelSpec } | { error: string } {
  const tierRaw = (fields.get(`tier__${agent}`) ?? "deep").trim();
  if (!(TIERS as readonly string[]).includes(tierRaw)) return { error: `invalid tier '${tierRaw}'` };
  const pin: Partial<Record<Provider, string>> = {};
  for (const p of PROVIDERS) {
    const v = (fields.get(`pin__${agent}__${p}`) ?? "").trim();
    if (!v) continue; // empty = tier default
    const valid = validatePin(v);
    if (!valid.ok) return { error: `${p} pin: ${valid.reason}` };
    pin[p] = v;
  }
  // Active provider — the one this agent runs on. claude (or unset) = default, omitted from frontmatter.
  const provRaw = (fields.get(`provider__${agent}`) ?? "claude").trim();
  if (!(PROVIDERS as readonly string[]).includes(provRaw)) return { error: `invalid provider '${provRaw}'` };
  const provider = provRaw === "claude" ? undefined : (provRaw as Provider);
  return { spec: provider ? { tier: tierRaw as Tier, pin, provider } : { tier: tierRaw as Tier, pin } };
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

/** POST /admin/models — write each agent's nested model block (tier + pins). */
export async function adminModelsSaveHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  let fields: URLSearchParams;
  try {
    fields = new URLSearchParams(await req.text());
  } catch (err) {
    return renderFlash(req, { kind: "error", message: `Could not parse request body: ${err instanceof Error ? err.message : String(err)}` });
  }

  const agentFiles = new Map(listAgentFiles().map((f) => [f.replace(/\.md$/, ""), f] as const));
  const changes: string[] = [];

  for (const [agent, fname] of agentFiles) {
    if (!fields.has(`tier__${agent}`)) continue; // agent not in this form submission
    const built = specFromForm(agent, fields);
    if ("error" in built) return renderFlash(req, { kind: "error", message: `${agent}: ${built.error}` });

    const filePath = path.join(AGENTS_DIR, fname);
    const content = fs.readFileSync(filePath, "utf-8");
    const before = renderModelSpecYaml(readModelSpec(content));
    const afterYaml = renderModelSpecYaml(built.spec);
    if (before === afterYaml) continue; // unchanged

    fs.writeFileSync(filePath, setModelBlock(content, afterYaml), "utf-8");
    const pinStr = Object.entries(built.spec.pin).map(([p, m]) => `${p}=${m}`).join(",");
    changes.push(`${agent}: ${built.spec.tier}${pinStr ? ` (${pinStr})` : ""}`);
  }

  if (changes.length === 0) {
    return renderFlash(req, { kind: "success", message: "No changes — all agents already match the submitted specs." });
  }

  return renderFlash(req, {
    kind: "success",
    message: `Saved ${changes.length} agent spec(s): ${changes.join("; ")}. Next: run \`bun scripts/install.ts\` to sync into ~/.claude/ (renders the flat Claude model), and \`bun scripts/build-site.ts\` to refresh the site.`,
  });
}

