/**
 * normalize-output.ts — Deterministic normalization layer for agent output.
 *
 * ROLE IN THE ARCHITECTURE (per docs/spec-schema-enforcement/architecture.md, PoC Finding):
 *
 *   The CLI's `structured_output` is UNRELIABLE for rich agent schemas (e.g., the 2910-byte
 *   BirdOut). It may be absent even when --json-schema is used. Therefore the code-level Zod
 *   validation layer is PRIMARY — not an assist, but the load-bearing guarantee.
 *
 *   This module is the CONSISTENCY ENTRY POINT:
 *     parse → validate → bounded coerce → re-validate
 *   It is deterministic and synchronous up to the optional coercion step.
 *
 * RELATIONSHIP WITH schema-runner.ts:
 *   schema-runner.ts (runAgentWithSchema) is the COERCION MECHANISM used internally by
 *   normalizeAgentOutput when coercion is needed. Its role has narrowed: it is the "targeted
 *   extraction" subprocess that calls `claude -p --json-schema` on the raw text, not the
 *   primary entry point for consumers. Consumers should call normalizeAgentOutput(), which
 *   composes json-extract + Zod safeParse + schema-runner coercion into one consistent API.
 *
 * INTEGRATION POINT (documented, NOT yet wired):
 *   The eval scorer (evals/src/scorer.ts) and Coach K's validation step would call:
 *
 *     const result = await normalizeAgentOutput("bird", rawText);
 *     if (!result.ok) { ... handle typed failure ... }
 *     // result.data is schema-valid BirdOutput, result.via tells you if coercion was needed
 *
 *   This replaces the ad-hoc extractJson() + manual parse pattern used today. The scorer
 *   would receive either a validated object or an explicit typed reason for failure — never
 *   a silent "valid only by luck" parse.
 */

import path from "path";
import fs from "fs";
import { z } from "zod";
import { extractJson } from "./json-extract.ts";
import { getAgentSchema, getAgentJsonSchema } from "../../schemas/agent-schemas.ts";

// ---------------------------------------------------------------------------
// NormalizeResult — the contract
// ---------------------------------------------------------------------------

/**
 * The result of normalizing agent output.
 *
 * Success:
 *   { ok: true; data: T; via: "direct" | "coerced" }
 *   - "direct": json-extract yielded a value that passed Zod safeParse
 *   - "coerced": initial Zod parse failed; a coercion subprocess recovered a valid object
 *
 * Failure:
 *   { ok: false; reason: ...; raw: string; issues?: string[] }
 *   - "no_json"         — extractJson() returned null; no JSON found in rawText
 *   - "schema_invalid"  — JSON was found but Zod rejected it, and coercion was disabled
 *   - "coercion_failed" — JSON found, Zod rejected, coercion attempted and still invalid
 */
export type NormalizeResult<T> =
  | { ok: true; data: T; via: "direct" | "coerced" }
  | { ok: false; reason: "no_json" | "schema_invalid" | "coercion_failed"; raw: string; issues?: string[] };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface NormalizeOpts {
  /**
   * Whether to attempt a coercion subprocess when Zod validation fails.
   * Defaults to true.
   * Set to false for pure offline/deterministic mode — no live API calls will be made.
   */
  coerce?: boolean;

  /** Timeout for the coercion subprocess in milliseconds. Defaults to 120_000. */
  coerceTimeoutMs?: number;

  /** Model to use for coercion. Defaults to "claude-haiku-4-5" (fast + cheap). */
  coerceModel?: string;

  /** Override agents directory for frontmatter lookup during coercion. */
  agentsDir?: string;
}

// ---------------------------------------------------------------------------
// Coercion subprocess
// ---------------------------------------------------------------------------

// Neutral system prompt — deliberately NOT the agent's persona.
// This is a targeted extraction call, not a re-run of the agent.
const COERCE_SYSTEM_PROMPT =
  "You are a JSON extraction assistant. Extract the content below into JSON matching " +
  "the provided schema. Output ONLY the JSON object — no prose, no fences, no explanation.";

const COERCE_MODEL_DEFAULT = "claude-haiku-4-5";
const COERCE_TIMEOUT_DEFAULT = 120_000;

interface CoercionResult {
  ok: boolean;
  output: unknown | null;
  error?: string;
}

/**
 * Run a targeted coercion subprocess via `claude -p --json-schema`.
 *
 * Uses a NEUTRAL system prompt (not the agent's persona) so the CLI's structured extraction
 * fires reliably. Per architecture.md PoC: targeted extraction against small/foreign schemas
 * populates structured_output; the neutral system prompt avoids the model emitting the full
 * big JSON into result (which bypasses structured_output).
 *
 * Reads structured_output first, then falls back to parsing result (same as schema-runner).
 */
