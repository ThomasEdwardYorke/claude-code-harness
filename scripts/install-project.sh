#!/usr/bin/env bash
# scripts/install-project.sh — install the harness (and the Codex companion)
# into the caller's current project directory.
#
# Usage (run from inside your project root):
#   bash ~/dev/claude-code-harness/scripts/install-project.sh
#
# Steps performed:
#   1. Register the two marketplaces (idempotent)
#   2. Install harness@claude-code-harness at project scope
#   3. Install codex@openai-codex at project scope
#   4. Scaffold harness.config.json from the repo template if missing
#
# After the script finishes, restart Claude Code so that the hook dispatcher
# is loaded into the session.

set -euo pipefail

PROJECT_ROOT="$(pwd)"
HARNESS_REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS_SLUG="ThomasEdwardYorke/claude-code-harness"
CODEX_SLUG="openai/codex-plugin-cc"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found on PATH" >&2
  exit 1
fi

echo "==> Target project: ${PROJECT_ROOT}"
echo "==> Harness repo:   ${HARNESS_REPO}"
echo ""

# 1. Marketplaces — 2nd add on an already-registered slug is a no-op warning,
#    so we pipe through `|| true` to keep the script idempotent.
echo "==> Adding marketplaces (ignored if already registered)..."
claude plugin marketplace add "${HARNESS_SLUG}" 2>&1 | tail -1 || true
claude plugin marketplace add "${CODEX_SLUG}"   2>&1 | tail -1 || true
echo ""

# 2. Plugins
echo "==> Installing harness@claude-code-harness (scope: project)..."
claude plugin install harness@claude-code-harness --scope project

echo "==> Installing codex@openai-codex (scope: project)..."
claude plugin install codex@openai-codex --scope project
echo ""

# 3. harness.config.json
CONFIG_FILE="${PROJECT_ROOT}/harness.config.json"
TEMPLATE="${HARNESS_REPO}/template/.claude/harness.config.json.tmpl"
if [ -f "${CONFIG_FILE}" ]; then
  echo "==> harness.config.json already exists; leaving it untouched."
elif [ -f "${TEMPLATE}" ]; then
  PROJECT_NAME="$(basename "${PROJECT_ROOT}")"
  sed "s|{{PROJECT_NAME}}|${PROJECT_NAME}|g" "${TEMPLATE}" > "${CONFIG_FILE}"
  echo "==> Wrote ${CONFIG_FILE} (projectName=${PROJECT_NAME})"
else
  echo "warning: template not found at ${TEMPLATE}; skipping config scaffold" >&2
fi

echo ""
echo "✔ Installation complete."
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code so the hooks are loaded."
echo "  2. Run '/harness-setup localize' to tune harness.config.json."
echo "  3. Verify with 'claude plugin list' — both plugins should be 'enabled'."
