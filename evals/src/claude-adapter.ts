/**
 * claude-adapter.ts — ClaudeAdapter interface + Bun.spawn implementation
 *
 * Production code uses BunClaudeAdapter.
 * Tests inject a mock that returns canned NDJSON strings.
 */

import type { ClaudeAdapter } from "./types.ts";

export type { ClaudeAdapter };

/**
 * Production adapter: wraps Bun.spawn to call the claude CLI.
 */
export class BunClaudeAdapter implements ClaudeAdapter {
  async run(
    args: string[],
    stdin: string,
    timeoutMs: number
  ): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(["claude", ...args], {
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutHandle = setTimeout(() => {
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

    clearTimeout(timeoutHandle);

    return { stdout, exitCode: exitCode ?? 0 };
  }
}
