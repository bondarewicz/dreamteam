// All shared types and interfaces for the eval pipeline

export type Score = "pass" | "partial" | "fail";

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

export interface TeamPhase {
  phaseNum: number;
  agent: string;
  prompt: string;
  expectedBehavior: string;
  failureModes: string;
  scoringRubric: string;
  gradersRaw: string;
  referenceOutput: string;
  humanDecision: string;
}

export interface PipelineFields {
  pipelineExpectedBehavior: string;
  pipelineFailureModes: string;
  pipelineScoringRubric: string;
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
  // For team scenarios
  phases?: PhaseOutput[];
  pipeline_fields?: Record<string, string>;
}

export interface PhaseOutput {
  phase_num: number;
  agent: string;
  agent_output: string;
  duration_ms: number;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  is_fixture: boolean;
  trace: unknown[];
  grader_results?: GraderResult[];
  grader_override?: boolean;
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
  phases?: PhaseOutput[];
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
  phases?: PhaseOutput[];
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
    pass_rate: number;
  };
  results: ScoredResult[];
  agent_summaries: Record<string, AgentSummary>;
  meta: {
    repo_commit: string;
    trials: number;
    notes: string;
  };
}

export interface ClaudeAdapter {
  run(
    args: string[],
    stdin: string,
    timeoutMs: number
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
}

export interface DiscoveredScenario {
  scenarioFile: string;
  agent: string;
  scenarioId: string;
}
