# Distribution — Implementation Plan (all phases)

Companion to **[`distribution.md`](./distribution.md)** (the *why* + target architecture).
This doc is the *how*: concrete, file-level steps for every phase.

## The core is the adapter layer (`distribution.md §6` — "stop being Claude-specific")

Distribution is **not** "publish the Claude version to npm." The core deliverable is the
**adapter layer**: one canonical, harness-neutral agent spec that runs on any of three
providers **directly** — no opencode, no third-party router. Each provider is a prerequisite
the user installs once; we invoke it with its own native interface.

| Provider / models | Invoked directly via | Auth / cost |
|-------------------|----------------------|-------------|
| **Claude** (opus / sonnet / haiku) | `claude -p` (Claude Code) | **Max plan — $0 API, sanctioned** |
| **Ollama** (`qwen3.6`, `gemma4`) | `POST localhost:11434/v1/chat/completions` | **local, $0** |
| **Gemini** (`gemini-2.x`) | `gemini -p "<prompt>" -m <model> -o json` (or API w/ `GEMINI_API_KEY`) | free tier |
| **Codex** (`gpt-5-codex` / o-series) | `codex exec "<prompt>" -m <model> --output-schema <f> --output-last-message <f>` | **ChatGPT subscription (`~/.codex` login) — $0, first-party CLI = sanctioned** |

Every backend is a **first-party** CLI/API for its provider — so subscription auth (Claude Max,
ChatGPT Plus/Pro) is sanctioned. That's the key difference from the opencode dead-end, which
was a *third-party* tool using the Anthropic subscription against ToS.

**Why no opencode** (this was the prior dead-end, now fully avoided): opencode forces a
*metered Anthropic API key* and Anthropic prohibits Max-subscription use through third-party
dev tooling. We're on the **Max plan**, so Claude must stay on native `claude -p`. Since each
provider already ships a usable direct interface (Ollama's OpenAI-compatible server, the
gemini CLI), opencode adds nothing but indirection and an auth/ToS hazard. Drop it.

**Prerequisite, not a dependency.** Each provider is "bring your own, already installed":
Ollama serving on `:11434`, gemini CLI authed (`GEMINI_API_KEY` or OAuth), Claude Code logged
into Max. `dreamteam doctor` checks presence/reachability and tells you what's missing.

### The abstraction (§6.1–6.4)

```
assets/agents/bird.md            canonical spec (provider-neutral)
  capabilities: [read, search, shell]
  model: { tier: reasoning-heavy,
           pin: { claude: claude-opus-4-8, gemini: gemini-2.x, ollama: qwen3.6, codex: gpt-5-codex } }
        │
        ├── INSTALL (interactive use) ── claude-code adapter → ~/.claude/agents/*.md (+hooks +MCP)
        │                                 (Claude Code is the agentic harness; Max plan)
        │
        └── runAgent(agent, prompt, {model}) ── direct provider backends (eval + scripted use)
              ├── claude  → claude -p --system-prompt-file <agent.md> --json-schema …   (Max; native schema)
              ├── ollama  → POST :11434/v1/chat/completions  (system=agent body, response_format=json_schema)
              ├── gemini  → gemini -p "<prompt>" -m <model> -o json   (soft schema → Zod re-validate)
              └── codex   → codex exec "<prompt>" -m <model> --output-schema <f> --output-last-message <f>
                            --sandbox read-only --skip-git-repo-check   (ChatGPT sub; NATIVE schema)
```

```ts
// the one routing function — provider prefix on the model id picks the backend
runAgent(agentName, prompt, { model })   // "claude-opus-4-8" | "ollama/qwen3.6" | "gemini/gemini-2.x"
//   → resolve canonical spec (system prompt + schema) → dispatch to the matching backend
//   → return { output, schemaOk, tokens, costUsd }   (costUsd 0 for ollama/free-tier)
```

The canonical agent spec is the single source of truth. **Two consumers ride on it:**
- **Install** — render into Claude Code for real interactive `/team` sessions (Claude/Max).
- **Eval / scripted run** — `runAgent` feeds the agent's system prompt + the scenario prompt
  to the chosen provider directly. The eval "backend" is not a separate design — it's the
  provider dispatch reused.

