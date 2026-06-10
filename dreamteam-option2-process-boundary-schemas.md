# dreamteam — Option 2: Process-Boundary Schema Enforcement

**Goal:** replace the current "prompt-defined output schema + Coach K re-validates the fields"
markdown-guard approach with *enforced* schemas, by dispatching each worker as a
`claude -p` subprocess that carries its own `--json-schema`. The typed contract moves from
prompt convention to the process boundary.

**Context:** issue [#20625](https://github.com/anthropics/claude-code/issues/20625)
(per-subagent schema in `.claude/agents/*.md`) is closed, so the native-to-markdown path is
dead. The `--json-schema` flag only binds a top-level `claude -p` invocation — so to use it,
Coach K must stop dispatching via the Task tool and instead spawn one headless process per
worker.

> **Mechanism caveat:** `--json-schema` is *validate-and-retry after generation*, NOT
> token-level constrained decoding. Claude finishes, the CLI validates against the schema and
> re-prompts on mismatch; if it can't satisfy the schema within the retry limit you get an
> error result instead of data. It's a real contract, not a guarantee. (Token-level guarantee
> only exists on the raw API via `output_config.format`, which would mean abandoning the CLI
> entirely.)

---

## What you gain vs. lose

**Gain**
- Enforced typed payload per worker — markdown guards become unnecessary.
- Real OS-level parallelism for fan-out phases (Bird+MJ concurrent; Kobe+Pippen+Drexler
  parallel) via `Promise.all` over spawned processes — arguably cleaner than agent-teams.
- Model pinning preserved per agent (`--model`), so eval baselines stay reproducible.
- Tool restriction preserved per agent (`--allowedTools`), mirroring current frontmatter.

**Lose**
- The Task-tool / agent-teams orchestration and shared session context. Each `claude -p`
  starts fresh with no memory of prior runs — Coach K must curate and pass the brief explicitly
  (you already do "focused brief per agent", so this maps over).
- The `/command` interactive UX for the orchestrated path (standalone commands still work).
- `memory: user` cross-session learning for Kobe/Magic — headless runs are stateless unless you
  re-feed state.

---

## The CLI call (per worker)

```bash
claude -p "<curated brief for this agent>" \
  --output-format json \
  --json-schema '<JSON Schema>' \
  --model claude-opus-4-6 \
  --allowedTools "Read" "Grep" "Glob" "Bash"
```

Output wrapper:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "<free-form text>",
  "structured_output": { "...": "validated payload" },
  "session_id": "...",
  "total_cost_usd": 0.0
}
```

- `--json-schema` **requires** `--output-format json` — text mode emits no `structured_output`.
- Pull the payload from `.structured_output`, not `.result`.
- On failure the `subtype` is the structured-output retry-exhaustion error
  (SDK names it `error_max_structured_output_retries`; **confirm the exact CLI subtype string
  against `claude -p --help` / a forced-failure run before relying on it**).

> **Flags to verify against `claude --help` before committing this doc to muscle memory:**
> the per-run turn cap (SDK uses `maxTurns`; CLI is likely `--max-turns`) and the exact failure
> `subtype`. `-p`, `--output-format json`, `--json-schema`, `--model`, `--allowedTools`,
> `--permission-mode`, and `--bare` are confirmed.

---

## `--bare` decision (important gotcha)

`--bare` skips auto-discovery of hooks, skills, plugins, **MCP servers**, auto-memory, and
CLAUDE.md — giving identical results on every machine (great for evals/CI).

But it also kills the MCP tools your agents depend on: **Context7** (Shaq/MJ fetch version-specific
docs), **Miro**, **Honeycomb**. So:

- Eval / reproducibility runs → consider `--bare` for a clean baseline.
- Real `/team` runs where Shaq needs Context7 → **do not** use `--bare`, or add the needed MCP
  servers back explicitly. Decide per agent.

---

## Per-agent schemas (Zod → JSON Schema)

Pass `z.toJSONSchema(Schema)` as the `--json-schema` arg. Keep schemas **flat** and mark
anything an agent might not find as `.optional()` — deep/over-required schemas are the main cause
of retry exhaustion.

```ts
import { z } from "zod";

