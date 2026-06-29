/**
 * instinct-scrub.heldout.test.ts — AC-2a′ held-out anti-overfit corpus (path "C")
 *
 * AUTHORED BY KOBE, INDEPENDENTLY OF SHAQ'S IMPLEMENTATION (anti-overfit gate).
 *
 * Purpose
 * -------
 * Path (C) deletes the wordlist + DR-5 (the orthographic "Title-case word absent
 * from the dictionary → DROP" branch). Under (C), a bare Title-case ordinary
 * English word with NO positive name-signal (no camelCaps/PascalCase code shape,
 * no DR-6 naming-context possessive/entity proximity, no corroborated acronym)
 * MUST be KEPT. The new failure mode is under-drop of bare signal-less names,
 * which is recoverable and backstopped by BR-13 (human-approval gate).
 *
 * This corpus is the zero-false-drop bar for that behavior. Every word below is:
 *   - an ordinary 10+ character Title-case English word that realistically
 *     appears in instinct prose;
 *   - DISJOINT from every word in instinct-scrub.test.ts (verified: 0 matches
 *     each, case-insensitive) — this is the anti-overfit guarantee. The words
 *     Shaq tuned against are deliberately NOT reused here;
 *   - embedded MID-SENTENCE (not clause-initial, so DR-2 does not trivially
 *     exempt it) in a realistic single-sentence instinct context with NO entity
 *     context words within ±5 tokens and NO possessive — so under (C) the only
 *     correct outcome is KEEP.
 *
 * EXPECTED STATE WHILE REVIEWING:
 *   Against the CURRENT (pre-(C)) wordlist-based Rule 4 / DR-5, MOST of these
 *   words are 10+ chars, absent from the 3–9 char primary list, and absent from
 *   the ENGLISH_WORDS_LONG supplement → they DROP. So this file is RED today.
 *   THAT IS EXPECTED AND CORRECT. It turns GREEN only once Shaq lands (C)
 *   (DR-5 deleted, wordlist removed). A green run here is the AC-2a′ sign-off.
 *
 * Determinism: no Math.random / Date / crypto — a fixed literal corpus.
 *
 * Run: bun test web/src/__tests__/instinct-scrub.heldout.test.ts
 */

import { test, expect, describe } from "bun:test";
import { scrub, RULES, type InstinctCandidate } from "../instinct-scrub.ts";

// ---------------------------------------------------------------------------
// Sanity: same import surface as the main suite
// ---------------------------------------------------------------------------

test("RULES import surface is intact (held-out file)", () => {
  expect(Array.isArray(RULES)).toBe(true);
  expect(RULES.length).toBeGreaterThan(3);
});

// ---------------------------------------------------------------------------
// AC-2a′ — held-out ordinary Title-case vocabulary (0 false drops required)
//
// 28 words (> the ≥25 bar). Each appears Title-case MID-SENTENCE with no
// name-signal. Under (C) all must be KEPT.
// ---------------------------------------------------------------------------

