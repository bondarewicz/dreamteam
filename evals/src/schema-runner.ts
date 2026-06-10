/**
 * schema-runner.ts — Schema-enforced agent runner using --system-prompt-file + --json-schema.
 *
 * Per architecture.md empirical finding (CLI 2.1.156):
 *   --agent + --json-schema → structured_output ABSENT (bypass)
 *   --system-prompt-file + --json-schema + --output-format json → structured_output POPULATED
 *
 * This module provides runAgentWithSchema() for the eval harness.
 * It does NOT break existing exports from agent-runner.ts.
 */

import path from "path";
import fs from "fs";
import { z } from "zod";
import { getAgentSchema, getAgentJsonSchema } from "../../schemas/agent-schemas.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "claude-opus-4-8";

// ---------------------------------------------------------------------------
// Frontmatter parsing (model + tools from agent .md)
// ---------------------------------------------------------------------------

interface AgentFrontmatter {
  model: string;
  tools: string[];
  disallowedTools: string[];
}

/**
 * Parse YAML-style frontmatter from an agent .md file.
 * Extracts model:, tools:, and disallowedTools: fields.
 */
export function parseAgentFrontmatter(mdPath: string): AgentFrontmatter {
  const content = fs.readFileSync(mdPath, { encoding: "utf-8" });

  // Extract frontmatter block between --- delimiters
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  const fmText = fmMatch ? fmMatch[1] : content;

  const modelMatch = /^model:\s*(.+)$/m.exec(fmText);
  const model = modelMatch ? modelMatch[1].trim() : DEFAULT_MODEL;

  // tools: may be a comma-separated string or YAML list
  const toolsMatch = /^tools:\s*(.+)$/m.exec(fmText);
  let tools: string[] = [];
  if (toolsMatch) {
    const raw = toolsMatch[1].trim();
    tools = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  const disallowedMatch = /^disallowedTools:\s*(.+)$/m.exec(fmText);
  let disallowedTools: string[] = [];
  if (disallowedMatch) {
    const raw = disallowedMatch[1].trim();
    disallowedTools = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return { model, tools, disallowedTools };
}

// ---------------------------------------------------------------------------
// JSON envelope parsing for --output-format json
// ---------------------------------------------------------------------------

/**
 * Parse the JSON envelope returned by claude --output-format json.
 *
 * CLI behavior (verified CLI 2.1.156, May 2026):
 *   - With --json-schema: the constrained JSON object is returned in `result` AS A STRING.
 *     `structured_output` field is NOT populated in current CLI builds.
 *   - The architecture.md finding of `structured_output` populated was from an earlier probe;
 *     current CLI puts the schema-constrained JSON string in `result`.
 *   - We extract from EITHER `structured_output` (future-compat) OR parse `result` as JSON.
 *
 * Envelope shape: { type: "result", subtype: "success"|"error", result: string,
 *                   structured_output?: object, total_cost_usd: number, usage: {...} }
 */
interface JsonEnvelope {
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  subtype?: string;
  is_error?: boolean;
}

/**
 * Parse a `--output-format stream-json` NDJSON stream into an event array.
 * Each line is one JSON event (system init, assistant, user, result, ...).
 * The init `system` event carries model/session/tools/version metadata that
 * the dashboard's TraceViewer reads; the final `result` event mirrors the
 * single-shot `--output-format json` envelope.
 */
function parseStreamEvents(stdout: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t || t[0] !== "{") continue;
    try {
      events.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      // skip partial / non-JSON status lines
    }
  }
  return events;
}

