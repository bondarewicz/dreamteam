// All shared types and interfaces for the eval pipeline

// "error" = the judge could not produce a verdict (throttle / non-zero exit / unparseable
// output). It is NOT a model outcome — exclude it from pass/partial/fail tallies and pass_rate.
export type Score = "pass" | "partial" | "fail" | "error";

export interface GraderDef {
  type: string;
  values?: string | string[];
  pattern?: string;
  sections?: string | string[];
  path?: string;
  min?: number;
  max?: number;
  min_items?: number;
  max_items?: number;
  type_check?: string;
  exists?: boolean;
  equals?: unknown;
  contains?: unknown;
  case_sensitive?: boolean;
  one_of?: unknown[];
  /**
   * Advisory opt-out. By default every grader is a HARD gate: a failure forces
   * the score to `fail`, overriding the LLM judge. Set `advisory: true` to make
   * a grader's failure non-gating — it is still recorded in grader_results for
   * the reviewer, but the LLM judge's verdict stands. Use for soft/heuristic
   * checks (confidence floors, supporting-evidence counts, prose-format checks)
   * where a legitimately-correct output can still trip the grader.
   */
  advisory?: boolean;
}

export interface GraderResult {
  type: string;
  config: Record<string, unknown>;
  passed: boolean;
  detail: string;
}

export interface ScenarioMeta {
  scenarioId: string;
  scenarioFile: string;
  agent: string;
  scenarioName: string;
  scenarioType: string;
  category: string;
}

export interface ScenarioFields {
  prompt: string;
  expectedBehavior: string;
  failureModes: string;
  scoringRubric: string;
  referenceOutput: string;
  graders: GraderDef[] | null;
}

export interface RawOutput {
  agent: string;
  scenario_id: string;
  agent_output: string;
  agent_output_excerpt: string;
  duration_ms: number;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: string;
  trace: unknown[];
  error?: string;
}

export interface TrialResult {
  score: Score;
  confidence_stated: number;
  justification: string;
  observations: Array<{ type: string; text: string }>;
  agent_output_excerpt: string;
  duration_ms: number;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: string;
  grader_results?: GraderResult[];
  grader_override?: boolean;
  failure_reason?: string;
}

export interface ScoredResult {
  agent: string;
  scenario_id: string;
  scenario_type: string;
  scenario_name: string;
  score: Score;
  confidence_stated: number;
  justification: string;
  observations: Array<{ type: string; text: string }>;
  agent_output_excerpt: string;
  duration_ms: number;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: string;
  run_id?: string;
  grader_results?: GraderResult[];
  grader_override?: boolean;
  category?: string;
  trials?: TrialResult[];
  flaky?: boolean;
  pass_hat_k?: boolean;
}

export interface AgentSummary {
  pass: number;
  partial: number;
  fail: number;
  pass_rate: number;
  avg_confidence_stated: number | null;
  calibration_gap: number | null;
}

export interface FinalResult {
  run_id: string;
  date: string;
  is_complete_baseline: boolean;
  scenarios_total: number;
  scenarios_run: number;
  summary: {
    pass: number;
    partial: number;
    fail: number;
    error?: number; // scenarios the judge could not score (excluded from pass_rate)
    pass_rate: number;
  };
  results: ScoredResult[];
  agent_summaries: Record<string, AgentSummary>;
  meta: {
    repo_commit: string;
    trials: number;
    notes: string;
    model?: string;
  };
}

export interface ClaudeAdapter {
  run(
    args: string[],
    stdin: string,
    timeoutMs: number,
    /**
     * Working directory for the spawned CLI. Used to give scratch-writing agents
     * (Shaq) an isolated, ephemeral cwd per run so the scenario's `.tmp/…` paths
     * can never collide across runs or parallel trials. Omitted → inherits the
     * harness cwd (repo root), which is correct for repo-reading analysis agents.
     */
    cwd?: string
  ): Promise<{ stdout: string; exitCode: number }>;
}

export interface PipelineOptions {
  parallel: number;
  resumeDir: string;
  agentFilter: string;
  scenarioFilter: string;
  phase: "agents" | "graders" | "score" | "all";
  trials: number;
  dryRun: boolean;
  timeoutPerPhase: number;
  repoRoot: string;
  model?: string;
  /** Resolve each agent's model from its tier for this provider (when --model is not given). */
  provider?: string;
}

export interface DiscoveredScenario {
  scenarioFile: string;
  agent: string;
  scenarioId: string;
}
