import { test, expect, describe } from "bun:test";
import path from "path";
import fs from "fs";
import {
  extractField,
  extractPrompt,
  parseScenarioMeta,
  extractGraders,
  parseTeamScenario,
} from "../scenario-parser.ts";

const EVALS_DIR = path.join(import.meta.dir, "../../");

// ── extractField ──────────────────────────────────────────────────────────────

describe("extractField", () => {
  test("extracts a simple field", () => {
    const content = `title: test\n\nexpected_behavior:\n  The agent should do X.\n  And Y.\n\nfailure_modes:\n  Should not do Z.\n`;
    const result = extractField("expected_behavior", content);
    expect(result).toContain("The agent should do X.");
  });

  test("returns empty string for missing field", () => {
    const result = extractField("nonexistent_field", "some content");
    expect(result).toBe("");
  });

  test("stops at next top-level field", () => {
    const content = `field_a:\n  value a\n\nfield_b:\n  value b\n`;
    const result = extractField("field_a", content);
    expect(result).toContain("value a");
    expect(result).not.toContain("value b");
  });
});

// ── extractPrompt ─────────────────────────────────────────────────────────────

describe("extractPrompt", () => {
  test("extracts prompt stopping at expected_behavior", () => {
    const content = `# Eval\n\nprompt: |\n  Do the thing.\n\nexpected_behavior:\n  It does the thing.\n`;
    const result = extractPrompt(content);
    expect(result).toContain("Do the thing.");
    expect(result).not.toContain("It does the thing.");
  });

  test("returns empty string if no prompt", () => {
    const result = extractPrompt("# No prompt here\n\nexpected_behavior:\n  Something.\n");
    expect(result).toBe("");
  });
});

// ── parseScenarioMeta ─────────────────────────────────────────────────────────

describe("parseScenarioMeta", () => {
  test("parses happy-path scenario (no type in title)", () => {
    const content = `# Eval: Shaq — Implement Widget\n\ncategory: regression\n`;
    const { scenarioName, scenarioType, category } = parseScenarioMeta(content);
    expect(scenarioName).toBe("Implement Widget");
    expect(scenarioType).toBe("happy-path");
    expect(category).toBe("regression");
  });

  test("parses edge case scenario", () => {
    const content = `# Eval: Shaq — Boundary Check (Edge Case)\n`;
    const { scenarioType } = parseScenarioMeta(content);
    expect(scenarioType).toBe("edge-case");
  });

  test("parses adversarial scenario", () => {
    const content = `# Eval: Bird — Adversarial Input (Adversarial)\n`;
    const { scenarioType } = parseScenarioMeta(content);
    expect(scenarioType).toBe("adversarial");
  });

  test("parses attack scenario", () => {
    const content = `# Eval: Shaq — Prompt Injection (Attack)\n`;
    const { scenarioType } = parseScenarioMeta(content);
    expect(scenarioType).toBe("adversarial");
  });

  test("parses regression scenario", () => {
    const content = `# Eval: MJ — Fix Bug (Regression)\n`;
    const { scenarioType } = parseScenarioMeta(content);
    expect(scenarioType).toBe("regression");
  });

  test("returns empty strings for no match", () => {
    const { scenarioName, category } = parseScenarioMeta("# Not a standard title\n");
    expect(scenarioName).toBe("");
    expect(category).toBe("");
  });
});

// ── extractGraders ────────────────────────────────────────────────────────────

describe("extractGraders", () => {
  test("returns null when no graders field", () => {
    const result = extractGraders("prompt:\n  hello\n\nexpected_behavior:\n  world\n");
    expect(result).toBeNull();
  });

  test("parses a single json_valid grader", () => {
    const content = `graders:\n  - type: json_valid\n\nprompt:\n  do it\n`;
    const result = extractGraders(content);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].type).toBe("json_valid");
  });

  test("parses multiple graders", () => {
    const content = `graders:\n  - type: json_valid\n  - type: contains\n    values: ["hello"]\n    case_sensitive: false\n\nprompt:\n  hi\n`;
    const result = extractGraders(content);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].type).toBe("json_valid");
    expect(result![1].type).toBe("contains");
    expect(result![1].values).toEqual(["hello"]);
    expect(result![1].case_sensitive).toBe(false);
  });

  test("ignores indented graders: inside prompt block", () => {
    const content = `prompt: |\n  Here is some text:\n  graders:\n    - type: json_valid\n\ngraders:\n  - type: regex\n    pattern: "hello"\n\nnext_field: value\n`;
    const result = extractGraders(content);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].type).toBe("regex");
  });

  test("parses numeric values", () => {
    const content = `graders:\n  - type: json_field\n    path: confidence.level\n    min: 85\n    max: 100\n\nprompt:\n  x\n`;
    const result = extractGraders(content);
    expect(result!.length).toBe(1);
    expect(result![0].min).toBe(85);
    expect(result![0].max).toBe(100);
  });

  test("parses boolean values", () => {
    const content = `graders:\n  - type: contains\n    values: ["test"]\n    case_sensitive: false\n\nprompt:\n  x\n`;
    const result = extractGraders(content);
    expect(result![0].case_sensitive).toBe(false);
  });

  test("parses regex pattern with escaped backslashes", () => {
    const content = `graders:\n  - type: regex\n    pattern: "\\\\s+"\n\nprompt:\n  x\n`;
    const result = extractGraders(content);
    expect(result![0].pattern).toBe("\\s+");
  });
});

