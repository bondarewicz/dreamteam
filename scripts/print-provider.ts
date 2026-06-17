#!/usr/bin/env bun
/**
 * print-provider.ts — print the provider an agent resolves to (the routing
 * authority Coach K consults before each spawn in hybrid /team). Prints one of:
 * claude | ollama | gemini | codex. Reads the agent's `model.provider` spec via
 * the SAME resolveEffectiveModel the eval path uses (no parallel routing table).
 *
 *   bun scripts/print-provider.ts <agent>   →  claude   (run native)
 *                                           →  ollama   (delegate via team-dispatch.ts)
 */
import { resolveEffectiveModel } from "../evals/src/agent-runner.ts";
import { parseProvider } from "../evals/src/provider-backends.ts";

const agent = process.argv[2];
if (!agent) {
  console.error("usage: bun scripts/print-provider.ts <agent>");
  process.exit(2);
}
console.log(parseProvider(resolveEffectiveModel(agent)).provider);
