#!/bin/bash
# Daily SEO health check — called by cron
SITE_DIR="/Users/ryanlehmann/Saas Prpojects/signature-generator"
CLAUDE_CLI=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")
PROMPT_FILE="$SITE_DIR/automation/prompts/daily-health.txt"

cd "$SITE_DIR" || exit 1
echo "[$(date '+%Y-%m-%d %H:%M')] Starting daily health check..."
"$CLAUDE_CLI" --print "$(cat "$PROMPT_FILE")"
echo "[$(date '+%Y-%m-%d %H:%M')] Daily health check complete."
