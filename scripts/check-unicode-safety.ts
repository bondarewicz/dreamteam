#!/usr/bin/env bun
/**
 * check-unicode-safety.ts — reject invisible/smuggled Unicode in LLM-context assets.
 *
 * Dream Team's value is .md text that flows into agent + judge context, and the
 * Coach K judge reads untrusted session transcripts. A malicious PR (or a poisoned
 * copy-paste) can hide instructions in characters that render invisibly — Tag-block
 * codepoints (the classic "ASCII smuggling"), zero-width joiners, BOM/word-joiner,
 * soft hyphen, and bidi-override controls that reorder visible text. None of these
 * have a legitimate place in our prose assets, so flagging them is near-zero
 * false-positive (printable typography — em dash, smart quotes, →, ·, accented
 * names — is untouched).
 *
 *   bun scripts/check-unicode-safety.ts          # scan, exit 1 on any finding (CI gate)
 *   bun scripts/check-unicode-safety.ts --write  # strip offending codepoints in place
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCAN_DIRS = ["agents", "commands", "evals"];
const SCAN_EXT = new Set([".md"]);
// Judge prompt text lives in code — include the two files that build it.
const EXTRA_FILES = ["evals/src/scorer.ts", "web/src/session-judge.ts"];
const write = process.argv.includes("--write");

type Rule = { name: string; bad: (cp: number) => boolean };
export const RULES: Rule[] = [
  { name: "tag-block (ASCII smuggling, U+E0000–E007F)", bad: (c) => c >= 0xe0000 && c <= 0xe007f },
  { name: "invisible/zero-width", bad: (c) => c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff || c === 0x00ad },
  { name: "bidi control/override", bad: (c) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f },
];
export const isBad = (c: number) => RULES.some((r) => r.bad(c));
/** Codepoints flagged in `text`, with 1-based line numbers. */
export function scanText(text: string): Array<{ line: number; cp: number; rule: string }> {
  const out: Array<{ line: number; cp: number; rule: string }> = [];
  text.split("\n").forEach((ln, i) => {
    for (const ch of ln) {
      const cp = ch.codePointAt(0)!;
      if (isBad(cp)) out.push({ line: i + 1, cp, rule: RULES.find((r) => r.bad(cp))!.name });
    }
  });
  return out;
}

function listFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".archive" || e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (SCAN_EXT.has(path.extname(e.name))) out.push(p);
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  for (const f of EXTRA_FILES) { const p = path.join(ROOT, f); if (fs.existsSync(p)) out.push(p); }
  return out;
}

if (import.meta.main) {
  let findings = 0, filesHit = 0, fixed = 0;
  const files = listFiles();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf-8");
    const hits = scanText(text);
    if (!hits.length) continue;
    filesHit++; findings += hits.length;
    for (const h of hits) console.log(`  ${path.relative(ROOT, file)}:${h.line}  U+${h.cp.toString(16).toUpperCase().padStart(4, "0")}  ${h.rule}`);
    if (write) {
      fs.writeFileSync(file, [...text].filter((ch) => !isBad(ch.codePointAt(0)!)).join(""));
      fixed += hits.length;
    }
  }
  if (!findings) { console.log(`unicode-safety: clean (${files.length} files scanned).`); process.exit(0); }
  if (write) { console.log(`\nunicode-safety: stripped ${fixed} offending codepoint(s) across ${filesHit} file(s).`); process.exit(0); }
  console.error(`\nunicode-safety: ${findings} finding(s) in ${filesHit} file(s). Run with --write to strip, or remove them.`);
  process.exit(1);
}
