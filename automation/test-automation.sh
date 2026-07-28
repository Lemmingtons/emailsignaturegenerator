#!/bin/bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_NODE="$(command -v node)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE="$TEST_ROOT/repository with spaces"
XDG_STATE_HOME="$TEST_ROOT/xdg-state"
DEFAULT_REPORT_DIR="$XDG_STATE_HOME/emailsignaturegenerator"
CUSTOM_REPORT_DIR="$TEST_ROOT/custom-reports"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FIXTURE" "$FAKE_BIN"
cp -R "$SOURCE_ROOT/automation" "$FIXTURE/automation"
cp "$SOURCE_ROOT/package.json" "$FIXTURE/package.json"

ACTION_LOG="$TEST_ROOT/actions.log"
PROMPT_LOG="$TEST_ROOT/prompt.log"
export ACTION_LOG PROMPT_LOG XDG_STATE_HOME

cat > "$FAKE_BIN/agent" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s' "${2:-}" > "$PROMPT_LOG"
printf 'agent\n' >> "$ACTION_LOG"
if [ "${FAKE_AGENT_MODE:-write}" = "fail" ]; then exit 9; fi
if [ "${FAKE_AGENT_MODE:-write}" = "write" ]; then
  report_file="$(printf '%s\n' "${2:-}" | sed -n 's/^Required report output: //p' | head -1)"
  mkdir -p "$(dirname "$report_file")"
  printf 'generated report\n' > "$report_file"
fi
EOF

cat > "$FAKE_BIN/npm" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "$ACTION_LOG"
[ "${FAKE_NPM_FAIL:-0}" != "1" ] || exit 8
EOF

cat > "$FAKE_BIN/npx" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'npx %s\n' "$*" >> "$ACTION_LOG"
EOF

cat > "$FAKE_BIN/send-email" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'email %s | %s | %s\n' "$1" "$2" "$3" >> "$ACTION_LOG"
EOF

chmod +x "$FAKE_BIN/agent" "$FAKE_BIN/npm" "$FAKE_BIN/npx" "$FAKE_BIN/send-email"
export PATH="$FAKE_BIN:$PATH"
export AGENT_CLI="$FAKE_BIN/agent"
export NODE_BIN="$FAKE_BIN/send-email"

git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.name 'Automation Test'
git -C "$FIXTURE" config user.email 'automation-test@example.invalid'
git -C "$FIXTURE" add automation package.json
git -C "$FIXTURE" commit -qm 'fixture'
APPROVED_COMMIT="$(git -C "$FIXTURE" rev-parse HEAD)"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_actions() {
  local actual
  actual="$(cat "$ACTION_LOG")"
  [ "$actual" = "$1" ] || fail "unexpected actions; expected:\n$1\nactual:\n$actual"
}
assert_rejected() {
  if "$@" >/dev/null 2>&1; then fail "command unexpectedly succeeded: $*"; fi
}
run_weekly() { bash "$FIXTURE/automation/run-weekly.sh"; }

