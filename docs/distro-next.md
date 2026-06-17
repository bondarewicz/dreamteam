# Distribution — pick up here tomorrow

Handoff for the `feat/distribution` work. Full plan: `docs/distribution-plan.md`. Publishing: `RELEASING.md`.

## Where we are (2026-06-16, end of session)

- Branch **`feat/distribution`** — ~15 commits, all pushed. NOT merged to `main`.
- **Published live on npm:** `@bondarewicz/dreamteam` (public). Beta channel works end-to-end.
- **Release CI works:** push to `feat/distribution` → CI publishes `1.0.1-beta.g<sha>` to the `beta` tag via **OIDC trusted publishing** (no token), with provenance, gated on `bun test`. Push to `main` → stable `latest`.
- **Trusted Publisher is configured** on npmjs.com (repo `bondarewicz/dreamteam`, workflow `release.yml`, `npm publish` permission). Publishing access set to "require 2FA / disallow tokens".

## DONE
- Phase 0 — `~/.dreamteam` data dir + `config.json` manifest (`scripts/paths.ts`)
- Phase 1 — `dreamteam` CLI + `HarnessAdapter` (`bin/dreamteam.ts`, `adapters/`): install/uninstall/status/doctor/list/eval/web
- Phase 2 — direct run-backends (`evals/src/provider-backends.ts`): **Ollama, Gemini, Codex all working**; acceptance test 4/4 pass on bird/scenario-01 (claude/ollama-qwen3.6/gemini-2.5-flash/codex-gpt-5.5)
- Results relocation → `~/.dreamteam/workspace` (eval results + DB; web reads it)
- `dreamteam web` command (serves the report + admin)
- Phase 3.5 (partial) — multi-provider `/admin/models` (Ollama live via `/api/tags`, Claude API, Gemini/Codex curated static)
- Phase 4 — packable + install-tested + **actually published** + beta/stable CI
- README rewritten (multi-provider, prerequisites, CLI) — npm + GH-Pages face
- Tarball trim: 360 kB / 150 files (POC scripts → `poc/`, `.archive/README.md` → `ABOUT.md`)

## REMAINING — start here, in order
1. ~~**`/admin/providers` page**~~ ✅ DONE — doctor-in-the-browser. Shared `scripts/doctor.ts` (`checkProviders()`) now backs both the CLI `doctor` and the new `/admin/providers` route+view (`web/src/views/Providers.ts`, `routes/admin.ts`). Sub-nav tab added on all admin pages. Render test in `web/src/__tests__/providers-view.test.ts`.
2. **Phase 3A — Codex native schema.** ✅ DONE — `toOpenAIStrictSchema()` + `stripNulls()` + `getAgentStrictJsonSchema()` in `schemas/agent-schemas.ts` (pure, unit-tested in `evals/src/__tests__/strict-schema.test.ts`). `runCodex` now passes `--output-schema <strict file>` instead of embedding the schema in the prompt; output is null-stripped before Zod. Verified live: codex/gpt-5.5 on a bird domain prompt → no E422, Zod-valid (4 rules, 4 AC, confidence 86).
3. **Phase 3B — harness-neutral agent specs.** ✅ DONE.
   - `scripts/model-tiers.ts` — **3 tiers** (deep/mid/fast) → per-provider model table; `parseModelSpec`/`resolveModel`/`renderModelSpecYaml`. Tier table (context7-researched + CLI-verified on this machine):
     - claude: opus-4-8 / sonnet-4-6 / haiku-4-5
     - ollama: qwen3.6 (36B) / qwen3.6 / gemma4 (8B) — the two models pulled locally
     - gemini: 2.5-pro / 2.5-flash / 2.5-flash-lite (3.x not on this account; pro currently quota-limited but valid)
     - codex: gpt-5.5 / gpt-5.5 / **gpt-5.4-mini** (ChatGPT account accepts only these two; minis/codex variants 400)
   - `scripts/frontmatter.ts` — **surgical** read/write of the `model:` block. NOTE: agent `description:` is single-quoted prose with apostrophes that `Bun.YAML` can't parse, so we YAML-parse ONLY the small model block, never the whole frontmatter.
   - All 8 `agents/*.md` migrated to nested `model:\n  tier: …` (opus→deep, sonnet→mid). resolveModel(claude) reproduces every original id exactly.
   - Adapter `renderAgentForClaude()` renders the flat `model: <claude-id>` on install (replaces the old sanitize hack). `schema-runner.ts` + `build-site.ts` route through the shared resolver too (they had their own `^model:` regexes).
   - `/admin/models` rebuilt: per-agent **tier select + 4 per-provider pin selects** + resolved preview; saves the nested block via `setModelBlock`. `models-api` picker lists now include gemini-2.5-flash-lite + gpt-5.4-mini.
   - Tests: `model-tiers.test.ts`, `render-agent-for-claude.test.ts`, `admin-view.test.ts`. Sandbox install + build-site + editor round-trip all verified.
   - ⚠️ STILL TODO: run a real `/team` to confirm Claude Code reads the rendered flat models fine (should — installed files are plain `model: claude-…`), and decide whether `dreamteam eval --provider X` (no `--model`) should resolve from the agent's tier/pin (currently evals need explicit `--model`).
