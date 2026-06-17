import { test, expect } from "bun:test";
import { localDateTime, formatDate } from "../views/html.ts";

test("formatDate renders the stored UTC value", () => {
  expect(formatDate("2026-06-17T07:22:46Z")).toBe("2026-06-17 07:22 UTC");
});

test("localDateTime emits a <time.local-dt> carrying the UTC ISO + UTC fallback", () => {
  const html = localDateTime("2026-06-17T07:22:46Z");
  expect(html).toContain('class="local-dt"');
  expect(html).toContain('datetime="2026-06-17T07:22:46Z"'); // truth = UTC ISO, for client conversion
  expect(html).toContain(">2026-06-17 07:22 UTC<");           // no-JS fallback text
  expect(html).toContain('title="2026-06-17 07:22 UTC"');
});

test("localDateTime escapes the timestamp attribute", () => {
  const html = localDateTime('2026"><script>x');
  expect(html).not.toContain("<script>x");
});
