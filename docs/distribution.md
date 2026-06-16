# Distribution — Releasing Dream Team as an installable package

> Goal: let anyone run
>
> ```bash
> bun add -g @bondarewicz/dreamteam      # or: npm i -g / pnpm add -g
> dreamteam install                       # provisions the active harness
> ```
>
> and get the full roster (agents, commands, hooks, eval harness) without
> cloning this repo — while keeping the door open to **non-Claude harnesses**
> (Cursor, opencode, Codex, Gemini CLI, Pi/atomic, …).

This doc is the plan, not the current state. Today Dream Team installs by
cloning the repo and running `bun scripts/install.ts`. The two sections below —
**Why the current install can't be published as-is** and **Target
architecture** — describe what has to change and why.

---

## 1. Why the current install can't ship as a package

`scripts/install.ts` makes three assumptions that only hold for a git clone:

1. **It runs from inside the repo.** `REPO_DIR = resolve(SCRIPT_DIR, "..")` and
   everything (agents, commands, eval templates) is read relative to that. A
   global package has no "repo" — it lives in a read-only-ish
   `node_modules/.bin` / global prefix.

2. **It records the clone path for runtime use.** `install.ts` writes the
   absolute repo path to `~/.claude/dreamteam/repo-root`, and `team.md` reads it
   so `/team` can find eval templates and **write draft evals back into the
   repo**. A published package can't write into its own install dir, and the
   user has no repo to write to.

3. **It symlinks `scripts/*.ts` into `~/.claude/scripts/`.** Symlinks into a
   global `node_modules` are fragile (break on `bun pm cache rm`, version bumps,
   or volume moves) and don't survive reinstalls cleanly.

The fix is to split **distributed, read-only assets** from a **user-owned
workspace**, and to ship a real CLI instead of a repo-relative script.

---

## 2. Target architecture

```
@bondarewicz/dreamteam          (the published package — read-only)
├── bin/dreamteam.ts            → exposed as the `dreamteam` command (package.json "bin")
├── dist/                       compiled CLI (if we precompile) 
├── assets/
│   ├── agents/*.md             canonical agent specs (source of truth)
│   ├── commands/*.md
│   ├── hooks.json
│   ├── mcp-servers.json
│   └── eval-templates/         scenario templates /team copies from
└── adapters/                   per-harness installers (see §6)

~/.dreamteam/                   (the user workspace — read/write, created on install)
├── config.json                 selected harness, model aliases, install manifest
├── workspace/
│   ├── evals/results/          eval runs land here (was: back into the repo)
│   ├── reports/retros/
│   └── docs/spec-<topic>/      /team specs for projects that don't want them in-repo
└── backups/backup-<ts>/        pre-install backups (was: ~/.claude/backup-*)
```

