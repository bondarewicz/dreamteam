import { test, expect } from "bun:test";
import { scanText, isBad } from "../../../scripts/check-unicode-safety.ts";

test("flags tag-block, zero-width, and bidi codepoints", () => {
  expect(isBad(0xe0041)).toBe(true);  // tag-block (smuggled 'A')
  expect(isBad(0x200b)).toBe(true);    // ZWSP
  expect(isBad(0xfeff)).toBe(true);    // BOM / word-joiner
  expect(isBad(0x00ad)).toBe(true);    // soft hyphen
  expect(isBad(0x202e)).toBe(true);    // RLO (bidi override)
  expect(isBad(0x2066)).toBe(true);    // LRI
});

test("does NOT flag legitimate printable typography (zero false positives)", () => {
  for (const ch of "— – “” ‘’ → ▶ · … é ł ż ó ñ 你好") {
    expect(isBad(ch.codePointAt(0)!)).toBe(false);
  }
});

test("scanText reports line + codepoint for smuggled content", () => {
  const text = "line one\nhello​world‮ end\nline three";
  const hits = scanText(text);
  expect(hits.length).toBe(2);
  expect(hits[0].line).toBe(2);
  expect(hits[0].cp).toBe(0x200b);
  expect(hits[1].cp).toBe(0x202e);
});

test("clean text yields no findings", () => {
  expect(scanText("plain ASCII — with em dash and an arrow → done").length).toBe(0);
});
