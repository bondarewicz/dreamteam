#!/bin/bash
set -euo pipefail

# Dream Team Installer
# Installs Claude Code agents and commands from this repo to ~/.claude/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_SRC="$REPO_DIR/agents"
COMMANDS_SRC="$REPO_DIR/commands"
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

# --- Step 2: Remove old files from previous installations ---
OLD_FILES=("penny.md" "guardian.md" "architect.md" "analyst.md" "frontend.md")
for old in "${OLD_FILES[@]}"; do
    if [ -f "$AGENTS_DST/$old" ]; then
        echo "Removing old agent: $old"
        rm -f "$AGENTS_DST/$old"
    fi
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

# --- Step 6: Install scripts (symlinks — always in sync, never stale) ---
SCRIPTS_DST="$CLAUDE_DIR/scripts"
mkdir -p "$SCRIPTS_DST"
# Remove dangling symlink from prior installations that included cast.sh
rm -f "$SCRIPTS_DST/cast.sh"
echo "Installing scripts (symlinks)..."
script_count=0
for script_file in "$SCRIPT_DIR"/*.sh; do
    filename=$(basename "$script_file")
    [[ "$filename" == "install.sh" ]] && continue
    # Remove old copy/symlink and create fresh symlink to repo
    rm -f "$SCRIPTS_DST/$filename"
    ln -s "$script_file" "$SCRIPTS_DST/$filename"
    chmod +x "$script_file"
    echo "  + $filename -> $(basename "$script_file") (symlink)"
    script_count=$((script_count + 1))
done
echo "  $script_count scripts installed."
echo ""

# --- Step 7: Ensure output directories exist ---
mkdir -p "$REPO_DIR/reports/retros"
mkdir -p "$REPO_DIR/reports/evals"
mkdir -p "$REPO_DIR/evals/results"

# --- Summary ---
echo "=== Installation Complete ==="
echo ""
echo "Dream Team agents:"
echo "  mj      — Strategic Systems Architect"
echo "  bird    — Domain Authority & Final Arbiter"
echo "  shaq    — Primary Code Executor"
echo "  kobe    — Quality & Risk Enforcer"
echo "  pippen  — Stability, Integration & Defense"
echo "  magic   — Context Synthesizer & Team Glue"
echo ""
echo "Commands:"
echo "  /mj           — Architecture design & health diagnostics"
echo "  /bird         — Domain analysis & business impact"
echo "  /shaq         — Code implementation"
echo "  /kobe         — Quality review & production readiness"
echo "  /pippen       — Stability & integration review"
echo "  /magic        — Synthesis & documentation"
echo "  /team         — Full Dream Team orchestration (Coach K)"
echo "  /code-review  — Automated PR code review (local only)"
echo ""
echo "Start a new Claude Code session to use the agents."
