/**
 * collaboration.test.ts
 *
 * LIVE COLLABORATION CHECK — tests that Dream Team agents genuinely exchange
 * messages via the bus during a session, not just sequential phase handoff.
 *
 * Design:
 *   1. A conductor agent (claude -p) calls TeamCreate, spawns Bird and MJ as
 *      background agents with the team_name, waits for their outputs via
 *      SendMessage / inbox checks, then calls TeamDelete.
 *   2. Bird is asked to pick ONE canonical term ("Customer" or "Buyer") and
 *      message it to MJ.
 *   3. MJ must NOT invent the term — he must obtain Bird's term via message,
 *      then form e.g. "ICustomerRepository".
 *   4. PASS: MJ's final output contains the EXACT term Bird chose.
 *      FAIL: MJ uses a different term, OR either agent reports "NO MESSAGING TOOL".
 *
 * HARNESS LIMITATION:
 *   The normal runTeamScenario harness in agent-runner.ts runs sequential
 *   claude -p subprocess calls — no TeamCreate, no shared bus, no SendMessage.
 *   This test bypasses that harness and uses a conductor claude -p call that
 *   itself orchestrates the bus via tool calls.
 *
 * ESCALATION NOTE:
 *   To run collaboration evals via the normal `bun evals/src/cli.ts` flow, the
 *   harness would need a new scenario type (e.g. `category: live_bus`) that:
 *     - calls TeamCreate before spawning phases
 *     - spawns phases as background agents with team_name
 *     - collects outputs via message inbox polling rather than sequential stdout
 *     - calls TeamDelete on completion
 *   This is a non-trivial harness change. Escalated — do not build without
 *   explicit approval from Coach K / MJ (architecture decision).
 *
 * NOTE: This test makes LIVE claude API calls and is slow (~60-120s).
 * It is GUARDED behind the LIVE_BUS_TEST env var so it never runs (or bills)
 * accidentally in CI. To run it explicitly:
 *   LIVE_BUS_TEST=1 bun test evals/src/__tests__/collaboration.test.ts
 * Without LIVE_BUS_TEST set, only the unit tests below run.
 */

import { test, expect, describe } from "bun:test";
import { Bun as _Bun } from "bun";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a claude CLI call and return stdout.
 * Throws if the process exits non-zero or times out.
 */
async function runClaude(prompt: string, timeoutMs: number): Promise<string> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ],
    {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const killHandle = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  }, timeoutMs);

  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  clearTimeout(killHandle);

  if (exitCode !== 0) {
    throw new Error(`claude exited with code ${exitCode}. stdout: ${stdout.slice(0, 500)}`);
  }

  return stdout;
}

/**
 * Extract the final text result from NDJSON stream output.
 */
function extractResult(ndjson: string): string {
  let lastResult = "";
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event.type === "result") {
        const r = event.result;
        lastResult = typeof r === "string" ? r : JSON.stringify(r);
      }
    } catch {
      // skip non-JSON
    }
  }
  return lastResult;
}

// ── Conductor Prompt ──────────────────────────────────────────────────────────

/**
 * Build the conductor prompt. The conductor:
 *   1. Calls TeamCreate with a unique team name
 *   2. Spawns Bird as a background agent (team_name set)
 *   3. Spawns MJ as a background agent (team_name set), telling him to wait
 *      for Bird's message before responding
 *   4. Waits for both to complete
 *   5. Calls TeamDelete
 *   6. Returns a JSON summary: { bird_term, mj_interface, collaboration_passed }
 */
