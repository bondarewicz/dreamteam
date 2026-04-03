import { test, expect, describe } from "bun:test";
import path from "path";
import fs from "fs";
import os from "os";
import type { ClaudeAdapter, PipelineOptions } from "../types.ts";
import { runPipeline } from "../pipeline.ts";

// ── Mock ClaudeAdapter ────────────────────────────────────────────────────────

function makeNdjsonOutput(agentOutput: string, tokens = 50): string {
  return JSON.stringify({
    type: "result",
    result: agentOutput,
    usage: { input_tokens: tokens, output_tokens: tokens },
    total_cost_usd: 0.01,
  });
}

class MockAdapter implements ClaudeAdapter {
  private responses: Map<string, string>;
  public calls: Array<{ args: string[]; stdin: string }> = [];

  constructor(responses: Map<string, string> = new Map()) {
    this.responses = responses;
  }

  async run(args: string[], stdin: string, _timeoutMs: number): Promise<{ stdout: string; exitCode: number }> {
    this.calls.push({ args, stdin });
    // Return a canned score response for scoring calls (-p flag without --agent)
    if (args.includes("-p") && !args.includes("--agent")) {
      return {
        stdout: '{"score": "pass", "confidence_stated": 85, "justification": "Good work", "observations": []}',
        exitCode: 0,
      };
    }
    // Return NDJSON for agent calls
    const agentOutput = this.responses.get(stdin.slice(0, 50)) ?? makeNdjsonOutput('{"answer": "done"}');
    return { stdout: agentOutput, exitCode: 0 };
  }
}

// ── Dry run test ──────────────────────────────────────────────────────────────

describe("pipeline dry-run", () => {
  test("dry run makes no claude calls and creates no files", async () => {
    const adapter = new MockAdapter();
    const repoRoot = path.join(import.meta.dir, "../../..");

    const opts: PipelineOptions = {
      parallel: 2,
      resumeDir: "",
      agentFilter: "shaq",
      scenarioFilter: "scenario-01*",
      phase: "all",
      trials: 1,
      dryRun: true,
      timeoutPerPhase: 0,
      repoRoot,
    };

    const result = await runPipeline(opts, adapter);

    expect(result.finalOutputPath).toBe("");
    expect(adapter.calls.length).toBe(0);
  });
});

// ── Resume test ───────────────────────────────────────────────────────────────

describe("pipeline resume", () => {
  test("resume skips scenarios whose raw output already exists", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));

    try {
      const repoRoot = path.join(import.meta.dir, "../../..");
      const evalsDir = path.join(repoRoot, "evals");

      // Find a real shaq scenario to use
      const shaqDir = path.join(evalsDir, "shaq");
      const scenarioFiles = fs.readdirSync(shaqDir).filter((f) => f.startsWith("scenario-") && f.endsWith(".md"));
      if (scenarioFiles.length === 0) {
        console.log("  SKIP: no shaq scenarios found");
        return;
      }

      const scenarioId = path.basename(scenarioFiles[0], ".md");

      // Pre-create a raw output file (simulating previous run)
      const preExisting = {
        agent: "shaq",
        scenario_id: scenarioId,
        agent_output: '{"answer": "pre-existing"}',
        agent_output_excerpt: '{"answer": "pre-existing"}',
        duration_ms: 100,
        tokens_used: 50,
        input_tokens: 25,
        output_tokens: 25,
        cost_usd: 0,
        timestamp: "2026-01-01T00:00:00Z",
        trace: [],
      };
      fs.writeFileSync(
        path.join(tmpDir, `shaq-${scenarioId}.json`),
        JSON.stringify(preExisting),
        "utf-8"
      );

      const adapter = new MockAdapter();
      const opts: PipelineOptions = {
        parallel: 2,
        resumeDir: tmpDir,
        agentFilter: "shaq",
        scenarioFilter: scenarioId,
        phase: "agents",
        trials: 1,
        dryRun: false,
        timeoutPerPhase: 0,
        repoRoot,
      };

      await runPipeline(opts, adapter);

      // No agent calls should have been made (file already exists = SKIP)
      const agentCalls = adapter.calls.filter((c) => c.args.includes("--agent"));
      expect(agentCalls.length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
