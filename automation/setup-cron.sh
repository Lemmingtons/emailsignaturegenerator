#!/bin/bash
# emailsignaturegenerator.ai SEO Automation Cron Setup
# Installs system cron jobs for set-and-forget SEO automation.
# Run once: chmod +x automation/setup-cron.sh && ./automation/setup-cron.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -z "${AGENT_CLI:-}" ]; then
  AGENT_CLI="$(command -v claude || true)"
  if [ -z "$AGENT_CLI" ] && [ -x "$HOME/.claude/local/claude" ]; then
    AGENT_CLI="$HOME/.claude/local/claude"
  fi
fi
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG_DIR="${REPORT_DIR:-$STATE_HOME/emailsignaturegenerator}"
if [ -n "${REPORT_DIR:-}" ]; then
  STATE_DIRECTORY_LABEL="REPORT_DIR override"
else
  STATE_DIRECTORY_LABEL="default outside checkout"
fi

# Ensure log directory exists
mkdir -p "$LOG_DIR"

if [ -z "$AGENT_CLI" ] || [ ! -x "$AGENT_CLI" ]; then
  echo "Agent CLI not found. Set AGENT_CLI=/path/to/cli and try again."
  exit 1
fi

echo "Installing cron jobs for emailsignaturegenerator.ai SEO automation..."
echo "   Agent CLI: $AGENT_CLI"
echo "   Site directory: $SITE_DIR"
echo "   Operational state directory ($STATE_DIRECTORY_LABEL): $LOG_DIR"
echo ""

# Build crontab entries (wrapper scripts used to avoid inline quoting issues)
START_MARKER="# BEGIN emailsignaturegenerator.ai SEO automation"
END_MARKER="# END emailsignaturegenerator.ai SEO automation"
DAILY_JOB="43 6 * * *  SEND_EMAIL=0 DEPLOY_AFTER=0 REPORT_DIR=\"$LOG_DIR\" AGENT_CLI=\"$AGENT_CLI\" bash \"$SITE_DIR/automation/run-daily.sh\" >> \"$LOG_DIR/cron-daily.log\" 2>&1"
WEEKLY_JOB="17 7 * * 1  SEND_EMAIL=0 DEPLOY_AFTER=0 REPORT_DIR=\"$LOG_DIR\" AGENT_CLI=\"$AGENT_CLI\" bash \"$SITE_DIR/automation/run-weekly.sh\" >> \"$LOG_DIR/cron-weekly.log\" 2>&1"
MONTHLY_JOB="23 8 1 * *  SEND_EMAIL=0 DEPLOY_AFTER=0 REPORT_DIR=\"$LOG_DIR\" AGENT_CLI=\"$AGENT_CLI\" bash \"$SITE_DIR/automation/run-monthly.sh\" >> \"$LOG_DIR/cron-monthly.log\" 2>&1"

# Install to crontab (preserving existing jobs)
TMPFILE=$(mktemp)
crontab -l 2>/dev/null |
  awk -v start="$START_MARKER" -v end="$END_MARKER" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' |
  grep -vF "$SITE_DIR/automation/run-daily.sh" |
  grep -vF "$SITE_DIR/automation/run-weekly.sh" |
  grep -vF "$SITE_DIR/automation/run-monthly.sh" > "$TMPFILE"
echo "" >> "$TMPFILE"
echo "$START_MARKER" >> "$TMPFILE"
echo "# Installed $(date +%Y-%m-%d)" >> "$TMPFILE"
echo "$DAILY_JOB" >> "$TMPFILE"
echo "$WEEKLY_JOB" >> "$TMPFILE"
echo "$MONTHLY_JOB" >> "$TMPFILE"
echo "$END_MARKER" >> "$TMPFILE"
crontab "$TMPFILE"
rm "$TMPFILE"

echo "Cron jobs installed. Schedule:"
echo "   Daily:   6:43am - Technical SEO health check"
echo "   Weekly:  Monday 7:17am - New blog article + sitemap update"
echo "   Monthly: 1st of month 8:23am - Full SEO + GEO audit report"
echo ""
echo "Reports and logs will be written to: $LOG_DIR/"
echo "   health-YYYY-MM-DD.md"
echo "   weekly-log.md"
echo "   monthly-YYYY-MM.md"
echo ""
echo "To view current cron jobs: crontab -l"
echo "To remove these jobs:       crontab -l | grep -v emailsignaturegenerator.ai | crontab -"
