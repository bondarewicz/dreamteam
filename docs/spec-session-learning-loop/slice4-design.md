# Slice 4 — The Two Ingestion Paths — Build-Ready Design

**Author:** MJ (Strategic Systems Architect) · **For:** Shaq (implementation) · **Status:** build-ready spec.
**Builds on:** `web/src/db-driver.ts` (seam) · `web/src/instincts-db.ts` (store, Slice 3) · `web/src/instinct-scrub.ts` (scrub gate, Slice 3) · `web/src/session-judge.ts` + `web/src/sessions-db.ts` (upstream judge findings).
**Serves:** architecture.md §3 (two ingestion paths), invoked by §0 in-session learning step, feeds §4 projection.

> **Pending Bird dependencies (structure absorbs either ruling — flagged for MJ reconciliation):**
> 1. **H-2 confidence formula** — exact `deriveConfidence(distinctSessions, severity)` body. Structure: a single pure TS function with one call site. Bird's answer = edit one function body. Provisional default pinned in §3.4.
> 2. **Authorship-guard exact semantics (BR-13a)** — is "byte-identical" raw `===`, or trim/whitespace/case-normalized? Structure: a single pure `isHumanAuthored(suggestion, typed)` function with one call site. Provisional default = raw `===` (strictest) in §4.3.
> Both are isolated behind one function each; neither changes any interface or the data flow.

---

## 0. Reconciliation notes (read first)

1. **Findings source = the existing `session_evals` table, READ-ONLY, via an ACL — not the new seam.** `web/src/sessions-db.ts` owns `session_evals` on the OLD synchronous `getDb()` (db.ts) connection. architecture.md §9 keeps `db.ts`/`sessions-db.ts` untouched until the Turso phase. The analyzer therefore reads findings through a thin **anti-corruption adapter** (`FindingsReader` port), default impl wraps a new read-only function on `sessions-db.ts`. The judge is an **upstream supplier the analyzer conforms to** (Conformist + ACL); one-way read; no write-back.

2. **`findings_json` shape is fixed by the judge.** `score.findings: QuestionVerdict[]` = `{ id: string /* rubric q-id e.g. "S1","C2" */, verdict: "warn"|"fail", evidence: string /* verbatim transcript quote */ }`. **There is no per-finding id, no `agent_id`, and no `tenant_id` on `session_evals` — only `project`.** Consequences pinned below:
   - `finding_id` (required by `signals_buffer`) is **synthesized**: `` `${session_id}:${question.id}` `` (stable, deduplicates on re-read — H-5-friendly).
   - `tenant_id` is NOT in the findings store. It is supplied by the **caller's `InstinctCtx`** (v1 single-tenant constant). The `FindingsReader` filters by `project` only; the analyzer stamps `tenant_id` from ctx.
   - `severity` is derived from `verdict` (`fail` > `warn`). This is the only severity signal available — feeds H-2.

3. **No LLM SDK exists — reuse the `claude -p` spawn.** `session-judge.ts` has a private `runClaude(prompt, model, timeoutMs)` (`Bun.spawn(["claude","-p",...])` + kill-on-timeout). Slice 4 extracts this into a shared `web/src/llm-client.ts` and depends on it behind the `LlmClient` port. Drexler-bias: reuse the proven spawn, do not add an SDK dependency.

4. **`InstinctCandidate` (scrub input) ≠ store row.** `instinct-scrub.ts` `scrub()` takes `{ trigger, behavioral_shape, evidence: string[] }`. The analyzer/capture build this shape, scrub it, and ONLY on `ok:true` compute `identity_key` and call the store. Scrub is **whole-candidate DROP** — a dropped candidate writes nothing.

---

## 1. Module map + boundaries

```
                  ┌────────────────────── §0 in-session step (bin/dreamteam.ts `learn`) ──────────────────────┐
                  │                                                                                            │
   session_evals  │   session-analyzer.ts            directive-capture.ts                                      │
   (judge, R/O)   │   runInstinctAnalyzer()          captureDirective()                                        │
        │         │        │   ▲                          │   ▲                                                │
        ▼         │        ▼   │ (port)                   ▼   │ (ports)                                         │
 [FindingsReader]─┼──► signals │ LlmClient          isHumanAuthored()  LlmClient(opt)                          │
   (ACL adapter)  │   extract  │ .generateCandidates    + scrub()                                              │
                  │        │   │                          │                                                    │
                  │        ▼   │                          ▼                                                    │
                  │   scrub() (DROP)              scrub() (DROP, imperative applies)                           │
                  │        │                              │                                                    │
                  │        ▼                              ▼                                                    │
                  │   instincts-db.recordSignal     instincts-db.upsertDirective                              │
                  │   (buffer→materialize @3)       (n=1, conf 0.9, status from keystroke)                    │
                  └────────────────────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼  (all writes self-contained tx in the store)
                                            db-driver seam
```

