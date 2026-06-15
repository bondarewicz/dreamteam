import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
// projectsDir() reads CLAUDE_PROJECTS_DIR at call time, so a static import is
// fine — the env var only needs to be set before the test bodies run.
import { listProjects, listSessions, loadSession } from "../sessions-source.ts";

// Point sessions-source at a hermetic fixture instead of the real
// ~/.claude/projects (which doesn't exist in CI and varies per machine).
let tmpRoot: string;

function writeSession(projectDir: string, id: string, records: unknown[]) {
  const dir = path.join(tmpRoot, projectDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), records.map(r => JSON.stringify(r)).join("\n"));
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-src-"));
  process.env.CLAUDE_PROJECTS_DIR = tmpRoot;

  // Project A — two human sessions (newest has the later end timestamp).
  writeSession("-tmp-projA", "sess-old", [
    { type: "user", timestamp: "2026-01-01T00:00:00Z", gitBranch: "main", message: { role: "user", content: "please add a function" } },
    { type: "assistant", timestamp: "2026-01-01T00:01:00Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", name: "Edit", id: "t1", input: { file_path: "/tmp/x.ts", old_string: "a", new_string: "a\nb\nc" } }] } },
  ]);
  writeSession("-tmp-projA", "sess-new", [
    { type: "user", timestamp: "2026-02-01T00:00:00Z", gitBranch: "main", message: { role: "user", content: "another human prompt" } },
    { type: "assistant", timestamp: "2026-02-01T00:02:00Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "done" }] } },
  ]);
  // A headless session (no human-typed prompt) — excluded from listSessions by default.
  writeSession("-tmp-projA", "sess-headless", [
    { type: "user", timestamp: "2026-01-03T00:00:00Z", isSidechain: true, message: { role: "user", content: "sidechain only" } },
    { type: "assistant", timestamp: "2026-01-03T00:00:30Z", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "auto" }] } },
  ]);

  // Excluded project — must never appear in listProjects/listSessions.
  writeSession("-Users-lb-Github-Bondarewicz-dreamteam-evals", "sess-eval", [
    { type: "user", timestamp: "2026-03-01T00:00:00Z", message: { role: "user", content: "eval run" } },
  ]);
});

afterAll(() => {
  delete process.env.CLAUDE_PROJECTS_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("listProjects excludes dreamteam-evals and returns counts", () => {
  const projects = listProjects();
  expect(projects.length).toBeGreaterThan(0);
  expect(projects.every(p => p.dir !== "-Users-lb-Github-Bondarewicz-dreamteam-evals")).toBe(true);
  expect(projects.every(p => p.sessions > 0)).toBe(true);
});

test("listSessions returns newest-first summaries with sane fields", () => {
  const sessions = listSessions({ limit: 50 });
  expect(sessions.length).toBeGreaterThan(0);
  // headless excluded by default → only the two human sessions of projA
  expect(sessions.length).toBe(2);
  // newest-first
  for (let i = 1; i < sessions.length; i++) {
    expect(new Date(sessions[i - 1].end).getTime()).toBeGreaterThanOrEqual(new Date(sessions[i].end).getTime());
  }
  expect(sessions[0].id).toBe("sess-new");
  for (const s of sessions) {
    expect(s.id).toBeTruthy();
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.linesAdded).toBeGreaterThanOrEqual(0);
    expect(s.linesRemoved).toBeGreaterThanOrEqual(0);
    expect(s.headless).toBe(false); // headless excluded by default
  }
});

test("loadSession returns full records + per-file changes", () => {
  const detail = loadSession("-tmp-projA", "sess-old");
  expect(detail).not.toBeNull();
  expect(detail!.records_raw.length).toBe(detail!.records);
  expect(detail!.filesChanged).toBe(detail!.files.length);
  const sumAdded = detail!.files.reduce((a, f) => a + f.added, 0);
  expect(sumAdded).toBe(detail!.linesAdded);
  // Edit added "a\nb\nc" (3 lines), removed "a" (1 line).
  expect(detail!.linesAdded).toBe(3);
  expect(detail!.linesRemoved).toBe(1);
});
