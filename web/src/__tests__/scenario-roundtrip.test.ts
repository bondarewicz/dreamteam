/**
 * Tests for parseTeamScenario / serializeTeamScenario round-trip behaviour.
 *
 * Covers:
 *   AC-1: All phase section headers preserved exactly on round-trip
 *   AC-2: Phase 1 header "Phase 1: Bird — Domain Analysis" preserved exactly
 *   AC-3: Phase type includes sectionHeader field
 *   AC-4: parseTeamScenario captures ## headings into sectionHeader
 *   AC-5: serializeTeamScenario uses stored sectionHeader instead of hard-coded labels
 *   AC-6: Fallback to "Phase N" when no sectionHeader exists
 *   AC-7: Real scenario-01-automapper-removal.md round-trips without changes
 */

import { test, expect, describe } from "bun:test";
import path from "path";
import fs from "fs";
import { parseTeamScenario, serializeTeamScenario } from "../routes/scenarios.ts";

// Minimal team scenario with unique descriptive phase headers
const SCENARIO_WITH_HEADERS = `# Eval: Team — Round-trip Test

## Overview

Tests round-trip fidelity of section headers.

---

category: regression

graders: []

---

## Phase 1: Bird — Domain Analysis

phase_1_agent: bird

phase_1_prompt: |
  Analyze the domain.

phase_1_expected_behavior: |
  Bird produces structured analysis.

phase_1_failure_modes: |
  Bird misses key domain concepts.

phase_1_scoring_rubric: |
  Pass if analysis is complete.

phase_1_graders: []

---

## Phase 2: MJ — Architecture

phase_2_agent: mj

phase_2_prompt: |
  Design the architecture.

phase_2_expected_behavior: |
  MJ produces an architectural plan.

phase_2_failure_modes: |
  MJ ignores constraints.

phase_2_scoring_rubric: |
  Pass if architecture is sound.

phase_2_graders: []

---

## Phase 3: Human Checkpoint (Fixture)

phase_3_agent: human

phase_3_prompt: |
  Human decision fixture: approve the plan.

phase_3_expected_behavior: |
  Human approves.

phase_3_failure_modes: |
  No approval given.

phase_3_scoring_rubric: |
  Pass if approved.

phase_3_graders: []

---

## Phase 4: Implementation — Shaq

phase_4_agent: shaq

phase_4_prompt: |
  Implement the plan.

phase_4_expected_behavior: |
  Shaq ships code.

phase_4_failure_modes: |
  Shaq skips tests.

phase_4_scoring_rubric: |
  Pass if implementation is complete.

phase_4_graders: []

---

## Pipeline-Level Fields

pipeline_expected_behavior: |
  All phases complete successfully.

pipeline_failure_modes: |
  Any phase fails.

pipeline_scoring_rubric: |
  Pass if all phases produce correct output.
`;

// Scenario with no ## headings before phases (programmatic / legacy format)
const SCENARIO_WITHOUT_HEADERS = `# Eval: Team — No Headers Test

## Overview

Tests fallback behaviour when phases have no section headers.

---

category: regression

graders: []

---

phase_1_agent: bird

phase_1_prompt: |
  Analyze.

phase_1_graders: []

---

phase_2_agent: shaq

phase_2_prompt: |
  Implement.

phase_2_graders: []

---

## Pipeline-Level Fields

pipeline_expected_behavior: |
  All phases complete.

pipeline_failure_modes: |
  Phases fail.

pipeline_scoring_rubric: |
  Pass if complete.
`;

// Scenario where Phase 1 has a section header but Phase 2 does not.
// This is the exact case that triggers the header-bleed bug: without the
// prevPhaseEnd boundary, Phase 2 would incorrectly inherit Phase 1's heading.
const SCENARIO_MIXED_HEADERS = `# Eval: Team — Mixed Headers Test

## Overview

Tests that a phase without a heading does not inherit the previous phase's heading.

---

category: regression

graders: []

---

## Phase 1: Bird — Analysis

phase_1_agent: bird

phase_1_prompt: |
  Analyze.

phase_1_graders: []

---

phase_2_agent: shaq

phase_2_prompt: |
  Implement.

phase_2_graders: []

---

## Pipeline-Level Fields

pipeline_expected_behavior: |
  All phases complete.

pipeline_failure_modes: |
  Phases fail.

pipeline_scoring_rubric: |
  Pass if complete.
`;

// ── AC-3: Phase type includes sectionHeader field ─────────────────────────────

