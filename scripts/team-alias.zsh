# Dream Team recording alias
# Source this in your .zshrc: source /path/to/dreamteam/scripts/team-alias.zsh

team() {
    local topic="${1:?Usage: team <topic>}"
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
    if [[ -z "$repo_root" ]]; then
        echo "ERROR: not in a git repository" >&2
        return 1
    fi

    local cast_script="${repo_root}/scripts/cast.sh"
    if [[ ! -f "$cast_script" ]]; then
        cast_script="$HOME/.claude/scripts/cast.sh"
    fi

    local recordings_dir="${repo_root}/docs/recordings"
    mkdir -p "$recordings_dir"

    local cast_file="${recordings_dir}/$(date +%Y-%m-%d)-${topic}.cast"

    # Record the session (real terminal capture via script(1))
    "$cast_script" rec "$cast_file" "Dream Team: ${topic}" -- claude

    echo ""
    echo "Session ended. Processing recording..."

    # Auto-upload (strips idle + converts to v2 + preserves markers)
    local url
    url=$("$cast_script" upload "$cast_file" "Dream Team: ${topic}" 2>&1)

    if [[ "$url" == https://* ]]; then
        echo "Recording uploaded: $url"
    else
        echo "Upload failed: $url"
        echo "Recording saved locally: $cast_file"
    fi

    # Auto-generate HTML report
    local reports_dir="${repo_root}/docs/reports"
    mkdir -p "$reports_dir"
    local report_file="${reports_dir}/$(date +%Y-%m-%d)-${topic}.html"

    if [[ "$url" == https://* ]]; then
        "$cast_script" export-html "$cast_file" "$url"
    else
        "$cast_script" export-html "$cast_file"
    fi
    mv "${cast_file%.cast}.html" "$report_file" 2>/dev/null
    echo "Report saved: $report_file"
    open "$report_file"
}