// Shared envelope — mirrors your cross-cutting agent features
// (confidence assessment, escalation protocol).
const Base = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string()),
  escalate: z.boolean(),
  escalation_reason: z.string().optional(), // present only when escalate = true
});

// bird → domain.md (acceptance criteria)
export const BirdOut = Base.extend({
  acceptance_criteria: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    rationale: z.string().optional(),
  })),
  open_questions: z.array(z.string()),
});

// mj → architecture.md (decisions + NFRs)
export const MjOut = Base.extend({
  decisions: z.array(z.object({
    decision: z.string(),
    alternatives_considered: z.array(z.string()),
    tradeoffs: z.string(),
  })),
  nfrs: z.array(z.object({ category: z.string(), requirement: z.string() })),
});

// shaq → primary executor (writes code). Often you want files-on-disk + a manifest,
// not the code inline. Keep the payload a summary; let Edit/Write do the real work.
export const ShaqOut = Base.extend({
  files_changed: z.array(z.object({
    path: z.string(),
    change: z.enum(["added", "modified", "deleted"]),
    summary: z.string(),
  })),
  tests_added: z.array(z.string()),
  notes: z.string().optional(),
});

// kobe → review.md (quality findings)
export const KobeOut = Base.extend({
  findings: z.array(z.object({
    severity: z.enum(["blocker", "major", "minor", "nit"]),
    location: z.string(),
    issue: z.string(),
    suggested_fix: z.string().optional(),
  })),
  verdict: z.enum(["pass", "fix_required"]),
});

// pippen → operations.md (readiness criteria)
export const PippenOut = Base.extend({
  readiness: z.array(z.object({
    area: z.enum(["observability", "rollback", "scaling", "security", "data"]),
    status: z.enum(["ready", "gap"]),
    detail: z.string(),
  })),
  go_no_go: z.enum(["go", "no_go"]),
});

// drexler → scope.md (deletion-bias / what was kept out)
export const DrexlerOut = Base.extend({
  cut: z.array(z.object({ item: z.string(), reason: z.string() })),
  over_engineering_flags: z.array(z.string()),
  duplication_flags: z.array(z.string()),
});

// magic → spec.md synthesis. Synthesis output is mostly prose;
// keep the schema light and let Magic write the actual spec.md to disk.
export const MagicOut = Base.extend({
  spec_path: z.string(),                 // e.g. docs/spec-<topic>/spec.md
  terminology_normalised: z.array(z.object({ from: z.string(), to: z.string() })),
  contradictions_flagged: z.array(z.string()),
});
```

---

## Bun runner

Use `Bun.spawn` with an **argv array** so the JSON schema is passed as a single argument —
no shell-escaping the braces/quotes (this is the part that bites if you go through a shell).

```ts
import { z } from "zod";

type AgentSpec = {
  name: string;
  model: string;
  allowedTools: string[];
  schema: z.ZodTypeAny;
  bare?: boolean;
};

type AgentResult<T> =
  | { ok: true; data: T; costUsd: number; sessionId: string }
  | { ok: false; reason: "schema_retries" | "parse" | "validation" | "process"; raw?: string };

