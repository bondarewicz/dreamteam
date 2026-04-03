import { test, expect, describe } from "bun:test";
import path from "path";
import { discoverScenarios } from "../discovery.ts";

const EVALS_DIR = path.join(import.meta.dir, "../../");

describe("discoverScenarios", () => {
  test("discovers scenarios from real evals directory", () => {
    const { scenarios, allScenariosTotal } = discoverScenarios(EVALS_DIR, "", "");
    expect(scenarios.length).toBeGreaterThan(0);
    expect(allScenariosTotal).toBeGreaterThan(0);
    expect(allScenariosTotal).toBeGreaterThanOrEqual(scenarios.length);
  });

  test("each scenario has agent, scenarioId, and scenarioFile", () => {
    const { scenarios } = discoverScenarios(EVALS_DIR, "", "");
    for (const s of scenarios.slice(0, 5)) {
      expect(s.agent).toBeTruthy();
      expect(s.scenarioId).toMatch(/^scenario-/);
      expect(s.scenarioFile).toMatch(/\.md$/);
    }
  });

  test("excludes 'results' directory", () => {
    const { scenarios } = discoverScenarios(EVALS_DIR, "", "");
    const hasResults = scenarios.some((s) => s.agent === "results");
    expect(hasResults).toBe(false);
  });

  test("agent filter works (single agent)", () => {
    const { scenarios: all } = discoverScenarios(EVALS_DIR, "", "");
    if (all.length === 0) return;

    const firstAgent = all[0].agent;
    const { scenarios: filtered } = discoverScenarios(EVALS_DIR, firstAgent, "");
    expect(filtered.every((s) => s.agent === firstAgent)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  test("agent filter with comma-separated names", () => {
    const { scenarios: all } = discoverScenarios(EVALS_DIR, "", "");
    if (all.length < 2) return;

    const agents = [...new Set(all.map((s) => s.agent))];
    if (agents.length < 2) return;

    const twoAgents = `${agents[0]},${agents[1]}`;
    const { scenarios: filtered } = discoverScenarios(EVALS_DIR, twoAgents, "");
    const filteredAgents = new Set(filtered.map((s) => s.agent));
    expect(filteredAgents.has(agents[0])).toBe(true);
    expect(filteredAgents.has(agents[1])).toBe(true);
    // No other agents
    for (const a of filteredAgents) {
      expect([agents[0], agents[1]]).toContain(a);
    }
  });

  test("scenario filter with fnmatch pattern", () => {
    const { scenarios } = discoverScenarios(EVALS_DIR, "", "scenario-01*");
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.scenarioId.startsWith("scenario-01"))).toBe(true);
  });

  test("scenario filter with qualified agent/scenario-id", () => {
    const { scenarios: all } = discoverScenarios(EVALS_DIR, "", "");
    if (all.length === 0) return;

    const first = all[0];
    const qualified = `${first.agent}/${first.scenarioId}`;
    const { scenarios: filtered } = discoverScenarios(EVALS_DIR, "", qualified);
    expect(filtered.length).toBe(1);
    expect(filtered[0].agent).toBe(first.agent);
    expect(filtered[0].scenarioId).toBe(first.scenarioId);
  });

  test("allScenariosTotal counts all scenarios regardless of filters", () => {
    const { allScenariosTotal: total } = discoverScenarios(EVALS_DIR, "", "");
    const { allScenariosTotal: withFilter } = discoverScenarios(EVALS_DIR, "shaq", "");
    expect(withFilter).toBe(total); // allScenariosTotal ignores agent filter
  });

  test("returns empty results for nonexistent agent filter", () => {
    const { scenarios } = discoverScenarios(EVALS_DIR, "nonexistent_agent_xyz", "");
    expect(scenarios.length).toBe(0);
  });

  test("returns empty for nonexistent evals dir", () => {
    const { scenarios, allScenariosTotal } = discoverScenarios("/nonexistent/path", "", "");
    expect(scenarios.length).toBe(0);
    expect(allScenariosTotal).toBe(0);
  });
});