| Component | Responsibility | Boundary |
|---|---|---|
| `web/src/llm-client.ts` | The LLM seam. Spawns `claude -p`, kill-on-timeout. `LlmClient` interface; default impl = lifted `runClaude`. | The ONLY new-loop module spawning `claude`. Injectable. No domain logic. |
| `web/src/session-analyzer.ts` | Auto-inferred path: read findings → extract signals → **empty short-circuit (no LLM)** → LLM generalize → **TS confidence** → scrub → `recordSignal`. | Reads findings (R/O via port). Writes only via `instincts-db`. NO DB tx of its own. Strictly validates candidate JSON (M-6, reject never default-fill). |
| `web/src/directive-capture.ts` | Human-directive path: surface candidate, enforce authorship guard, scrub (imperative applies), `upsertDirective`. | Never auto-commits. `status='approved'` ONLY on the confirm-keystroke signal from the caller. |
| `FindingsReader` (port, in `session-analyzer.ts`) | ACL over `session_evals`. | One-way read; conforms to judge shape; isolates the analyzer from the old DB. |

---

## 2. The LLM client seam — `web/src/llm-client.ts`

Lift the proven spawn out of `session-judge.ts` (do NOT duplicate it).

```ts
export interface RunOpts { model?: string; timeoutMs?: number; }
/** Spawns `claude -p`, streams stdin prompt, kills on timeout. Lifted from session-judge.runClaude. */
export async function runClaudeCli(prompt: string, opts: RunOpts): Promise<{ stdout: string; exitCode: number; timedOut: boolean }>;
```