### Install adapter vs. run backend — why only `claude-code` is an adapter (decided)

These are two distinct layers; "an adapter per provider" was never the goal:

- **Install adapter** (`adapters/HarnessAdapter`) installs agents into a *harness* for
  **interactive** use. Needs a harness with an agent-loading concept. **Claude Code is the
  only install adapter** — your interactive `/team` home on Max. **Ollama categorically can't
  be one** (bare model server, no agent loop). Gemini CLI and Codex CLI *could* be
  (GEMINI.md / AGENTS.md) but interactive install into them is **out of scope** for now.
- **Run backend** (`runAgent`, Phase 2) runs an agent on a *provider/model* for evals/scripted
  use. **All four providers are run backends** — this is where "stop being Claude-specific"
  is delivered (measurement across providers). No install adapter is required to grade a model.

**Decision (2026-06-16):** multi-provider lives at the **run-backend** layer only. Gemini/Codex
do **not** get install adapters; the eval corpus grading agents across all four providers is the
goal. (`distribution.md §6.2`'s `codex.ts`/`cursor.ts` install adapters remain a possible later
extension, explicitly deferred.)

**Scope honesty (§6.3 reality check).** Most Dream Team agents are analysis/review agents
that emit a single structured output (Bird's domain rules, Kobe's review verdict, MJ's
architecture) — direct single-shot inference covers them fully on all three providers.
*Multi-tool agentic loops* are a different matter: Claude Code provides one for Claude, the
gemini CLI provides one for Gemini, but Ollama is a bare inference endpoint (no tool loop).
So: **Claude = full agentic fidelity; Gemini = agentic via its CLI; Ollama = single-shot
inference (the common eval path).** That's an acceptable, explicit asymmetry.

### Local state (verified)
- **Ollama** up on `:11434`; `/v1/chat/completions` returns correctly. Models `qwen3.6:latest`
  (23 GB → reasoning-heavy), `gemma4:latest` (9.6 GB → fast).
- **Gemini CLI 0.46.0**; headless `-p`/`--prompt`, `-m`, `-o json|stream-json`,
  `--approval-mode plan` (read-only); `GEMINI_API_KEY` set.
- **Claude Code** on Max (native `claude -p`, the schema-enforcement path already in
  `evals/src/schema-runner.ts`).
- **Codex CLI 0.140.0** at `~/.local/bin/codex`; authed via `~/.codex` (ChatGPT login, no
  `OPENAI_API_KEY`). Headless `codex exec`; `--json` (JSONL events), `--output-last-message`
  (final message → file), `--output-schema` (native JSON-Schema final response),
  `--sandbox read-only`, `--skip-git-repo-check`.
- No opencode involvement. (The stale `~/.config/opencode/dreamteam/` from a prior experiment
  can be ignored/removed — not part of this design.)

**Acceptance bar — one agent, all three providers, our way:**
```bash
bun evals/src/cli.ts --agent bird --model claude-opus-4-8 --trials 3   # claude -p, Max
bun evals/src/cli.ts --agent bird --model ollama/qwen3.6  --trials 3   # direct :11434
bun evals/src/cli.ts --agent bird --model gemini/gemini-2.x --trials 3 # gemini -p / API
bun evals/src/cli.ts --agent bird --model codex/gpt-5-codex --trials 3 # codex exec, ChatGPT sub
```

---

## Phase 0 — Workspace split + manifest  *(foundation; unblocks everything)*

Read-only assets vs writable workspace; install records a manifest, not a clone path.
1. `assetsDir` (shipped canonical specs) vs `dataDir` (`~/.dreamteam`, writable; honor `$XDG_*`).
2. Replace `~/.claude/dreamteam/repo-root` with `~/.dreamteam/config.json`
   `{ assetsDir, dataDir, version, installed: [{path, sha}] }`.
3. Workspace writes (`reports/`, `evals/results/`, drafts) → `dataDir/workspace/`; update
   `team.md`'s lookup. Backups → `dataDir/backups/…` with a manifest.

