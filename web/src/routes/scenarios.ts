/**
 * Scenario browser and editor routes
 *
 * GET  /scenarios                              — list all scenarios
 * GET  /scenarios/:agent/:scenarioId           — edit form
 * POST /api/scenarios/:agent/:scenarioId       — save
 * POST /api/scenarios/:agent/:scenarioId/validate — validate only (htmx)
 *
 * Draft lifecycle routes (registered BEFORE generic /:agent/:scenarioId):
 * GET  /scenarios/:agent/drafts/:draftId              — draft edit page
 * POST /api/scenarios/:agent/drafts/:draftId           — save draft
 * POST /api/scenarios/:agent/drafts/:draftId/validate  — validate draft
 * POST /api/scenarios/:agent/drafts/:draftId/generate-graders — generate graders
 * POST /api/scenarios/:agent/drafts/:draftId/dry-run   — run eval on draft
 * POST /api/scenarios/:agent/drafts/:draftId/promote   — promote to production
 */

import path from "path";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { readdirSync } from "node:fs";
import { getDb } from "../db.ts";
import { Layout, maybeLayout } from "../views/Layout.ts";
import { esc } from "../views/html.ts";
import {
  ScenariosListPage,
  ScenarioEditPage,
  DraftEditPage,
  TeamScenarioEditPage,
  ScenarioNewPage,
  ScenarioGenerateFragment,
  ValidationResultFragment,
  SaveSuccessPage,
  GraderPreviewFragment,
  KNOWN_GRADER_TYPES,
  KNOWN_CATEGORIES,
  KNOWN_AGENTS,
  type ParsedScenario,
  type ParsedTeamScenario,
  type Phase,
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

function draftPath(agent: string, draftId: string): string {
  return path.join(EVALS_DIR, agent, "drafts", `${draftId}.md`);
}

/**
 * Compute the next available scenario number for an agent.
 * Scans evals/<agent>/scenario-NN-*.md, finds the max NN, returns max+1.
 * Returns 1 if no scenarios exist yet. Zero-padded to 2 digits.
 */
function computeNextScenarioNumber(agentDir: string): number {
  try {
    const files = readdirSync(agentDir);
    const nums: number[] = [];
    for (const f of files) {
      const m = /^scenario-(\d+)-.*\.md$/.exec(f);
      if (m) nums.push(parseInt(m[1], 10));
    }
    if (nums.length === 0) return 1;
    return Math.max(...nums) + 1;
  } catch {
    return 1;
  }
}

/**
 * Check whether a dry run has been completed for a given draft.
 * We look up the DB for any eval_results with the draft's temp scenario_id.
 */
function hasDryRunResult(agent: string, draftId: string): boolean {
  try {
    const db = getDb();
    const tempScenarioId = `scenario-_draft-temp-${draftId}`;
    const row = db.query(
      "SELECT COUNT(*) as c FROM eval_results WHERE agent = ? AND scenario_id = ?"
    ).get(agent, tempScenarioId) as { c: number } | null;
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Path to the dry-run content-hash sidecar file for a given draft.
 * Written at dry-run time; compared at promote time to detect post-dry-run edits
 * to eval-relevant fields only.
 */
function dryRunHashSidecarPath(agent: string, draftId: string): string {
  return path.join(EVALS_DIR, agent, "drafts", `.dryrun-${draftId}.hash`);
}

/**
 * Compute a hash of only the eval-relevant fields of a parsed scenario.
 * Changes to category, title, overview, and reference_output do NOT affect
 * eval execution or scoring and should NOT invalidate a dry run.
 */
function evalContentHash(parsed: ParsedScenario): string {
  const content = [
    parsed.prompt,
    parsed.expected_behavior,
    parsed.failure_modes,
    parsed.scoring_rubric,
    JSON.stringify(parsed.graders),
  ].join("\x00");
  return String(Bun.hash(content));
}

/**
 * Record a hash of the eval-relevant draft fields as the dry-run baseline.
 * Called after successfully saving the draft and before starting the eval.
 */
function recordDryRunHash(agent: string, draftId: string): void {
  try {
    const content = readFileSync(draftPath(agent, draftId), "utf-8");
    const parsed = parseScenario(content);
    writeFileSync(dryRunHashSidecarPath(agent, draftId), evalContentHash(parsed), "utf-8");
  } catch { /* non-fatal */ }
}

/**
 * Check if the eval-relevant fields of the draft have changed since the last dry run.
 * Returns true (allow promotion) only if a sidecar exists AND the eval content hash matches.
 * Non-eval changes (category, title, overview, reference_output) do NOT invalidate the hash.
 */
function isDryRunFresh(agent: string, draftId: string): boolean {
  try {
    const recorded = readFileSync(dryRunHashSidecarPath(agent, draftId), "utf-8").trim();
    const content = readFileSync(draftPath(agent, draftId), "utf-8");
    const parsed = parseScenario(content);
    return evalContentHash(parsed) === recorded;
  } catch {
    return false;
  }
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

/**
 * Parse a team scenario file into a ParsedTeamScenario.
 * Detects phases by scanning for phase_N_agent fields (N = 1, 2, ...).
 * Extracts per-phase and pipeline-level fields.
 */
export function parseTeamScenario(content: string): ParsedTeamScenario {
  const base: ParsedScenario = {
    title: extractTitle(content),
    overview: extractOverview(content),
    category: extractLine(content, "category"),
    graders: parseGraders(content),
    prompt: "",
    reference_output: "",
    expected_behavior: "",
    failure_modes: "",
    scoring_rubric: "",
  };

  const phases: Phase[] = [];
  let phaseNum = 1;
  while (true) {
    const agentRe = new RegExp(`^phase_${phaseNum}_agent:\\s*(\\S+)`, "m");
    const agentMatch = agentRe.exec(content);
    if (!agentMatch) break;
    const phaseAgent = agentMatch[1].trim();

    function extractPhaseBlock(field: string): string {
      const key = `phase_${phaseNum}_${field}`;
      const startRe = new RegExp(`^${key}:\\s*\\|?\\s*\\n`, "m");
      const startMatch = startRe.exec(content);
      if (!startMatch) return "";
      const after = content.slice(startMatch.index + startMatch[0].length);
      // Stop at next phase_N_ field or pipeline_ field
      const nextRe = /\n(?:phase_\d+_[a-zA-Z]|pipeline_[a-zA-Z])/;
      const nextMatch = nextRe.exec(after);
      const block = nextMatch ? after.slice(0, nextMatch.index) : after;
      return dedentBlock(block.replace(/\n$/, ""));
    }

    function extractPhaseGraders(): Grader[] {
      const key = `phase_${phaseNum}_graders`;
      // Check for empty
      const emptyRe = new RegExp(`^${key}:\\s*\\[\\s*\\]`, "m");
      if (emptyRe.test(content)) return [];
      const startRe = new RegExp(`^${key}:\\s*\\n`, "m");
      const startMatch = startRe.exec(content);
      if (!startMatch) return [];
      const after = content.slice(startMatch.index + startMatch[0].length);
      const nextRe = /\n(?:phase_\d+_[a-zA-Z]|pipeline_[a-zA-Z])/;
      const nextMatch = nextRe.exec(after);
      const block = nextMatch ? after.slice(0, nextMatch.index) : after;
      if (!block.trim()) return [];
      // Parse graders from the block — reuse existing parseGraders logic inline
      const fakeContent = `graders:\n${block}`;
      return parseGraders(fakeContent);
    }

    const phasePrompt = extractPhaseBlock("prompt");
    const phase: Phase = {
      phaseNum,
      agent: phaseAgent,
      prompt: phasePrompt,
      expectedBehavior: extractPhaseBlock("expected_behavior"),
      failureModes: extractPhaseBlock("failure_modes"),
      scoringRubric: extractPhaseBlock("scoring_rubric"),
      graders: extractPhaseGraders(),
      referenceOutput: extractPhaseBlock("reference_output"),
    };
    if (phaseAgent === "human") {
      phase.humanDecision = phasePrompt;
    }
    phases.push(phase);
    phaseNum++;
  }

  return {
    ...base,
    isTeam: true,
    phases,
    pipelineExpectedBehavior: extractBlock(content, "pipeline_expected_behavior"),
    pipelineFailureModes: extractBlock(content, "pipeline_failure_modes"),
    pipelineScoringRubric: extractBlock(content, "pipeline_scoring_rubric"),
  };
}

/**
 * Serialize a ParsedTeamScenario back to the canonical team scenario file format.
 * Preserves phase structure and pipeline-level fields.
 */
export function serializeTeamScenario(p: ParsedTeamScenario): string {
  const parts: string[] = [];

  parts.push(`# ${p.title}`);
  parts.push("");
  parts.push("## Overview");
  parts.push("");
  if (p.overview.trim()) {
    parts.push(p.overview.trim());
    parts.push("");
  }
  parts.push("---");
  parts.push("");
  parts.push(`category: ${p.category}`);
  parts.push("");

  // Top-level graders (pipeline-level graders)
  if (p.graders.length === 0) {
    parts.push("graders: []");
  } else {
    parts.push("graders:");
    parts.push(p.graders.map(serializeGrader).join("\n"));
  }
  parts.push("");
  parts.push("---");
  parts.push("");

  // Phases
  for (const phase of p.phases) {
    const pn = phase.phaseNum;
    const sectionLabels: Record<string, string> = {
      1: "Phase 1: Parallel Analysis",
      4: "Phase 4: Human Decision (Fixture)",
    };
    const sectionLabel = sectionLabels[pn] ?? `Phase ${pn}`;
    parts.push(`## ${sectionLabel}`);
    parts.push("");
    parts.push(`phase_${pn}_agent: ${phase.agent}`);
    parts.push("");
    if (phase.prompt.trim()) {
      parts.push(`phase_${pn}_prompt: |`);
      parts.push(indentBlock(phase.prompt.trim()));
      parts.push("");
    }
    if (phase.expectedBehavior.trim()) {
      parts.push(`phase_${pn}_expected_behavior: |`);
      parts.push(indentBlock(phase.expectedBehavior.trim()));
      parts.push("");
    }
    if (phase.failureModes.trim()) {
      parts.push(`phase_${pn}_failure_modes: |`);
      parts.push(indentBlock(phase.failureModes.trim()));
      parts.push("");
    }
    if (phase.scoringRubric.trim()) {
      parts.push(`phase_${pn}_scoring_rubric: |`);
      parts.push(indentBlock(phase.scoringRubric.trim()));
      parts.push("");
    }
    if (phase.graders.length === 0) {
      parts.push(`phase_${pn}_graders: []`);
    } else {
      parts.push(`phase_${pn}_graders:`);
      parts.push(phase.graders.map(serializeGrader).join("\n"));
    }
    parts.push("");
    if (phase.referenceOutput.trim()) {
      parts.push(`phase_${pn}_reference_output: |`);
      parts.push(indentBlock(phase.referenceOutput.trim()));
      parts.push("");
    }
    parts.push("---");
    parts.push("");
  }

  // Pipeline-level fields
  parts.push("## Pipeline-Level Fields");
  parts.push("");
  if (p.pipelineExpectedBehavior.trim()) {
    parts.push("pipeline_expected_behavior: |");
    parts.push(indentBlock(p.pipelineExpectedBehavior.trim()));
    parts.push("");
  }
  if (p.pipelineFailureModes.trim()) {
    parts.push("pipeline_failure_modes: |");
    parts.push(indentBlock(p.pipelineFailureModes.trim()));
    parts.push("");
  }
  if (p.pipelineScoringRubric.trim()) {
    parts.push("pipeline_scoring_rubric: |");
    parts.push(indentBlock(p.pipelineScoringRubric.trim()));
    parts.push("");
  }

  return parts.join("\n").replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
}

export function parseScenario(content: string): ParsedScenario {
  // Detect team scenarios by presence of phase_1_agent field
  if (/^phase_1_agent:\s*\S/m.test(content)) {
    return parseTeamScenario(content);
  }
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

export function validateScenario(p: ParsedScenario, isDraft = false): ValidationIssue[] {
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

  // Warn: title format (skip for drafts — they use a different title convention)
  if (!isDraft && !TITLE_RE.test(p.title)) {
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

  // Warn: field boundary violations in content fields (skip for drafts — prompts often contain "TASK:" etc.)
  if (!isDraft) {
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
    return { agent, scenarioId, title: name, category, type, kind: "production" };
  } catch {
    return { agent, scenarioId, title: scenarioId, category: "", type: "", kind: "production" };
  }
}

/**
 * Parse a draft file for the list view.
 * draftId is the filename without .md extension (e.g. "draft-2026-03-30-1900-foo")
 */
const PLACEHOLDER_TEXT = "DRAFT - Needs human review";

function parseDraftListItem(agent: string, draftId: string): ScenarioListItem {
  try {
    const content = readFileSync(draftPath(agent, draftId), "utf-8");
    const titleLine = extractTitle(content);
    // Extract name from draft title: "Eval: {Agent} — Draft — {Name} ({Type})"
    // or just use the full title if pattern doesn't match
    const nameMatch = /—\s+Draft\s+—\s+(.+?)(?:\s+\((.+?)\))?\s*$/.exec(titleLine);
    const name = nameMatch ? nameMatch[1].trim() : (titleLine || draftId);
    const type = nameMatch?.[2] ?? "";
    const category = extractLine(content, "category") || "draft";

    // Compute readiness: category set, dry run completed, no placeholder text
    const categoryReady = category !== "draft" && category !== "";
    const dryRunDone = hasDryRunResult(agent, draftId);
    const hasPlaceholder = content.includes(PLACEHOLDER_TEXT);
    const draftReady = categoryReady && dryRunDone && !hasPlaceholder;

    return { agent, scenarioId: draftId, title: name, category, type, kind: "draft", draftReady };
  } catch {
    return { agent, scenarioId: draftId, title: draftId, category: "draft", type: "", kind: "draft", draftReady: false };
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

      // Scan drafts/ subdirectory (AC-12: no error if missing)
      try {
        const draftsDir = path.join(agentDir, "drafts");
        const draftFiles = readdirSync(draftsDir);
        for (const f of draftFiles.sort()) {
          if (f.startsWith("draft-") && f.endsWith(".md")) {
            const draftId = f.replace(/\.md$/, "");
            scenarios.push(parseDraftListItem(agent, draftId));
          }
        }
      } catch {
        // drafts/ directory doesn't exist — that's fine (AC-12)
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

  const url = new URL(req.url);
  const savedFlash = url.searchParams.get("saved") === "1";

  // Detect team scenarios — route to TeamScenarioEditPage
  if (/^phase_1_agent:\s*\S/m.test(content)) {
    const parsed = parseTeamScenario(content);
    const issues: ValidationIssue[] = [];
    const body = TeamScenarioEditPage(agent, scenarioId, parsed, issues, savedFlash, false);
    return html(maybeLayout(req, `${scenarioId} — ${agent} (team)`, body, "/scenarios"));
  }

  const parsed = parseScenario(content);
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

// ── Draft route handlers ─────────────────────────────────────────────────────

/** Path traversal guard for agent/draftId params */
function isPathSafe(...parts: string[]): boolean {
  for (const p of parts) {
    if (!p || p.includes("..") || p.includes("/")) return false;
  }
  return true;
}

/** GET /scenarios/:agent/drafts/:draftId */
export function draftEditHandler(req: Request, params: Record<string, string>): Response {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Not Found", 404);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  let content: string;
  try {
    content = readFileSync(draftPath(agent, draftId), "utf-8");
  } catch {
    return html(Layout("Not Found", `<div class="empty-state">Draft not found: ${esc(agent)}/drafts/${esc(draftId)}</div>`), 404);
  }

  const url = new URL(req.url);
  const savedFlash = url.searchParams.get("saved") === "1";
  const errorParam = url.searchParams.get("error") ?? "";
  const dryRunDone = hasDryRunResult(agent, draftId);

  // Detect team scenarios — route to TeamScenarioEditPage
  if (/^phase_1_agent:\s*\S/m.test(content)) {
    const parsed = parseTeamScenario(content);
    const issues: ValidationIssue[] = savedFlash && !errorParam ? [] : [];
    if (errorParam === "nodryrun") {
      issues.push({ level: "error", message: "Promotion blocked: a dry run must be completed first." });
    } else if (errorParam === "conflict") {
      issues.push({ level: "error", message: "Promotion failed: scenario number conflict — try again." });
    }
    const body = TeamScenarioEditPage(agent, draftId, parsed, issues, savedFlash && !errorParam, dryRunDone);
    return html(maybeLayout(req, `${draftId} — ${agent} (team draft)`, body, "/scenarios"));
  }

  const parsed = parseScenario(content);
  // Build issues, possibly adding a promote-blocked error
  let issues = savedFlash && !errorParam ? [] : validateScenario(parsed, true);
  if (errorParam === "placeholder") {
    issues = [{ level: "error", message: "Promotion blocked: replace placeholder text 'DRAFT - Needs human review' before promoting." }, ...issues];
  } else if (errorParam === "category") {
    issues = [{ level: "error", message: "Promotion blocked: set a non-draft category before promoting." }, ...issues];
  } else if (errorParam === "nodryrun") {
    issues = [{ level: "error", message: "Promotion blocked: a dry run must be completed first." }, ...issues];
  } else if (errorParam === "conflict") {
    issues = [{ level: "error", message: "Promotion failed: scenario number conflict — try again." }, ...issues];
  } else if (errorParam === "stalerun") {
    issues = [{ level: "error", message: "Promotion blocked: draft was modified after dry run — re-run before promoting." }, ...issues];
  }

  const body = DraftEditPage(agent, draftId, parsed, issues, savedFlash && !errorParam, undefined, dryRunDone);
  return html(maybeLayout(req, `${draftId} — ${agent} (draft)`, body, "/scenarios"));
}

/** POST /api/scenarios/:agent/drafts/:draftId — save draft */
export async function draftSaveHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Bad Request", 400);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  // Ensure drafts directory exists
  const draftsDir = path.join(EVALS_DIR, agent, "drafts");
  mkdirSync(draftsDir, { recursive: true });

  const formParams = await parseFormBody(req);

  // Team scenario save: form will have is_team=1 and phase_count
  const isTeam = formParams.get("is_team") === "1";
  if (isTeam) {
    // Read current file to get team structure, then update from form
    let existingContent = "";
    try {
      existingContent = readFileSync(draftPath(agent, draftId), "utf-8");
    } catch { /* new file */ }
    const existingParsed = existingContent ? parseTeamScenario(existingContent) : null;
    const phaseCount = parseInt(formParams.get("phase_count") ?? "0", 10);

    // Build updated phases from form
    const updatedPhases: Phase[] = [];
    for (let pn = 1; pn <= phaseCount; pn++) {
      const phaseAgent = formParams.get(`phase_${pn}_agent`) ?? (existingParsed?.phases[pn - 1]?.agent ?? "unknown");
      const isHuman = phaseAgent === "human";
      updatedPhases.push({
        phaseNum: pn,
        agent: phaseAgent,
        prompt: formParams.get(`phase_${pn}_prompt`) ?? (existingParsed?.phases[pn - 1]?.prompt ?? ""),
        expectedBehavior: formParams.get(`phase_${pn}_expected_behavior`) ?? (existingParsed?.phases[pn - 1]?.expectedBehavior ?? ""),
        failureModes: existingParsed?.phases[pn - 1]?.failureModes ?? "",
        scoringRubric: existingParsed?.phases[pn - 1]?.scoringRubric ?? "",
        graders: existingParsed?.phases[pn - 1]?.graders ?? [],
        referenceOutput: existingParsed?.phases[pn - 1]?.referenceOutput ?? "",
        humanDecision: isHuman ? (formParams.get(`phase_${pn}_prompt`) ?? "") : undefined,
      });
    }

    const teamParsed: ParsedTeamScenario = {
      title: formParams.get("title") ?? (existingParsed?.title ?? ""),
      overview: formParams.get("overview") ?? (existingParsed?.overview ?? ""),
      category: formParams.get("category") ?? (existingParsed?.category ?? "draft"),
      graders: existingParsed?.graders ?? [],
      prompt: "",
      reference_output: "",
      expected_behavior: "",
      failure_modes: "",
      scoring_rubric: "",
      isTeam: true,
      phases: updatedPhases,
      pipelineExpectedBehavior: formParams.get("pipeline_expected_behavior") ?? (existingParsed?.pipelineExpectedBehavior ?? ""),
      pipelineFailureModes: formParams.get("pipeline_failure_modes") ?? (existingParsed?.pipelineFailureModes ?? ""),
      pipelineScoringRubric: formParams.get("pipeline_scoring_rubric") ?? (existingParsed?.pipelineScoringRubric ?? ""),
    };

    const serialized = serializeTeamScenario(teamParsed);
    try {
      writeFileSync(draftPath(agent, draftId), serialized, "utf-8");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const dryRunDone = hasDryRunResult(agent, draftId);
      const errorIssues: ValidationIssue[] = [{ level: "error", message: `Failed to write file: ${errMsg}` }];
      const body = TeamScenarioEditPage(agent, draftId, teamParsed, errorIssues, false, dryRunDone);
      return html(maybeLayout(req, `${draftId} — ${agent} (team draft)`, body, "/scenarios"), 500);
    }

    return new Response(null, {
      status: 302,
      headers: { Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?saved=1` },
    });
  }

  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed, true);
  const hasErrors = issues.some(i => i.level === "error");

  if (hasErrors) {
    const dryRunDone = hasDryRunResult(agent, draftId);
    const body = DraftEditPage(agent, draftId, parsed, issues, false, undefined, dryRunDone);
    return html(maybeLayout(req, `${draftId} — ${agent} (draft)`, body, "/scenarios"));
  }

  const serialized = serializeScenario(parsed);
  try {
    writeFileSync(draftPath(agent, draftId), serialized, "utf-8");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorIssues: ValidationIssue[] = [{ level: "error", message: `Failed to write file: ${errMsg}` }];
    const dryRunDone = hasDryRunResult(agent, draftId);
    const body = DraftEditPage(agent, draftId, parsed, errorIssues, false, undefined, dryRunDone);
    return html(maybeLayout(req, `${draftId} — ${agent} (draft)`, body, "/scenarios"), 500);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?saved=1` },
  });
}

/** POST /api/scenarios/:agent/drafts/:draftId/validate — htmx fragment */
export async function draftValidateHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Bad Request", 400);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  const formParams = await parseFormBody(req);
  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed, true);
  const hasErrors = issues.some(i => i.level === "error");

  // When validation passes (no errors), compute the suggested production title
  let suggestedTitle: string | undefined;
  if (!hasErrors) {
    const agentDir = path.join(EVALS_DIR, agent);
    const nextNum = computeNextScenarioNumber(agentDir);
    const paddedNum = String(nextNum).padStart(2, "0");
    const agentDisplay = agent.charAt(0).toUpperCase() + agent.slice(1);
    const category = parsed.category || "capability";

    // Extract name from draft title pattern: "Eval: {Agent} — Draft — {Name} ({Suffix})"
    // Strip recognized draft prefixes and suffixes to isolate the human-readable name
    let name = parsed.title;
    const draftPrefixRe = /^Eval:\s+\S.*?—\s+Draft\s+—\s+(.+)$/;
    const draftMatch = draftPrefixRe.exec(parsed.title);
    if (draftMatch) {
      name = draftMatch[1].trim();
      // Strip trailing "(Auto-captured)" suffix
      name = name.replace(/\s*\(Auto-captured\)\s*$/, "").trim();
    }

    suggestedTitle = `Eval: ${agentDisplay} — Scenario ${paddedNum} — ${name} (${category})`;
  }

  return html(ValidationResultFragment(issues, suggestedTitle));
}

/** POST /api/scenarios/:agent/drafts/:draftId/generate-graders — htmx fragment
 *
 * For team scenarios, accepts query param ?phase=N to generate graders for a specific phase.
 * Extracts phase_N_expected_behavior and phase_N_scoring_rubric from the form data,
 * and calls generateGraders with phase_N_agent as the target agent.
 */
export async function draftGenerateGradersHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Bad Request", 400);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  const url = new URL(req.url);
  const phaseParam = url.searchParams.get("phase");
  const formParams = await parseFormBody(req);

  if (phaseParam !== null) {
    // Team scenario: generate graders for a specific phase
    const pn = parseInt(phaseParam, 10);
    if (isNaN(pn) || pn < 1) return html("Bad Request — invalid phase param", 400);

    const phaseAgent = formParams.get(`phase_${pn}_agent`) ?? agent;
    const expectedBehavior = formParams.get(`phase_${pn}_expected_behavior`) ?? "";
    const scoringRubric = formParams.get(`phase_${pn}_scoring_rubric`) ?? "";

    const generated = generateGraders(expectedBehavior, scoringRubric, phaseAgent);
    return html(GraderPreviewFragment(generated));
  }

  const expectedBehavior = formParams.get("expected_behavior") ?? "";
  const scoringRubric = formParams.get("scoring_rubric") ?? "";

  const generated = generateGraders(expectedBehavior, scoringRubric, agent);
  return html(GraderPreviewFragment(generated));
}

/** POST /api/scenarios/:agent/drafts/:draftId/dry-run — save draft, temp file, start eval */
export async function draftDryRunHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Bad Request", 400);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  // Check if a run is already in progress
  const active = getActiveRun();
  if (active && !active.done) {
    return html(`<span class="sc-dry-run-error">A run is already in progress — wait for it to finish before starting a dry run.</span>`);
  }

  const formParams = await parseFormBody(req);
  const isTeam = formParams.get("is_team") === "1";

  // ── Team scenario dry run ─────────────────────────────────────────────────
  if (isTeam) {
    // Read the draft from disk (team form doesn't carry all phase data back faithfully)
    let content: string;
    try {
      content = readFileSync(draftPath(agent, draftId), "utf-8");
    } catch {
      return html(`<span class="sc-dry-run-error">Draft not found — save the draft first.</span>`);
    }

    const tempScenarioId = `scenario-_draft-temp-${draftId}`;
    const tempPath = path.join(EVALS_DIR, "team", `${tempScenarioId}.md`);
    const draftsDir = path.join(EVALS_DIR, "team", "drafts");
    mkdirSync(draftsDir, { recursive: true });

    try {
      writeFileSync(tempPath, content, "utf-8");
      await startEvalRun({
        agents: ["team"],
        scenarios: [`team/${tempScenarioId}`],
        trials: 1,
        parallel: 1,
        timeoutPerPhase: 600,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tempPath);
      } catch { /* ignore */ }
      return html(`<span class="sc-dry-run-error">Failed to start team dry run: ${esc(errMsg)}</span>`);
    }

    const activeForCleanup = getActiveRun();
    if (activeForCleanup?.proc) {
      (async () => {
        try { await activeForCleanup.proc.exited; } catch { /* ignore */ }
        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(tempPath);
        } catch { /* ignore */ }
      })();
    }

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

  // ── Standard (non-team) dry run ───────────────────────────────────────────
  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed, true);
  const hasErrors = issues.some(i => i.level === "error");

  if (hasErrors) {
    const errorMessages = issues.filter(i => i.level === "error").map(i => i.message).join("; ");
    return html(`<span class="sc-dry-run-error">Cannot dry run — validation errors: ${esc(errorMessages)}</span>`);
  }

  // BR-8: Dry run blocked if graders array is empty
  if (parsed.graders.length === 0) {
    return html(`<span class="sc-dry-run-error">Cannot dry run — no graders defined. Generate and save graders first.</span>`);
  }

  // Save the draft first
  const draftsDir = path.join(EVALS_DIR, agent, "drafts");
  mkdirSync(draftsDir, { recursive: true });
  const serialized = serializeScenario(parsed);
  try {
    writeFileSync(draftPath(agent, draftId), serialized, "utf-8");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return html(`<span class="sc-dry-run-error">Failed to save draft before dry run: ${esc(errMsg)}</span>`);
  }

  // Record a hash of eval-relevant fields at dry-run time so promote can detect post-dry-run edits.
  recordDryRunHash(agent, draftId);

  // Create a temp production path so eval-run.sh can discover it
  // Temp file format: scenario-_draft-temp-{draftId}.md
  const tempScenarioId = `scenario-_draft-temp-${draftId}`;
  const tempPath = path.join(EVALS_DIR, agent, `${tempScenarioId}.md`);

  try {
    writeFileSync(tempPath, serialized, "utf-8");

    await startEvalRun({
      agents: [agent],
      scenarios: [`${agent}/${tempScenarioId}`],
      trials: 1,
      parallel: 1,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Clean up temp file on error
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tempPath);
    } catch { /* ignore */ }
    return html(`<span class="sc-dry-run-error">Failed to start dry run: ${esc(errMsg)}</span>`);
  }

  // Capture the active run immediately (before any await) to avoid a race
  // where getActiveRun() could return null if the process exits very quickly.
  // Clean up temp file in background after eval process exits.
  const activeForCleanup = getActiveRun();
  if (activeForCleanup?.proc) {
    (async () => {
      try { await activeForCleanup.proc.exited; } catch { /* ignore */ }
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tempPath);
      } catch { /* ignore */ }
    })();
  }

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

/** POST /api/scenarios/:agent/drafts/:draftId/promote — promote draft to production */
export async function draftPromoteHandler(req: Request, params: Record<string, string>): Promise<Response> {
  const { agent, draftId } = params;
  if (!agent || !draftId) return html("Bad Request", 400);
  if (!isPathSafe(agent, draftId)) return html("Bad Request", 400);

  // Read the draft file
  let content: string;
  try {
    content = readFileSync(draftPath(agent, draftId), "utf-8");
  } catch {
    return html("Draft not found", 404);
  }

  // Detect team scenario
  const isTeamScenario = /^phase_1_agent:\s*\S/m.test(content);

  if (isTeamScenario) {
    // Team scenario promote: validate phases have prompt + expected_behavior
    const teamParsed = parseTeamScenario(content);

    // Validate all phases have prompt + expected_behavior
    const missingPhases: number[] = [];
    for (const phase of teamParsed.phases) {
      if (phase.agent !== "human" && (!phase.prompt.trim() || !phase.expectedBehavior.trim())) {
        missingPhases.push(phase.phaseNum);
      }
    }
    if (missingPhases.length > 0) {
      return html(
        `Promotion blocked: phases ${missingPhases.join(", ")} are missing prompt or expected_behavior.`,
        400
      );
    }

    // BR-3: Promotion only after a completed dry run
    if (!hasDryRunResult(agent, draftId)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=nodryrun`,
        },
      });
    }

    // Compute next scenario number in evals/team/
    const teamDir = path.join(EVALS_DIR, "team");
    mkdirSync(teamDir, { recursive: true });

    const titleLine = extractTitle(content);
    const nameMatch = /—\s+(?:Draft\s+—\s+)?(.+?)(?:\s+\((.+?)\))?\s*$/.exec(titleLine);
    const namePart = nameMatch ? nameMatch[1].trim() : (teamParsed.title || draftId);
    const slug = slugify(namePart);

    let newScenarioId: string | undefined;
    let newPath: string | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const nextNum = computeNextScenarioNumber(teamDir);
      const paddedNum = String(nextNum).padStart(2, "0");
      newScenarioId = `scenario-${paddedNum}-${slug}`;
      newPath = path.join(teamDir, `${newScenarioId}.md`);

      const updatedTitle = teamParsed.title
        .replace(/—\s*Draft\s*—/, `— Scenario ${paddedNum} —`)
        .replace(/\s+/g, " ")
        .trim();
      const updatedParsed: ParsedTeamScenario = { ...teamParsed, title: updatedTitle };
      const serialized = serializeTeamScenario(updatedParsed);

      try {
        writeFileSync(newPath, serialized, { flag: "wx" });
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EEXIST" && attempt < 2) continue;
        if (code === "EEXIST") {
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=conflict`,
            },
          });
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        return html(`Promotion failed: ${esc(errMsg)}`, 500);
      }
    }

    // Delete draft after promotion
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(draftPath(agent, draftId));
    } catch { /* non-fatal */ }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/scenarios/team/${encodeURIComponent(newScenarioId!)}?saved=1`,
      },
    });
  }

  // ── Standard (non-team) promote ───────────────────────────────────────────
  const parsed = parseScenario(content);

  // BR-7: Blocked if placeholder text remains
  const PLACEHOLDER = "DRAFT - Needs human review";
  if (
    parsed.expected_behavior.includes(PLACEHOLDER) ||
    parsed.failure_modes.includes(PLACEHOLDER) ||
    parsed.scoring_rubric.includes(PLACEHOLDER)
  ) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=placeholder`,
      },
    });
  }

  // AC-9: Promote blocked if category is still 'draft'
  if (!parsed.category || parsed.category === "draft") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=category`,
      },
    });
  }

  // BR-3: Promotion only after a completed dry run
  if (!hasDryRunResult(agent, draftId)) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=nodryrun`,
      },
    });
  }

  // BR-3 (staleness): Block if draft was edited after the dry run was performed.
  if (!isDryRunFresh(agent, draftId)) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=stalerun`,
      },
    });
  }

  // BR-5: Compute next unique scenario number
  const agentDir = path.join(EVALS_DIR, agent);

  // Derive slug from title name part
  const titleLine = extractTitle(content);
  const nameMatch = /—\s+(?:Draft\s+—\s+)?(.+?)(?:\s+\((.+?)\))?\s*$/.exec(titleLine);
  const namePart = nameMatch ? nameMatch[1].trim() : (parsed.title || draftId);
  const slug = slugify(namePart);

  // Update the title line to replace "Draft" with "Scenario {NN}" — computed per attempt
  // so that the padded number matches the actual file written.
  let newScenarioId: string | undefined;
  let newPath: string | undefined;
  let serialized: string | undefined;

  // Retry loop: handles concurrent promotions where two requests compute the same number.
  // On EEXIST, recompute the next number and try again (up to 3 attempts).
  for (let attempt = 0; attempt < 3; attempt++) {
    const nextNum = computeNextScenarioNumber(agentDir);
    const paddedNum = String(nextNum).padStart(2, "0");
    newScenarioId = `scenario-${paddedNum}-${slug}`;
    newPath = path.join(agentDir, `${newScenarioId}.md`);

    const updatedTitle = parsed.title
      .replace(/—\s*Draft\s*—/, `— Scenario ${paddedNum} —`)
      .replace(/\s+/g, " ")
      .trim();
    const updatedParsed = { ...parsed, title: updatedTitle };
    serialized = serializeScenario(updatedParsed);

    try {
      writeFileSync(newPath, serialized, { flag: "wx" });
      break; // success
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST" && attempt < 2) {
        continue; // recompute and retry
      }
      if (code === "EEXIST") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/scenarios/${encodeURIComponent(agent)}/drafts/${encodeURIComponent(draftId)}?error=conflict`,
          },
        });
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      return html(`Promotion failed: ${esc(errMsg)}`, 500);
    }
  }

  // BR-13: Delete draft after successful promotion
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(draftPath(agent, draftId));
  } catch {
    // Draft deletion failed but promotion succeeded — not fatal
  }

  // Redirect to the new production scenario
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/scenarios/${encodeURIComponent(agent)}/${encodeURIComponent(newScenarioId!)}?saved=1`,
    },
  });
}

// ── New Scenario helpers ──────────────────────────────────────────────────────

/**
 * Find the next available scenario number for an agent.
 * Reads evals/<agent>/ directory, finds all scenario-NN-*.md files,
 * returns the next available number (max existing + 1, or 1 if none).
 */
function nextScenarioNumber(agent: string): number {
  const agentDir = path.join(EVALS_DIR, agent);
  try {
    const files = readdirSync(agentDir);
    const nums: number[] = [];
    for (const f of files) {
      const m = /^scenario-(\d+)-.*\.md$/.exec(f);
      if (m) nums.push(parseInt(m[1], 10));
    }
    if (nums.length === 0) return 1;
    return Math.max(...nums) + 1;
  } catch {
    return 1;
  }
}

/**
 * Derive a URL-safe slug from a title string.
 * Lowercase, keep alphanumerics and hyphens, replace spaces with hyphens.
 * Collapse multiple hyphens, trim trailing hyphens, max 50 chars.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+$/, "")
    .slice(0, 50)
    .replace(/-+$/, "") // trim again after truncation
    || "scenario";
}

/**
 * Call Claude via the `claude` CLI to generate scenario fields from agent + description.
 * Returns a complete ParsedScenario with all fields including the actual eval prompt.
 * On error, throws with a descriptive message.
 */
async function generateScenarioFields(agent: string, description: string, nextNum: number): Promise<ParsedScenario> {
  const systemPrompt = `You are Bird, the Dream Team's domain analysis expert. Given a description of what an eval scenario should test for a specific agent, generate a complete eval scenario.
