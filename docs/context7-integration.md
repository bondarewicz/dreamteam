# Context7 Integration

**Status:** Installed (User scope MCP server)
**Source:** https://context7.com / https://github.com/upstash/context7

## What is Context7?

An MCP server (by Upstash) that fetches up-to-date, version-specific library documentation and injects it into LLM context. Solves the problem of agents hallucinating APIs or using outdated code patterns from training data.

## How it works

Two-step process:
1. `mcp__context7__resolve-library-id` — convert a library name (e.g. `"react"`, `"drizzle-orm"`) into a Context7 ID
2. `mcp__context7__get-library-docs` — fetch version-specific docs and code examples using that ID

## Setup

Context7 is hosted at `https://mcp.context7.com/mcp` and authenticates via an API key passed as a header. Get a key from https://context7.com (free tier available).

```bash
# Add the MCP server at User scope (available in all projects on this machine)
claude mcp add --transport http context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY: <your-key>" \
  -s user

# Verify
claude mcp list           # should show: context7 ... ✓ Connected
claude mcp get context7   # shows scope + connection status
```

**Restart Claude Code** after adding the server so the new MCP tools register in the session.

### Where the API key lives

The key is stored in `~/.claude.json` under `mcpServers.context7` — **User scope, not the repo**. Never commit Context7 keys to `.env` or any tracked file. To rotate:

```bash
claude mcp remove context7 -s user
# then re-add with the new key
```

## Usage

Once installed, agents can call Context7 in any prompt. Example:

```
Use Context7 to fetch current Drizzle ORM schema syntax, then add a users
table to db/schema.ts with id, email, createdAt columns.
```

The agent will:
1. Call `resolve-library-id` with `"drizzle-orm"` → gets a Context7 ID
2. Call `get-library-docs` with that ID → gets version-specific docs
3. Write code grounded in real APIs rather than training-data guesses

**Smoke test:**
```
Use Context7 to show me the React useEffect cleanup function signature.
```

## Integration with Dream Team agents

| Agent | Benefit | Tool config change |
|-------|---------|--------------------|
| **Shaq** | **High** — writes code using external libraries | None needed (blacklist config picks up MCP tools automatically) |
| **MJ** | **Medium** — evaluates library capabilities during architecture design | Add `mcp__context7__*` to whitelist |
| **Kobe** | **Low** — could verify API usage in reviews | Optional |
| **Bird / Pippen / Magic** | **None** — don't interact with library APIs | No change |

### Agent instruction snippet

For agents adopting Context7, add a section like:

```markdown
## External Documentation (Context7)
When implementing code that uses external libraries, use Context7 to get
current API docs BEFORE writing code:
1. `mcp__context7__resolve-library-id` — find the library's Context7 ID
2. `mcp__context7__get-library-docs` — fetch version-specific docs
Always prefer Context7 docs over training knowledge for library APIs.
```

## Open questions

- Whether Context7 covers niche libraries or only popular ones
- Impact on agent turn budget — each doc lookup costs 2 tool calls
- Whether to make it mandatory ("always check") or advisory ("check when unsure")
