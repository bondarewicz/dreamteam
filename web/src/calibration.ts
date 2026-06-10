/**
 * calibration.ts — "eval the evaluator" (slice 4, docs/session-evals-design.md §6).
 *
 * A calibration scenario = a FROZEN compacted transcript + a HUMAN golden label
 * per rubric question. Running calibration feeds each frozen transcript through
 * the current judge prompt and compares verdicts to the labels MECHANICALLY
 * (exact-match agreement + ordinal gap) — no second LLM, so no regress.
 *
 * Scenarios are JSON files in web/data/calibration/. Labels start as "draft"
 * (Claude-proposed) and become "human" once reviewed in the UI.
 */
import fs from "fs";
import path from "path";
import { ALL_QUESTION_IDS, judgeTranscript, judgePromptVersion } from "./session-judge.ts";
import type { Verdict, QuestionVerdict } from "./session-judge.ts";

const CALIB_DIR = path.join(import.meta.dir, "../data/calibration");

export type CalibrationScenario = {
  id: string;
  project: string;
  session_id: string;
  title: string;
  note: string;
  labeledBy: "draft" | "human";
  labels: Partial<Record<string, Verdict>>; // question id -> golden verdict
  transcript: string;                        // FROZEN judge input
};

export function listCalibration(): CalibrationScenario[] {
  if (!fs.existsSync(CALIB_DIR)) return [];
  return fs.readdirSync(CALIB_DIR).filter(f => f.endsWith(".json"))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CALIB_DIR, f), "utf8")) as CalibrationScenario; }
      catch { return null; }
    })
    .filter((s): s is CalibrationScenario => !!s)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getCalibration(id: string): CalibrationScenario | null {
  const file = path.join(CALIB_DIR, `${id}.json`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function saveCalibration(s: CalibrationScenario): void {
  fs.mkdirSync(CALIB_DIR, { recursive: true });
  fs.writeFileSync(path.join(CALIB_DIR, `${s.id}.json`), JSON.stringify(s, null, 2));
}

function nextId(): string {
  const existing = listCalibration().map(s => s.id);
  let n = 1;
  while (existing.includes(`calib-${String(n).padStart(2, "0")}`)) n++;
  return `calib-${String(n).padStart(2, "0")}`;
}

/** Freeze a session as a new calibration scenario, seeding draft labels (e.g. from a prior eval). */
export function createCalibrationFromSession(
  project: string, sessionId: string, title: string, transcript: string,
  draftLabels: Partial<Record<string, Verdict>>, note = "",
): CalibrationScenario {
  const s: CalibrationScenario = {
    id: nextId(), project, session_id: sessionId, title, note,
    labeledBy: "draft", labels: draftLabels, transcript,
  };
  saveCalibration(s);
  return s;
}

// ── runner ────────────────────────────────────────────────────
const ORD: Record<Verdict, number> = { fail: 0, warn: 1, pass: 2, "n-a": -1 };

export type QuestionAgreement = {
  id: string; label: Verdict | null; judged: Verdict; match: boolean; gap: number | null;
};
export type ScenarioResult = {
  id: string; title: string; labeledBy: string;
  questions: QuestionAgreement[];
  labeled: number; matched: number; agreement: number; // over labeled questions
  error?: string;
};
export type CalibrationRun = {
  promptVersion: string;
  ranAt: string;
  scenarios: ScenarioResult[];
  totalLabeled: number; totalMatched: number; agreement: number;
  // judge-bias: positive = judge harsher (lower verdict) than human, negative = softer
  meanSignedGap: number;
};

export async function runCalibration(opts: { now: string; model?: string }): Promise<CalibrationRun> {
  const scenarios = listCalibration();
  const results = await Promise.all(scenarios.map(async (s): Promise<ScenarioResult> => {
    const r = await judgeTranscript(s.transcript, { now: opts.now, model: opts.model });
    const judgedById = new Map(r.verdicts.map(v => [v.id, v.verdict]));
    const questions: QuestionAgreement[] = ALL_QUESTION_IDS.map(id => {
      const label = (s.labels[id] ?? null) as Verdict | null;
      const judged = (judgedById.get(id) ?? "n-a") as Verdict;
      const match = label !== null && label === judged;
      const gap = label !== null && label !== "n-a" && judged !== "n-a" ? ORD[judged] - ORD[label] : null;
      return { id, label, judged, match, gap };
    });
    const labeledQs = questions.filter(q => q.label !== null);
    const matched = labeledQs.filter(q => q.match).length;
    return {
      id: s.id, title: s.title, labeledBy: s.labeledBy, questions,
      labeled: labeledQs.length, matched,
      agreement: labeledQs.length ? matched / labeledQs.length : 0,
      error: r.error,
    };
  }));

  const totalLabeled = results.reduce((a, r) => a + r.labeled, 0);
  const totalMatched = results.reduce((a, r) => a + r.matched, 0);
  const gaps = results.flatMap(r => r.questions.map(q => q.gap).filter((g): g is number => g !== null));
  const meanSignedGap = gaps.length ? gaps.reduce((a, g) => a + g, 0) / gaps.length : 0;

  return {
    promptVersion: judgePromptVersion(),
    ranAt: opts.now,
    scenarios: results,
    totalLabeled, totalMatched,
    agreement: totalLabeled ? totalMatched / totalLabeled : 0,
    meanSignedGap,
  };
}
