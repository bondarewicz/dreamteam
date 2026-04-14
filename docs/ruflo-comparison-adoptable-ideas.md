# ruflo comparison & adoptable ideas

Date: 2026-04-13
Status: backlog — review before implementing
Source: side-by-side of `ruvnet/ruflo` (cloned at `../ruflo`) vs dreamteam

## TL;DR

Ruflo is a 6k-commit enterprise orchestration platform (76 plugin agents, 168 commands, 41 skills, custom runtime, MCP server, AgentDB/HNSW, 9 RL algorithms, Raft/BFT consensus). dreamteam is a thin Claude Code harness (7 agents, 10 commands, 3 TS scripts, no runtime). Most of ruflo is overkill for 6 agents. Five pieces are worth stealing.

## Scale comparison

| | **dreamteam** | **ruflo** |
|---|---|---|
| Agents | 7 `.md` | 76 plugin agents + 5 v3 yaml stubs |
| Commands | 10 `.md` | 168 across 18 categories |
| Skills | uses Claude Code skills | 41 bundled (agentdb, sparc, swarm, etc.) |
| Runtime | 3 TS scripts + evals | v2/src = 644 TS files (CLI, MCP, providers, hive-mind, neural, reasoningbank) |
| Per-agent tool allowlist | yes | no (ruflo uses bash hooks in frontmatter) |
| Output schemas / escalation protocol | yes | no (relies on swarm consensus) |
| Eval harness | yes (per-agent + team) | benchmark/ + tests/, no per-agent evals |
| Coordination model | personas + scoped tools + contracts | taxonomy + topologies + consensus protocols |

## Design philosophy difference

- **ruflo**: taxonomy + topology. Agents grouped by function (`consensus/raft-manager.md`, `swarm/mesh-coordinator.md`, `hive-mind/queen.md`). Coordination is *protocol-based*. Learning loop: RETRIEVE→JUDGE→DISTILL→CONSOLIDATE→ROUTE via AgentDB + HNSW + RL.
- **dreamteam**: personas + scoped tools. Seven NBA identities with tool allowlists, Output Schema, Escalation Protocol, Confidence Assessment, Turn Budget. Coordination is *contract-based* — Coach K validates at checkpoints.

One-liner: **ruflo solves "how do N agents coordinate at scale"**; **dreamteam solves "how do 6 agents stop talking past each other"**. Ruflo is a framework; dreamteam is a config.

---

## Adoptable ideas (ranked by value/effort)

### 1. `hooks.json` — biggest win, lowest effort

Ruflo ships `plugin/hooks/hooks.json` wiring Claude Code's `PreToolUse`/`PostToolUse` events to CLI commands. **dreamteam has zero hooks**, even though saved feedback (`feedback_draft_evals_mandatory`, `update-config` skill) says automated behaviors belong in hooks, not in-agent instructions.

Candidate hooks:
- **PostToolUse on `Task` (matcher `shaq`)** → auto-spawn Kobe review.
- **PostToolUse on `Write|Edit` inside `/agents/`** → auto-regenerate draft evals for that agent (currently manual, should be mandatory per saved feedback).
- **PreToolUse on `Write` into `~/.claude/`** → block the write, print "edit repo source instead" (enforces `feedback_edit_repo_first`).
- **Stop hook** → if a `/team` session ended without a magic retro, auto-invoke magic.

Converts several saved feedback rules from prompts-I-hope-Claude-obeys into harness guarantees.

Ruflo's format for reference:
```json
{
  "$schema": "https://code.claude.com/schemas/hooks.json",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow@alpha hooks pre-edit --file \"$TOOL_INPUT_file_path\"",
          "timeout": 5000,
          "continueOnError": true
        }]
      }
    ]
  }
}
```

### 2. Security agent — clear capability gap

Ruflo has `security-architect.yaml`, `consensus/security-manager.md`, plus a `security-review` SPARC mode. **dreamteam has no security lens.** Kobe finds bugs and edge cases; nobody explicitly covers authn/authz, injection, secret handling, supply chain.

Two options:
- **New 7th player** (e.g. "Dennis" Rodman — defender) as a security specialist. Same template as Kobe, different checklist.
- **Kobe security mode** gated by a keyword in the task (`security:` prefix) so Kobe runs OWASP-style checks. Lower surface area.

**Recommendation**: start with Kobe mode. Adding a 7th agent has orchestration cost across team.md, evals, coachk routing.

### 3. Named `/team` pipelines (stream-chain idea)

Ruflo's `stream-chain pipeline <name>` invokes predefined agent sequences. `commands/team.md` is 1,212 lines trying to cover everything in one flow. Split into named presets:

- `/team quick-fix` → Shaq → Kobe (skip Bird/MJ)
- `/team feature` → Bird → MJ → Shaq → Kobe → Pippen → Magic (current default)
- `/team pr-review` → Kobe + Pippen parallel, Magic synth
- `/team audit` → Bird + Kobe (security mode) + Pippen
- `/team debug` → MJ (health diagnostic) → Shaq → Pippen

Each is a short section in team.md pointing to Coach K with a different agent graph. User picks pipeline instead of Coach K deciding. Reduces team.md cognitive load.

### 4. TDD state machine for Shaq

Ruflo's `sparc/tdd.md` enforces explicit red-green-refactor phases. Currently `agents/shaq.md` says "write tests" but doesn't gate implementation behind failing tests. Add output-schema fields:

```yaml
tdd_phase: red | green | refactor
failing_test_output: <paste>
```

Shaq can't claim `green` without showing a prior `red`. Coach K validates phase transitions — same contract pattern already used for escalation, applied to TDD state.

### 5. `/verify` command — lightweight cross-check

Ruflo has `commands/verify/check.md` and `commands/truth/start.md` — standalone "does this output match the spec?" commands separate from the full orchestration loop. dreamteam has no equivalent — cross-checking Shaq's work against Bird's acceptance criteria requires running all of `/team`.

Add `/verify <pr-or-file>`: loads the latest Bird acceptance-criteria output from `retros/` or `data/`, runs Shaq's code against it, reports pass/fail per criterion. Cheaper than `/team` when you just need "is this done yet."

---

## Explicitly skip

- **Swarm topologies, consensus (Raft/BFT), hive-mind** — 6 agents, not 100. Coach K is sufficient.
- **AgentDB / HNSW / ReasoningBank / RL / neural** — requires a custom runtime. Claude Code's auto-memory already covers persistence needs.
- **SPARC as a new framework** — Bird→MJ→Shaq→Kobe→Pippen→Magic flow is already SPARC-shaped (Spec/Arch/Refinement/Completion). Don't rename.
- **MCP server / CLI / multi-provider (Claude/GPT/Gemini/Ollama)** — dreamteam's value is being a thin harness. Adding a runtime undoes that.
- **Embedding bash in agent frontmatter** (ruflo: `hooks: pre: | echo ...`) — Claude Code hooks in `settings.json` are the right place. Matches `feedback_edit_repo_first` philosophy.
- **Q-learning router / MoE experts** — dreamteam has ~7 routing decisions. A router isn't needed.

## Next actions when addressing

Priority order for implementation:
1. `hooks.json` (highest leverage, enforces existing feedback rules)
2. Named `/team` pipelines (splits monolithic team.md)
3. `/verify` command (cheap cross-check without full team)
4. Kobe security mode (capability gap)
5. Shaq TDD state machine (quality improvement)

Each should get its own eval pass before shipping (`feedback_eval_trials_mandatory`).