describe("AC-3: Phase type includes sectionHeader field", () => {
  test("parsed phase object has sectionHeader property", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    // The property must exist on the Phase objects when a heading is found
    expect(phases[0]).toHaveProperty("sectionHeader");
  });
});

// ── AC-4: parseTeamScenario captures ## headings into sectionHeader ───────────

describe("AC-4: parseTeamScenario captures ## headings", () => {
  test("phase 1 sectionHeader matches the ## heading text", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    expect(phases[0].sectionHeader).toBe("Phase 1: Bird — Domain Analysis");
  });

  test("phase 2 sectionHeader matches the ## heading text", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    expect(phases[1].sectionHeader).toBe("Phase 2: MJ — Architecture");
  });

  test("phase 3 sectionHeader matches the ## heading text (human phase)", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    expect(phases[2].sectionHeader).toBe("Phase 3: Human Checkpoint (Fixture)");
  });

  test("phase 4 sectionHeader matches the ## heading text", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    expect(phases[3].sectionHeader).toBe("Phase 4: Implementation — Shaq");
  });

  test("all 4 phases are captured", () => {
    const { phases } = parseTeamScenario(SCENARIO_WITH_HEADERS);
    expect(phases).toHaveLength(4);
  });
});

// ── AC-2: Phase 1 header exactly preserved ────────────────────────────────────

describe("AC-2: Phase 1 header preserved exactly", () => {
  test("Phase 1 header 'Phase 1: Bird — Domain Analysis' round-trips unchanged", () => {
    const content = SCENARIO_WITH_HEADERS;
    const parsed = parseTeamScenario(content);
    const serialized = serializeTeamScenario(parsed);
    expect(serialized).toContain("## Phase 1: Bird — Domain Analysis");
  });
});

// ── AC-5: serializeTeamScenario uses stored sectionHeader ────────────────────

describe("AC-5: serializeTeamScenario uses stored sectionHeader", () => {
  test("serialized output contains all original ## headings", () => {
    const parsed = parseTeamScenario(SCENARIO_WITH_HEADERS);
    const serialized = serializeTeamScenario(parsed);
    expect(serialized).toContain("## Phase 1: Bird — Domain Analysis");
    expect(serialized).toContain("## Phase 2: MJ — Architecture");
    expect(serialized).toContain("## Phase 3: Human Checkpoint (Fixture)");
    expect(serialized).toContain("## Phase 4: Implementation — Shaq");
  });

  test("serialized output does NOT contain hard-coded 'Phase 1: Parallel Analysis'", () => {
    // The old hard-coded label should NOT appear when the actual header differs
    const parsed = parseTeamScenario(SCENARIO_WITH_HEADERS);
    const serialized = serializeTeamScenario(parsed);
    expect(serialized).not.toContain("## Phase 1: Parallel Analysis");
  });

  test("serialized output does NOT contain hard-coded 'Phase 4: Human Decision (Fixture)'", () => {
    // Our scenario uses "Phase 3: Human Checkpoint (Fixture)" for the human phase
    const parsed = parseTeamScenario(SCENARIO_WITH_HEADERS);
    const serialized = serializeTeamScenario(parsed);
    // The old code would emit "Phase 4: Human Decision (Fixture)" for phase 4
    // Our phase 4 is "Phase 4: Implementation — Shaq" — ensure that's what's emitted
    expect(serialized).not.toContain("## Phase 4: Human Decision (Fixture)");
    expect(serialized).toContain("## Phase 4: Implementation — Shaq");
  });
});

// ── AC-1: Full round-trip preserves all headers ───────────────────────────────

describe("AC-1: Round-trip preserves all headers", () => {
  test("parse → serialize → parse yields identical sectionHeaders", () => {
    const parsed1 = parseTeamScenario(SCENARIO_WITH_HEADERS);
    const serialized = serializeTeamScenario(parsed1);
    const parsed2 = parseTeamScenario(serialized);

    for (let i = 0; i < parsed1.phases.length; i++) {
      expect(parsed2.phases[i].sectionHeader).toBe(parsed1.phases[i].sectionHeader);
    }
  });

  test("two scenarios with different Phase 1 headers both preserve their own", () => {
    const scenarioA = SCENARIO_WITH_HEADERS;
    const scenarioB = scenarioA.replace(
      "## Phase 1: Bird — Domain Analysis",
      "## Phase 1: Custom Header For Scenario B"
    );

    const parsedA = parseTeamScenario(scenarioA);
    const parsedB = parseTeamScenario(scenarioB);

    const serializedA = serializeTeamScenario(parsedA);
    const serializedB = serializeTeamScenario(parsedB);

    expect(serializedA).toContain("## Phase 1: Bird — Domain Analysis");
    expect(serializedB).toContain("## Phase 1: Custom Header For Scenario B");
    // Each scenario must NOT leak the other's header
    expect(serializedA).not.toContain("## Phase 1: Custom Header For Scenario B");
    expect(serializedB).not.toContain("## Phase 1: Bird — Domain Analysis");
  });
});

