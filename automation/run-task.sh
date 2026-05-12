#!/bin/bash
set -euo pipefail

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: automation/run-task.sh <daily-health|weekly-content|monthly-audit>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompts/$TASK.txt"
LOG_DIR="${REPORT_DIR:-$SITE_DIR/reports}"
if [ -z "${AGENT_CLI:-}" ]; then
  AGENT_CLI="$(command -v claude || true)"
  if [ -z "$AGENT_CLI" ] && [ -x "$HOME/.claude/local/claude" ]; then
    AGENT_CLI="$HOME/.claude/local/claude"
  fi
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

if [ -z "$AGENT_CLI" ] || [ ! -x "$AGENT_CLI" ]; then
  echo "Agent CLI not found. Set AGENT_CLI=/path/to/cli." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
cd "$SITE_DIR"

echo "[$(date '+%Y-%m-%d %H:%M')] Starting $TASK"
"$AGENT_CLI" --print "$(cat "$PROMPT_FILE")"

if [ "${DEPLOY_AFTER:-0}" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Deploying"
  npx wrangler deploy >> "$LOG_DIR/cron-$TASK.log" 2>&1
fi

echo "[$(date '+%Y-%m-%d %H:%M')] Complete $TASK"
