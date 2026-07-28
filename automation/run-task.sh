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
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG_DIR="${REPORT_DIR:-$STATE_HOME/emailsignaturegenerator}"

case "$TASK" in
  daily-health)
    REPORT_FILE="$LOG_DIR/health-$(date '+%Y-%m-%d').md"
    EMAIL_SUBJECT="Daily SEO Health Check"
    ;;
  weekly-content)
    REPORT_FILE="$LOG_DIR/weekly-log.md"
    EMAIL_SUBJECT="Weekly SEO Update — New Article Published"
    ;;
  monthly-audit)
    REPORT_FILE="$LOG_DIR/monthly-$(date '+%Y-%m').md"
    EMAIL_SUBJECT="Monthly SEO+GEO Audit Report"
    ;;
  *)
    echo "Unknown task: $TASK" >&2
    exit 2
    ;;
esac

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

REPORT_EXISTED=0
REPORT_MUST_CHANGE=0
REPORT_SNAPSHOT="$(mktemp)"
REPORT_READY=0
cleanup_report_snapshot() {
  if [ "$REPORT_EXISTED" = "1" ] && [ "$REPORT_READY" != "1" ]; then
    cp "$REPORT_SNAPSHOT" "$REPORT_FILE"
  fi
  rm -f "$REPORT_SNAPSHOT"
}
trap cleanup_report_snapshot EXIT
if [ -f "$REPORT_FILE" ]; then
  REPORT_EXISTED=1
  cp "$REPORT_FILE" "$REPORT_SNAPSHOT"
  if [ "$TASK" = "weekly-content" ]; then
    REPORT_MUST_CHANGE=1
  else
    rm -f "$REPORT_FILE"
  fi
fi

echo "[$(date '+%Y-%m-%d %H:%M')] Starting $TASK"
"$AGENT_CLI" --print "$(printf 'Repository root: %s\nRequired report output: %s\nRun all repository commands from the repository root and write the report to the exact path above.\n\n' "$SITE_DIR" "$REPORT_FILE"; cat "$PROMPT_FILE")"

if [ ! -s "$REPORT_FILE" ]; then
  echo "Expected report is missing or empty: $REPORT_FILE" >&2
  exit 1
fi
if [ "$REPORT_MUST_CHANGE" = "1" ]; then
  SNAPSHOT_SIZE="$(wc -c < "$REPORT_SNAPSHOT" | tr -d ' ')"
  REPORT_SIZE="$(wc -c < "$REPORT_FILE" | tr -d ' ')"
  if [ "$REPORT_SIZE" -le "$SNAPSHOT_SIZE" ] || ! head -c "$SNAPSHOT_SIZE" "$REPORT_FILE" | cmp -s "$REPORT_SNAPSHOT" -; then
    echo "Expected report was not appended during this run: $REPORT_FILE" >&2
    exit 1
  fi
fi
REPORT_READY=1

SEND_REQUESTED=0
DEPLOY_REQUESTED=0
[ "${SEND_EMAIL:-0}" = "1" ] && SEND_REQUESTED=1
[ "${DEPLOY_AFTER:-0}" = "1" ] && DEPLOY_REQUESTED=1

if [ "$SEND_REQUESTED" = "1" ] || [ "$DEPLOY_REQUESTED" = "1" ]; then
  if [ "${ALLOW_EXTERNAL_WRITES:-0}" != "1" ]; then
    echo "External writes require ALLOW_EXTERNAL_WRITES=1." >&2
    exit 1
  fi
fi

if [ "$DEPLOY_REQUESTED" = "1" ]; then
  if [ -z "${DEPLOY_APPROVED_COMMIT:-}" ]; then
    echo "Deployment requires DEPLOY_APPROVED_COMMIT." >&2
    exit 1
  fi

  HEAD_COMMIT="$(git rev-parse HEAD)"
  if [ "$DEPLOY_APPROVED_COMMIT" != "$HEAD_COMMIT" ]; then
    echo "DEPLOY_APPROVED_COMMIT does not match HEAD ($HEAD_COMMIT)." >&2
    exit 1
  fi

  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    echo "Deployment requires a clean git tree." >&2
    exit 1
  fi
fi

if [ "$DEPLOY_REQUESTED" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Running pre-deploy checks"
  npm run check
  echo "[$(date '+%Y-%m-%d %H:%M')] Deploying"
  npx wrangler deploy >> "$LOG_DIR/cron-$TASK.log" 2>&1
fi

if [ "$SEND_REQUESTED" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Sending report email"
  "${NODE_BIN:-node}" "$SCRIPT_DIR/send-email.js" "$REPORT_FILE" "$EMAIL_SUBJECT"
fi

echo "[$(date '+%Y-%m-%d %H:%M')] Complete $TASK"
