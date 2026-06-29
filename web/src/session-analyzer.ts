/**
 * session-analyzer.ts — Auto-inferred instinct ingestion path (§3 of slice4-design.md).
 *
 * Flow:
 *   FindingsReader (R/O, ACL over sessions-db) → empty short-circuit →
 *   LlmClient.generateCandidates → scrub (DROP) → store.recordSignal (per session)
 *
 * CRITICAL single-flight invariant: ALL LLM + scrub work happens BEFORE any
 * store write. The analyzer opens ZERO transactions of its own.
 *
 * SEAM RULES:
 *   - Imports runClaudeCli from llm-client.ts for the default LlmClient impl.
 *   - The LlmClient interface is declared HERE (domain-free seam stays seam-free).
 *   - Analyzer never calls store.transaction(); each store.recordSignal() manages
 *     its own single-flight tx internally.
 */
import { scrub, maskEvidence, type InstinctCandidate as ScrubCandidate } from "./instinct-scrub.ts";
import { createInstinctsDb, isDomain, type InstinctsDb } from "./instincts-db.ts";
import { getRecentFindings, type FindingRow } from "./sessions-db.ts";
import { runClaudeCli } from "./llm-client.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A candidate instinct surfaced by the LLM from the findings window.
 * NOTE: This is the ANALYZER-domain shape, distinct from scrub-module's InstinctCandidate
 * (which has no domain / source_session_ids). Passed to scrub after stripping the extras.
 */
export interface InstinctCandidate {
  trigger: string;
  behavioral_shape: string;
  domain: string;
  evidence: string[];
  /** Session ids where this pattern was observed (used to drive recordSignal per session). */
  source_session_ids: string[];
}

/** Input fed to the LLM to generalize findings into candidate instincts. */
export interface GeneralizeInput {
  rows: FindingRow[];
}

/**
 * Analyzer-domain LlmClient (domain-aware, NOT the bare seam).
 * Default impl wraps runClaudeCli; tests inject a fake.
 */
export interface LlmClient {
  /**
   * Generalize findings into candidate instincts.
   * Returns LlmResult (never throws) on timeout or unparseable output.
   * Malformed candidates are dropped by the default impl (M-6).
   * The timedOut flag is surfaced in AnalyzerResult so callers can observe failures.
   */
  generateCandidates(input: GeneralizeInput): Promise<LlmResult>;
}

/** ACL adapter over sessions-db that isolates the analyzer from the eval DB schema. */
export interface FindingsReader {
  recent(project: string, windowLimit: number): Promise<FindingRow[]>;
}

export interface AnalyzerDeps {
  findings: FindingsReader;
  llm: LlmClient;
  store: InstinctsDb;
  /** Injectable clock for tests (default: () => new Date().toISOString()). */
  now?: () => string;
}

export interface AnalyzerCtx {
  tenant_id: string;
  project: string;
  /** How many session evals to read. Default: 50. */
  windowLimit?: number;
}

export interface AnalyzerResult {
  llmCalled: boolean;
  candidatesGenerated: number;
  /** Candidates dropped by scrub. */
  candidatesScrubbed: number;
  signalsRecorded: number;
  /** instinct_ids where materialization happened (occurrence_count reached 3). */
  materialized: number[];
  /**
   * True when the LLM call timed out.
   * Previously this was silently swallowed (returned []); now surfaced so callers
   * can observe and alert on timeout failures.
   * Always false when llmCalled is false (empty-findings short-circuit).
   */
  llmTimedOut: boolean;
}

// ---------------------------------------------------------------------------
// Default implementations (wired at runtime; overridden by tests)
// ---------------------------------------------------------------------------

/**
 * Default FindingsReader: wraps getRecentFindings from sessions-db.
 * Read-only; does not touch the write path.
 */
export function makeSessionEvalsReader(): FindingsReader {
  return {
    async recent(project: string, windowLimit: number): Promise<FindingRow[]> {
      return getRecentFindings(project, windowLimit);
    },
  };
}

// ---------------------------------------------------------------------------
// JSON extraction (strict — reject not default-fill, M-6)
// ---------------------------------------------------------------------------