4. **Proxy path (interactive non-Claude)** — user's point: "if we can eval them we should use them." Build `ANTHROPIC_BASE_URL` → LiteLLM (or similar) → Ollama/Gemini, so `/team` runs interactively on non-Claude models. Claude Code IS redirectable this way. Caveats: session-wide base_url (loses Max for that session), local-model tool-use quality is the unknown, format-translation fragility. **Needs supervision** — run a real `/team` on `ollama/qwen3.6` to see how tool-use holds up.
5. **Phase 5 — cross-provider eval baseline + GH Pages export.** Run the 40-scenario corpus across providers, A/B in the report; export curated DB for the public GH Pages demo. **BURNS Max** (the judge) — user decides when; do not run unsupervised.
6. **PR `feat/distribution` → `main`** → cut stable `1.0.1` (CI publishes `latest`).
7. ~~**Cleanup: delete legacy devDeps**~~ ✅ DONE — removed `jest`, `ts-jest`, `express`, `@types/express`, `@types/jest` + the orphan `jest` config block from root `package.json`; added `@types/bun`. `bun install` removed 5 packages; lockfile refreshed. Verified nothing imports them. (Dependabot alerts clear once pushed.)

## User TODO on npm (their terminal — needs their auth)
Delete the stale betas so only the sha-form remains:
```bash
BETA=$(npm view @bondarewicz/dreamteam dist-tags.beta)
npm dist-tag add @bondarewicz/dreamteam@"$BETA" latest    # move latest off beta.0 first
for V in 1.0.1-beta.0 1.0.1-beta.1 1.0.1-beta.2.g406dd53 1.0.1-beta.3.g1d6f79c; do
  npm unpublish @bondarewicz/dreamteam@"$V"; done
```
(Keep at least one version — unpublishing ALL = 24h name lockout.)

## Key decisions & facts (don't re-litigate)
- **Bun-only package.** bin = `bin/dreamteam.ts` via `#!/usr/bin/env bun`; Node precompilation impractical (bun:sqlite / Bun.serve / .ts imports everywhere).
- **No opencode.** It forces a metered Anthropic key + violates Max-subscription ToS. We invoke each provider's own first-party CLI/API directly.
- **Provider invocation:** claude → `claude -p` (Max); ollama → `POST :11434/api/chat` with native `format`=schema; gemini → `gemini -p -o json` with `GEMINI_SYSTEM_MD=<agent file>` (overrides its built-in agentic prompt → single-shot, else it returns prose/empty); codex → `codex exec - -m <model> --output-last-message` (prompt via stdin `-`; leading `---` frontmatter as a positional would be parsed as a flag).
- **Judge (Coach K) always Claude** — `--model` only swaps the agent under test.
- **Version scheme: `1.0.1-beta.g<sha>`** (sha in prerelease §9, NOT build metadata §10 — npm rejects/collapses `+build`). First stable = `1.0.1` (no public 1.0.0; the accidental 1.0.1-beta.0 came from `npm version prerelease` patch-bumping).
- **Install adapter = Claude Code only** (interactive). Ollama can't be one (bare inference, no agent loop). Gemini/Codex install adapters deliberately deferred. Multi-provider lives at the **run-backend** layer (evals).

## Gotchas hit (so we don't repeat)
- `npm i <pkg>` in the repo root adds a **self-dependency** + npm `package-lock.json`. Test-install in a throwaway dir or `bun add -g`, never the repo root.
- CI publish needs **npm ≥ 11.5** for OIDC trusted publishing → `npm install -g npm@latest` step (setup-node ships npm 10.x → `ENEEDAUTH`).
- Provenance requires `package.json.repository.url` to match the repo (E422 if missing).
- First-ever publish sets `latest` even with `--tag beta`.
- `.npmignore` is **ignored** when `package.json` has a `files` allowlist → use a precise allowlist.
- Codex on a ChatGPT account: `gpt-5-codex` 400s; use **`gpt-5.5`**.
- Every push to `feat/distribution` publishes a beta (incl. doc-only commits). Consider a `paths-ignore` in `release.yml` for `docs/**`/`*.md` if that's noisy.

## Verify-the-package quickly (no auth)
```bash
cd /tmp && mkdir dt && cd dt && bun init -y && bun add @bondarewicz/dreamteam@beta
HOME=/tmp/dt-home node_modules/.bin/dreamteam doctor   # sandbox HOME so it won't touch real ~/.dreamteam
```
