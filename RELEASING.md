# Releasing `@bondarewicz/dreamteam`

Beta from a branch (npm dist-tag `beta`), tested in the open, promoted to stable
(`latest`) only on merge to `main`. Betas never become what a plain
`bun add -g @bondarewicz/dreamteam` resolves to.

| Channel | Version | Published with | Installed with |
|---------|---------|----------------|----------------|
| **Beta** (any non-`main` branch) | `2.0.0-beta.<N>` | `npm publish --tag beta` | `bun add -g @bondarewicz/dreamteam@beta` |
| **Stable** (`main`) | `2.0.0` | `npm publish` *(→ `latest`)* | `bun add -g @bondarewicz/dreamteam` |

Semver `-beta.N` is excluded from `^`/`~` ranges, and the `beta` dist-tag keeps it off
`latest`. Until the first stable ships there is **no `latest`** — install `@beta` explicitly.

## CI (the normal path) — `.github/workflows/release.yml`

- Push to `feat/distribution` (or any non-`main` branch) → publishes `…-beta.<run_number>`
  to the `beta` tag.
- Push to `main` → publishes the stable version to `latest`.
- Both run with OIDC **provenance** and are gated on the **unit/integration suite** (`bun test`).
- `workflow_dispatch` with `dry_run: true` packs without publishing.

### One-time setup (before the first CI publish)
1. **Claim the name + enable trusted publishing.** On npmjs.com create/own the
   `@bondarewicz` scope. Either (a) add a **Trusted Publisher** for this repo+workflow
   (no token needed — preferred), or (b) create a granular **automation token** and add it
   as the repo secret `NPM_TOKEN` (the workflow reads `NODE_AUTH_TOKEN`).
2. **2FA:** trusted publishing / automation tokens bypass the interactive OTP that would
   otherwise block CI.

## The eval gate is LOCAL (important)

CI runs the LLM-free `bun test` suite. It does **not** run the behavioral eval
(`bun evals/src/cli.ts --trials 3`) — that needs Claude/Max auth CI lacks, and
`ANTHROPIC_API_KEY` would bill the API (which we avoid). **Before triggering a release,
run the eval gate locally:**

```bash
bun evals/src/cli.ts --trials 3        # behavioral gate (Max-backed judge)
bun test                               # same suite CI runs
bun pack:check                         # inspect tarball contents/size
```

## Manual beta (fallback, no CI)

```bash
npm login                              # once, as the package owner
bun version:beta                       # 2.0.0 → 2.0.0-beta.0 (then .1, .2, …)
bun publish:beta                       # npm publish --tag beta --access public
# test the REAL published artifact in a clean shell:
bun add -g @bondarewicz/dreamteam@beta
dreamteam doctor && dreamteam install && dreamteam web
# iterate: bun version:beta → bun publish:beta → retest
```

## Promote to stable (on merge to `main`)

```bash
# after feat/distribution → main:
npm version 2.0.0 --no-git-tag-version # drop the -beta suffix (or bump as needed)
# CI on main publishes latest automatically; or manually:
bun publish:stable
```

Optionally clean up: `npm dist-tag rm @bondarewicz/dreamteam beta` once a stable `latest`
exists, or `npm deprecate '@bondarewicz/dreamteam@<beta range>' 'superseded by 2.0.0'`.
