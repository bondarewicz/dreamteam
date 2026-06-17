# Dream Team

A squad of specialized AI agents — each owns one job (domain rules, architecture, implementation, quality, scope, synthesis) — plus a `/team` orchestrator that runs them as a pipeline from problem statement to reviewed, spec-backed code. **Put any agent on any provider — Claude, Codex, Gemini, or Ollama — for both the eval corpus *and* live `/team` sessions, each on your own subscription (no metered API). And every agent's behavior is schema-enforced and graded against that corpus — not vibes.**

Install once, use in every project. The agents are named after the 1992 USA Basketball Dream Team; the personas are a framing device, the roles are real.

> **New here? Start at [bondarewicz.github.io/dreamteam](https://bondarewicz.github.io/dreamteam/)** — it walks the roster, the playbook, and the evals visually. This README is the technical reference.

## Install

```bash
bun add -g @bondarewicz/dreamteam@beta     # beta channel (npm/pnpm work too)
dreamteam install                           # provision the agents into your harness
dreamteam doctor                            # check which providers are reachable
```

`dreamteam install` copies the agents + commands into Claude Code (`~/.claude/`), records a manifest in `~/.dreamteam/`, and merges hooks/MCP add-if-missing. Re-run after upgrades. Eval results and the web DB live in `~/.dreamteam/workspace/` (never the repo).

## Prerequisites

Dream Team is **Bun-only** and brings nothing of its own — each provider is a tool you already have:

| Prerequisite | Needed for | Notes |
|---|---|---|
| **[Bun](https://bun.sh)** ≥ 1.1 | everything | the CLI runs on Bun |
| **[Claude Code](https://claude.com/claude-code)** (Pro/Max) | interactive `/team`, **and the eval judge** | the orchestrator + judge run on Claude; sanctioned subscription use |
| **[Ollama](https://ollama.com)** *(optional)* | running agents on local models (evals **and** `/team`) | `ollama serve` + a pulled model (e.g. `qwen3.6`); local, free |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** *(optional)* | running agents on Gemini (evals **and** `/team`) | logged in (`~/.gemini`); free tier — no `GEMINI_API_KEY` (that meters) |
| **[Codex CLI](https://github.com/openai/codex)** *(optional)* | running agents on GPT-class (evals **and** `/team`) | `codex login` (ChatGPT subscription) — no `OPENAI_API_KEY` (that meters) |

`dreamteam doctor` reports presence + auth for each. You only need the providers you intend to use — Claude Code alone is enough for interactive `/team`.

## The CLI

```text
dreamteam install [--harness claude-code] [--dry-run]   provision agents/commands
dreamteam uninstall                                      remove exactly what was installed
dreamteam status                                         versions, manifest, drift
dreamteam doctor                                         Claude / Ollama / Gemini / Codex reachability
dreamteam list                                           roster + commands
dreamteam eval [...]                                     run the eval pipeline (passthrough)
dreamteam web [--port N]                                 serve the eval report + admin at :3000
```

## The roster

| Agent | Command | Role | Default model |
|-------|---------|------|---------------|
| **bird** | `/bird` | Domain Authority & Final Arbiter | `claude-opus-4-8` |
| **mj** | `/mj` | Strategic Systems Architect | `claude-opus-4-8` |
| **shaq** | `/shaq` | Primary Code Executor | `claude-sonnet-4-6` |
| **kobe** | `/kobe` | Quality & Risk Enforcer | `claude-opus-4-8` |
| **pippen** | `/pippen` | Stability, Integration & Defense | `claude-opus-4-8` |
| **magic** | `/magic` | Context Synthesizer & Team Glue | `claude-sonnet-4-6` |
| **drexler** | `/drexler` | Deletion-Bias Enforcer | `claude-sonnet-4-6` |

Coach K (the orchestrator) runs on Claude/Max and is never delegated. Each agent's `model:` frontmatter is a **tier** (deep/mid/fast) plus an optional **provider** + per-provider pins — the default is Claude, but set `provider: codex|gemini|ollama` to run that agent elsewhere (interactively in `/team` and in evals). Evals can also override per-run via `--model`/`--provider` (see below). Every agent body enforces four contracts: an **output schema** validated before handoffs, an **escalation protocol** (stop and ask, never guess), a **confidence assessment**, and a **turn budget** (`maxTurns`).

Each agent is one markdown file, `agents/<name>.md` — YAML frontmatter (config) + body (system prompt). The repo is the source of truth; **edit the repo, run `dreamteam install`, never edit `~/.claude/` directly.**

## Orchestration — `/team`

`/team` runs **inside Claude Code**. Coach K curates a focused brief per agent (not a dump of prior output) and runs one of three modes:

- **Quick Fix** — sequential pipeline for bugs/small features: you author intake → Bird → Shaq → Kobe + Drexler (parallel) → Magic synthesises → you sign off. Fixes loop until reviewers re-verify.
- **PR Review** — Bird + MJ + Kobe review a diff in parallel; Coach K synthesizes to `docs/PR-<n>-review.md`. All `gh` is read-only.
- **Full Team** — independent sessions in isolated git worktrees for new features; checkpoints saved to disk. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; falls back to Quick Fix.

**Git safety:** no agent commits or pushes — you control git. Every run drops a checkpoint and an HTML retro in `~/.dreamteam/workspace/`.

### Any agent on any provider — interactively

`/team` is **hybrid multi-provider**, not Claude-only. Coach K orchestrates on Claude (Max) and never moves; each agent runs on the provider you declare in its frontmatter:

```yaml
model:
  tier: deep            # deep | mid | fast — resolves to a model per provider
  provider: codex       # claude (default) | codex | gemini | ollama
```

When an agent is pinned off-Claude, Coach K **delegates that turn to the provider's own first-party CLI** (`codex exec`, `gemini`, ollama `/api/chat`) on its native subscription/local runtime, then folds the structured result back into the same brief → checkpoint → reviewer loop. **No proxy, no `ANTHROPIC_BASE_URL`, no metered API** — Max stays Max, ChatGPT-Codex stays your ChatGPT sub, Gemini/Ollama on their own auth.

Implementation agents (Shaq) get a real **plan → you approve → implement** gate on every provider, with the plan phase made *physically write-incapable* per provider (codex `--sandbox read-only`, gemini OS read-only cwd, ollama withheld write-tools). Each provider's gate is proven by an instrumented eval before it ships. Analysis/synthesis agents (Bird, MJ, Kobe, Pippen, Drexler, Magic) delegate single-shot. See `docs/spec-hybrid-team/`.

### Spec-driven development

A `/team` session produces a multi-authored spec under `docs/spec-<topic>/` — `intake.md` (you), `domain.md` (Bird), `architecture.md` (MJ), `operations.md` (Pippen), `scope.md` (Drexler), `review.md` (Kobe), `spec.md` (Magic, the synthesis). You sign off on `spec.md` before the session ends.

## Schema enforcement

Agent outputs are typed at the **process boundary**, not by prompt convention:

```
claude -p --system-prompt-file agents/<name>.md --json-schema <flat schema> --output-format json
```

The model is forced to a flat JSON schema; the result is re-validated with Zod (`schemas/agent-schemas.ts`) and re-prompted on mismatch. Findings: `structured_output` populates reliably only for **flat** schemas (hoist nesting to prefixed top-level keys), and `--system-prompt-file` binds the validator where `--agent` does not. See `docs/spec-schema-enforcement/`.

## Cross-provider evals — the moat

Every code-touching agent has a scenario suite under `evals/<agent>/` (capability, edge-case, escalation, adversarial). Each scenario declares `prompt` / `expected_behavior` / `failure_modes` / `scoring_rubric`. The pipeline is a deterministic TypeScript CLI: it runs each agent, applies zero-LLM graders, then scores each output against its rubric with a pinned **Coach K judge**.

The same agent, same scenario, same judge — graded on any provider by changing `--model` (exact id) or `--provider` (resolve each agent's tier for that provider):

```bash
dreamteam eval --agent bird --model claude-opus-4-8         # exact Claude model (Max)
dreamteam eval --agent bird --model ollama/qwen3.6          # exact Ollama model (local :11434)
dreamteam eval --agent bird --provider gemini              # bird's tier → Gemini's model
dreamteam eval --agent shaq --provider codex               # shaq's tier → Codex (codex exec)
dreamteam eval --trials 3                                   # sample each scenario N times
```

`--model` routes on the `provider/` prefix (bare id = Claude); `--provider` resolves each agent's tier/pin for that provider (the two are mutually exclusive). Either affects only the agents under test — **the judge stays on Claude** so comparisons share a baseline. Cost: Claude = Max, Ollama = local/free, Gemini = free tier, Codex = ChatGPT subscription. The run's resolved model is recorded and shown per run in the dashboard.

```bash
dreamteam web        # http://localhost:3000 — eval report, /admin/models (per-provider picker),
                     # /admin/providers, sessions. Reads ~/.dreamteam/workspace.
```

## MCP tools

Agents are granted tools liberally, so **any MCP server connected to Claude Code just works** — no per-agent wiring. MJ/Shaq pull library docs from [Context7](https://context7.com); the team reads/writes [Miro](https://miro.com). Keys live in `~/.claude.json` (User scope), never the repo:

```bash
claude mcp add --transport http context7 https://mcp.context7.com/mcp --header "CONTEXT7_API_KEY: <key>" -s user
```

`/REDACTED` builds a [Brandolini](https://leanpub.com/introducing_REDACTED)-style REDACTED on a Miro board (`as-is` / `to-be` / `both`).

## Contributing / development

```bash
git clone https://github.com/bondarewicz/dreamteam ~/Github/Bondarewicz/dreamteam
cd ~/Github/Bondarewicz/dreamteam && bun install
bun scripts/install.ts        # alias for `dreamteam install` from source
bun test                      # eval-harness + web suites
```

Releases publish from CI: push to a branch → `1.0.1-beta.g<sha>` on the npm `beta` tag (OIDC provenance); merge to `main` → stable `latest`. See `RELEASING.md`.

## License

MIT — see [LICENSE](LICENSE). Agent names and jersey numbers are used affectionately as a framing device; this project is not affiliated with, endorsed by, or sponsored by the NBA, USA Basketball, the named players or their estates, Chuck Daly's estate, or Coach Mike Krzyzewski.
