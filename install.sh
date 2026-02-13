#!/bin/bash
set -euo pipefail

# Dream Team Installer
# Installs Claude Code agents and commands from this repo to ~/.claude/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_SRC="$SCRIPT_DIR/agents"
COMMANDS_SRC="$SCRIPT_DIR/commands"
AGENTS_DST="$CLAUDE_DIR/agents"
COMMANDS_DST="$CLAUDE_DIR/commands"
BACKUP_DIR="$CLAUDE_DIR/backup-$(date +%Y%m%d-%H%M%S)"

echo "=== Dream Team Installer ==="
echo ""

# --- Step 1: Backup existing files ---
if [ -d "$AGENTS_DST" ] || [ -d "$COMMANDS_DST" ]; then
    echo "Backing up existing files to $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR"
    [ -d "$AGENTS_DST" ] && cp -r "$AGENTS_DST" "$BACKUP_DIR/agents"
    [ -d "$COMMANDS_DST" ] && cp -r "$COMMANDS_DST" "$BACKUP_DIR/commands"
    echo "  Backup complete."
    echo ""
fi

# --- Step 2: Remove old agent files that are being replaced ---
OLD_AGENTS=("penny.md")
for old in "${OLD_AGENTS[@]}"; do
    if [ -f "$AGENTS_DST/$old" ]; then
        echo "Removing old agent: $old"
        rm -f "$AGENTS_DST/$old"
    fi
done

# Remove old commands that conflict with Dream Team agent names
# (mj, magic, shaq are now agents, not standalone commands)
OLD_COMMANDS=("penny.md" "mj.md" "magic.md" "shaq.md")
for old in "${OLD_COMMANDS[@]}"; do
    if [ -f "$COMMANDS_DST/$old" ]; then
        echo "Removing old command: $old"
        rm -f "$COMMANDS_DST/$old"
    fi
done

echo ""

# --- Step 3: Create directories ---
mkdir -p "$AGENTS_DST"
mkdir -p "$COMMANDS_DST"

# --- Step 4: Install agents ---
echo "Installing agents..."
agent_count=0
for agent_file in "$AGENTS_SRC"/*.md; do
    filename=$(basename "$agent_file")
    cp "$agent_file" "$AGENTS_DST/$filename"
    agent_name="${filename%.md}"
    echo "  + $agent_name"
    agent_count=$((agent_count + 1))
done
echo "  $agent_count agents installed."
echo ""

# --- Step 5: Install commands ---
echo "Installing commands..."
cmd_count=0
for cmd_file in "$COMMANDS_SRC"/*.md; do
    filename=$(basename "$cmd_file")
    cp "$cmd_file" "$COMMANDS_DST/$filename"
    cmd_name="${filename%.md}"
    echo "  + /$cmd_name"
    cmd_count=$((cmd_count + 1))
done
echo "  $cmd_count commands installed."
echo ""

# --- Summary ---
echo "=== Installation Complete ==="
echo ""
echo "Standalone agents (project-specific):"
echo "  guardian  — Production readiness reviewer"
echo "  architect — System health & technical strategy"
echo "  analyst   — Business impact & requirements"
echo "  frontend  — UI architecture & React specialist"
echo ""
echo "Dream Team agents (general-purpose):"
echo "  mj      — Domain Authority & Final Arbiter"
echo "  bird    — Strategic Systems Architect"
echo "  shaq    — Primary Code Executor"
echo "  kobe    — Quality & Risk Enforcer"
echo "  pippen  — Stability, Integration & Defense"
echo "  magic   — Context Synthesizer & Team Glue"
echo ""
echo "Commands:"
echo "  /guardian  — Launch production readiness review"
echo "  /architect — Launch system health analysis"
echo "  /analyst   — Launch business impact analysis"
echo "  /frontend  — Launch frontend architecture review"
echo "  /team      — Launch Dream Team orchestration (Coach K)"
echo ""
echo "Start a new Claude Code session to use the agents."
