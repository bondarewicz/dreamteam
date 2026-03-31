# Serena Integration Assessment

**Date:** 2026-03-31
**Status:** Under consideration
**Link:** https://oraios.github.io/serena / https://github.com/oraios/serena

## What is Serena?

Open-source MCP server that gives LLMs IDE-like semantic code understanding via LSP backends or JetBrains plugins. Supports 40+ languages.

Key tools it exposes:
- `find_symbol` — symbol-level code discovery and extraction
- `find_referencing_symbols` — find all callers/references of a symbol
- `insert_after_symbol` — structure-aware code insertion

## Why it matters for DreamTeam

Addresses **pain point #8** from `team-improvement-analysis.md`: agents lack AST/dependency graph tools and rely on manual Glob/Grep for code navigation.

### Per-agent impact

| Agent | Benefit |
|-------|---------|
| **Bird** | Trace domain models and relationships via symbol resolution instead of grep |
| **MJ** | Get actual dependency graphs and call chains for architecture analysis |
| **Shaq** | Place code precisely using structure-aware insertion |
| **Kobe** | Verify all callers handle new contracts via reference finding |
| **Pippen** | Trace cross-boundary calls and error propagation paths |

### Additional benefits

- **Token efficiency** — no more loading entire files to find one function; reduces context bloat
- **Precision** — symbol resolution eliminates false-positive grep matches
- **Call chain analysis** — biggest current gap; Serena does in one call what takes multiple grep rounds

## Integration path

Serena runs as an MCP server. Add it the same way as Miro:

```bash
claude mcp add serena -- <serena-command>
```

No agent definition changes needed — agents get access to new tools automatically.

## What it does NOT address

- Inter-agent communication / handoff structure
- Parallelization of agent phases
- Eval system or observability/metrics

## Next steps

1. Install Serena MCP server locally and test with a real codebase
2. Run MJ and Kobe evals with Serena enabled vs baseline — measure precision and token usage
3. If positive, document which Serena tools to allow per agent (read-only agents should not get `insert_after_symbol`)