Pure refactor — zero behavior change for the existing Claude install.

## Phase 1 — CLI + canonical spec + `runAgent` (claude backend)

The abstraction is born here; Claude is the first backend.
1. `bin/dreamteam.ts`: `install [--dry-run]`, `uninstall`, `status`, `doctor`, `list`, `eval`.
2. Canonical frontmatter format (`assets/agents/*.md`: `capabilities`, `model.tier`,
   `model.pin.{claude,gemini,ollama}`).
3. `adapters/claude-code.ts` = today's install.ts behavior behind a small interface
   (interactive install for Claude/Max).
4. `evals/src/run-agent.ts`: `runAgent(agent, prompt, {model})` with the `claude` backend
   (wrap the existing `schema-runner.ts` / `claude-adapter.ts`). `cli.ts` keeps working,
   model id with no provider prefix ⇒ claude.
5. `doctor`: Claude Code present + logged in; Ollama reachable; gemini CLI present + authed.

Testable: existing Claude evals + install unchanged, now routed through `runAgent`.

## Phase 2 — THE CORE: direct Ollama + Gemini backends  ★ "stop being Claude-specific"

`distribution.md §6` realized — without opencode. Prove with a **vertical slice (Bird)**.
1. `runAgent` backends:
   - `ollama` — POST `:11434/v1/chat/completions`, `messages: [{system: <agent body>},
     {user: <prompt>}]`, `response_format: { type: "json_schema", … }` from the agent's
     registered schema; parse `choices[0].message.content`; Zod re-validate (already in harness).
   - `gemini` — **(decided: gemini CLI, zero-config — verified working)**
     `printf '<agent body>' | gemini -p "<prompt>" -m <model> -o json --approval-mode plan`.
     Agent body piped as stdin = system instruction (verified: obeyed; e.g. terse-uppercase
     system → `"DDD"`). Read-only via `--approval-mode plan`. Uses existing auth, no key wiring.
     **Verified envelope shape** (parse after first `{`): `.response` = agent output;
     `.stats.models[<model>].tokens.total` = token count; no cost field → `costUsd: 0`.
     Caveats (acceptable): it's an agent harness — injects its own ~8k-token tool/system
     preamble per call (agent body is *appended*, not a clean system role), ~14 s latency,
     some nondeterminism. Zod re-validation + `--trials` absorb it.
   - `codex` — `codex exec "<prompt>" -m <model> --output-schema <schema.json>
     --output-last-message <out> --sandbox read-only --skip-git-repo-check`; agent body
     prepended/piped as instructions; read `<out>` for the final message, parse against the
     native `--output-schema`, Zod re-validate. ChatGPT-subscription auth (`~/.codex`), $0.
     Best off-Claude schema fidelity (native, like `claude --json-schema`).
2. Model routing: `provider/model` prefix selects the backend (`ollama/…`, `gemini/…`,
   `codex/…`); bare id ⇒ claude. `costUsd` defaults 0 for local/subscription providers.
3. Tier → model table per provider
   (`reasoning-heavy → {claude-opus-4-8, gemini-2.x, qwen3.6, gpt-5-codex}`,
   `fast-cheap → {claude-haiku, gemini-flash, gemma4, gpt-5-codex-mini}`).

Testable: the acceptance bar — Bird graded on all three providers, same corpus.

## Phase 3 — Full roster + schema hardening

All 8 agents have canonical specs; native structured-output path per provider (Ollama
`response_format`, Gemini `responseSchema`), prompt-embedded + Zod as the universal fallback
for any model with weak schema adherence. `dreamteam status` shows install drift.

## Phase 3.5 — Web multi-provider surface

The web app (`web/`) is Claude-only today and must become provider-aware. Three pieces,
all hanging off **one shared provider/model registry** (the same `provider/model` ids the
Phase 2 `runAgent` backends route on — single source of truth for picker + eval + CLI).