// ── AC-6: Fallback to "Phase N" when no sectionHeader ────────────────────────

describe("AC-6: Fallback to Phase N when no sectionHeader", () => {
  test("phases with no ## heading get fallback label in serialized output", () => {
    const parsed = parseTeamScenario(SCENARIO_WITHOUT_HEADERS);
    const serialized = serializeTeamScenario(parsed);
    // Phases 1 and 2 have no ## heading before them
    expect(serialized).toContain("## Phase 1");
    expect(serialized).toContain("## Phase 2");
  });

  test("phases with no ## heading have undefined sectionHeader", () => {
    const parsed = parseTeamScenario(SCENARIO_WITHOUT_HEADERS);
    // phases 1 and 2 have no ## heading before the phase_N_agent field
    expect(parsed.phases[0].sectionHeader).toBeUndefined();
    expect(parsed.phases[1].sectionHeader).toBeUndefined();
  });
});

// ── Mixed-header: header bleed regression test ────────────────────────────────

describe("Mixed-header: Phase 1 has heading, Phase 2 does not", () => {
  test("Phase 2 sectionHeader is undefined (no header bleed from Phase 1)", () => {
    const { phases } = parseTeamScenario(SCENARIO_MIXED_HEADERS);
    expect(phases[0].sectionHeader).toBe("Phase 1: Bird — Analysis");
    expect(phases[1].sectionHeader).toBeUndefined();
  });

  test("Phase 2 serializes with fallback label '## Phase 2' (not Phase 1 heading)", () => {
    const parsed = parseTeamScenario(SCENARIO_MIXED_HEADERS);
    const serialized = serializeTeamScenario(parsed);
    expect(serialized).toContain("## Phase 1: Bird — Analysis");
    expect(serialized).toContain("## Phase 2");
    expect(serialized).not.toContain("## Phase 2: Bird — Analysis");
  });
});

// ── AC-7: Real scenario files round-trip without changes ─────────────────────

describe("AC-7: Real scenario round-trip", () => {
  // web/src/__tests__ → web/src → web → worktree root
  const WORKTREE_ROOT = path.join(import.meta.dir, "../../..");
  const teamScenario01 = path.join(WORKTREE_ROOT, "evals/team/scenario-01-automapper-removal.md");

  test("scenario-01-automapper-removal.md round-trips all phase headers unchanged", () => {
    if (!fs.existsSync(teamScenario01)) {
      console.log("  SKIP: evals/team/scenario-01-automapper-removal.md not found");
      return;
    }

    const original = fs.readFileSync(teamScenario01, "utf-8");
    const parsed = parseTeamScenario(original);
    const serialized = serializeTeamScenario(parsed);
    const reparsed = parseTeamScenario(serialized);

    // All sectionHeaders from parsed must match reparsed
    for (let i = 0; i < parsed.phases.length; i++) {
      expect(reparsed.phases[i].sectionHeader).toBe(parsed.phases[i].sectionHeader);
    }
  });

  test("scenario-01 phase 1 sectionHeader captured correctly", () => {
    if (!fs.existsSync(teamScenario01)) {
      console.log("  SKIP: evals/team/scenario-01-automapper-removal.md not found");
      return;
    }

    const content = fs.readFileSync(teamScenario01, "utf-8");
    const { phases } = parseTeamScenario(content);
    // The heading in the file is: ## Phase 1: Parallel Analysis — Bird + MJ + Kobe
    expect(phases[0].sectionHeader).toBe("Phase 1: Parallel Analysis — Bird + MJ + Kobe");
  });

  test("scenario-01 serialized output contains all original ## Phase headings", () => {
    if (!fs.existsSync(teamScenario01)) {
      console.log("  SKIP: evals/team/scenario-01-automapper-removal.md not found");
      return;
    }

    const original = fs.readFileSync(teamScenario01, "utf-8");
    const parsed = parseTeamScenario(original);
    const serialized = serializeTeamScenario(parsed);

    // All phase headings from the original must appear in serialized output
    const originalHeadings = [...original.matchAll(/^## (Phase \d+.*)$/gm)].map(m => m[1].trim());
    for (const heading of originalHeadings) {
      expect(serialized).toContain(`## ${heading}`);
    }
  });
});
