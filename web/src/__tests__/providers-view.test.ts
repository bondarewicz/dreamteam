import { test, expect } from "bun:test";
import { ProvidersPage, PingResultFragment } from "../views/Providers.ts";
import type { ProviderCheck } from "../../../scripts/doctor.ts";
import type { PingResult } from "../../../scripts/provider-ping.ts";

const claude: ProviderCheck = {
  id: "claude", label: "Claude Code (claude)", ok: true,
  detail: "2.1.0", role: "interactive /team + the eval judge", required: true,
};
const ollamaDown: ProviderCheck = {
  id: "ollama", label: "Ollama (localhost:11434)", ok: false,
  detail: "start: `ollama serve`", role: "cross-provider evals on local models", required: false,
};

test("renders one row per provider check", () => {
  const html = ProvidersPage([claude, ollamaDown], { present: true, count: 32 });
  // 2 data rows + 2 CSS selectors (.prov-row, .prov-row:last-child)
  expect((html.match(/prov-row/g) ?? []).length).toBe(4);
  expect(html).toContain("Claude Code (claude)");
  expect(html).toContain("Ollama (localhost:11434)");
});

test("required provider OK → green summary; missing → red summary", () => {
  const ok = ProvidersPage([claude], { present: true, count: 1 });
  expect(ok).toContain("Claude Code present");

  const missing = ProvidersPage([{ ...claude, ok: false }], { present: false, count: 0 });
  expect(missing).toContain("Claude Code missing");
  expect(missing).toContain("dreamteam install"); // no-manifest hint
});

test("required vs optional badges reflect the check", () => {
  const html = ProvidersPage([claude, ollamaDown], { present: true, count: 1 });
  expect(html).toContain("required");
  expect(html).toContain("optional");
});

test("manifest present shows file count", () => {
  const html = ProvidersPage([claude], { present: true, count: 32 });
  expect(html).toContain("32 files");
});

test("rows expose a Test live button + ping target per provider", () => {
  const html = ProvidersPage([claude, ollamaDown], { present: true, count: 1 });
  expect((html.match(/hx-post="\/admin\/providers\/test"/g) ?? []).length).toBe(2);
  expect(html).toContain('id="ping-claude"');
  expect(html).toContain('id="ping-ollama"');
  expect(html).toContain('hx-post="/admin/providers/test"');
  expect(html).toContain(`hx-vals='{"provider":"claude"}'`);
});

test("PingResultFragment: success shows reply + latency + cost", () => {
  const r: PingResult = { provider: "claude", ok: true, model: "haiku", latencyMs: 3064, response: "READY", tokens: 63, costUsd: 0.0001 };
  const html = PingResultFragment(r);
  expect(html).toContain("live ✓");
  expect(html).toContain("3064 ms");
  expect(html).toContain("haiku");
  expect(html).toContain("READY");
  expect(html).toContain("$0.0001");
});

test("PingResultFragment: failure shows the error, not a reply", () => {
  const r: PingResult = { provider: "ollama", ok: false, model: "", latencyMs: 12, response: "", error: "not reachable on :11434" };
  const html = PingResultFragment(r);
  expect(html).toContain("live ✗");
  expect(html).toContain("not reachable on :11434");
  expect(html).not.toContain("ping-resp");
});

test("PingResultFragment escapes response text", () => {
  const r: PingResult = { provider: "ollama", ok: true, model: "m", latencyMs: 1, response: "<script>x</script>" };
  const html = PingResultFragment(r);
  expect(html).not.toContain("<script>x");
  expect(html).toContain("&lt;script&gt;");
});
