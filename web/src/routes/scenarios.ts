/**
 * Scenario browser and editor routes
 *
 * GET  /scenarios                              — list all scenarios
 * GET  /scenarios/:agent/:scenarioId           — edit form
 * POST /api/scenarios/:agent/:scenarioId       — save
 * POST /api/scenarios/:agent/:scenarioId/validate — validate only (htmx)
 */

import path from "path";
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { Layout, maybeLayout } from "../views/Layout.ts";
import { esc } from "../views/html.ts";
import {
  ScenariosListPage,
  ScenarioEditPage,
  ValidationResultFragment,
  SaveSuccessPage,
  GraderPreviewFragment,
  KNOWN_GRADER_TYPES,
  KNOWN_CATEGORIES,
  type ParsedScenario,
  type Grader,
  type ValidationIssue,
  type ScenarioListItem,
} from "../views/Scenarios.ts";
import { generateGraders } from "../grader-generator.ts";
import { getActiveRun, startEvalRun } from "../sse.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const REPO_ROOT = path.join(import.meta.dir, "../../..");
const EVALS_DIR = path.join(REPO_ROOT, "evals");

function scenarioPath(agent: string, scenarioId: string): string {
  return path.join(EVALS_DIR, agent, `${scenarioId}.md`);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Strip exactly 2-space YAML block indent from a block literal value.
 * indentBlock always adds 2 spaces; dedentBlock always removes exactly 2 spaces.
 * This ensures idempotent round-trips: parse → serialize → parse yields the same content.
 */
function dedentBlock(block: string): string {
  // Always strip exactly 2-space YAML block indent (what the serializer adds)
  return block.split("\n").map(line => {
    if (line.startsWith("  ")) return line.slice(2);
    return line;
  }).join("\n").trim();
}

/**
 * Extract a multi-line block field value (after `name: |`).
 * Uses the same boundary terminator logic as the eval runner.
 */
function extractBlock(content: string, name: string): string {
  const startRe = new RegExp(`^${name}:\\s*\\|?\\s*\\n`, "m");
  const startMatch = startRe.exec(content);
  if (!startMatch) return "";
  const afterField = content.slice(startMatch.index + startMatch[0].length);
  const nextFieldRe = /\n[a-zA-Z_][a-zA-Z0-9_]*:\s/;
  const nextField = nextFieldRe.exec(afterField);
  const block = nextField ? afterField.slice(0, nextField.index) : afterField;
  return dedentBlock(block.replace(/\n$/, ""));
}

/**
 * Extract the prompt using its specific terminators (matches eval-run.sh).
 */
function extractPrompt(content: string): string {
  const startRe = /^prompt:\s*\|?\s*\n/m;
  const startMatch = startRe.exec(content);
  if (!startMatch) return "";
  const afterPrompt = content.slice(startMatch.index + startMatch[0].length);
  const terminators = /\n(?:expected_behavior|failure_modes|scoring_rubric|graders|category|reference_output):\s/;
  const termMatch = terminators.exec(afterPrompt);
  const block = termMatch ? afterPrompt.slice(0, termMatch.index) : afterPrompt;
  return dedentBlock(block.replace(/\n$/, ""));
}

/**
 * Extract simple single-line field value.
 */
function extractLine(content: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(\\S.*)$`, "m");
  const m = re.exec(content);
  return m ? m[1].trim() : "";
}

/**
 * Extract the ## Overview block (before the --- separator).
 */
function extractOverview(content: string): string {
  const m = /^## Overview\s*\n(.*?)(?=\n---)/ms.exec(content);
  if (!m) return "";
  return m[1].trim();
}

/**
 * Extract title (first # line).
 */
function extractTitle(content: string): string {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim() : "";
}

/**
 * Parse YAML-ish graders block into structured objects.
 * The format is:
 *   graders:
 *     - type: json_valid
 *     - type: json_field
 *       path: "foo"
 *       min_items: 4
 */
function parseGraders(content: string): Grader[] {
  // Check for empty graders: []
  if (/^graders:\s*\[\s*\]/m.test(content)) return [];

  // Extract everything after "graders:" until the next top-level field
  const graderStartRe = /^graders:\s*\n/m;
  const graderStart = graderStartRe.exec(content);
  if (!graderStart) return [];
  const afterGraders = content.slice(graderStart.index + graderStart[0].length);
  const nextFieldRe = /\n[a-zA-Z_][a-zA-Z0-9_]*:\s/;
  const nextField = nextFieldRe.exec(afterGraders);
  const block = nextField ? afterGraders.slice(0, nextField.index) : afterGraders;
  if (!block.trim()) return [];

  const graders: Grader[] = [];

  // Split block into individual grader entries by the "  - type:" delimiter
  const items = block.split(/(?=^  - type:)/m).filter(s => s.trim());

  for (const item of items) {
    const typeMatch = /^  - type:\s*(\S+)/m.exec(item);
    if (!typeMatch) continue;
    const type = typeMatch[1].trim();
    const grader: Grader = { type };

    // Parse additional properties (key: value lines with at least 4 spaces indent)
    const propRe = /^    ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/gm;
    let prop;
    while ((prop = propRe.exec(item)) !== null) {
      const key = prop[1];
      const rawVal = prop[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      // Try to coerce to number
      const num = Number(rawVal);
      grader[key] = rawVal !== "" && !isNaN(num) && rawVal !== "true" && rawVal !== "false"
        ? num
        : rawVal;
    }

    graders.push(grader);
  }

  return graders;
}

export function parseScenario(content: string): ParsedScenario {
  return {
    title: extractTitle(content),
    overview: extractOverview(content),
    category: extractLine(content, "category"),
    graders: parseGraders(content),
    prompt: extractPrompt(content),
    reference_output: extractBlock(content, "reference_output"),
    expected_behavior: extractBlock(content, "expected_behavior"),
    failure_modes: extractBlock(content, "failure_modes"),
    scoring_rubric: extractBlock(content, "scoring_rubric"),
  };
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Serialize a grader back to YAML-ish indented format.
 */
function serializeGrader(g: Grader): string {
  let s = `  - type: ${g.type}`;
  const skip = new Set(["type"]);
  for (const [k, v] of Object.entries(g)) {
    if (skip.has(k) || v === undefined || v === null || v === "") continue;
    const valStr = typeof v === "string" ? `"${v}"` : String(v);
    s += `\n    ${k}: ${valStr}`;
  }
  return s;
}

/**
 * Indent a block value for use after `field: |\n`.
 * Ensures every line has exactly 2 spaces of indent.
 */
function indentBlock(text: string): string {
  if (!text.trim()) return "";
  return text
    .split("\n")
    .map(line => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
}

/**
 * Serialize a ParsedScenario back to the canonical file format.
 * Field ordering matches what extract_prompt() expects.
 */
export function serializeScenario(p: ParsedScenario): string {
  const parts: string[] = [];

  // Title
  parts.push(`# ${p.title}`);
  parts.push("");

  // Overview
  parts.push("## Overview");
  parts.push("");
  if (p.overview.trim()) {
    parts.push(p.overview.trim());
    parts.push("");
  }

  // Separator
  parts.push("---");
  parts.push("");

  // Category
  parts.push(`category: ${p.category}`);
  parts.push("");

  // Graders
  if (p.graders.length === 0) {
    parts.push("graders: []");
  } else {
    parts.push("graders:");
    parts.push(p.graders.map(serializeGrader).join("\n"));
  }
  parts.push("");

  // Prompt
  const promptLines = p.prompt.trim();
  if (promptLines) {
    parts.push("prompt: |");
    parts.push(indentBlock(promptLines));
    parts.push("");
  }

  // Reference Output (optional)
  if (p.reference_output.trim()) {
    parts.push("reference_output: |");
    parts.push(indentBlock(p.reference_output.trim()));
    parts.push("");
  }

  // Expected Behavior
  if (p.expected_behavior.trim()) {
    parts.push("expected_behavior: |");
    parts.push(indentBlock(p.expected_behavior.trim()));
    parts.push("");
  }

  // Failure Modes
  if (p.failure_modes.trim()) {
    parts.push("failure_modes: |");
    parts.push(indentBlock(p.failure_modes.trim()));
    parts.push("");
  }

  // Scoring Rubric
  if (p.scoring_rubric.trim()) {
    parts.push("scoring_rubric: |");
    parts.push(indentBlock(p.scoring_rubric.trim()));
    parts.push("");
  }

  // LF line endings, single trailing newline
  return parts.join("\n").replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
}

// ── Validation ───────────────────────────────────────────────────────────────

const TITLE_RE = /^Eval:\s+\S.*—\s+Scenario\s+\d+\s+—\s+.+\(.+\)\s*$/;
const FIELD_BOUNDARY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*:\s/;

export function validateScenario(p: ParsedScenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Block: empty prompt
  if (!p.prompt.trim()) {
    issues.push({ level: "error", message: "Prompt is empty — save blocked." });
  }

  // Block: invalid grader types
  for (const g of p.graders) {
    if (!g.type || !KNOWN_GRADER_TYPES.includes(g.type as typeof KNOWN_GRADER_TYPES[number])) {
      issues.push({ level: "error", message: `Unknown grader type: "${g.type}" — save blocked. Must be one of: ${KNOWN_GRADER_TYPES.join(", ")}` });
    }
  }

  // Block: non-numeric values for numeric grader properties
  const numericProps = ["min_items", "max_items", "min", "max", "expected_count"];
  for (const g of p.graders) {
    for (const prop of numericProps) {
      if (g[prop] !== undefined && g[prop] !== "") {
        const asNum = Number(g[prop]);
        if (isNaN(asNum)) {
          issues.push({ level: "error", message: `Grader (${g.type}) property "${prop}" must be a number, got: "${g[prop]}"` });
        }
      }
    }
  }

  // Warn: title format
  if (!TITLE_RE.test(p.title)) {
    issues.push({ level: "warn", message: `Title format mismatch. Expected: "Eval: {Agent} — Scenario {N} — {Name} ({Type})" with em dashes. Got: "${p.title}"` });
  }

  // Warn: unknown category
  if (p.category && !KNOWN_CATEGORIES.includes(p.category as typeof KNOWN_CATEGORIES[number])) {
    issues.push({ level: "warn", message: `Unknown category: "${p.category}". Known: ${KNOWN_CATEGORIES.join(", ")}` });
  }

  // Warn: missing rubric sub-sections
  const rubric = p.scoring_rubric;
  if (rubric.trim()) {
    if (!/^\s*pass:/m.test(rubric)) issues.push({ level: "warn", message: "Scoring rubric missing 'pass:' sub-section." });
    if (!/^\s*partial:/m.test(rubric)) issues.push({ level: "warn", message: "Scoring rubric missing 'partial:' sub-section." });
    if (!/^\s*fail:/m.test(rubric)) issues.push({ level: "warn", message: "Scoring rubric missing 'fail:' sub-section." });
  }

  // Warn: field boundary violations in content fields
  const contentFields: Array<[string, string]> = [
    ["prompt", p.prompt],
    ["expected_behavior", p.expected_behavior],
    ["failure_modes", p.failure_modes],
    ["scoring_rubric", p.scoring_rubric],
    ["reference_output", p.reference_output],
  ];
  for (const [fieldName, fieldValue] of contentFields) {
    const lines = fieldValue.split("\n");
    for (const line of lines) {
      // Look for unindented lines that match the field boundary pattern
      if (FIELD_BOUNDARY_RE.test(line) && !/^\s/.test(line)) {
        issues.push({ level: "warn", message: `Field "${fieldName}" contains a line that looks like a top-level field boundary: "${line.slice(0, 80)}"` });
        break; // one warning per field is enough
      }
    }
  }

  return issues;
}

// ── Form parsing ─────────────────────────────────────────────────────────────

/**
 * Parse graders from form data (grader_type_N, grader_prop_N_propname, grader_count).
 * Scans all param keys matching grader_type_* to handle sparse indices (e.g. when
 * a user rejects a grader that is not the last one, accepted graders at higher indices
 * would be silently dropped if we only iterated 0..count-1).
 */
function parseGradersFromForm(params: URLSearchParams): Grader[] {
  const graders: Grader[] = [];

  // Find all grader type entries (handles sparse indices from accept/reject)
  const indices: number[] = [];
  for (const key of params.keys()) {
    const m = key.match(/^grader_type_(\d+)$/);
    if (m) indices.push(parseInt(m[1], 10));
  }
  indices.sort((a, b) => a - b);

  for (const idx of indices) {
    const type = params.get(`grader_type_${idx}`);
    if (!type) continue;
    const g: Grader = { type };

    // Collect all props for this index
    const prefix = `grader_prop_${idx}_`;
    for (const [key, val] of params.entries()) {
      if (key.startsWith(prefix)) {
        const prop = key.slice(prefix.length);
        const num = Number(val);
        g[prop] = val !== "" && !isNaN(num) ? num : val;
      }
    }

    graders.push(g);
  }

  return graders;
}

async function parseFormBody(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  return new URLSearchParams(text);
}

function parsedFromForm(params: URLSearchParams): ParsedScenario {
  return {
    title: params.get("title") ?? "",
    overview: params.get("overview") ?? "",
    category: params.get("category") ?? "",
    graders: parseGradersFromForm(params),
    prompt: params.get("prompt") ?? "",
    reference_output: params.get("reference_output") ?? "",
    expected_behavior: params.get("expected_behavior") ?? "",
    failure_modes: params.get("failure_modes") ?? "",
    scoring_rubric: params.get("scoring_rubric") ?? "",
  };
}

// ── List helpers ─────────────────────────────────────────────────────────────

/**
 * Parse just enough from a scenario file for the list view.
 */
function parseScenarioListItem(agent: string, scenarioId: string): ScenarioListItem {
  try {
    const content = readFileSync(scenarioPath(agent, scenarioId), "utf-8");
    const titleLine = extractTitle(content);
    // Extract name from title: "Eval: {Agent} — Scenario {N} — {Name} ({Type})"
    const nameMatch = /—\s+(.+?)(?:\s+\((.+?)\))?\s*$/.exec(titleLine);
    const name = nameMatch ? nameMatch[1].trim() : titleLine;
    const type = nameMatch?.[2] ?? "";
    const category = extractLine(content, "category");
    return { agent, scenarioId, title: name, category, type };
  } catch {
    return { agent, scenarioId, title: scenarioId, category: "", type: "" };
  }
}

function loadScenarioListGroups(
  filterAgent?: string
): Array<{ agent: string; scenarios: ScenarioListItem[] }> {
  const groups: Array<{ agent: string; scenarios: ScenarioListItem[] }> = [];
  try {
    const entries = readdirSync(EVALS_DIR, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "results" || entry.name.startsWith(".")) continue;
      if (filterAgent && entry.name !== filterAgent) continue;

      const agent = entry.name;
      const agentDir = path.join(EVALS_DIR, agent);
      const scenarios: ScenarioListItem[] = [];

      try {
        const files = readdirSync(agentDir);
        for (const f of files.sort()) {
          if (f.startsWith("scenario-") && f.endsWith(".md")) {
            const scenarioId = f.replace(/\.md$/, "");
            scenarios.push(parseScenarioListItem(agent, scenarioId));
          }
        }
      } catch {
        // skip
      }

      if (scenarios.length > 0) {
        groups.push({ agent, scenarios });
      }
    }
  } catch {
    // evals dir missing
  }
  return groups;
}

