#!/usr/bin/env bun
/**
 * poc-bird-schema.ts — A/B measurement: current stream-json path vs schema-enforced path.
 *
 * GOAL: Measure retry-exhaustion risk of Bird's Zod schema under --json-schema.
 *
 * Path A (current harness): --agent bird --output-format stream-json → fence-strip → parse JSON
 * Path B (new):            --system-prompt-file bird.md --json-schema <BirdOut> → structured_output
 *
 * 3 scenarios × 2 paths = 6 live agent calls.
 *
 * Per architecture.md (empirical, CLI 2.1.156):
 *   --agent + --json-schema → structured_output ABSENT (bypass — do NOT use)
 *   --system-prompt-file + --json-schema + --output-format json → structured_output POPULATED
 *
 * Run: bun scripts/poc-bird-schema.ts
 */

import path from "path";
import fs from "fs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const BIRD_MD = path.join(AGENTS_DIR, "bird.md");

// ---------------------------------------------------------------------------
// Inline JSON extraction (mirrors evals/src/json-extract.ts logic)
// ---------------------------------------------------------------------------

function extractJson(output: string): unknown {
  const trimmed = output.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  const fenceMatch = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(output);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  const openers = /[\[{]/g;
  let m: RegExpExecArray | null;
  while ((m = openers.exec(output)) !== null) {
    const start = m.index;
    let depth = 0;
    let inString = false;
    for (let i = start; i < output.length; i++) {
      const ch = output[i];
      if (inString) {
        if (ch === "\\") { i++; } else if (ch === '"') { inString = false; }
        continue;
      }
      if (ch === '"') { inString = true; }
      else if (ch === "{" || ch === "[") { depth++; }
      else if (ch === "}" || ch === "]") { depth--; }
      if (depth === 0) {
        try { return JSON.parse(output.slice(start, i + 1)); } catch { /* next */ }
        break;
      }
    }
  }
  return null;
}

function hasFence(output: string): boolean {
  return /```(?:json)?/.test(output);
}

// ---------------------------------------------------------------------------
// NDJSON parser (mirrors evals/src/agent-runner.ts parseNdjson)
// ---------------------------------------------------------------------------

function parseNdjson(raw: string): {
  agentOutput: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
} {
  let resultEvent: Record<string, unknown> | null = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      if (ev.type === "result") resultEvent = ev;
    } catch { /* skip */ }
  }
  if (resultEvent) {
    const rawResult = resultEvent.result;
    const agentOutput = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
    const usage = (resultEvent.usage ?? {}) as Record<string, number>;
    return {
      agentOutput,
      costUsd: Number(resultEvent.total_cost_usd ?? 0),
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
    };
  }
  return { agentOutput: raw, costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

// ---------------------------------------------------------------------------
// Path A runner: stream-json via --agent
// ---------------------------------------------------------------------------

async function runPathA(prompt: string, timeoutMs: number): Promise<{
  ok: boolean;
  validJson: boolean;
  neededFenceStrip: boolean;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  detail: string;
}> {
  const start = Date.now();
  const argv = [
    "claude", "-p",
    "--agent", "bird",
    "--output-format", "stream-json",
    "--verbose",
  ];

  try {
    const proc = Bun.spawn(argv, {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => { try { proc.kill(); } catch { /* */ } }, timeoutMs);
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timeout);

    const durationMs = Date.now() - start;

    if ((code ?? 0) !== 0) {
      return { ok: false, validJson: false, neededFenceStrip: false, durationMs, costUsd: 0,
        inputTokens: 0, outputTokens: 0, detail: `exit ${code}` };
    }

    const { agentOutput, costUsd, inputTokens, outputTokens } = parseNdjson(stdout);
    const fenced = hasFence(agentOutput);
    const parsed = extractJson(agentOutput);
    const validJson = parsed !== null && typeof parsed === "object";

    return {
      ok: validJson,
      validJson,
      neededFenceStrip: fenced,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
      detail: validJson ? "ok" : `parse failed (len=${agentOutput.length})`,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      validJson: false,
      neededFenceStrip: false,
      durationMs: Date.now() - start,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      detail: `spawn error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Path B runner: --system-prompt-file + --json-schema
// ---------------------------------------------------------------------------

async function runPathB(prompt: string, jsonSchemaStr: string, timeoutMs: number): Promise<{
  ok: boolean;
  structuredOutputPresent: boolean;
  zodValid: boolean;
  retryExhausted: boolean;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  detail: string;
}> {
  const start = Date.now();
  const argv = [
    "claude", "-p",
    "--system-prompt-file", BIRD_MD,
    "--json-schema", jsonSchemaStr,
    "--output-format", "json",
    "--model", "claude-opus-4-8",
    "--allowedTools", "Read,Grep,Glob,Bash,Skill",
  ];

  try {
    const proc = Bun.spawn(argv, {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => { try { proc.kill(); } catch { /* */ } }, timeoutMs);
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timeout);

    const durationMs = Date.now() - start;

    // Parse JSON envelope
    let envelope: Record<string, unknown> | null = null;
    const trimmed = stdout.trim();
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      const idx = trimmed.indexOf("{");
      if (idx !== -1) {
        try { envelope = JSON.parse(trimmed.slice(idx)); } catch { /* */ }
      }
    }

    const costUsd = typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : 0;
    const usage = (envelope?.usage ?? {}) as Record<string, number>;
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);

    // CLI 2.1.156+ behavior: --json-schema puts constrained JSON in `result` as a string.
    // `structured_output` may be absent even on success. We check both.
    let schemaOutput: unknown = undefined;
    let outputSource = "none";

    if (envelope?.structured_output !== undefined && envelope.structured_output !== null) {
      schemaOutput = envelope.structured_output;
      outputSource = "structured_output";
    } else if (typeof envelope?.result === "string") {
      try {
        schemaOutput = JSON.parse(envelope.result as string);
        outputSource = "result_string";
      } catch { /* not parseable */ }
    } else if (envelope?.result !== undefined && typeof envelope.result === "object") {
      schemaOutput = envelope.result;
      outputSource = "result_object";
    }

    const structuredOutputPresent = schemaOutput !== undefined && schemaOutput !== null;

    // Retry-exhaustion: non-zero exit + no parseable schema output, or is_error/subtype=error
    const retryExhausted =
      !structuredOutputPresent && (
        (code ?? 0) !== 0 ||
        envelope?.subtype === "error" ||
        envelope?.is_error === true
      );

    // Zod validate if schema output is present
    let zodValid = false;
    if (structuredOutputPresent) {
      const { BirdOut } = await import("../schemas/agent-schemas.ts");
      const r = BirdOut.safeParse(schemaOutput);
      zodValid = r.success;
      if (!r.success) {
        const issues = r.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.log(`    Zod issues (first 3): ${issues}`);
      }
    }

    if ((code ?? 0) !== 0 && !structuredOutputPresent) {
      return {
        ok: false, structuredOutputPresent, zodValid, retryExhausted, durationMs, costUsd,
        inputTokens, outputTokens, detail: `exit ${code}, envelope subtype=${envelope?.subtype ?? "?"}`,
      };
    }

    return {
      ok: structuredOutputPresent && zodValid,
      structuredOutputPresent,
      zodValid,
      retryExhausted,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
      detail: structuredOutputPresent
        ? zodValid ? `ok (source=${outputSource})` : `schema output present (source=${outputSource}) but Zod failed`
        : `schema output absent, subtype=${envelope?.subtype ?? "?"}, exit=${code}`,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      structuredOutputPresent: false,
      zodValid: false,
      retryExhausted: false,
      durationMs: Date.now() - start,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      detail: `spawn error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Scenario definitions (3 representative Bird scenarios)
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: "scenario-01",
    name: "Domain Rule Extraction (happy path)",
    prompt: `A logistics platform handles parcel delivery. The following rules have been described by a product manager:

"A shipment can be created when there is a pickup address and a delivery address. Once in transit, it cannot be sent back to pending. Delivered shipments are final — their state cannot change. Weight must be positive and cannot exceed 1000 kg. We charge by weight bracket: under 10 kg is standard, 10 kg up to but not including 50 kg is heavy (10 kg is the lower boundary, inclusive), 50 kg and above is freight (50 kg is the lower boundary, inclusive)."

Read this description and produce a domain analysis using your full output schema. Include: domain_analysis, business_rules (with invariant flags), acceptance_criteria (with Given/When/Then), and confidence assessment.`,
  },
  {
    id: "scenario-03",
    name: "Business Impact Assessment (escalation case)",
    prompt: `The engineering team wants to change how delivery ETAs are calculated. Currently ETAs are shown as exact timestamps (e.g., "Delivery by 14:30 on Friday"). The proposal is to change to date-only windows (e.g., "Delivery by Friday").

Analyze the business impact of this change. Use your full output schema including business_impact with all sub-fields (financial, operational, user, risk, stakeholders_affected). If any information is missing that you need to complete a confident analysis, escalate.`,
  },
  {
    id: "scenario-09",
    name: "Ambiguous Spec / Contradiction Escalation (hard)",
    prompt: `A product manager provides the following requirements for an order cancellation feature:

"An order can be cancelled at any time before it ships."

Additionally, the finance team sends this constraint:

"Orders that have been invoiced cannot be cancelled — invoicing is irreversible."

And the operations team adds:

"We invoice orders at the time of placement to lock in pricing."

Analyze these requirements. Produce your full output schema.`,
  },
];

const TIMEOUT_MS = 180_000; // 3 min per call

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Import the schema
  const { getAgentJsonSchema } = await import("../schemas/agent-schemas.ts");
  const jsonSchema = getAgentJsonSchema("bird");
  if (!jsonSchema) {
    console.error("ERROR: No schema registered for bird");
    process.exit(1);
  }
  const jsonSchemaStr = JSON.stringify(jsonSchema);

  console.log("=".repeat(80));
  console.log("POC: Bird A/B Schema Enforcement Measurement");
  console.log("=".repeat(80));
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Paths: A (stream-json --agent) + B (--system-prompt-file --json-schema)`);
  console.log(`Total calls: ${SCENARIOS.length * 2}`);
  console.log(`Timeout per call: ${TIMEOUT_MS / 1000}s`);
  console.log("=".repeat(80));
  console.log();

  type RowResult = {
    scenario: string;
    path: string;
    ok: boolean;
    validJson?: boolean;
    neededFenceStrip?: boolean;
    structuredOutputPresent?: boolean;
    zodValid?: boolean;
    retryExhausted?: boolean;
    durationMs: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    detail: string;
  };

  const rows: RowResult[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n[${scenario.id}] ${scenario.name}`);
    console.log("-".repeat(60));

    // Path A
    console.log("  Path A (stream-json --agent): running...");
    const a = await runPathA(scenario.prompt, TIMEOUT_MS);
    console.log(`  Path A done: ok=${a.ok}, fenced=${a.neededFenceStrip}, cost=$${a.costUsd.toFixed(4)}, ${a.durationMs}ms`);
    rows.push({
      scenario: scenario.id,
      path: "A (stream-json)",
      ok: a.ok,
      validJson: a.validJson,
      neededFenceStrip: a.neededFenceStrip,
      durationMs: a.durationMs,
      costUsd: a.costUsd,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      detail: a.detail,
    });

    // Path B
    console.log("  Path B (--system-prompt-file + --json-schema): running...");
    const b = await runPathB(scenario.prompt, jsonSchemaStr, TIMEOUT_MS);
    console.log(`  Path B done: ok=${b.ok}, structured=${b.structuredOutputPresent}, zod=${b.zodValid}, retry_exhausted=${b.retryExhausted}, cost=$${b.costUsd.toFixed(4)}, ${b.durationMs}ms`);
    rows.push({
      scenario: scenario.id,
      path: "B (--json-schema)",
      ok: b.ok,
      structuredOutputPresent: b.structuredOutputPresent,
      zodValid: b.zodValid,
      retryExhausted: b.retryExhausted,
      durationMs: b.durationMs,
      costUsd: b.costUsd,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      detail: b.detail,
    });
  }

  // ---------------------------------------------------------------------------
  // Print comparison table
  // ---------------------------------------------------------------------------
  console.log("\n\n" + "=".repeat(80));
  console.log("RESULTS TABLE");
  console.log("=".repeat(80));
  console.log(
    "Scenario".padEnd(15) +
    "Path".padEnd(22) +
    "OK?".padEnd(6) +
    "Valid JSON".padEnd(12) +
    "Fence?".padEnd(8) +
    "Struct?".padEnd(9) +
    "Zod?".padEnd(6) +
    "Retry?".padEnd(8) +
    "Cost($)".padEnd(10) +
    "ms".padEnd(8) +
    "Detail"
  );
  console.log("-".repeat(120));

  for (const r of rows) {
    const isPathB = r.path.startsWith("B");
    console.log(
      r.scenario.padEnd(15) +
      r.path.padEnd(22) +
      (r.ok ? "YES" : "NO ").padEnd(6) +
      (isPathB ? "n/a".padEnd(12) : (r.validJson ? "YES" : "NO ").padEnd(12)) +
      (isPathB ? "n/a".padEnd(8) : (r.neededFenceStrip ? "YES" : "no ").padEnd(8)) +
      (!isPathB ? "n/a".padEnd(9) : (r.structuredOutputPresent ? "YES" : "NO ").padEnd(9)) +
      (!isPathB ? "n/a".padEnd(6) : (r.zodValid ? "YES" : "NO ").padEnd(6)) +
      (!isPathB ? "n/a".padEnd(8) : (r.retryExhausted ? "YES" : "no ").padEnd(8)) +
      `$${r.costUsd.toFixed(4)}`.padEnd(10) +
      `${r.durationMs}`.padEnd(8) +
      r.detail
    );
  }

  // ---------------------------------------------------------------------------
  // Summary + rollout recommendation
  // ---------------------------------------------------------------------------
  const pathBRows = rows.filter((r) => r.path.startsWith("B"));
  const pathBTotal = pathBRows.length;
  const pathBRetryExhausted = pathBRows.filter((r) => r.retryExhausted).length;
  const pathBOk = pathBRows.filter((r) => r.ok).length;
  const pathBStructured = pathBRows.filter((r) => r.structuredOutputPresent).length;
  const retryExhaustionRate = pathBTotal > 0 ? (pathBRetryExhausted / pathBTotal) * 100 : 0;
  const successRate = pathBTotal > 0 ? (pathBOk / pathBTotal) * 100 : 0;

  const pathARows = rows.filter((r) => r.path.startsWith("A"));
  const pathACostTotal = pathARows.reduce((s, r) => s + r.costUsd, 0);
  const pathBCostTotal = pathBRows.reduce((s, r) => s + r.costUsd, 0);

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Path B scenarios: ${pathBTotal}`);
  console.log(`Path B schema output present (structured_output or result_string): ${pathBStructured}/${pathBTotal}`);
  console.log(`Path B Zod-valid: ${pathBOk}/${pathBTotal}`);
  console.log(`Path B retry-exhausted: ${pathBRetryExhausted}/${pathBTotal} (${retryExhaustionRate.toFixed(1)}%)`);
  console.log(`Path B success rate: ${successRate.toFixed(1)}%`);
  console.log(`Cost Path A total: $${pathACostTotal.toFixed(4)}`);
  console.log(`Cost Path B total: $${pathBCostTotal.toFixed(4)}`);
  console.log(`Cost delta (B-A): ${pathBCostTotal > pathACostTotal ? "+" : ""}$${(pathBCostTotal - pathACostTotal).toFixed(4)}`);

  console.log("\nROLLOUT RECOMMENDATION:");
  if (retryExhaustionRate <= 10) {
    console.log(`  PROCEED — retry-exhaustion rate ${retryExhaustionRate.toFixed(1)}% is at or below 10% threshold.`);
    console.log("  Safe to roll out to MJ, Pippen, Drexler, Kobe (Shaq last per architecture.md).");
  } else if (retryExhaustionRate <= 25) {
    console.log(`  CAUTION — retry-exhaustion rate ${retryExhaustionRate.toFixed(1)}% is above 10% threshold.`);
    console.log("  Recommend simplifying schema (loosen .optional() fields, flatten nested objects) before rollout.");
  } else {
    console.log(`  BLOCK — retry-exhaustion rate ${retryExhaustionRate.toFixed(1)}% is unacceptably high.`);
    console.log("  Schema needs significant simplification or --json-schema approach is not viable for Bird.");
  }

  console.log("\n" + "=".repeat(80));

  // Save results to .tmp/ for reference
  const tmpDir = path.join(REPO_ROOT, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const outFile = path.join(tmpDir, "poc-bird-schema-results.json");
  fs.writeFileSync(outFile, JSON.stringify({ rows, summary: {
    pathBTotal, pathBStructured, pathBOk, pathBRetryExhausted,
    retryExhaustionRate, successRate, pathACostTotal, pathBCostTotal,
  }}, null, 2));
  console.log(`Results saved to: ${outFile}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
