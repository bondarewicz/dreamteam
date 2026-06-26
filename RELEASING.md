# Releasing `@bondarewicz/dreamteam`

**Releases are automatic.** Merge (or push) a conventional-commit `feat:`/`fix:` to
`main` and CI publishes a new version — no version bump, no release PR, no manual tags.

## How it works — `.github/workflows/release.yml`

On every push to `main`, `scripts/next-version.ts` reads the conventional-commit
subjects since the last `v*` tag and picks the bump:

| Commit / squash subject on `main` | Result |
|---|---|
| `feat:` / `feat(scope):` | **minor** → publish |
| `fix:` | **patch** → publish |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer | **major** → publish |
| `chore:` `docs:` `ci:` `test:` `refactor:` `style:` | **no release** (workflow runs, finds nothing, exits) |

Then CI runs the LLM-free test gate, publishes to npm `latest` (OIDC trusted
publishing), tags `vX.Y.Z`, and cuts a GitHub Release with auto-generated notes.

**The version of record is git tags + npm, not `package.json`** — that field is a
managed placeholder (`0.0.0-managed`). CI sets the real version in the workspace at
publish time, so the published tarball (and every installed user's `dreamteam status`)
is always correct. There is **no release-please** and **no release PR**.

## What you do

1. Land changes via PR (main is protected) — or push directly (you have admin bypass).
2. Use a conventional-commit **PR title / squash subject**: that's what CI reads
   (`feat(cli): …`, `fix: …`). chore/docs/ci subjects ship nothing.
3. Merge → it publishes. Watch the `release` workflow run to confirm.

## Run the eval gate LOCALLY first (important)

CI runs only `bun test`. It does NOT run the behavioral eval (needs Claude/Max auth CI
lacks; `ANTHROPIC_API_KEY` would bill the API). Before merging changes to agent/command
specs:

```bash
bun evals/src/cli.ts --trials 3        # behavioral gate (Max-backed judge)
bun test                               # same suite CI runs
bun pack:check                         # inspect tarball contents/size
```

## Beta channel (non-`main` branches)

Push any non-`main` branch → publishes `<last-version>-beta.g<sha>` to the `beta`
dist-tag. Install with `bun add -g @bondarewicz/dreamteam@beta`.

## Dry run

`workflow_dispatch` on `release.yml` with `dry_run: true` packs without publishing.

## One-time setup (already done)

npm trusted publishing (OIDC) for this repo + workflow (or the `NPM_TOKEN` secret). 2FA
is bypassed for trusted publishing / automation tokens.