// ── Route handlers ────────────────────────────────────────────────────────────

/** GET /scenarios */
export function scenariosListHandler(req: Request, _params: Record<string, string>): Response {
  const url = new URL(req.url);
  const filterAgent = url.searchParams.get("agent") ?? "";
  const groups = loadScenarioListGroups();
  const body = ScenariosListPage(groups, filterAgent);
  return html(maybeLayout(req, "Scenarios", body, "/scenarios"));
}

/** GET /scenarios/:agent/:scenarioId */
export function scenarioEditHandler(req: Request, params: Record<string, string>): Response {
  const { agent, scenarioId } = params;
  if (!agent || !scenarioId) return html("Not Found", 404);

  // Prevent path traversal
  if (agent.includes("..") || scenarioId.includes("..") || agent.includes("/") || scenarioId.includes("/")) {
    return html("Bad Request", 400);
  }

  let content: string;
  try {
    content = readFileSync(scenarioPath(agent, scenarioId), "utf-8");
  } catch {
    return html(Layout("Not Found", `<div class="empty-state">Scenario not found: ${esc(agent)}/${esc(scenarioId)}</div>`), 404);
  }

  const parsed = parseScenario(content);
  const url = new URL(req.url);
  const savedFlash = url.searchParams.get("saved") === "1";
  // Show existing issues on load; suppress on fresh save to avoid confusion
  const issues = savedFlash ? [] : validateScenario(parsed);
  const body = ScenarioEditPage(agent, scenarioId, parsed, issues, savedFlash);
  return html(maybeLayout(req, `${scenarioId} — ${agent}`, body, "/scenarios"));
}