export async function runAgent<T>(
  spec: AgentSpec,
  brief: string,
): Promise<AgentResult<T>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(spec.schema));

  const argv = [
    "claude", "-p", brief,
    "--output-format", "json",
    "--json-schema", jsonSchema,
    "--model", spec.model,
    "--allowedTools", ...spec.allowedTools,
  ];
  if (spec.bare) argv.push("--bare");

  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;

  if (exit !== 0) return { ok: false, reason: "process", raw: stdout };

  let wrapper: any;
  try { wrapper = JSON.parse(stdout); }
  catch { return { ok: false, reason: "parse", raw: stdout }; }

  // CONFIRM this subtype string against a real failure run.
  if (wrapper.subtype === "error_max_structured_output_retries") {
    return { ok: false, reason: "schema_retries", raw: stdout };
  }
  if (wrapper.subtype !== "success" || wrapper.structured_output == null) {
    return { ok: false, reason: "process", raw: stdout };
  }

  // Defense-in-depth: re-validate locally even though the CLI validated.
  const parsed = spec.schema.safeParse(wrapper.structured_output);
  if (!parsed.success) return { ok: false, reason: "validation", raw: stdout };

  return {
    ok: true,
    data: parsed.data as T,
    costUsd: wrapper.total_cost_usd ?? 0,
    sessionId: wrapper.session_id,
  };
}
```

### Coach K dispatch (replaces Task-tool handoff)

```ts
// Parallel phase example: Kobe + Pippen + Drexler review concurrently.
const [kobe, pippen, drexler] = await Promise.all([
  runAgent<z.infer<typeof KobeOut>>(
    { name: "kobe", model: "claude-opus-4-6",
      allowedTools: ["Read","Grep","Glob","Bash","Edit"], schema: KobeOut },
    coachK.briefFor("kobe"),
  ),
  runAgent<z.infer<typeof PippenOut>>(
    { name: "pippen", model: "claude-opus-4-6",
      allowedTools: ["Read","Grep","Glob","Bash","Honeycomb"], schema: PippenOut },
    coachK.briefFor("pippen"),
  ),
  runAgent<z.infer<typeof DrexlerOut>>(
    { name: "drexler", model: "claude-sonnet-4-6",
      allowedTools: ["Read","Grep","Glob","Bash"], schema: DrexlerOut },
    coachK.briefFor("drexler"),
  ),
]);

for (const [agent, r] of [["kobe",kobe],["pippen",pippen],["drexler",drexler]] as const) {
  if (!r.ok) coachK.handleFailure(agent, r.reason); // fallback: simpler schema, retry, or unstructured
}
```

The `if (!r.ok)` branch is your *new* safety guard — one typed state transition, replacing the
markdown field-checking Coach K does today.

---

## Preserving dreamteam's properties through the migration

- **Reproducible evals** — keep pinning `--model claude-opus-4-6` etc.; the only variable across
  runs stays the model build. Use `--bare` for the eval harness specifically.
- **Tool restrictions** — `--allowedTools` per agent mirrors the frontmatter `Tools` column.
- **Turn budgets** — map `maxTurns` (shaq 100, drexler 30, rest 50) to the CLI turn-cap flag once
  you've confirmed its name.
- **Git safety** — don't include `Bash` git-write capability; or keep `--permission-mode plan`
  for read-only reviewers. No agent commits/pushes — unchanged.
- **Checkpoints / retros** — write `structured_output` straight to your `docs/spec-<topic>/`
  artifacts; the typed payload is now trivially serialisable, which actually *helps* the retro
  metrics (escalations, confidence) since those are first-class fields in `Base`.
- **Auth/cost** — headless `claude -p` uses whatever the CLI is logged into; on your subscription
  login it bills against the subscription, not metered API tokens. Verify before a big batch run.

---

## Migration path (don't big-bang it)

1. Convert **one** read-only agent first — Bird is a good candidate (no Edit/Write, clean
   `acceptance_criteria` schema).
2. Run it both ways against your existing eval scenarios; compare schema-failure rate and quality
   judge scores.
3. If the failure rate is acceptable, convert the rest of the read-only reviewers
   (MJ, Pippen, Drexler, Kobe).
4. Convert Shaq last — it's the executor with the widest tool surface and the most to lose from a
   fresh-session, no-shared-context model. Make sure its brief carries everything it needs.
5. Keep Magic's synthesis writing the real `spec.md` to disk; the schema is just the manifest.

If schema-failure rates are bad on the heavier opus agents, that's the old chattiness problem
resurfacing — narrow the schema further or drop that agent to a sonnet build for the structured
step.