async function runCoercionSubprocess(
  rawText: string,
  jsonSchemaStr: string,
  opts: { timeoutMs: number; model: string }
): Promise<CoercionResult> {
  const prompt = `${COERCE_SYSTEM_PROMPT}\n\nCONTENT:\n${rawText}`;

  const argv = [
    "claude",
    "-p",
    "--system-prompt",
    COERCE_SYSTEM_PROMPT,
    "--json-schema",
    jsonSchemaStr,
    "--output-format",
    "json",
    "--model",
    opts.model,
    "--dangerously-skip-permissions",
  ];

  let stdout = "";
  let exitCode = 0;

  try {
    const proc = Bun.spawn(argv, {
      stdin: new TextEncoder().encode(`CONTENT TO EXTRACT:\n${rawText}`),
      stdout: "pipe",
      stderr: "pipe",
    });

    const killHandle = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }, opts.timeoutMs);

    [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(killHandle);
    exitCode = exitCode ?? 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: null, error: `Spawn error: ${msg}` };
  }

  if (exitCode !== 0) {
    return { ok: false, output: null, error: `claude exited ${exitCode}. stdout: ${stdout.slice(0, 300)}` };
  }

  // Parse the JSON envelope from stdout
  let envelope: Record<string, unknown> | null = null;
  const trimmed = stdout.trim();
  try {
    envelope = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Try to find first { in case of status lines
    const start = trimmed.indexOf("{");
    if (start !== -1) {
      try {
        envelope = JSON.parse(trimmed.slice(start)) as Record<string, unknown>;
      } catch {
        // give up
      }
    }
  }

  if (!envelope) {
    return { ok: false, output: null, error: "Could not parse JSON envelope from coercion subprocess" };
  }

  // Extract output: structured_output first (future-compat), then result
  let extracted: unknown = undefined;

  if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
    extracted = envelope.structured_output;
  } else if (typeof envelope.result === "string") {
    try {
      extracted = JSON.parse(envelope.result);
    } catch {
      // result string isn't parseable JSON; try extractJson as fallback
      extracted = extractJson(envelope.result);
    }
  } else if (envelope.result !== null && typeof envelope.result === "object") {
    extracted = envelope.result;
  }

  if (extracted === undefined || extracted === null) {
    return { ok: false, output: null, error: "Coercion envelope had no extractable output" };
  }

  return { ok: true, output: extracted };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Normalize raw agent text output into a schema-valid object or an explicit typed failure.
 *
 * Steps (deterministic):
 *   1. extractJson(rawText) — 3-tier extraction (direct, fence, brace-scan). If null → no_json.
 *   2. Zod safeParse against the agent's registered schema. If valid → {ok:true, via:"direct"}.
 *   3. [if opts.coerce !== false] One bounded coercion pass via `claude -p --json-schema`.
 *      Re-validate result with Zod. If valid → {ok:true, via:"coerced"}.
 *   4. Otherwise → {ok:false, reason, issues}.
 *
 * @param agentName  Name of the agent (must be in AgentSchemaRegistry)
 * @param rawText    Raw output text from the agent
 * @param opts       Normalization options
 */
export async function normalizeAgentOutput<T = unknown>(
  agentName: string,
  rawText: string,
  opts: NormalizeOpts = {}
): Promise<NormalizeResult<T>> {
  const coerce = opts.coerce !== false; // default true
  const coerceTimeoutMs = opts.coerceTimeoutMs ?? COERCE_TIMEOUT_DEFAULT;
  const coerceModel = opts.coerceModel ?? COERCE_MODEL_DEFAULT;

  // Resolve schema from registry
  const zodSchema = getAgentSchema(agentName);
  if (!zodSchema) {
    // No schema registered — treat as a coercion_failed since we cannot validate
    return {
      ok: false,
      reason: "coercion_failed",
      raw: rawText,
      issues: [`No schema registered for agent: ${agentName}`],
    };
  }

  // Step 1: Extract JSON from raw text using 3-tier extractor
  const extracted = extractJson(rawText);
  if (extracted === null) {
    return { ok: false, reason: "no_json", raw: rawText };
  }

  // Step 2: Zod safeParse
  const parseResult = zodSchema.safeParse(extracted);
  if (parseResult.success) {
    return { ok: true, data: parseResult.data as T, via: "direct" };
  }

  // Collect Zod issues for potential reporting
  const zodIssues = (parseResult as z.SafeParseError<unknown>).error.issues.map(
    (i) => `${i.path.join(".")}: ${i.message}`
  );

  // Step 3: Coercion disabled — return schema_invalid
  if (!coerce) {
    return {
      ok: false,
      reason: "schema_invalid",
      raw: rawText,
      issues: zodIssues,
    };
  }

  // Step 3: One bounded coercion pass via claude -p --json-schema
  const jsonSchemaObj = getAgentJsonSchema(agentName)!;
  const jsonSchemaStr = JSON.stringify(jsonSchemaObj);

  const coercionResult = await runCoercionSubprocess(rawText, jsonSchemaStr, {
    timeoutMs: coerceTimeoutMs,
    model: coerceModel,
  });

  if (!coercionResult.ok || coercionResult.output === null) {
    return {
      ok: false,
      reason: "coercion_failed",
      raw: rawText,
      issues: zodIssues.concat(coercionResult.error ? [`coercion error: ${coercionResult.error}`] : []),
    };
  }

  // Step 4: Re-validate coerced output with Zod
  const coercedParse = zodSchema.safeParse(coercionResult.output);
  if (coercedParse.success) {
    return { ok: true, data: coercedParse.data as T, via: "coerced" };
  }

  const coercedIssues = (coercedParse as z.SafeParseError<unknown>).error.issues.map(
    (i) => `${i.path.join(".")}: ${i.message}`
  );

  return {
    ok: false,
    reason: "coercion_failed",
    raw: rawText,
    issues: coercedIssues,
  };
}
