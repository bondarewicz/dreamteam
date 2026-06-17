#!/usr/bin/env bun
/**
 * install.ts — legacy installer shim.
 *
 * The install flow now lives in adapters/provision.ts and is driven by the
 * `dreamteam` CLI (bin/dreamteam.ts). This shim keeps `bun scripts/install.ts`
 * working — and always in sync — for one deprecation cycle. It is equivalent to
 * `dreamteam install` (claude-code harness).
 */

import { provision } from "../adapters/provision.ts";

console.log("=== Dream Team Installer (alias for `dreamteam install`) ===");
const res = await provision({ harnesses: "claude-code" });
console.log(`\nInstallation complete — ${res.installed.length} files installed.`);
console.log("Start a new Claude Code session to use the agents.");
