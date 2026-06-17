import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { assembleFinalResult } from "../assembler.ts";

function emptyScored(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asm-model-"));
  fs.mkdirSync(path.join(tmp, "scored"));
  return tmp;
}

test("meta.model records the exact --model when given", () => {
  const tmp = emptyScored();
  const r = assembleFinalResult(path.join(tmp, "scored"), "2026-01-01-0000", 0, 0, 1, ".", "ollama/qwen3.6");
  expect(r.meta.model).toBe("ollama/qwen3.6");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("meta.model records '<provider> (tier)' for a --provider run", () => {
  const tmp = emptyScored();
  const r = assembleFinalResult(path.join(tmp, "scored"), "2026-01-01-0000", 0, 0, 1, ".", undefined, "gemini");
  expect(r.meta.model).toBe("gemini (tier)");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("meta.model defaults to 'claude (tier)' for a plain run (never undefined)", () => {
  const tmp = emptyScored();
  const r = assembleFinalResult(path.join(tmp, "scored"), "2026-01-01-0000", 0, 0, 1, ".");
  expect(r.meta.model).toBe("claude (tier)");
  fs.rmSync(tmp, { recursive: true, force: true });
});