function parseJsonEnvelope(stdout: string): JsonEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as JsonEnvelope;
  } catch {
    // claude sometimes emits status lines before JSON; try to find the first {
    const start = trimmed.indexOf("{");
    if (start === -1) return null;
    try {
      return JSON.parse(trimmed.slice(start)) as JsonEnvelope;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Typed result types
// ---------------------------------------------------------------------------

export type SchemaRunSuccess<T> = {
  ok: true;
  data: T;
  rawEnvelope: JsonEnvelope;
  neededFenceStrip: false; // schema path never needs fence-stripping
  /** Where the schema-constrained output was found in the envelope */
  outputSource: "structured_output" | "result_string";
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Full stream-json event list (init + assistant + result) for trace capture */
  trace?: Record<string, unknown>[];
};

export type SchemaRunFailure = {
  ok: false;
  reason:
    | "no_schema_output"         // neither structured_output nor parseable result JSON found
    | "schema_validation_failed" // output present but Zod rejected it
    | "process_error"            // spawn/timeout/non-zero exit
    | "no_schema_registered";    // agent not in registry
  detail: string;
  rawEnvelope: JsonEnvelope | null;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Full stream-json event list (init + assistant + result) for trace capture */
  trace?: Record<string, unknown>[];
};

export type SchemaRunResult<T = unknown> = SchemaRunSuccess<T> | SchemaRunFailure;

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export interface RunAgentWithSchemaOpts {
  /** Override the model from frontmatter */
  model?: string;
  /** Override the allowed tools list */
  allowedTools?: string[];
  timeoutMs?: number;
  /** Path to the agents directory (defaults to repo root agents/) */
  agentsDir?: string;
  /** Extra CLI flags to append */
  extraArgs?: string[];
}

/**
 * Run a named agent with schema enforcement.
 *
 * Dispatches: claude -p <prompt>
 *   --system-prompt-file ~/.claude/agents/<agentName>.md
 *   --json-schema <jsonSchema>
 *   --output-format json
 *   --model <model-from-frontmatter>
 *   --allowedTools <tools-from-frontmatter>
 *
 * Pulls .structured_output from the JSON envelope.
 * Re-validates with Zod (defense in depth).
 */
export async function runAgentWithSchema<T = unknown>(
  agentName: string,
  prompt: string,
  opts: RunAgentWithSchemaOpts = {}
): Promise<SchemaRunResult<T>> {
  const startMs = Date.now();

  // 1. Resolve Zod schema
  const zodSchema = getAgentSchema(agentName);
  if (!zodSchema) {
    return {
      ok: false,
      reason: "no_schema_registered",
      detail: `No Zod schema registered for agent: ${agentName}`,
      rawEnvelope: null,
      durationMs: Date.now() - startMs,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 2. Emit JSON Schema (for --json-schema flag)
  const jsonSchema = getAgentJsonSchema(agentName)!;
  const jsonSchemaStr = JSON.stringify(jsonSchema);

  // 3. Resolve agent .md file and parse frontmatter
  const agentsDir = opts.agentsDir ?? AGENTS_DIR;
  const agentMdPath = path.join(agentsDir, `${agentName}.md`);

  let frontmatter: AgentFrontmatter;
  try {
    frontmatter = parseAgentFrontmatter(agentMdPath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "process_error",
      detail: `Failed to read agent frontmatter from ${agentMdPath}: ${msg}`,
      rawEnvelope: null,
      durationMs: Date.now() - startMs,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // Precedence: explicit CLI override (non-empty) → agent frontmatter model → omit --model flag.
  // Use || rather than ?? so that empty-string overrides (cli.ts default of "") fall through.
  const model = (opts.model && opts.model.trim()) || frontmatter.model || "";
  const tools = opts.allowedTools ?? frontmatter.tools;

  // 4. Build argv array (no shell — safe for JSON schema strings with special chars)
  const argv: string[] = [
    "claude",
    "-p",
    "--system-prompt-file",
    agentMdPath,
    "--json-schema",
    jsonSchemaStr,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Only emit --model when we have a non-empty value — passing "" causes a 400 API error.
  if (model) {
    argv.push("--model", model);
  }

  // Only emit --allowedTools when we have a non-empty list — passing "" causes a CLI error.
  if (tools.length > 0) {
    argv.push("--allowedTools", tools.join(","));
  }

  if (opts.extraArgs) {
    argv.push(...opts.extraArgs);
  }

  // 5. Spawn process
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let stdout = "";
  let exitCode = 0;

  try {
    const proc = Bun.spawn(argv, {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutHandle = setTimeout(() => {
      try { proc.kill(); } catch { /* already dead */ }
    }, timeoutMs);

    [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(timeoutHandle);
    exitCode = exitCode ?? 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "process_error",
      detail: `Spawn error: ${msg}`,
      rawEnvelope: null,
      durationMs: Date.now() - startMs,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const durationMs = Date.now() - startMs;

  // 6. Parse stream-json events. The final `result` event mirrors the old
  // single-shot json envelope; the full event list is kept as `trace` so the
  // init metadata (model/session/version/tools) is preserved for the UI.
  const traceEvents = parseStreamEvents(stdout);
  const envelope =
    (traceEvents.find((e) => e.type === "result") as JsonEnvelope | undefined) ??
    parseJsonEnvelope(stdout); // fallback if CLI emitted a single object
  const costUsd = typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : 0;
  const inputTokens =
    typeof envelope?.usage?.input_tokens === "number" ? envelope.usage.input_tokens : 0;
  const outputTokens =
    typeof envelope?.usage?.output_tokens === "number" ? envelope.usage.output_tokens : 0;

  // 7. Check for process error
  if (exitCode !== 0 && !envelope) {
    return {
      ok: false,
      reason: "process_error",
      detail: `claude exited ${exitCode}. stdout: ${stdout.slice(0, 500)}`,
      rawEnvelope: envelope,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
    };
  }

  if (envelope?.subtype === "error" || envelope?.is_error === true) {
    return {
      ok: false,
      reason: "process_error",
      detail: `envelope subtype=error or is_error=true. detail: ${JSON.stringify(envelope).slice(0, 300)}`,
      rawEnvelope: envelope,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
    };
  }

  // 8. Extract schema-constrained output from envelope.
  //
  // CLI 2.1.156+ behavior (verified empirically):
  //   - `structured_output` is populated when using the Agent SDK output_format type.
  //   - `claude -p --json-schema` puts the constrained JSON in `result` as a JSON STRING.
  //   - We check structured_output first (future-compat), then fall back to parsing `result`.
  let schemaOutput: unknown = undefined;
  let outputSource: "structured_output" | "result_string" = "structured_output";

  if (envelope?.structured_output !== undefined && envelope.structured_output !== null) {
    schemaOutput = envelope.structured_output;
    outputSource = "structured_output";
  } else if (typeof envelope?.result === "string") {
    // result is a JSON string — attempt to parse it
    try {
      schemaOutput = JSON.parse(envelope.result);
      outputSource = "result_string";
    } catch {
      // result string isn't parseable JSON
    }
  } else if (envelope?.result !== undefined && typeof envelope?.result === "object") {
    // result is already an object (some CLI versions may serialize differently)
    schemaOutput = envelope.result;
    outputSource = "result_string";
  }

  if (schemaOutput === undefined || schemaOutput === null) {
    return {
      ok: false,
      reason: "no_schema_output",
      detail: `No schema-constrained output found in envelope (structured_output absent, result not parseable). subtype=${envelope?.subtype ?? "unknown"}`,
      rawEnvelope: envelope,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
      trace: traceEvents,
    };
  }

  // 9. Re-validate with Zod (defense in depth)
  const parseResult = zodSchema.safeParse(schemaOutput);
  if (!parseResult.success) {
    const issues = (parseResult as z.SafeParseError<unknown>).error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      reason: "schema_validation_failed",
      detail: `Zod validation failed (source=${outputSource}): ${issues}`,
      rawEnvelope: envelope,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
      trace: traceEvents,
    };
  }

  return {
    ok: true,
    data: parseResult.data as T,
    rawEnvelope: envelope,
    neededFenceStrip: false,
    outputSource,
    durationMs,
    costUsd,
    inputTokens,
    outputTokens,
    trace: traceEvents,
  };
}
