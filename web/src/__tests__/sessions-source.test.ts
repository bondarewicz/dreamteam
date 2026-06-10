import { test, expect } from "bun:test";
import { listProjects, listSessions, loadSession } from "../sessions-source.ts";

test("listProjects excludes dreamteam-evals and returns counts", () => {
  const projects = listProjects();
  expect(projects.length).toBeGreaterThan(0);
  expect(projects.every(p => p.dir !== "-Users-lb-Github-Bondarewicz-dreamteam-evals")).toBe(true);
  expect(projects.every(p => p.sessions > 0)).toBe(true);
});

test("listSessions returns newest-first summaries with sane fields", () => {
  const sessions = listSessions({ limit: 50 });
  expect(sessions.length).toBeGreaterThan(0);
  // newest-first
  for (let i = 1; i < sessions.length; i++) {
    expect(new Date(sessions[i - 1].end).getTime()).toBeGreaterThanOrEqual(new Date(sessions[i].end).getTime());
  }
  for (const s of sessions) {
    expect(s.id).toBeTruthy();
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.linesAdded).toBeGreaterThanOrEqual(0);
    expect(s.linesRemoved).toBeGreaterThanOrEqual(0);
    expect(s.headless).toBe(false); // headless excluded by default
  }
});

test("loadSession returns full records + per-file changes", () => {
  const first = listSessions({ limit: 1 })[0];
  const detail = loadSession(first.project, first.id);
  expect(detail).not.toBeNull();
  expect(detail!.records_raw.length).toBe(first.records);
  expect(detail!.filesChanged).toBe(detail!.files.length);
  const sumAdded = detail!.files.reduce((a, f) => a + f.added, 0);
  expect(sumAdded).toBe(detail!.linesAdded);
});