Key inversion: **`repo-root` becomes two resolved paths** —
`assetsDir` (inside the installed package, read-only) and `dataDir`
(`~/.dreamteam`, writable). `team.md` reads templates from `assetsDir` and
writes drafts to `dataDir/workspace`. Use the
[XDG base dir](https://specifications.freedesktop.org/basedir-spec/) convention:
honor `$XDG_DATA_HOME` / `$XDG_CONFIG_HOME`, fall back to `~/.dreamteam`.

---

## 3. The CLI surface

Replace the single `install.ts` with a small command tree. Keep it Bun TS
(per project convention — no shell scripts).

```bash
dreamteam install [--harness claude|cursor|opencode|codex|all] [--dry-run]
dreamteam uninstall [--harness ...]           # restores from backup
dreamteam status                              # what's installed, which harness, versions, drift
dreamteam update                              # re-sync assets after a package bump
dreamteam doctor                              # validate harness present, MCP reachable, flags set
dreamteam eval [...]                          # thin wrapper over evals/src/cli.ts
dreamteam list                                # roster + commands
```

`package.json` additions:

```jsonc
{
  "name": "@bondarewicz/dreamteam",
  "version": "1.0.0",
  "type": "module",
  "bin": { "dreamteam": "bin/dreamteam.ts" },   // Bun runs .ts directly; for npm/node ship dist/dreamteam.js
  "files": ["bin", "dist", "assets", "adapters", "README.md", "LICENSE"],
  "engines": { "bun": ">=1.1.0", "node": ">=20" },
  "publishConfig": { "access": "public" },
  "exports": {
    ".": "./dist/index.js",                     // SDK entry: programmatic install/adapters
    "./adapters": "./dist/adapters/index.js"
  }
}
```

Notes:
- `bin` pointing at a `.ts` file works under Bun but **not** under plain
  `node`/npm global installs. To support `npm i -g`, precompile with
  `bun build bin/dreamteam.ts --target=node --outfile dist/dreamteam.js` and add
  a `#!/usr/bin/env node` shebang; point `bin` at `dist/dreamteam.js`. Keep the
  `.ts` for local dev via a `dev` script.
- `files` is an **allowlist** — without it, npm publishes `node_modules`,
  `.tmp/`, `data/`, eval results, and the whole `web/` server. Only ship assets
  + CLI. (`web/`, `site/`, `evals/` test suites stay in the repo, not the
  package.)

---

## 4. Make `install.ts` package-aware

Concrete changes to the existing installer logic:

| Today | Change to |
|-------|-----------|
| `REPO_DIR = resolve(SCRIPT_DIR, "..")` | `assetsDir = resolve(import.meta.dir, "../assets")` (inside the package) |
| writes `~/.claude/dreamteam/repo-root` = repo path | writes `~/.dreamteam/config.json` with `{ assetsDir, dataDir, harness, version }` |
| `cpSync(agents → ~/.claude/agents)` | **harness adapter** decides the target dir & format (see §6) |
| symlink `scripts/*.ts → ~/.claude/scripts` | **copy** compiled helpers into `dataDir/bin`, or invoke them via the `dreamteam` CLI instead of loose scripts |
| backups in `~/.claude/backup-*` | backups in `dataDir/backups/` with a manifest so `uninstall` is exact |
| merge MCP into `~/.claude.json`, hooks into `~/.claude/settings.json` | same, but **driven by the adapter** — each harness has its own config file/format |
| `mkdir reports/, evals/results/ in REPO_DIR` | `mkdir` under `dataDir/workspace/` |

Add an **install manifest** (`dataDir/config.json` → `installed: [{path, harness, sha}]`)
so `update` can detect drift (user hand-edited an installed agent) and
`uninstall` removes exactly what we wrote — never user files.

---

## 5. Publishing pipeline

**Registry & scope.** `@bondarewicz` is a scoped name. Two options:
- **npm public registry** (recommended for reach): create the `@bondarewicz`
  org/scope on npmjs.com, `publishConfig.access = "public"`. Works with
  `bun add -g`, `npm`, `pnpm`, `yarn` out of the box.
- **GitHub Packages**: free for public scoped packages but forces consumers to
  add a `.npmrc` registry line — worse UX. Skip unless you want it private.

**Versioning.** Adopt [Changesets](https://github.com/changesets/changesets):
`bunx changeset` per change → CI consumes them, bumps semver, writes
`CHANGELOG.md`, publishes. Agent-spec changes are user-visible behavior, so they
deserve real semver:
- **patch** — prompt wording, eval scenarios, docs
- **minor** — new agent/command, new adapter, new model alias
- **major** — renamed agent, changed install layout, dropped harness

**Provenance & integrity.** Publish from CI with `npm publish --provenance`
(OIDC, no long-lived token — mirrors the `nuget-trusted-publishing` pattern).
Gate release on the eval suite so a regression can't ship.

**Release CI** (`.github/workflows/release.yml`):
```yaml
on: { push: { branches: [main] } }
jobs:
  release:
    permissions: { contents: write, id-token: write }   # id-token = OIDC provenance
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun evals/src/cli.ts --trials 3        # gate: behavior regression = no publish
      - run: bun run build                          # bun build → dist/
      - uses: changesets/action@v1                  # version + publish
        with: { publish: bun run release }
        env: { NPM_TOKEN: ... }                     # or pure OIDC provenance
```

Per project memory: every agent-spec change must pass `--trials 3` before
shipping — wiring that into the release gate makes it non-skippable.

---

## 6. The big one — stop being Claude-specific

Right now an "agent" *is* a Claude Code markdown file with Claude-flavored
frontmatter (`tools: Read, Grep, …`, `model: claude-opus-4-8`), copied to
`~/.claude/agents/`. Three things are hard-coded to Claude Code: the **file
format**, the **install location**, and the **model ids**. Decouple all three
behind an adapter layer.

### 6.1 Canonical agent spec (harness-neutral)

Make the markdown frontmatter the *canonical* spec and treat Claude Code as
just one render target. Canonical fields:

```yaml
---
name: bird
role: Domain Authority & Final Arbiter
capabilities: [read, search, shell]      # neutral verbs, not Claude tool names
model:
  tier: reasoning-heavy                   # neutral tier, not a build id
  pin: { claude: claude-opus-4-8 }        # optional per-provider pin override
maxTurns: 50
memory: false
---
(system prompt body — already harness-neutral prose)
```

The body is already portable; only the frontmatter vocabulary is Claude-bound.

### 6.2 Adapters translate canonical → target

```
adapters/
├── types.ts            interface HarnessAdapter
├── claude-code.ts      → ~/.claude/agents/*.md  (+ settings.json hooks, .claude.json MCP)
├── cursor.ts           → .cursor/rules/*.mdc     (project-scoped "rules")
├── opencode.ts         → opencode agent/command format
├── codex.ts            → AGENTS.md + Codex config
└── generic-mcp.ts      → expose each agent as an MCP server (works in any MCP client / Pi / atomic)
```

```ts
interface HarnessAdapter {
  id: string;
  detect(): Promise<boolean>;                       // is this harness installed?
  capabilityMap: Record<Capability, string>;        // read → "Read"/"file_read"/...
  resolveModel(tier: ModelTier, pin?: string): string;
  installAgent(spec: CanonicalAgent, dataDir: string): Promise<InstalledFile>;
  installCommand(spec: CanonicalCommand): Promise<InstalledFile>;
  installHooks?(hooks: HookSpec[]): Promise<void>;   // optional — not all harnesses have hooks
  installMcp?(servers: McpSpec[]): Promise<void>;
}
```

`dreamteam install --harness all` runs every adapter whose `detect()` returns
true. `dreamteam install` with no flag auto-detects and prompts if ambiguous.

**Capability mapping** is where harnesses differ most. Claude Code has rich tool
gating; Cursor rules don't gate tools at all; MCP exposes whatever the server
declares. The adapter owns that translation and should **degrade loudly** — if a
harness can't enforce `capabilities: [read, search]` (no write), the adapter
warns rather than silently granting write.

### 6.3 Model aliasing (the cross-provider unlock)

`tier` → concrete model, resolved per harness/provider:

| Tier | Claude | OpenAI | Google | Local |
|------|--------|--------|--------|-------|
| `reasoning-heavy` | claude-opus-4-8 | o-series / gpt-5-class | gemini-2.x-pro | — |
| `balanced` | claude-sonnet-4-6 | gpt-class | gemini-2.x-flash | — |
| `fast-cheap` | claude-haiku-4-5 | mini-class | flash-lite | qwen/llama |

Keep `pin` for the eval baseline use case (README §"Models are pinned … so eval
baselines vary only the model version") — a pin overrides the tier on the
harness that owns it. The eval harness already A/Bs `--model`; tiers just give
non-Claude users a sane default without forcing them to know build ids.

> **Reality check.** Agents like Bird, Kobe, Pippen lean on Claude-specific
> behaviors and MCP tools (Honeycomb, Context7). True parity on other harnesses
> is a stretch goal — the realistic near-term target is: **Claude Code = full
> fidelity; others = agents + commands + prompts work, hooks/MCP/eval-harness
> are best-effort.** Say this in the README so expectations match.

### 6.4 The eval harness is the moat — keep it harness-neutral

`evals/src/cli.ts` already shells out to `claude -p`. Generalize the runner
behind a `runAgent(spec, input)` interface with provider backends
(`claude -p`, OpenAI API, Gemini CLI, generic MCP call). That turns the eval
suite into a **cross-provider regression harness** — "does Bird still hold the
domain line on gpt-5 vs opus-4-8?" — which is exactly the differentiator over
atomic (see `docs/` comparison: atomic gives auditability, Dream Team measures
behavior). This is the single highest-leverage portability investment.

---

## 7. Migration & backwards compatibility

- Existing users (`~/.claude/dreamteam/repo-root` present) → `dreamteam install`
  detects the legacy layout, migrates workspace artifacts into `~/.dreamteam/`,
  and leaves a one-line shim at the old path so in-flight `/team` sessions don't
  break.
- The repo keeps working for development: a `dev` script runs the CLI from
  source (`bun bin/dreamteam.ts install --assets ./assets`), so contributors
  don't need a publish to test.
- Keep `scripts/install.ts` as a thin deprecated alias that calls
  `dreamteam install` for one minor version, then remove.

---

## 8. Open questions / risks

1. **Writable workspace vs. repo specs.** Today `/team` writes specs into the
   *target project's* `docs/spec-<topic>/`. Should that stay (project-local,
   committed) or move to `~/.dreamteam`? Likely **stay project-local** for specs,
   **move to `~/.dreamteam`** only for eval results/retros. Decide before §4.
2. **Hooks portability.** Claude Code hooks (`scripts/hooks.json`,
   `check-plan.ts`, `session-eval-hook.ts`) have no equivalent on most
   harnesses. Either ship them Claude-only or reimplement as a CLI pre/post step.
3. **MCP keys.** Never bundle keys. `dreamteam doctor` should detect missing
   Context7/Honeycomb/Miro servers and print the `claude mcp add …` line rather
   than failing.
4. **Bun-only vs node.** Shipping `.ts` bins is Bun-only. Precompiling to `dist`
   buys `npm i -g` support at the cost of a build step — recommended, since the
   ask is `bun add -g` *or others*.
5. **Naming.** `dreamteam` (the bin) may collide. Consider `dt` alias.

---

## 9. Phased roadmap

| Phase | Deliverable | Unblocks |
|-------|-------------|----------|
| **0** | Split `assets/` from workspace; `~/.dreamteam` data dir; manifest | everything below |
| **1** | `dreamteam` CLI (`install/uninstall/status/doctor`), Claude adapter only | `bun add -g @bondarewicz/dreamteam` works for Claude users |
| **2** | `files` allowlist + Changesets + OIDC release CI + eval gate | first public publish |
| **3** | Canonical spec + capability/model abstraction (Claude still only renderer) | clean seam, no behavior change |
| **4** | 2nd adapter (Cursor *or* generic-MCP) + `runAgent` provider backends | "not Claude-specific" is real |
| **5** | Cross-provider eval baseline (Bird on opus vs gpt vs gemini) | the differentiator vs atomic |

Ship Phase 1–2 to deliver the literal ask (`bun add -g …`). Phases 3–5 deliver
"not only Claude-specific" without betting the first release on it.

---

## 10. What to borrow from ECC

[ECC](https://github.com/affaan-m/ECC) ("agent harness operating system") is the
most-starred project in this space and — after a thorough six-prong deep read — it
is **real engineering by a credible author** ([Affaan Mustafa](https://affaanmustafa.com/):
Anthropic hackathon winner, elizaOS core dev, AgentShield author, 3M+ guide views),
not a config dump. The full ECC analysis and the prioritized upgrade plan it drove
now live in **[`ecc-upgrade-plan.md`](./ecc-upgrade-plan.md)** — read that for the
complete picture (state store, learning loop, security, docs/community, skills,
multi-harness). This section keeps only the **distribution-specific** takeaways.

### 10.1 Metrics — read them honestly, don't chase the number

Live GitHub API (2026-06-16): **216,472 stars** (repo created 2026-01-18) but only
**1,103 watchers**, **20 open issues**, and **3,412** `ecc-universal` weekly npm
downloads. Counts are also self-inconsistent (author's site: 97K stars / 116 skills;
repo: 216K / 271). The stars are powered by a genuine 10M-view distribution machine,
but the engagement ratios say active *adoption* is a fraction of the headline. **Don't
benchmark against the star number; benchmark against what's installable and proven.**

### 10.2 The distribution playbook (where we're absent, not behind)

1. **Multi-channel install.** Plugin (`/plugin install ecc@ecc`), npm, GitHub App,
   `install.sh --profile`. We have one path: `git clone` + `bun scripts/install.ts`.
   This is exactly what §1–§5 of this doc fix; ECC validates the work is worth doing.
2. **Claude Code plugin + marketplace listing — add as Phase 1.5.** Lowest-effort,
   highest-leverage adoption move. Our `agents/` + `commands/` are already in the
   shape a `.claude-plugin/plugin.json` wants (ECC registers its whole tree with one
   glob). Reaches Claude users who will never `bun add -g` anything.
3. **Install profiles.** `--profile agents` (agents+commands) vs `--profile full`
   (+ hooks + eval harness + MCP) for the `dreamteam install` surface (§3).
4. **A README that sells before it documents**, led by the moat ECC structurally
   lacks — see §10.3 and `ecc-upgrade-plan.md` §0/§5.
5. **`files` allowlist + provenance publishing.** We already plan OIDC provenance
   (§5) and a `files` allowlist (§3) — keep them; table stakes for trust.

Do **not** adopt: custom badge endpoints that decouple displayed metrics from GitHub,
12-language README SEO (solo-maintainer translation debt), or day-one monetization.

### 10.3 Lead with the moat

The confirmed differentiator: **ECC has no executable eval harness, no LLM judge over
a scenario corpus, and no schema-enforced agent output** — its `tests/` only assert
that prompt files contain expected strings, and model-backed judging is on its
roadmap. Dream Team has all three, plus the ParcelVision domain corpus. The README
hook: *"the only Claude Code agent team whose every behaviour is schema-enforced and
graded against a domain corpus — not vibes,"* with the public HTML eval report as
proof. **Sequencing:** distribution (§1–§5 + the plugin) gets people to the door; the
eval receipts are why they stay. Full upgrade roadmap in `ecc-upgrade-plan.md`.
