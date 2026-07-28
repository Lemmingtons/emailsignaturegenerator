#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_AFTER="${DEPLOY_AFTER:-0}" exec bash "$SCRIPT_DIR/run-task.sh" weekly-content