# Defaults generate a report but perform no external write.
: > "$ACTION_LOG"
FAKE_AGENT_MODE=write run_weekly
assert_actions 'agent'
grep -Fq "Repository root: $FIXTURE" "$PROMPT_LOG" || fail 'prompt did not use current repository root'
grep -Fq "Required report output: $DEFAULT_REPORT_DIR/weekly-log.md" "$PROMPT_LOG" || fail 'prompt did not use default operational state directory'
[ -s "$DEFAULT_REPORT_DIR/weekly-log.md" ] || fail 'default report was not written to operational state'
case "$DEFAULT_REPORT_DIR/" in
  "$FIXTURE"/*) fail 'default report directory is inside the checkout' ;;
esac
[ -z "$(git -C "$FIXTURE" status --porcelain --untracked-files=all)" ] || fail 'default report output dirtied the checkout'
[ ! -e "$FIXTURE/reports" ] || fail 'default run created a reports directory in the checkout'
if grep -Eq 'send-email|mailer|wrangler deploy' "$PROMPT_LOG"; then fail 'prompt instructs an external write'; fi
if [ "$(grep -c 'SEND_EMAIL=0 DEPLOY_AFTER=0' "$FIXTURE/automation/setup-cron.sh")" -ne 3 ]; then
  fail 'cron entries do not explicitly disable email and deployment'
fi

# An explicit REPORT_DIR remains authoritative.
: > "$ACTION_LOG"
FAKE_AGENT_MODE=write REPORT_DIR="$CUSTOM_REPORT_DIR" run_weekly
assert_actions 'agent'
grep -Fq "Required report output: $CUSTOM_REPORT_DIR/weekly-log.md" "$PROMPT_LOG" || fail 'explicit REPORT_DIR was not respected'
[ -s "$CUSTOM_REPORT_DIR/weekly-log.md" ] || fail 'explicit report output was not created'
[ -z "$(git -C "$FIXTURE" status --porcelain --untracked-files=all)" ] || fail 'explicit external report output dirtied the checkout'

# Email requires the shared external-write approval and uses mapped safe arguments.
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write SEND_EMAIL=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

: > "$ACTION_LOG"
FAKE_AGENT_MODE=write SEND_EMAIL=1 ALLOW_EXTERNAL_WRITES=1 run_weekly
assert_actions "$(printf 'agent\nemail %s | %s | %s' "$FIXTURE/automation/send-email.js" "$DEFAULT_REPORT_DIR/weekly-log.md" 'Weekly SEO Update — New Article Published')"

# Deploy requires external approval, an approved SHA, a matching HEAD, and cleanliness.
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write DEPLOY_AFTER=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT=0000000000000000000000000000000000000000 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

# An invalid deploy preflight also prevents an otherwise approved email.
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write SEND_EMAIL=1 DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT=0000000000000000000000000000000000000000 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

printf '\n' >> "$FIXTURE/package.json"
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT="$APPROVED_COMMIT" bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'
git -C "$FIXTURE" checkout -- package.json

printf 'unreviewed\n' > "$FIXTURE/untracked.txt"
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT="$APPROVED_COMMIT" bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'
rm "$FIXTURE/untracked.txt"

# Fully gated deployment validates first and invokes only the fake deploy action.
: > "$ACTION_LOG"
FAKE_AGENT_MODE=write DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT="$APPROVED_COMMIT" run_weekly
assert_actions "$(printf 'agent\nnpm run check\nnpx wrangler deploy')"

: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=write FAKE_NPM_FAIL=1 DEPLOY_AFTER=1 ALLOW_EXTERNAL_WRITES=1 DEPLOY_APPROVED_COMMIT="$APPROVED_COMMIT" bash "$FIXTURE/automation/run-weekly.sh"
assert_actions "$(printf 'agent\nnpm run check')"

# Missing, empty, or failed output prevents all side effects.
rm -f "$DEFAULT_REPORT_DIR/weekly-log.md"
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=missing SEND_EMAIL=1 ALLOW_EXTERNAL_WRITES=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

: > "$DEFAULT_REPORT_DIR/weekly-log.md"
: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=missing SEND_EMAIL=1 ALLOW_EXTERNAL_WRITES=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

: > "$ACTION_LOG"
assert_rejected env FAKE_AGENT_MODE=fail SEND_EMAIL=1 ALLOW_EXTERNAL_WRITES=1 bash "$FIXTURE/automation/run-weekly.sh"
assert_actions 'agent'

# Subject values are CR/LF-free, bounded, and escaped in HTML.
SOURCE_ROOT="$SOURCE_ROOT" "$REAL_NODE" <<'EOF'
const assert = require('assert');
const path = require('path');
const { MAX_SUBJECT_LENGTH, buildEmailPayload, sanitizeSubject } = require(path.join(process.env.SOURCE_ROOT, 'automation/send-email.js'));
const hostile = `${'A'.repeat(240)}\r\nB <script>alert("x")</script> & more`;
const sanitized = sanitizeSubject(hostile);
assert.strictEqual(sanitized.length, MAX_SUBJECT_LENGTH);
assert(!/[\r\n]/.test(sanitized));
const payload = buildEmailPayload({ reportContent: '<report & data>', subject: 'Hello\r\nBcc: victim@example.com <b>&', today: '28 July 2026', toEmail: 'owner@example.com' });
assert(payload.subject.length <= MAX_SUBJECT_LENGTH);
assert(!/[\r\n]/.test(payload.subject));
assert(payload.subject.includes('Hello Bcc: victim@example.com'));
assert(payload.html.includes('<h1>Hello Bcc: victim@example.com &lt;b&gt;&amp;</h1>'));
assert(payload.html.includes('&lt;report &amp; data&gt;'));
EOF

echo 'Automation regression tests passed.'