describe("AC-2a′ — held-out anti-overfit corpus (0 false drops required under path C)", () => {
  const HELDOUT_CORPUS: Array<{ trigger: string; behavioral_shape: string; word: string }> = [
    {
      trigger: "when a design decision is non-obvious",
      behavioral_shape: "record a clear Justification before moving on",
      word: "Justification",
    },
    {
      trigger: "when a problem feels too large to tackle at once",
      behavioral_shape: "favor stepwise Decomposition into smaller subproblems",
      word: "Decomposition",
    },
    {
      trigger: "when a long message contains several distinct asks",
      behavioral_shape: "send a brief Acknowledgement of each one before answering",
      word: "Acknowledgement",
    },
    {
      trigger: "when several tasks compete for limited time",
      behavioral_shape: "make the Prioritization explicit before starting any of them",
      word: "Prioritization",
    },
    {
      trigger: "when modelling a tricky concept",
      behavioral_shape: "choose a Representation that makes the invariants obvious",
      word: "Representation",
    },
    {
      trigger: "when requirements seem to conflict",
      behavioral_shape: "defer the final Determination until the trade-offs are clear",
      word: "Determination",
    },
    {
      trigger: "when inputs vary widely in shape",
      behavioral_shape: "apply a stable Classification before branching on type",
      word: "Classification",
    },
    {
      trigger: "when reading unfamiliar code",
      behavioral_shape: "build a mental Comprehension of the flow before editing",
      word: "Comprehension",
    },
    {
      trigger: "when a downstream call may fail",
      behavioral_shape: "handle the failure in Anticipation rather than reacting later",
      word: "Anticipation",
    },
    {
      trigger: "when load is uneven across workers",
      behavioral_shape: "even out the Distribution before it becomes a bottleneck",
      word: "Distribution",
    },
    {
      trigger: "when many small changes accumulate",
      behavioral_shape: "describe each Contribution so the history stays readable",
      word: "Contribution",
    },
    {
      trigger: "when the solution space is wide open",
      behavioral_shape: "timebox the Exploration before committing to one path",
      word: "Exploration",
    },
    {
      trigger: "when a risky operation is imminent",
      behavioral_shape: "do the Preparation up front so the step itself is quick",
      word: "Preparation",
    },
    {
      trigger: "when data is accidentally lost",
      behavioral_shape: "rehearse the Restoration path before it is ever needed",
      word: "Restoration",
    },
    {
      trigger: "when a variable purpose is unclear",
      behavioral_shape: "put the intent in the Declaration with a descriptive name",
      word: "Declaration",
    },
    {
      trigger: "when a bug is hard to reproduce",
      behavioral_shape: "slow down for a careful Examination of the inputs",
      word: "Examination",
    },
    {
      trigger: "when behaviour surprises a reader",
      behavioral_shape: "leave a short Explanation near the surprising line",
      word: "Explanation",
    },
    {
      trigger: "when agreeing to a plan despite doubts",
      behavioral_shape: "voice any Reservation early rather than after the fact",
      word: "Reservation",
    },
    {
      trigger: "when crossing a system boundary",
      behavioral_shape: "make the Translation between formats explicit and total",
      word: "Translation",
    },
    {
      trigger: "when a number drives a decision",
      behavioral_shape: "show the Calculation so others can check it",
      word: "Calculation",
    },
    {
      trigger: "when tuning for speed",
      behavioral_shape: "base each change on a Measurement rather than a guess",
      word: "Measurement",
    },
    {
      trigger: "when sharing behaviour between types",
      behavioral_shape: "prefer composition over deep Inheritance to limit coupling",
      word: "Inheritance",
    },
    {
      trigger: "when an iterative process runs long",
      behavioral_shape: "watch for Convergence and stop once it stabilizes",
      word: "Convergence",
    },
    {
      trigger: "when a pattern repeats across cases",
      behavioral_shape: "let that Recognition drive a shared abstraction",
      word: "Recognition",
    },
    {
      trigger: "when a build step is slow",
      behavioral_shape: "cache the Compilation output to speed later runs",
      word: "Compilation",
    },
    {
      trigger: "when an interface is non-trivial",
      behavioral_shape: "write a precise Description of the expected contract",
      word: "Description",
    },
    {
      trigger: "when severity is uncertain",
      behavioral_shape: "make an honest Assessment before escalating",
      word: "Assessment",
    },
    {
      trigger: "when a resource must be held briefly",
      behavioral_shape: "pair every Acquisition with a guaranteed release",
      word: "Acquisition",
    },
  ];

  test("corpus size is at least 25 (anti-overfit breadth)", () => {
    expect(HELDOUT_CORPUS.length).toBeGreaterThanOrEqual(25);
  });

  test("every word appears Title-case mid-sentence (not clause-initial)", () => {
    // Self-check on the fixtures: the word must occur after a lowercase prose
    // word inside behavioral_shape, never at position 0. Guards against an
    // accidental clause-initial placement that would make the test pass via
    // DR-2 instead of via the (C) keep-by-default behavior we mean to verify.
    const misplaced: string[] = [];
    for (const { behavioral_shape, word } of HELDOUT_CORPUS) {
      const idx = behavioral_shape.indexOf(word);
      if (idx <= 0) misplaced.push(word);
      const prev = behavioral_shape[idx - 1];
      if (prev !== " ") misplaced.push(`${word} (no leading space)`);
    }
    expect(misplaced).toEqual([]);
  });

  test("all held-out words are KEPT — 0 false drops (AC-2a′ bar)", () => {
    const falseDrops: string[] = [];
    for (const inst of HELDOUT_CORPUS) {
      const result = scrub({ trigger: inst.trigger, behavioral_shape: inst.behavioral_shape, evidence: [] });
      if (!result.ok) {
        falseDrops.push(`"${inst.word}" → ${result.reason} (${result.matchedRule})`);
      }
    }
    if (falseDrops.length > 0) {
      throw new Error(
        `AC-2a′ held-out false drops (${falseDrops.length}/${HELDOUT_CORPUS.length}) — ` +
        `EXPECTED RED until path (C) lands; GREEN is the sign-off:\n` +
        falseDrops.map(s => "  " + s).join("\n"),
      );
    }
    expect(falseDrops.length).toBe(0);
  });

  // Per-word assertions for precise failure output.
  for (const inst of HELDOUT_CORPUS) {
    test(`KEPT (held-out): "${inst.word}"`, () => {
      const result = scrub({ trigger: inst.trigger, behavioral_shape: inst.behavioral_shape, evidence: [] });
      expect(result.ok).toBe(true);
    });
  }
});
