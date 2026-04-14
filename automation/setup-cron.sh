#!/bin/bash
# emailsignaturegenerator.ai — SEO Automation Cron Setup
# Installs system cron jobs for set-and-forget SEO automation.
# Run once: chmod +x automation/setup-cron.sh && ./automation/setup-cron.sh

SITE_DIR="/Users/ryanlehmann/Saas Prpojects/signature-generator"
CLAUDE_CLI=$(which claude 2>/dev/null || echo "$HOME/.claude/local/claude")
LOG_DIR="$SITE_DIR/reports"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Check Claude CLI is available
if [ ! -f "$CLAUDE_CLI" ]; then
  echo "⚠️  Claude CLI not found. Make sure 'claude' is in your PATH."
  echo "   Install Claude Code CLI and try again."
  exit 1
fi

echo "🔧 Installing cron jobs for emailsignaturegenerator.ai SEO automation..."
echo "   Claude CLI: $CLAUDE_CLI"
echo "   Site directory: $SITE_DIR"
echo ""

# Build crontab entries (wrapper scripts used to avoid inline quoting issues)
DAILY_JOB="43 6 * * *  bash \"$SITE_DIR/automation/run-daily.sh\" >> \"$LOG_DIR/cron-daily.log\" 2>&1"
WEEKLY_JOB="17 7 * * 1  bash \"$SITE_DIR/automation/run-weekly.sh\" >> \"$LOG_DIR/cron-weekly.log\" 2>&1"
MONTHLY_JOB="23 8 1 * *  bash \"$SITE_DIR/automation/run-monthly.sh\" >> \"$LOG_DIR/cron-monthly.log\" 2>&1"

# Install to crontab (preserving existing jobs)
TMPFILE=$(mktemp)
crontab -l 2>/dev/null | grep -v "emailsignaturegenerator.ai" > "$TMPFILE"
echo "" >> "$TMPFILE"
echo "# emailsignaturegenerator.ai SEO automation — installed $(date +%Y-%m-%d)" >> "$TMPFILE"
echo "$DAILY_JOB" >> "$TMPFILE"
echo "$WEEKLY_JOB" >> "$TMPFILE"
echo "$MONTHLY_JOB" >> "$TMPFILE"
crontab "$TMPFILE"
rm "$TMPFILE"

echo "✅ Cron jobs installed. Schedule:"
echo "   Daily:   6:43am — Technical SEO health check"
echo "   Weekly:  Monday 7:17am — New blog article + sitemap update"
echo "   Monthly: 1st of month 8:23am — Full SEO + GEO audit report"
echo ""
echo "📁 Logs will be written to: $LOG_DIR/"
echo "   daily-health-YYYY-MM-DD.md"
echo "   weekly-log.md"
echo "   monthly-YYYY-MM.md"
echo ""
echo "To view current cron jobs: crontab -l"
echo "To remove these jobs:       crontab -l | grep -v emailsignaturegenerator.ai | crontab -"
