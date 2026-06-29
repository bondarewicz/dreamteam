/**
 * directive-capture.ts — Human-directive ingestion path (§4 of slice4-design.md).
 *
 * Flow:
 *   surface() → surfaced candidates (never committed) →
 *   human types/edits → captureDirective() →
 *   authorship guard → scrub → upsertDirective
 *
 * Authorship guard (BR-13b/c/e, Bird ruling):
 *   norm(x) = NFKC → lowercase → strip [^a-z0-9 ] → collapse whitespace → trim.
 *   REJECT if norm(content) === norm(suggestion) OR norm(content) is empty.
 *
 * Scrub still applies to directives (BR-9, Rule 7 — abuse-hole mitigation:
 * a human may direct a policy, not smuggle an executable imperative).
 */
import { scrub } from "./instinct-scrub.ts";
import { createInstinctsDb, isDomain, type InstinctsDb, type InstinctCtx, type Instinct } from "./instincts-db.ts";
import type { LlmClient, InstinctCandidate } from "./session-analyzer.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A candidate instinct surfaced to the human for review / editing. */
export interface DirectiveSuggestion {
  trigger: string;
  behavioral_shape: string;
  domain: string;
  /** The suggestion text shown to the human (BR-13a audit trail). */
  suggestionText: string;
}

export interface DirectiveDecision {
  /** The trust anchor — the human confirm keystroke (BR-13a). Caller-supplied. */
  confirmed: boolean;
  /** What the human actually typed/edited (free-text). */
  typedText: string;
}

export type CaptureOutcome =
  | { result: "approved"; instinct: Instinct }
  | { result: "pending"; instinct: Instinct }
  | { result: "rejected-not-authored"; reason: string }
  | { result: "rejected-scrub"; reason: string; matchedRule: string };

export interface CaptureDeps {
  store: InstinctsDb;
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Authorship guard (BR-13b/c/e — Bird ruling)
// ---------------------------------------------------------------------------

/**
 * Normalise text for authorship comparison.
 * NFKC → lowercase → strip non-[a-z0-9 ] → collapse whitespace → trim.
 */
function normAuthorship(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when the human is considered the author of `typed`.
 * REJECT conditions (return false):
 *   - norm(typed) === norm(suggestion)  → human just accepted without editing
 *   - norm(typed) is empty              → nothing substantive was typed
 *
 * Single call site; Bird may tune this function without changing any interface.
 */
export function isHumanAuthored(suggestion: string, typed: string): boolean {
  const nTyped = normAuthorship(typed);
  if (nTyped.length === 0) return false;                       // empty → not authored
  const nSug = normAuthorship(suggestion);
  return nTyped !== nSug;                                       // identical (after norm) → not authored
}

// ---------------------------------------------------------------------------
// createDirectiveCapture
// ---------------------------------------------------------------------------

export function createDirectiveCapture(deps?: Partial<CaptureDeps>): {
  /**
   * Surface candidate directives from a transcript via the injected LlmClient.
   * Returns raw suggestions — never committed. The caller presents them to the human.
   */
  surface(transcript: string, llm: LlmClient, ctx: InstinctCtx): Promise<DirectiveSuggestion[]>;

  /**
   * Commit one directive after the human has typed/edited it and optionally confirmed.
   * Enforces authorship guard + scrub before any DB write.
   */
  captureDirective(
    s: DirectiveSuggestion,
    d: DirectiveDecision,
    ctx: InstinctCtx,
  ): Promise<CaptureOutcome>;
} {
  const store = deps?.store ?? createInstinctsDb();
  const nowFn = deps?.now ?? (() => new Date().toISOString());

  return {
    async surface(transcript: string, llm: LlmClient, ctx: InstinctCtx): Promise<DirectiveSuggestion[]> {
      // Ask the LLM to generalize the transcript into candidate patterns.
      // These are surfaced to the human; NONE are committed.
      const fakeFindings = [{
        finding_id: "surface:transcript",
        session_id: "surface",
        question_id: "surface",
        verdict: "warn" as const,
        evidence: transcript,
        observed_at: nowFn(),
      }];

      let candidates: InstinctCandidate[] = [];
      try {
        const llmResult = await llm.generateCandidates({ rows: fakeFindings });
        candidates = llmResult.candidates;
      } catch {
        return [];
      }

      // Return only candidates with valid domains; never commit them.
      return candidates
        .filter((c) => isDomain(c.domain))
        .map((c) => ({
          trigger: c.trigger,
          behavioral_shape: c.behavioral_shape,
          domain: c.domain,
          suggestionText: c.behavioral_shape, // suggestion text = the proposed behavioral_shape
        }));
    },

    async captureDirective(
      s: DirectiveSuggestion,
      d: DirectiveDecision,
      ctx: InstinctCtx,
    ): Promise<CaptureOutcome> {
      // Step 1: Authorship guard FIRST (BR-13a, BR-12).
      // Reject if the human's typed text is empty or identical (after norm) to the suggestion.
      if (!isHumanAuthored(s.suggestionText, d.typedText)) {
        return {
          result: "rejected-not-authored",
          reason: "typed text is identical to suggestion or empty — human authorship required (BR-13a)",
        };
      }

      // Step 2: Build candidate from human text.
      // v1: trigger from the suggestion, behavioral_shape from typedText (human-authored).
      // Flag: Bird may want BOTH trigger AND behavioral_shape to come from typedText.
      const trigger = s.trigger;
      const behavioral_shape = d.typedText;
      const domain = s.domain;
      const evidence = [d.typedText];

      // Step 3: Scrub (STILL APPLIES — BR-9, imperative Rule 7 abuse-hole mitigation).
      const scrubRes = scrub({ trigger, behavioral_shape, evidence });
      if (!scrubRes.ok) {
        return {
          result: "rejected-scrub",
          reason: scrubRes.reason,
          matchedRule: scrubRes.matchedRule,
        };
      }

      // Step 4: domain assert + identity_key.
      if (!isDomain(domain)) {
        return {
          result: "rejected-scrub",
          reason: `invalid domain: ${domain}`,
          matchedRule: "domain-guard",
        };
      }
      const identity_key = store.identityKey(trigger, domain, behavioral_shape);

      // Step 5: status from keystroke (BR-13a / AC-1b).
      const status = d.confirmed ? "approved" : "pending";

      // Write via store.upsertDirective (confidence=0.9, ingestion_path='human_directive', n=1).
      const instinct = await store.upsertDirective({
        ctx,
        identity_key,
        trigger,
        domain,
        behavioral_shape,
        status,
        suggested_content: s.suggestionText,
      });

      return { result: status, instinct };
    },
  };
}
