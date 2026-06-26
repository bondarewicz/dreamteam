import { test, expect, describe } from "bun:test";
import { computeBump, bumpVersion } from "../../../scripts/next-version.ts";

describe("computeBump", () => {
  test("feat → minor", () => {
    expect(computeBump(["feat: add thing", "chore: tidy"], [])).toBe("minor");
  });

  test("feat with scope + PR suffix → minor", () => {
    expect(computeBump(["feat(cli): add upgrade command (#55)"], [])).toBe("minor");
  });

  test("fix → patch", () => {
    expect(computeBump(["fix: handle null", "docs: readme"], [])).toBe("patch");
  });

  test("feat outranks fix regardless of order", () => {
    expect(computeBump(["fix: a", "feat: b"], [])).toBe("minor");
    expect(computeBump(["feat: b", "fix: a"], [])).toBe("minor");
  });

  test("breaking marker `!` → major (outranks feat)", () => {
    expect(computeBump(["feat!: drop old api"], [])).toBe("major");
    expect(computeBump(["feat(core)!: rework"], [])).toBe("major");
  });

  test("BREAKING CHANGE footer in body → major", () => {
    expect(computeBump(["feat: x"], ["BREAKING CHANGE: removed Y"])).toBe("major");
    expect(computeBump(["fix: x"], ["BREAKING-CHANGE: removed Y"])).toBe("major");
  });

  test("only chore/docs/ci/test/refactor → no release", () => {
    expect(computeBump(["chore: deps", "docs: tidy", "ci: bump action", "test: more", "refactor: rename"], [])).toBeNull();
  });

  test("non-conventional subjects → no release", () => {
    expect(computeBump(["wip", "merge stuff", "update readme"], [])).toBeNull();
  });

  test("empty → no release", () => {
    expect(computeBump([], [])).toBeNull();
  });

  test("does not mistake prose 'fix' in a body for a fix commit", () => {
    expect(computeBump(["chore: cleanup"], ["this will fix things later"])).toBeNull();
  });
});

describe("bumpVersion", () => {
  test("major resets minor+patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(bumpVersion("v1.2.3", "major")).toBe("2.0.0");
  });
  test("minor resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });
  test("patch increments patch", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });
  test("handles 1.2.0 → 1.3.0 (the real next release)", () => {
    expect(bumpVersion("1.2.0", "minor")).toBe("1.3.0");
  });
});