/** POST /api/scenarios/:agent/:scenarioId/validate — htmx fragment */
export async function scenarioValidateHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, scenarioId } = params;
  if (!agent || !scenarioId) return html("Bad Request", 400);

  const formParams = await parseFormBody(req);
  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed);
  return html(ValidationResultFragment(issues));
}

/** POST /api/scenarios/:agent/:scenarioId — save */
export async function scenarioSaveHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, scenarioId } = params;
  if (!agent || !scenarioId) return html("Bad Request", 400);

  // Path traversal guard
  if (agent.includes("..") || scenarioId.includes("..") || agent.includes("/") || scenarioId.includes("/")) {
    return html("Bad Request", 400);
  }

  const formParams = await parseFormBody(req);
  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed);

  // Block if there are errors
  const hasErrors = issues.some(i => i.level === "error");
  if (hasErrors) {
    // Re-render edit page with validation issues shown
    const body = ScenarioEditPage(agent, scenarioId, parsed, issues);
    return html(maybeLayout(req, `${scenarioId} — ${agent}`, body, "/scenarios"));
  }

  // Serialize and write
  const serialized = serializeScenario(parsed);

  try {
    writeFileSync(scenarioPath(agent, scenarioId), serialized, "utf-8");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorIssues: ValidationIssue[] = [
      { level: "error", message: `Failed to write file: ${errMsg}` },
    ];
    const body = ScenarioEditPage(agent, scenarioId, parsed, errorIssues);
    return html(maybeLayout(req, `${scenarioId} — ${agent}`, body, "/scenarios"), 500);
  }

  // On success, redirect back to edit page with a success flash
  // Use redirect so the user gets a clean form from the saved file
  return new Response(null, {
    status: 302,
    headers: { Location: `/scenarios/${encodeURIComponent(agent)}/${encodeURIComponent(scenarioId)}?saved=1` },
  });
}

