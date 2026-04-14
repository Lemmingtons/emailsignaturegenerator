#!/bin/bash
# Weekly content generation — called by cron
SITE_DIR="/Users/ryanlehmann/Saas Prpojects/signature-generator"
CLAUDE_CLI=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")
PROMPT_FILE="$SITE_DIR/automation/prompts/weekly-content.txt"

cd "$SITE_DIR" || exit 1
echo "[$(date '+%Y-%m-%d %H:%M')] Starting weekly content run..."
"$CLAUDE_CLI" --print "$(cat "$PROMPT_FILE")"
echo "[$(date '+%Y-%m-%d %H:%M')] Deploying to Cloudflare Workers..."
/opt/homebrew/bin/npx wrangler deploy >> "$SITE_DIR/reports/cron-weekly.log" 2>&1
echo "[$(date '+%Y-%m-%d %H:%M')] Weekly content run complete."