/** @internal exported for unit tests only — not part of the stable public API */
export function extractCandidatesJson(raw: string): unknown[] | null {
  // Try to find a JSON array in the output. Prefer a fenced block.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const attempt = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Find the first [...] that parses.
  const start = attempt.indexOf("[");
  if (start === -1) return null;
  // Walk from the end looking for the matching close bracket.
  const end = attempt.lastIndexOf("]");
  if (end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(attempt.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Validate a raw LLM-supplied object as an InstinctCandidate. Drop (return null) if invalid.
 * @internal exported for unit tests only — not part of the stable public API */
export function validateCandidate(raw: unknown): InstinctCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const trigger = typeof obj.trigger === "string" ? obj.trigger.trim() : "";
  const behavioral_shape = typeof obj.behavioral_shape === "string" ? obj.behavioral_shape.trim() : "";
  const domain = typeof obj.domain === "string" ? obj.domain.trim() : "";
  const evidence = Array.isArray(obj.evidence) ? (obj.evidence as unknown[]).filter((e): e is string => typeof e === "string") : [];
  const source_session_ids = Array.isArray(obj.source_session_ids)
    ? (obj.source_session_ids as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  // M-6: reject, never default-fill
  if (!trigger) return null;
  if (!behavioral_shape) return null;
  if (!isDomain(domain)) return null;
  if (evidence.length === 0) return null;
  if (source_session_ids.length === 0) return null;

  return { trigger, behavioral_shape, domain, evidence, source_session_ids };
}

/**
 * Result returned by LlmClient.generateCandidates.
 * Carries the timeout signal so the analyzer can surface it in AnalyzerResult
 * rather than silently swallowing it.
 */
export interface LlmResult {
  candidates: InstinctCandidate[];
  /** True when the underlying LLM call timed out (candidates will be []). */
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Default LlmClient (wraps runClaudeCli — H-7)
//
// Real-measured p99 latency for claude -p on 26 findings / 6584-char prompt = 56s.
// Use 120s so there is ample headroom for larger windows without silent failures.
// Do NOT rely on runClaudeCli's 180s default — keep the analyzer's budget explicit.
// ---------------------------------------------------------------------------

/** Milliseconds budget for the LLM call inside the analyzer. */
export const ANALYZER_LLM_TIMEOUT_MS = 120_000;

const GENERALIZE_PROMPT_TEMPLATE = `You are analyzing session evaluation findings to extract generalizable behavioral instincts for an AI coding agent.

Given the following warn/fail findings from recent sessions, identify recurring behavioral patterns that represent systemic issues. Return a JSON array of instinct candidates.

## Findings
{{FINDINGS}}

## Instructions
- Each candidate must have: trigger (what context triggers the pattern), behavioral_shape (the problematic behavior), domain (one of: git, code_quality, testing, process, communication, security, other), evidence (array of verbatim quotes from the findings), source_session_ids (array of session ids where observed).
- Return ONLY patterns observed in 2+ sessions.
- Return ONLY valid JSON array. No prose before or after.
- Malformed or uncertain patterns: OMIT entirely.

## Output format
[{"trigger":"...","behavioral_shape":"...","domain":"...","evidence":["..."],"source_session_ids":["..."]}]`;

export function makeClaudeLlmClient(): LlmClient {
  return {
    async generateCandidates(input: GeneralizeInput): Promise<LlmResult> {
      const findingsText = input.rows
        .map((r) => `[${r.session_id}] ${r.verdict.toUpperCase()} ${r.question_id}: ${r.evidence}`)
        .join("\n");

      const prompt = GENERALIZE_PROMPT_TEMPLATE.replace("{{FINDINGS}}", findingsText);

      const { stdout, timedOut } = await runClaudeCli(prompt, { timeoutMs: ANALYZER_LLM_TIMEOUT_MS });
      if (timedOut) {
        console.warn(
          `[session-analyzer] LLM call timed out after ${ANALYZER_LLM_TIMEOUT_MS}ms — ` +
          `returning empty candidates (real p99 latency measured at ~56s; increase budget if this fires).`,
        );
        return { candidates: [], timedOut: true };
      }

      const raw = extractCandidatesJson(stdout);
      if (!raw) return { candidates: [], timedOut: false };

      const candidates = raw.map(validateCandidate).filter((c): c is InstinctCandidate => c !== null);
      return { candidates, timedOut: false };
    },
  };
}

// ---------------------------------------------------------------------------
// createSessionAnalyzer
// ---------------------------------------------------------------------------

export function createSessionAnalyzer(deps?: Partial<AnalyzerDeps>): {
  runInstinctAnalyzer(ctx: AnalyzerCtx): Promise<AnalyzerResult>;
} {
  const findings = deps?.findings ?? makeSessionEvalsReader();
  const llm = deps?.llm ?? makeClaudeLlmClient();
  const store = deps?.store ?? createInstinctsDb();
  const nowFn = deps?.now ?? (() => new Date().toISOString());

  return {
    async runInstinctAnalyzer(ctx: AnalyzerCtx): Promise<AnalyzerResult> {
      const windowLimit = ctx.windowLimit ?? 50;

      // Step 1: Read findings (no tx held, read-only).
      // Guard: a buggy FindingsReader impl could return a non-array; treat as empty (MINOR-8).
      const rawRows = await findings.recent(ctx.project, windowLimit);
      const rows: FindingRow[] = Array.isArray(rawRows) ? rawRows : [];

      // Step 2: H-7 empty short-circuit — BEFORE any LLM call.
      // Most sessions hit this: no findings → zero LLM cost.
      if (rows.length === 0) {
        return {
          llmCalled: false,
          candidatesGenerated: 0,
          candidatesScrubbed: 0,
          signalsRecorded: 0,
          materialized: [],
          llmTimedOut: false,
        };
      }

      // Step 3: LLM generalization (OUTSIDE any tx — single-flight safety).
      // On timeout/parse-fail → empty candidates; analyzer returns gracefully (no throw).
      let candidates: InstinctCandidate[] = [];
      let llmTimedOut = false;
      try {
        const llmResult = await llm.generateCandidates({ rows });
        candidates = llmResult.candidates;
        llmTimedOut = llmResult.timedOut;
      } catch {
        // LLM failure: log and continue with zero candidates
        candidates = [];
        llmTimedOut = false;
      }

      // Build session → severity lookup (max severity wins: fail > warn)
      const sessionSeverity = new Map<string, "warn" | "fail">();
      const sessionFindings = new Map<string, FindingRow[]>();
      for (const row of rows) {
        if (!sessionFindings.has(row.session_id)) sessionFindings.set(row.session_id, []);
        sessionFindings.get(row.session_id)!.push(row);
        // fail wins over warn
        const prev = sessionSeverity.get(row.session_id);
        if (!prev || row.verdict === "fail") sessionSeverity.set(row.session_id, row.verdict);
      }

      // Steps 4–5: Scrub → identityKey → recordSignal (per session_id in source_session_ids)
      // All pure computation (scrub, identity_key) done BEFORE any store call. ✓
      let candidatesScrubbed = 0;
      let signalsRecorded = 0;
      const materializedIds: number[] = [];

      for (const candidate of candidates) {
        // Step 4a: Scrub (whole-candidate DROP on ok:false).
        // BR-SG-3: DROP gate restricted to PROJECTED fields only (trigger + behavioral_shape).
        // Evidence is NEVER projected (memory-projection.ts serialises only trigger/behavioral_shape/
        // domain/confidence/ingestion_path/occurrence_count — verified by Bird in memory-projection.ts).
        // A candidate MUST NOT be dropped because of evidence content.
        // Cross-field detection (BR-SG-5) is preserved: buildCrossFieldTexts() still generates the
        // trigger+" "+behavioral_shape join even when evidence:[] — see instinct-scrub.ts.
        const scrubInput: ScrubCandidate = {
          trigger: candidate.trigger,
          behavioral_shape: candidate.behavioral_shape,
          evidence: [], // BR-SG-3: evidence excluded from DROP gate
        };
        const scrubRes = scrub(scrubInput);
        if (!scrubRes.ok) {
          candidatesScrubbed++;
          continue;
        }

        // Step 4b: domain re-assert (defensive; already validated in LLM client)
        if (!isDomain(candidate.domain)) {
          candidatesScrubbed++;
          continue;
        }

        // Step 4c: identity_key (pure, BEFORE any DB call)
        const identity_key = store.identityKey(candidate.trigger, candidate.domain, candidate.behavioral_shape);

        // Step 4d: intersect source_session_ids with the KNOWN window (IMPORTANT-4).
        // Hallucinated session ids would record phantom signals that can wrongly advance
        // the BR-1 3-distinct-session threshold. DROP unknown ids before any recordSignal.
        const knownSessions = new Set(sessionFindings.keys());
        const distinctSessions = new Set(
          candidate.source_session_ids.filter((id) => knownSessions.has(id)),
        );

        // Step 5: Writes — one recordSignal per unique session_id (NO tx wrapper here)
        const now = nowFn();
        // BR-SG-4: mask hard identifiers in evidence before storing at rest.
        // maskEvidence() is deterministic (same input → same output); replaces identified
        // spans with [redacted] without dropping the candidate.
        // AC-SG-8: if evidence[0] is entirely an identifier, returns "[evidence masked]".
        const evidenceScrubbed = maskEvidence(candidate.evidence[0] ?? "");

        for (const session_id of distinctSessions) {
          const severity = sessionSeverity.get(session_id) ?? "warn";
          // Use the first FindingRow for this session as the finding_id source
          const sessionRows = sessionFindings.get(session_id);
          const finding_id = sessionRows?.[0]?.finding_id ?? `${session_id}:unknown`;

          const res = await store.recordSignal(
            {
              identity_key,
              tenant_id: ctx.tenant_id,
              project: ctx.project,
              session_id,
              finding_id,
              evidence_scrubbed: evidenceScrubbed,
              observed_at: now,
              severity,
            },
            {
              trigger: candidate.trigger,
              domain: candidate.domain,
              behavioral_shape: candidate.behavioral_shape,
            },
          );

          signalsRecorded++;
          if (res.materialized && res.instinctId !== undefined) {
            materializedIds.push(res.instinctId);
          }
        }
      }

      return {
        llmCalled: true,
        candidatesGenerated: candidates.length,
        candidatesScrubbed,
        signalsRecorded,
        materialized: materializedIds,
        llmTimedOut,
      };
    },
  };
}