1. **Generalize the model registry** (`web/src/models-api.ts`, today Claude-only). Add a
   `provider` field to `ModelRecord`; resolve per provider:
   - `claude` — existing Anthropic `/v1/models` + `claude-*` fallback (unchanged).
   - `ollama` — **live** `GET :11434/api/tags` → installed models → ids `ollama/<name>`.
   - `gemini` — curated static list (`gemini/gemini-2.x`); the API key can't be assumed.
   - `codex` — curated static list (`codex/gpt-5-codex`, o-series).
   Canonical id is `provider/model`; a bare `claude-*` still means Claude (back-compat).
2. **`/admin/models` — grouped picker.** Each agent's `<select>` gains `<optgroup>` per
   provider (Claude / Ollama / Gemini / Codex). Loosen the `admin.ts` model-id validation to
   accept `provider/model`. Writing `model: ollama/qwen3.6` into an agent's frontmatter is
   what makes a non-Claude default real.
3. **`/admin/providers` — new page (the "OAuth" page).** *Reality check:* a browser page
   **cannot perform the OAuth/login flows** — those are first-party CLI/browser flows
   (`claude` subscription login, `gemini` login, `codex login`, `ollama serve`). So this page
   is **`dreamteam doctor` in the browser**: per-provider reachability + auth status, plus the
   exact command to fix each (and where keys like `GEMINI_API_KEY` go). It surfaces and guides;
   it does not store tokens. Reuse the same checks as `bin/dreamteam.ts doctor`.

**Coupling + sequencing:** the registry's `provider/model` ids must match the Phase 2 backend
routing, so this lands **after Phase 2** (else the picker offers models nothing can run). The
`/admin/providers` status page is independent (mirrors `doctor`) and can land anytime.

## Phase 4 — Publishable package

`bun add -g @bondarewicz/dreamteam` (per `distribution.md §3, §5`): `files` allowlist,
precompiled `dist/dreamteam.js` bin, `publishConfig.access: public` on the personal
`@bondarewicz` scope, Changesets + OIDC release CI gated on `--trials 3`, legacy-layout
migration shim.

## Phase 5 — Cross-provider eval baseline  *(the differentiator)*

The 40-scenario corpus as a `(scenario × provider)` matrix; HTML report A/Bs
`claude-opus-4-8` (Max) vs `ollama/qwen3.6` (local) vs `gemini/gemini-2.x` vs
`codex/gpt-5-codex` (ChatGPT sub). Just `--model` permutations through the Phase 2 backends. Publish as the public proof:
*"graded against a domain corpus, on any provider — not vibes."*

---

## Sequencing

```
Phase 0 ──► Phase 1 (CLI + canonical spec + claude backend)
                │
                ▼
        Phase 2 ★ direct ollama + gemini + codex backends   (Bird slice: all 4 providers)
                ├──► Phase 3   (full roster, schema hardening)
                ├──► Phase 3.5 (web multi-provider: model registry, grouped picker, providers page)
                ├──► Phase 4   (publish)
                └──► Phase 5   (cross-provider eval baseline)
   (Phase 3.5's /admin/providers status page is independent — mirrors doctor, can land anytime)
```

Phase 2 is the heart and the highest-information unknown — go for it right after 0→1.

## Open decisions

1. **Interactive vs eval scope.** Confirmed: direct single-shot covers the eval/measurement
   goal for all agents on all providers. Multi-tool agentic use stays Claude (Claude Code) /
   Gemini (gemini CLI); Ollama is single-shot only. OK?
2. **Gemini: CLI vs API.** *Resolved → gemini CLI (zero-config):* `gemini -p … -o json` using
   existing auth, no key wiring. Accept the agent-harness nondeterminism; lean on Zod
   re-validation + `--trials`. (Gemini API w/ `responseSchema` remains a later option if schema
   adherence proves too noisy.)
3. **Schema enforcement per provider.** Ollama `response_format` and Gemini `responseSchema`
   are native; for the slice, prompt-embedded + Zod is the cheap universal path. Native day one?
4. **Tier → model table.** Local: `qwen3.6` (reasoning-heavy), `gemma4` (fast); pin the exact
   `gemini-2.x` and Codex (`gpt-5-codex` vs default; confirm via `codex exec -m <id>`) ids.
5. **`dreamteam` bin name** collision on npm (`distribution.md §8.5`); `dt` fallback alias.
