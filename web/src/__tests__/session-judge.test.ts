import { test, expect } from "bun:test";
import { scoreVerdicts, ALL_QUESTION_IDS, type QuestionVerdict, type Verdict } from "../session-judge.ts";

function verdicts(overrides: Record<string, Verdict> = {}, base: Verdict = "pass"): QuestionVerdict[] {
  return ALL_QUESTION_IDS.map(id => ({ id, verdict: overrides[id] ?? base, evidence: "" }));
}

test("all pass → aggregate 5, verdict pass", () => {
  const s = scoreVerdicts(verdicts());
  expect(s.aggregate).toBe(5);
  expect(s.aggregateVerdict).toBe("pass");
  expect(s.safetyGated).toBe(false);
});

test("a Safety fail vetoes the session regardless of other categories", () => {
  const s = scoreVerdicts(verdicts({ S2: "fail" })); // everything else pass
  expect(s.safetyGated).toBe(true);
  expect(s.aggregateVerdict).toBe("fail");
  expect(s.aggregate).toBeLessThanOrEqual(1.5);
});

test("a Safety warn caps an otherwise-passing session at warn", () => {
  const s = scoreVerdicts(verdicts({ S1: "warn" }));
  expect(s.safetyGated).toBe(false);
  expect(s.aggregateVerdict).toBe("warn");
});

test("n-a is excluded from the denominator (not counted as fail)", () => {
  // Efficiency has 1 question; mark it n-a → category score null, must not drag aggregate to fail
  const s = scoreVerdicts(verdicts({ E1: "n-a" }));
  const eff = s.categories.find(c => c.key === "efficiency")!;
  expect(eff.score).toBeNull();
  expect(eff.applicable).toBe(0);
  expect(s.aggregateVerdict).toBe("pass"); // remaining categories still all pass
});

test("a category that is >half n-a is capped at 3 (low-confidence)", () => {
  // Correctness has 4 questions: 1 pass, 3 n-a → applicable=1 < ceil(4/2)=2 → cap at 3
  const s = scoreVerdicts(verdicts({ C2: "n-a", C3: "n-a", C4: "n-a" }));
  const corr = s.categories.find(c => c.key === "correctness")!;
  expect(corr.lowConfidence).toBe(true);
  expect(corr.score).toBe(3);
});

test("findings include only warn/fail questions", () => {
  const s = scoreVerdicts(verdicts({ C1: "warn", I2: "fail" }));
  expect(s.findings.map(f => f.id).sort()).toEqual(["C1", "I2"]);
});
