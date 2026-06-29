/**
 * llm-client.ts — Lifted `claude -p` spawn seam.
 *
 * Provides a stable interface for invoking the Claude CLI process so that
 * callers (session-judge.ts, session-analyzer.ts) can be tested with an
 * injected mock without spawning a real process.
 *
 * SEAM RULES:
 *   - Only this module may call Bun.spawn for the claude CLI.
 *   - Tests inject a fake LlmClient; they NEVER import this module directly
 *     from the call that spawns the process.
 *
 * TIMEOUT DESIGN (Kobe review fix):
 *   `setTimeout` kill-only is insufficient: if claude ignores SIGTERM or a
 *   grandchild holds the stdout pipe open, `await Promise.all([stdout, exited])`
 *   hangs forever. The fix is Promise.race against an INDEPENDENT deadline that
 *   resolves unconditionally — the process state cannot block the caller.
 *
 * STDERR DRAIN (Kobe review fix):
 *   Undrained stderr → pipe-buffer fills → child blocks → hangs to timeout.
 *   stderr is always drained alongside stdout and returned on non-zero exit.
 */

export interface RunOpts {
  /** Optional model override (passed as --model <model>). */
  model?: string;
  /** Milliseconds before the process is killed. Default: 180_000. */
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  /** Drained stderr — non-empty on non-zero exit (auth errors, rate limits, etc.). */
  stderr: string;
  exitCode: number;
  /** True when the timeout fired and the process was killed. */
  timedOut: boolean;
}

/**
 * Injectable LlmClient interface.
 * Real implementation = runClaudeCli below.
 * Test implementation = fake that returns canned JSON without spawning.
 */
export interface LlmClient {
  run(prompt: string, opts?: RunOpts): Promise<RunResult>;
}

/**
 * Real LlmClient: spawns `claude -p [--model <model>]`, pipes prompt via stdin,
 * returns stdout + stderr + exit code. Kills the process on timeout via Promise.race
 * so the caller always returns within timeoutMs regardless of subprocess state.
 *
 * @param prompt  Full prompt text to send via stdin.
 * @param opts    Optional model and timeout config.
 */
export async function runClaudeCli(prompt: string, opts: RunOpts = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const args = ["-p"];
  if (opts.model) args.push("--model", opts.model);

  const proc = Bun.spawn(["claude", ...args], {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Subprocess task: drain both pipes and wait for exit.
  // This MUST drain stderr to prevent the pipe-buffer-fill deadlock.
  const procTask = async (): Promise<RunResult> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { timedOut: false, stdout, stderr, exitCode: exitCode ?? 0 };
  };

  // Independent deadline: resolves unconditionally at timeoutMs.
  // Promise.race guarantees we return even if the process ignores SIGTERM
  // or a grandchild holds the stdout/stderr pipe open.
  const deadlineTask = new Promise<RunResult>((resolve) =>
    setTimeout(() => {
      // SIGTERM first, then escalate to SIGKILL.
      try { proc.kill(); } catch { /* already dead */ }
      try { proc.kill(9); } catch { /* already dead */ }
      // Best-effort: kill the entire process group so grandchildren die too.
      // Works only when the spawned process is a process-group leader; safe to ignore.
      const pid = proc.pid;
      if (pid != null) { try { process.kill(-pid, 9); } catch { /* not a group leader */ } }
      resolve({ timedOut: true, stdout: "", stderr: "killed: timeout", exitCode: -1 });
    }, timeoutMs)
  );

  // Race: the deadline wins if the process is still alive at timeoutMs.
  return Promise.race([procTask(), deadlineTask]);
}

/**
 * Default real LlmClient instance.
 * Import this when you want the real Claude CLI.
 */
export const defaultLlmClient: LlmClient = {
  run: runClaudeCli,
};