/** POST /api/scenarios/:agent/:scenarioId/generate-graders — htmx fragment */
export async function scenarioGenerateGradersHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, scenarioId } = params;
  if (!agent || !scenarioId) return html("Bad Request", 400);

  if (agent.includes("..") || scenarioId.includes("..") || agent.includes("/") || scenarioId.includes("/")) {
    return html("Bad Request", 400);
  }

  const formParams = await parseFormBody(req);
  const expectedBehavior = formParams.get("expected_behavior") ?? "";
  const scoringRubric = formParams.get("scoring_rubric") ?? "";

  const generated = generateGraders(expectedBehavior, scoringRubric, agent);
  return html(GraderPreviewFragment(generated));
}

/** POST /api/scenarios/:agent/:scenarioId/dry-run — save + start single-scenario eval */
export async function scenarioDryRunHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, scenarioId } = params;
  if (!agent || !scenarioId) return html("Bad Request", 400);

  if (agent.includes("..") || scenarioId.includes("..") || agent.includes("/") || scenarioId.includes("/")) {
    return html("Bad Request", 400);
  }

  // Check if a run is already in progress
  const active = getActiveRun();
  if (active && !active.done) {
    return html(`<span class="sc-dry-run-error">A run is already in progress — wait for it to finish before starting a dry run.</span>`);
  }

  // Parse and validate form data
  const formParams = await parseFormBody(req);
  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed);

  const hasErrors = issues.some(i => i.level === "error");
  if (hasErrors) {
    const errorMessages = issues
      .filter(i => i.level === "error")
      .map(i => i.message)
      .join("; ");
    return html(`<span class="sc-dry-run-error">Cannot dry run — validation errors: ${esc(errorMessages)}</span>`);
  }

  // Save the file first
  const serialized = serializeScenario(parsed);
  try {
    writeFileSync(scenarioPath(agent, scenarioId), serialized, "utf-8");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return html(`<span class="sc-dry-run-error">Failed to save file before dry run: ${esc(errMsg)}</span>`);
  }

  // Start single-scenario eval run
  try {
    await startEvalRun({
      agents: [agent],
      scenarios: [`${agent}/${scenarioId}`],
      trials: 1,
      parallel: 1,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return html(`<span class="sc-dry-run-error">Failed to start dry run: ${esc(errMsg)}</span>`);
  }

  // Redirect to live view — use HX-Redirect for htmx requests, 302 for plain form submits
  const isHtmx = req.headers.get("HX-Request") === "true";
  if (isHtmx) {
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/evals/live" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: "/evals/live" },
  });
}