You MUST respond with ONLY valid JSON and nothing else.
Do not include markdown fences, explanations, or any text outside the JSON object.

The JSON must have exactly these fields:
{
  "title": "Eval: {Agent} — Scenario N — {Name} ({Type})",
  "overview": "Brief description of what this scenario tests",
  "prompt": "The actual eval prompt that will be fed to the agent — a realistic user request or task description that tests what the description asks for",
  "expected_behavior": "Multi-line description of what the agent should do to pass",
  "failure_modes": "Multi-line description of how the agent could fail this scenario",
  "scoring_rubric": "pass:\\n  <pass criteria>\\npartial:\\n  <partial credit criteria>\\nfail:\\n  <fail criteria>",
  "category": "one of: capability, regression, happy-path, edge-case, adversarial, draft",
  "type": "one of: Happy Path, Edge Case, Escalation Case, Negative Case, Capability, Hard, Very Hard, Expert"
}

Use em dashes (—) in the title, not regular dashes.
The scenario number N in the title MUST be ${String(nextNum).padStart(2, "0")} — this is the next available number for this agent.
Make the prompt a realistic, detailed user request that naturally tests the described scenario.
Make the expected_behavior, failure_modes, and scoring_rubric detailed and specific to the scenario.

CRITICAL: Output ONLY the raw JSON object. No markdown fences, no \`\`\`json blocks, no commentary. First character must be { and last must be }.`;

  const userMessage = `Agent: ${agent}
Description: ${description}

Generate a complete eval scenario including the actual eval prompt.`;

  const proc = Bun.spawn(
    ["claude", "-p", userMessage, "--system-prompt", systemPrompt, "--output-format", "text", "--max-turns", "1"],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  // Read stdout/stderr concurrently with process execution to avoid pipe deadlock
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => { proc.kill(); reject(new Error("Claude CLI timed out after 60s")); }, 60000)
  );
  const exitCode = await Promise.race([proc.exited, timeout]);

  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  if (exitCode !== 0) {
    throw new Error(`Claude CLI failed (exit ${exitCode}): ${stderr.slice(0, 400)}`);
  }

  // Extract JSON — try multiple strategies
  let jsonText = stdout.trim();
  // Strategy 1: strip markdown fences (complete fences)
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(jsonText);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  } else {
    // Strategy 2: find first { to last } (handles truncated fences or prose wrapping)
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse Claude response as JSON. Raw output: ${stdout.slice(0, 600)}`);
  }

  return {
    title: String(parsed.title ?? ""),
    overview: String(parsed.overview ?? ""),
    expected_behavior: String(parsed.expected_behavior ?? ""),
    failure_modes: String(parsed.failure_modes ?? ""),
    scoring_rubric: String(parsed.scoring_rubric ?? ""),
    category: String(parsed.category ?? "draft"),
    graders: [],
    prompt: String(parsed.prompt ?? ""),
    reference_output: "",
  };
}

// ── New Scenario route handlers ───────────────────────────────────────────────

/** GET /scenarios/new */
export function scenarioNewHandler(req: Request, _params: Record<string, string>): Response {
  const url = new URL(req.url);
  const agent = url.searchParams.get("agent") ?? "";
  const body = ScenarioNewPage(agent);
  return html(maybeLayout(req, "New Scenario", body, "/scenarios"));
}

/** POST /api/scenarios/generate — htmx fragment */
export async function scenarioGenerateHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  const formParams = await parseFormBody(req);
  const agent = formParams.get("agent") ?? "";
  const description = (formParams.get("description") ?? "").trim();

  // Validate inputs
  if (!agent || !KNOWN_AGENTS.includes(agent as typeof KNOWN_AGENTS[number])) {
    return html(ScenarioGenerateFragment(agent, emptyScenario(), "Please select a valid agent."));
  }
  if (!description) {
    return html(ScenarioGenerateFragment(agent, emptyScenario(), "Scenario description is required."));
  }

  let generated: ParsedScenario;
  try {
    const nextNum = nextScenarioNumber(agent);
    generated = await generateScenarioFields(agent, description, nextNum);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return html(ScenarioGenerateFragment(agent, emptyScenario(), `Generation failed: ${errMsg}`));
  }

  return html(ScenarioGenerateFragment(agent, generated));
}

function emptyScenario(): ParsedScenario {
  return {
    title: "",
    overview: "",
    category: "draft",
    graders: [],
    prompt: "",
    reference_output: "",
    expected_behavior: "",
    failure_modes: "",
    scoring_rubric: "",
  };
}

/** POST /api/scenarios/new — save new scenario */
export async function scenarioNewSaveHandler(req: Request, _params: Record<string, string>): Promise<Response> {
  const formParams = await parseFormBody(req);
  const agent = formParams.get("agent") ?? "";

  // Validate agent
  if (!agent || !KNOWN_AGENTS.includes(agent as typeof KNOWN_AGENTS[number])) {
    return html("Bad Request: invalid agent", 400);
  }

  // Path traversal guard on agent
  if (agent.includes("..") || agent.includes("/")) {
    return html("Bad Request", 400);
  }

  const parsed = parsedFromForm(formParams);
  const issues = validateScenario(parsed);
  const hasErrors = issues.some(i => i.level === "error");

  if (hasErrors) {
    // Re-render the generate fragment with errors shown
    const body = ScenarioGenerateFragment(agent, parsed);
    return html(maybeLayout(req, "New Scenario", ScenarioNewPage(agent) + body, "/scenarios"));
  }

  // Auto-generate scenarioId: next number + slug from title.
  // Use atomic 'wx' flag to prevent TOCTOU race: if two concurrent saves compute the same
  // number and both pass an existsSync check, the second would silently overwrite the first.
  // With 'wx', writeFileSync throws EEXIST if the file already exists, so we retry with an
  // incremented number (up to 5 attempts) instead of doing a separate existsSync check.
  const slug = slugify(parsed.title.replace(/^Eval:\s+[^—]+—\s+Scenario\s+\d+\s+—\s+/i, "").replace(/\s*\(.*\)\s*$/, ""));
  const serialized = serializeScenario(parsed);

  let scenarioId: string | undefined;
  let filePath: string | undefined;
  let startNum = nextScenarioNumber(agent);
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const num = startNum + attempt;
    const paddedNum = String(num).padStart(2, "0");
    const candidateId = `scenario-${paddedNum}-${slug}`;
    const candidatePath = scenarioPath(agent, candidateId);
    try {
      writeFileSync(candidatePath, serialized, { flag: "wx" });
      scenarioId = candidateId;
      filePath = candidatePath;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // File already exists — try next number
        continue;
      }
      // Any other error (permissions, missing dir, etc.)
      const errMsg = err instanceof Error ? err.message : String(err);
      const body = ScenarioGenerateFragment(agent, parsed, `Failed to write file: ${errMsg}`);
      return html(maybeLayout(req, "New Scenario", body, "/scenarios"), 500);
    }
  }

  if (!scenarioId || !filePath) {
    const body = ScenarioGenerateFragment(agent, parsed, `Could not find a free scenario slot after ${MAX_ATTEMPTS} attempts — please try again.`);
    return html(maybeLayout(req, "New Scenario", body, "/scenarios"), 409);
  }

  // Redirect to the edit page with saved flash
  return new Response(null, {
    status: 302,
    headers: { Location: `/scenarios/${encodeURIComponent(agent)}/${encodeURIComponent(scenarioId)}?saved=1` },
  });
}
