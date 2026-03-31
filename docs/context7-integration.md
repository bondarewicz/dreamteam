# Context7 Integration

**Status:** Not yet integrated
**Date:** 2026-03-31
**Source:** https://context7.com / https://github.com/upstash/context7

## What is Context7?

An MCP server (by Upstash) that fetches up-to-date, version-specific library documentation and injects it into LLM context. Solves the problem of agents hallucinating APIs or using outdated code patterns from training data.

## How it works

Two-step process:
1. `resolve-library-id` — convert a library name (e.g. "react") into a Context7 ID
2. `query-docs` — fetch version-specific docs and code examples using that ID

## Installation

```bash
npx ctx7 setup --claude
```

This configures Context7 as an MCP server in Claude Code settings via OAuth + API key.

## Integration requirements for dreamteam agents

### Tool access changes

| Agent | Current tool config | Change needed |
|-------|-------------------|---------------|
| **Shaq** | `disallowedTools: Task` (blacklist) | None — MCP tools available automatically |
| **MJ** | `tools: Read, Grep, Glob, Bash, WebFetch, WebSearch` (whitelist) | Add `mcp__context7__resolve-library-id, mcp__context7__query-docs` |
| **Kobe** | `tools: Read, Grep, Glob, Bash, Edit` (whitelist) | Optional — low benefit |
| **Bird/Pippen/Magic** | Whitelisted | No change — don't interact with library APIs |

### Agent instruction additions

Each agent that uses Context7 needs a section explaining when and how to use it. Example:

```markdown
## External Documentation (Context7)
When implementing code that uses external libraries, use Context7 to get
current API docs BEFORE writing code. Two-step process:
1. `resolve-library-id` — find the library's Context7 ID
2. `query-docs` — fetch version-specific docs and examples
Always prefer Context7 docs over training knowledge for library APIs.
```

## Benefit assessment

| Agent | Benefit | Rationale |
|-------|---------|-----------|
| **Shaq** | **High** | Writes code using external libraries — most likely to hallucinate APIs |
| **MJ** | **Medium** | Evaluates library capabilities during architecture design |
| **Kobe** | **Low** | Could verify API usage in reviews, but adds turns for marginal gain |
| **Bird/Pippen/Magic** | **None** | Don't interact with library APIs |

## Open questions

- Exact MCP tool names after installation (assumed `mcp__context7__*` prefix)
- Whether Context7 covers niche libraries or only popular ones
- Impact on agent turn budget — each doc lookup costs 2 tool calls
- Whether to make it mandatory ("always check") or advisory ("check when unsure")
