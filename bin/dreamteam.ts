#!/usr/bin/env bun
/**
 * dreamteam — Dream Team CLI (Phase 1 of distribution).
 *
 *   dreamteam install   [--harness claude-code|all] [--dry-run]
 *   dreamteam uninstall
 *   dreamteam status                 what's installed, versions, drift
 *   dreamteam doctor                 are Claude / Ollama / Gemini reachable?
 *   dreamteam list                   roster + commands
 *   dreamteam eval [...]             thin passthrough to evals/src/cli.ts
 */

import path from "path";
import fs from "fs";
import { assetsDir, readConfig, contentSha, dataDir } from "../scripts/paths.ts";
import { provision, unprovision, knownHarnesses } from "../adapters/provision.ts";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(name);
}

async function cmdInstall(args: string[]): Promise<number> {
  const harnesses = flag(args, "--harness") ?? "claude-code";
  const dryRun = has(args, "--dry-run");
  const res = await provision({ harnesses, dryRun });
  console.log(`\n${dryRun ? "Dry run complete" : "Installation complete"} — harnesses: ${res.harnesses.join(", ")}, ${res.installed.length} files.`);
  if (!dryRun) console.log("Start a new Claude Code session to use the agents.");
  return 0;
}

async function cmdUninstall(): Promise<number> {
  const res = await unprovision();
  console.log(`\nUninstalled ${res.removed} files across: ${res.harnesses.join(", ")}.`);
  return 0;
}

function cmdStatus(): number {
  const cfg = readConfig();
  if (!cfg) {
    console.log("Not installed (no ~/.dreamteam/config.json). Run: dreamteam install");
    return 1;
  }
  console.log(`Dream Team ${cfg.version}`);
  console.log(`  assetsDir : ${cfg.assetsDir}`);
  console.log(`  dataDir   : ${cfg.dataDir}`);
  console.log(`  harnesses : ${cfg.harnesses.join(", ")}`);
  console.log(`  installed : ${cfg.installed.length} files (${cfg.installedAt})`);

  // Drift: installed file edited since install (current content sha != manifest sha).
  let drift = 0, missing = 0;
  for (const f of cfg.installed) {
    try {
      const cur = contentSha(fs.readFileSync(f.path, "utf-8"));
      if (cur !== f.sha) { drift++; console.log(`  ~ drift: ${f.path}`); }
    } catch {
      missing++; console.log(`  ! missing: ${f.path}`);
    }
  }
  console.log(drift || missing ? `  ${drift} drifted, ${missing} missing.` : "  all installed files match manifest.");
  return 0;
}

async function bin(name: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  try {
    const proc = Bun.spawn([name, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { ok: code === 0, detail: out.trim().split("\n")[0] ?? "" };
  } catch {
    return { ok: false, detail: "not on PATH" };
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function cmdDoctor(): Promise<number> {
  console.log("Dream Team doctor — provider reachability\n");
  const rows: Array<[string, boolean, string]> = [];

  const claude = await bin("claude", ["--version"]);
  rows.push(["Claude Code (claude)", claude.ok, claude.ok ? claude.detail : "install: https://claude.ai/code"]);

  const ollamaUp = await reachable("http://localhost:11434/api/tags");
  rows.push(["Ollama (:11434)", ollamaUp, ollamaUp ? "serving" : "start: `ollama serve`"]);

  const gemini = await bin("gemini", ["--version"]);
  const geminiAuth = !!process.env.GEMINI_API_KEY || fs.existsSync(path.join(process.env.HOME ?? "~", ".gemini"));
  rows.push(["Gemini CLI (gemini)", gemini.ok && geminiAuth, gemini.ok ? (geminiAuth ? gemini.detail : "installed, but no GEMINI_API_KEY / ~/.gemini auth") : "not on PATH"]);

  const codex = await bin("codex", ["--version"]);
  const codexAuth = fs.existsSync(path.join(process.env.HOME ?? "~", ".codex")) || !!process.env.OPENAI_API_KEY || !!process.env.CODEX_API_KEY;
  rows.push(["Codex CLI (codex)", codex.ok && codexAuth, codex.ok ? (codexAuth ? codex.detail : "installed, but not logged in (`codex login`) / no API key") : "not on PATH"]);

  let allOk = true;
  for (const [label, ok, detail] of rows) {
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(24)} ${detail}`);
    if (!ok) allOk = false;
  }
  const cfg = readConfig();
  console.log(`\n  install manifest: ${cfg ? `present (${cfg.installed.length} files)` : "missing — run dreamteam install"}`);
  console.log(allOk ? "\nAll providers reachable." : "\nSome providers unavailable (only those you intend to use need to pass).");
  return allOk ? 0 : 0; // non-fatal: not everyone uses all three
}

function cmdList(): number {
  const assets = assetsDir();
  for (const [dir, label] of [["agents", "Agents"], ["commands", "Commands"]] as const) {
    const p = path.join(assets, dir);
    if (!fs.existsSync(p)) continue;
    const names = fs.readdirSync(p).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
    console.log(`${label} (${names.length}):`);
    for (const n of names) console.log(`  ${dir === "commands" ? "/" : ""}${n}`);
    console.log("");
  }
  return 0;
}

async function cmdEval(args: string[]): Promise<number> {
  const cli = path.join(assetsDir(), "evals", "src", "cli.ts");
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return (await proc.exited) ?? 0;
}

async function cmdWeb(args: string[]): Promise<number> {
  const port = flag(args, "--port") ?? process.env.PORT ?? "3000";
  const entry = path.join(assetsDir(), "web", "index.ts");
  if (!fs.existsSync(entry)) {
    console.error(`Web app not found at ${entry}. (Is web/ part of this install?)`);
    return 1;
  }
  console.log(`Starting Dream Team web → http://localhost:${port}  (reads ${dataDir()}/workspace)`);
  const proc = Bun.spawn(["bun", entry], {
    env: { ...process.env, PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return (await proc.exited) ?? 0;
}

function usage(): void {
  console.log(`dreamteam — Dream Team CLI

  install [--harness ${knownHarnesses().join("|")}|all] [--dry-run]
  uninstall
  status            installed files, versions, drift vs manifest
  doctor            Claude / Ollama / Gemini reachability
  list              roster + commands
  eval [...]        passthrough to evals/src/cli.ts
  web [--port N]    serve the web app (eval report, /admin/models, sessions)
`);
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 0;
switch (cmd) {
  case "install": code = await cmdInstall(rest); break;
  case "uninstall": code = await cmdUninstall(); break;
  case "status": code = cmdStatus(); break;
  case "doctor": code = await cmdDoctor(); break;
  case "list": code = cmdList(); break;
  case "eval": code = await cmdEval(rest); break;
  case "web": code = await cmdWeb(rest); break;
  case undefined:
  case "help":
  case "--help":
  case "-h": usage(); break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    usage();
    code = 1;
}
process.exit(code);