function makeConductorPrompt(teamName: string): string {
  return `You are a test conductor. Your ONLY job is to orchestrate a collaboration test between Bird and MJ via the agent bus. Follow these steps EXACTLY and output a JSON summary at the end.

TEAM NAME: ${teamName}

STEP 1: Call TeamCreate with name "${teamName}".

STEP 2: Spawn Bird as a background agent:
- Agent name: "bird"
- team_name: "${teamName}"
- run_in_background: true
- Prompt: "You are Bird, the Domain Authority. This is a collaboration test. Pick ONE canonical term for the actor that places orders — either 'Customer' or 'Buyer'. Choose whichever you prefer. Then: (1) Send a message to 'mj' via SendMessage with your chosen term. (2) Send a message to 'conductor' via SendMessage with your chosen term. Format your message as: CANONICAL_TERM:<your-choice>. Do not do anything else."

STEP 3: Spawn MJ as a background agent:
- Agent name: "mj"
- team_name: "${teamName}"
- run_in_background: true
- Prompt: "You are MJ, the Strategic Systems Architect. This is a collaboration test. Wait for a message from 'bird' containing a CANONICAL_TERM. Once you receive it, form a repository interface name using that EXACT term (e.g. if term is Customer, output ICustomerRepository). Then send a message to 'conductor' via SendMessage with your interface name. Format your message as: INTERFACE_NAME:<your-interface>. IMPORTANT: Do NOT invent a term — use ONLY the term Bird sent you. If you do not receive a message from Bird within 30 seconds, report: NO_MESSAGE_RECEIVED."

STEP 4: Wait for messages from both 'bird' and 'mj' in your inbox (CheckMyInbox or equivalent). Collect:
- bird_term: the term from Bird's CANONICAL_TERM message
- mj_interface: the interface name from MJ's INTERFACE_NAME message

STEP 5: Call TeamDelete with name "${teamName}".

STEP 6: Output ONLY this JSON (no markdown fences, no prose):
{
  "bird_term": "<the term Bird chose>",
  "mj_interface": "<the interface MJ named>",
  "collaboration_passed": <true if mj_interface contains bird_term, false otherwise>,
  "team_deleted": true
}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "collaboration — live bus message exchange",
  () => {
    test.skipIf(!process.env.LIVE_BUS_TEST)(
      "Bird sends canonical term to MJ via bus; MJ uses it in interface name",
      async () => {
        // Use a unique team name so this test never collides with a real session
        const teamName = `collab-test-${Date.now()}`;

        let conductorOutput: string;
        try {
          const ndjson = await runClaude(makeConductorPrompt(teamName), 180_000);
          conductorOutput = extractResult(ndjson);
        } catch (err) {
          // If claude is not available (CI without auth), skip gracefully
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("not found") ||
            msg.includes("ANTHROPIC_API_KEY") ||
            msg.includes("authentication")
          ) {
            console.log("SKIP: claude CLI not available or not authenticated");
            return;
          }
          throw err;
        }

        // Parse conductor JSON output
        let summary: {
          bird_term?: string;
          mj_interface?: string;
          collaboration_passed?: boolean;
          team_deleted?: boolean;
        };
        try {
          // Strip markdown fences if present (defensive)
          const cleaned = conductorOutput.replace(/^```[a-z]*\n?/m, "").replace(/^```$/m, "").trim();
          summary = JSON.parse(cleaned);
        } catch {
          throw new Error(
            `Conductor did not return valid JSON. Output: ${conductorOutput.slice(0, 500)}`
          );
        }

        // PASS ASSERTION 1: Bird must have picked a valid canonical term
        expect(["Customer", "Buyer"]).toContain(summary.bird_term);

        // PASS ASSERTION 2: MJ's interface must contain Bird's exact term
        expect(summary.mj_interface).toBeTruthy();
        expect(summary.mj_interface!.toLowerCase()).toContain(
          summary.bird_term!.toLowerCase()
        );

        // PASS ASSERTION 3: Conductor confirms collaboration passed
        expect(summary.collaboration_passed).toBe(true);

        // PASS ASSERTION 4: Team was deleted (cleanup)
        expect(summary.team_deleted).toBe(true);
      },
      180_000 // 3-minute timeout for live agent calls
    );
  }
);

// ── Unit tests (always run — no live calls) ────────────────────────────────

describe("extractResult — NDJSON parsing", () => {
  test("extracts result from a well-formed NDJSON stream", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: '{"bird_term":"Customer"}', total_cost_usd: 0.01, usage: {} }),
    ].join("\n");

    const result = extractResult(ndjson);
    expect(result).toBe('{"bird_term":"Customer"}');
  });

  test("returns last result event if multiple exist", () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: "first" }),
      JSON.stringify({ type: "result", result: "last" }),
    ].join("\n");

    expect(extractResult(ndjson)).toBe("last");
  });

  test("returns empty string if no result event", () => {
    const ndjson = JSON.stringify({ type: "system", subtype: "init" });
    expect(extractResult(ndjson)).toBe("");
  });

  test("skips non-JSON lines gracefully", () => {
    const ndjson = [
      "not-json",
      JSON.stringify({ type: "result", result: "ok" }),
      "also-not-json",
    ].join("\n");

    expect(extractResult(ndjson)).toBe("ok");
  });
});

describe("makeConductorPrompt — prompt generation", () => {
  test("includes team name in prompt", () => {
    const prompt = makeConductorPrompt("test-team-123");
    expect(prompt).toContain("test-team-123");
    expect(prompt).toContain("TeamCreate");
    expect(prompt).toContain("TeamDelete");
  });

  test("instructs Bird to message MJ and conductor", () => {
    const prompt = makeConductorPrompt("test-team-456");
    expect(prompt).toContain("Send a message to 'mj'");
    expect(prompt).toContain("Send a message to 'conductor'");
  });

  test("instructs MJ to use only Bird's term", () => {
    const prompt = makeConductorPrompt("test-team-789");
    expect(prompt).toContain("Do NOT invent a term");
    expect(prompt).toContain("use ONLY the term Bird sent you");
  });
});