// ── Real scenario files ───────────────────────────────────────────────────────

describe("Real scenario files", () => {
  const shaqScenario = path.join(EVALS_DIR, "shaq/scenario-01-spec-faithful-implementation.md");

  test("parses shaq scenario-01 if it exists", () => {
    if (!fs.existsSync(shaqScenario)) {
      console.log("  SKIP: shaq/scenario-01 not found");
      return;
    }
    const content = fs.readFileSync(shaqScenario, "utf-8");
    const prompt = extractPrompt(content);
    expect(prompt.length).toBeGreaterThan(10);

    const { scenarioName, scenarioType } = parseScenarioMeta(content);
    expect(scenarioName).toContain("Spec");
    expect(scenarioType).toBeDefined();
  });

  test("parses graders from shaq scenario-01", () => {
    if (!fs.existsSync(shaqScenario)) return;
    const content = fs.readFileSync(shaqScenario, "utf-8");
    const graders = extractGraders(content);
    expect(graders).not.toBeNull();
    expect(graders!.length).toBeGreaterThan(0);
    // Should have json_valid and json_field graders
    const types = graders!.map((g) => g.type);
    expect(types).toContain("json_valid");
  });

  test("parses all shaq scenarios without throwing", () => {
    const shaqDir = path.join(EVALS_DIR, "shaq");
    if (!fs.existsSync(shaqDir)) return;

    const files = fs.readdirSync(shaqDir).filter((f) => f.startsWith("scenario-") && f.endsWith(".md"));
    for (const fname of files) {
      const content = fs.readFileSync(path.join(shaqDir, fname), "utf-8");
      expect(() => extractPrompt(content)).not.toThrow();
      expect(() => parseScenarioMeta(content)).not.toThrow();
      expect(() => extractGraders(content)).not.toThrow();
    }
  });
});

// ── parseTeamScenario ─────────────────────────────────────────────────────────

describe("parseTeamScenario", () => {
  const teamContent = `# Team Scenario

phase_1_agent: shaq
phase_1_prompt: |
  Do step one.

phase_2_agent: human
phase_2_prompt: |
  Approve this.

phase_3_agent: bird
phase_3_prompt: |
  Verify the output.

pipeline_expected_behavior:
  The pipeline completes successfully.

pipeline_failure_modes:
  Missing steps.

pipeline_scoring_rubric:
  Full marks if all phases complete.
`;

  test("parses 3 phases", () => {
    const { phases } = parseTeamScenario(teamContent);
    expect(phases.length).toBe(3);
  });

  test("parses agents correctly", () => {
    const { phases } = parseTeamScenario(teamContent);
    expect(phases[0].agent).toBe("shaq");
    expect(phases[1].agent).toBe("human");
    expect(phases[2].agent).toBe("bird");
  });

  test("sets humanDecision for human phase", () => {
    const { phases } = parseTeamScenario(teamContent);
    expect(phases[1].humanDecision).toContain("Approve this.");
    expect(phases[0].humanDecision).toBe("");
    expect(phases[2].humanDecision).toBe("");
  });

  test("parses pipeline fields", () => {
    const { pipelineFields } = parseTeamScenario(teamContent);
    expect(pipelineFields.pipelineExpectedBehavior).toContain("completes successfully");
    expect(pipelineFields.pipelineFailureModes).toContain("Missing steps");
    expect(pipelineFields.pipelineScoringRubric).toContain("Full marks");
  });
});
