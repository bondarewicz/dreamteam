#!/usr/bin/env bun
/**
 * next-version.ts — auto-versioning for Option 1 (publish-on-merge).
 *
 * release.yml runs this on every push to main. It reads the conventional-commit
 * subjects since the last `v*` tag and decides the next semver:
 *   BREAKING (`type!:` or `BREAKING CHANGE:` footer) → major
 *   any `feat:` → minor
 *   any `fix:`  → patch
 *   anything else (chore/docs/ci/test/refactor/style) → NO release
 *
 * Prints the next version (e.g. `1.3.0`) to stdout, or NOTHING when there's
 * nothing to release — release.yml treats empty output as "skip publish". The
 * version of record lives in git tags + npm; package.json is a managed placeholder.
 */

export type Bump = "major" | "minor" | "patch" | null;

// `type(scope)!: subject` — captures type and the optional `!` breaking marker.
const TYPE_RE = /^([a-z]+)(\([^)]*\))?(!)?:/i;

/**
 * Decide the bump from commit subjects (first lines) + bodies. Pure + testable.
 * feat outranks fix; a breaking marker anywhere outranks both.
 */
export function computeBump(subjects: string[], bodies: string[]): Bump {
  const breakingInSubject = subjects.some((s) => TYPE_RE.exec(s.trim())?.[3] === "!");
  const breakingInBody = bodies.some((b) => /^BREAKING[ -]CHANGE:/im.test(b));
  if (breakingInSubject || breakingInBody) return "major";

  let bump: Bump = null;
  for (const s of subjects) {
    const type = TYPE_RE.exec(s.trim())?.[1]?.toLowerCase();
    if (type === "feat") return "minor"; // minor is the highest non-breaking bump
    if (type === "fix") bump = "patch";
  }
  return bump;
}

/** Increment a semver string by the given level. Pure + testable. */
export function bumpVersion(current: string, level: Exclude<Bump, null>): string {
  const [maj, min, pat] = current.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  if (level === "major") return `${maj + 1}.0.0`;
  if (level === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** Run a shell command, returning trimmed stdout ("" on failure). */
function sh(cmd: string): string {
  try {
    const p = Bun.spawnSync(["bash", "-lc", cmd]);
    return new TextDecoder().decode(p.stdout).trim();
  } catch {
    return "";
  }
}

if (import.meta.main) {
  const lastTag = sh("git describe --tags --match 'v*' --abbrev=0 2>/dev/null");
  const range = lastTag ? `${lastTag}..HEAD` : "";
  // Exclude merge commits; squash-merge subjects carry the PR title's conventional prefix.
  const subjects = sh(`git log ${range} --no-merges --format='%s'`).split("\n").filter(Boolean);
  // NUL-separate bodies so multi-line BREAKING CHANGE footers stay intact.
  const bodies = sh(`git log ${range} --no-merges --format='%b%x00'`).split("\0").map((b) => b.trim()).filter(Boolean);

  const level = computeBump(subjects, bodies);
  if (!level) process.exit(0); // empty stdout → release.yml skips

  const base = lastTag ? lastTag.replace(/^v/, "") : "0.0.0";
  process.stdout.write(bumpVersion(base, level));
}