- **Refactor (low-risk, route through Shaq):** replace `session-judge.ts`'s private `runClaude` body with a call to `runClaudeCli` (behavior-identical: same args, same kill-on-timeout). Keeps a single spawn implementation. If the judge refactor is deemed out of slice scope, `llm-client.ts` may stand alone and the judge dedup is a follow-up — note it, do not block.
- **Timeout:** analyzer passes `timeoutMs: 30_000` (H-7, distinct from the judge's 180_000). `runClaudeCli` returns `timedOut:true` when the kill fired so the analyzer can branch.

The analyzer-facing port (defined in `session-analyzer.ts`, NOT in the seam — keeps the seam domain-free):

```ts
export interface InstinctCandidate {            // scrub-shaped + domain + provenance
  trigger: string; behavioral_shape: string; domain: string;
  evidence: string[]; source_session_ids: string[];
}
export interface LlmClient {
  /** Generalize findings → candidates. Throws/returns [] on timeout or unparseable output. */
  generateCandidates(input: GeneralizeInput, signal?: AbortSignal): Promise<InstinctCandidate[]>;
}
```
Default impl wraps `runClaudeCli` (`timeoutMs:30_000`), builds a prompt from the bounded findings window, parses JSON with the judge's **strict** discipline (`extractJson` style; reject-not-default-fill — M-6), validates each candidate: non-empty `trigger`/`behavioral_shape`, `isDomain(domain)` (from `instincts-db`), `evidence` non-empty array. **Any malformed candidate is dropped, never repaired.** Tests inject a fake `LlmClient` (§6) — no network, no spawn.

---

## 3. `session-analyzer.ts` — auto-inferred path

### 3.1 Public API
```ts
export interface AnalyzerDeps {
  findings: FindingsReader;     // default: makeSessionEvalsReader()
  llm: LlmClient;               // default: makeClaudeLlmClient()
  store: InstinctsDb;           // default: createInstinctsDb()
  now?: () => string;           // default: () => new Date().toISOString()  (test seam)
}
export interface AnalyzerCtx { tenant_id: string; project: string; windowLimit?: number; }
export interface AnalyzerResult {
  llmCalled: boolean; candidatesGenerated: number; candidatesScrubbed: number;
  signalsRecorded: number; materialized: number[]; /* instinct ids */
}
export function createSessionAnalyzer(deps?: Partial<AnalyzerDeps>): {
  runInstinctAnalyzer(ctx: AnalyzerCtx): Promise<AnalyzerResult>;
};
```

### 3.2 FindingsReader port (ACL)
```ts
export interface FindingRow { session_id: string; question_id: string; verdict: "warn"|"fail"; evidence: string; observed_at: string; }
export interface FindingsReader { recent(project: string, windowLimit: number): Promise<FindingRow[]>; }
```
Default impl = new read-only function in `sessions-db.ts`:
`getRecentFindings(project, limit)` → reads the most-recent `limit` rows of `session_evals` for `project` (latest `prompt_version` per session — newest `judged_at`), parses `findings_json`, flattens to `FindingRow[]` (one per warn/fail entry, `question_id=q.id`, `observed_at=judged_at`). **Read-only addition; does not touch write paths or the seam rigidity** (that rigidity is about driver IMPORTS, not about read queries on the legacy eval DB).
`windowLimit` default **50 sessions** (bounded LLM input + bounded cost) — a tunable; flag for ops.

### 3.3 Flow (single-flight safe — all LLM/scrub OUTSIDE any tx)
1. `rows = await findings.recent(ctx.project, windowLimit)`  *(DB read, no tx held)*
2. **Empty short-circuit (MANDATORY, H-7):** if `rows.length === 0` → return `{ llmCalled:false, ... zeros }` **BEFORE constructing the LLM client call.** Most sessions hit this. Assert in tests: zero `generateCandidates` invocations.
3. `candidates = await llm.generateCandidates({ rows }, AbortSignal.timeout(30_000))` *(≤30s, H-7)*. On timeout/parse-fail → `candidates = []`, `llmCalled:true`; analyzer returns gracefully (no throw up to the CLI; log + continue to projection).
4. For each candidate (pure compute, no DB):
   a. `scrubRes = scrub({ trigger, behavioral_shape, evidence })` — **whole-candidate DROP** on `ok:false` (skip; count as scrubbed-out).
   b. `domain` validated by `isDomain` (already done in LLM impl; re-assert defensively).
   c. `identity_key = store.identityKey(trigger, domain, behavioral_shape)`.
   d. `distinct = new Set(candidate.source_session_ids).size`.
   e. `confidence = deriveConfidence(distinct, severityOf(candidate))` — **TS-derived (H-2); model value ignored.** ROUND to 2 dp (H-3).
5. **Writes (each store call opens its own tx internally — analyzer opens NONE):** for each surviving candidate, for each `session_id` in `source_session_ids`:
   `await store.recordSignal({ identity_key, tenant_id: ctx.tenant_id, project: ctx.project, session_id, finding_id: \`${session_id}:${candidate.primary_question_id}\`, evidence_scrubbed: <clean evidence>, observed_at: now() }, { confidence, trigger, domain, behavioral_shape })`.
   Collect `materialized` ids where `res.materialized === true`. **All `recordSignal` calls are sequential awaits — never wrapped in `store.transaction` by the analyzer** (the store already does single-flight: compute-then-tx). No LLM/scrub happens after step 4, so no non-DB await can land inside a tx.
6. Return `AnalyzerResult`.

> **CRITICAL single-flight invariant (db-driver.ts):** the analyzer performs ALL LLM + scrub work in steps 2–4, THEN all writes in step 5. There is structurally no path where an LLM/scrub await sits inside `transaction(fn)` — the analyzer never calls `transaction` at all; it calls `recordSignal`, which itself computes everything before opening its tx.

### 3.4 `deriveConfidence` (H-2 — **PROVISIONAL, pending Bird**)
```ts
/** PROVISIONAL (Bird H-2 ruling pending). Single call site; one function body to swap. */
export function deriveConfidence(distinctSessions: number, severity: "warn"|"fail"): number {
  // candidate from spec §"H-2 formula not yet pinned": +0.1 per 3 sessions past the threshold,
  // optional severity nudge. Clamp [0.3,0.9], ROUND 2dp (H-3, BR-2).
  const base = 0.3 + Math.floor((distinctSessions - 3) / 3) * 0.1;
  const sev  = severity === "fail" ? 0.0 : 0.0;     // severity multiplier DEFERRED to v1.1 per spec
  return Math.round(Math.min(0.9, Math.max(0.3, base + sev)) * 100) / 100;
}
```
Boundary tests required regardless of final formula (§6): 3 sessions → in [0.3,0.9]; output is multiple of 0.01; never <0.3 or >0.9.

---

## 4. `directive-capture.ts` — human-directive path

### 4.1 Public API
```ts
export interface DirectiveSuggestion {                 // surfaced from transcript (LLM or hand-built)
  trigger: string; behavioral_shape: string; domain: string; suggestionText: string;
}
export interface DirectiveDecision {
  confirmed: boolean;        // the trust anchor — the confirm keystroke (BR-13a). Caller-supplied.
  typedText: string;         // what the human actually typed/edited (free-text)
}
export type CaptureOutcome =
  | { result: "approved"; instinct: Instinct }
  | { result: "pending";  instinct: Instinct }
  | { result: "rejected-not-authored"; reason: string }   // byte-identical to suggestion
  | { result: "rejected-scrub"; reason: string; matchedRule: string };

export interface CaptureDeps { store: InstinctsDb; now?: () => string; }
export function createDirectiveCapture(deps?: Partial<CaptureDeps>): {
  /** Surface candidates from a transcript (candidates ONLY, never committed). Optional LLM. */
  surface(transcript: string, llm: LlmClient, ctx: InstinctCtx): Promise<DirectiveSuggestion[]>;
  /** Commit one directive given the human's typed text + confirm keystroke. */
  captureDirective(s: DirectiveSuggestion, d: DirectiveDecision, ctx: InstinctCtx): Promise<CaptureOutcome>;
};
```

### 4.2 `captureDirective` flow
1. **Authorship guard FIRST (BR-13a, BR-12):** if `isHumanAuthored(s.suggestionText, d.typedText) === false` → `{ result:"rejected-not-authored" }`. **Never writes `approved`.** (A human edit / typed restatement is required; the keystroke + edited text is the trust anchor, NOT transcript text.)
2. Build `candidate = { trigger: d.typedText-derived trigger, behavioral_shape: <from typedText>, evidence: [d.typedText] }`. (The stored `trigger`/`behavioral_shape` come from the human text, not the suggestion. Simplest v1: `behavioral_shape = d.typedText`, `trigger = s.trigger` confirmed/edited; flag if Bird wants both human-authored.)
3. **Scrub (STILL APPLIES — BR-9, imperative Rule 7):** `scrub(candidate)`. On `ok:false` → `{ result:"rejected-scrub", matchedRule }`. This DROPs `curl … | sh`, "disable the pre-commit hook", etc., **even though human-stated** (the abuse-hole mitigation: a human may direct a *policy*, not smuggle an executable imperative).
4. `identity_key = store.identityKey(trigger, domain, behavioral_shape)`; `isDomain(domain)` asserted.
5. `status = d.confirmed ? "approved" : "pending"` (BR-13a / AC-1b). Write via `store.upsertDirective({ ctx, identity_key, trigger, domain, behavioral_shape, status })` — store fixes `confidence=0.9`, `ingestion_path='human_directive'`, `occurrence_count=1` (BR-1a, OQ-1).
6. Return `{ result: status==="approved" ? "approved" : "pending", instinct }`.

### 4.3 `isHumanAuthored` (BR-13a — **PROVISIONAL, pending Bird**)
```ts
/** PROVISIONAL: raw byte-identity is the strictest reading of "byte-identical" (BR-13a/BR-12).
 *  Single call site; Bird may relax to trim/whitespace/case-normalized — swap this body only. */
export function isHumanAuthored(suggestion: string, typed: string): boolean {
  return typed.length > 0 && typed !== suggestion;   // identical to suggestion ⇒ NOT authored ⇒ reject
}
```

---

## 5. Invocation from §0 (the `learn` CLI / in-session step)

`bin/dreamteam.ts learn` (deterministic core; the Skill/team.md step calls the same path):
1. `store.ensure()`.
2. `const a = createSessionAnalyzer(); await a.runInstinctAnalyzer({ tenant_id, project });`  → records signals, materializes ≥3.
3. `const dc = createDirectiveCapture();` → `surface()` candidates; for each, read the human's typed/edited line + confirm keystroke from the CLI prompt; `captureDirective(...)`. (`AskUserQuestion` yes/no is acceptable ONLY for auto-inferred pending approval, never for directive authorship — directive requires free-text.)
4. Present auto `pending` instincts for approve/reject via `store.setStatus`.
5. `memory-projection.regenerate({ tenant_id, project })` — **decoupled from `DREAMTEAM_LEARN`** (Fix-3/AC-6): projection always runs; learning gate guards only steps 2–3.

`tenant_id` v1 = single-tenant constant (config); `project` = current project slug (mirrors `projIdFromTranscript` in `session-eval-hook.ts`).

---

## 6. Test plan (`web/src/__tests__/`) — all LLM injected, no network/spawn

**Mock injection:** every test constructs `createSessionAnalyzer({ findings: fakeReader, llm: fakeLlm, store: realStoreOn(:memory:), now: () => fixedIso })`. `fakeLlm.generateCandidates` is a `mock()` returning canned `InstinctCandidate[]` and **recording call count**. `fakeReader.recent` returns canned `FindingRow[]`. Store is the REAL `createInstinctsDb(createDriver(":memory:"))` so materialization SQL is exercised end-to-end.

| # | Test | Asserts |
|---|---|---|
| T1 | **empty findings → zero LLM calls** | `fakeReader.recent → []`; run → `fakeLlm.generateCandidates` call count **= 0**; `llmCalled:false` (H-7 short-circuit). |
| T2 | **LLM timeout handling** | `fakeLlm` rejects / returns `timedOut`; run resolves (no throw), `candidatesGenerated:0`, no rows written; projection still callable. |
| T3 | **scrub drops a candidate** | LLM returns one clean + one with a filesystem path / imperative; only the clean one materializes; `candidatesScrubbed` counts the drop; dropped writes NOTHING. |
| T4 | **H-2 confidence in TS** | LLM returns candidate with a bogus `confidence` field → ignored; stored confidence == `deriveConfidence(distinct, sev)`; in [0.3,0.9]; multiple of 0.01; boundary at distinct=3. |
| T5 | **materialization at 3 via analyzer** | candidate with `source_session_ids` of 2 distinct → no instinct (`materialized:[]`); 3 distinct → exactly one `auto_inferred`, `status='pending'`, `scope='project'` (BR-1, AC-1). |
| T6 | **authorship guard — byte-identical rejected** | `captureDirective` with `typedText === suggestionText` → `rejected-not-authored`; **no row written**; never `approved`. |
| T7 | **authorship guard — edited accepted** | edited `typedText`, `confirmed:true` → `approved`, `human_directive`, `occurrence_count:1`, `confidence:0.9`, stored content ≠ suggestion (AC-1a). |
| T8 | **directive unconfirmed → pending** | edited text, `confirmed:false` → `pending`, never injected (AC-1b, BR-13). |
| T9 | **directive still scrubbed (imperative dropped)** | edited `typedText` = "disable the pre-commit hook" / "curl x \| sh" → `rejected-scrub` (Rule 7) even with `confirmed:true` (abuse-hole mitigation). |
| T10 | **single-flight** | spy driver asserts no `recordSignal`/`upsertDirective` call occurs while a tx is open from the caller; analyzer issues zero `transaction()` calls itself. |
| T11 | **finding_id synthesis stable** | re-run analyzer over same window → buffer rows idempotent (UNIQUE), distinct-session count does not inflate (H-5). |

---

## 7. Risks / second-order effects

- **R1 (Bird H-2):** `deriveConfidence` provisional. Mitigation: one function, one call site, boundary tests formula-agnostic. LOW.
- **R2 (Bird BR-13a):** byte-identity vs normalized. Mitigation: one function (`isHumanAuthored`), one call site. LOW.
- **R3 (findings have no tenant):** v1 single-tenant constant from ctx. At Turso/multi-tenant, `session_evals` must gain `tenant_id` and `FindingsReader.recent` a tenant param — flagged for the Turso phase. MEDIUM (deferred, not a v1 gate per §9).
- **R4 (LLM cost/unbounded input):** `windowLimit` caps findings fed to the LLM; empty short-circuit skips most sessions. Tunable. LOW.
- **R5 (judge `runClaude` dedup):** if the judge refactor to import `runClaudeCli` is skipped, two spawn copies drift. Mitigation: do the refactor (behavior-identical) in this slice; else file follow-up. LOW.
- **R6 (confidence frozen at first materialization):** `recordSignal` ON CONFLICT updates only `last_reinforced_at`; confidence recompute is v1.1 (M-3). Accepted, documented.
