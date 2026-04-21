#!/usr/bin/env bash
# scripts/install-project.sh — install the harness (and optionally the Codex
# companion) into the caller's current project directory.
#
# Usage (run from inside your project root):
#   bash ~/dev/claude-code-harness/scripts/install-project.sh
#   bash ~/dev/claude-code-harness/scripts/install-project.sh --with-codex
#   bash ~/dev/claude-code-harness/scripts/install-project.sh --help
#
# Flags:
#   --with-codex   Also install openai-codex companion plugin (enables the
#                  codex-sync / coderabbit-mimic agents). Default: skipped.
#   --help, -h     Show this help message.
#
# Steps performed:
#   1. Register the harness marketplace (idempotent)
#   2. Install harness@claude-code-harness at project scope
#   3. [opt-in] Register the codex marketplace + install codex@openai-codex
#   4. Scaffold harness.config.json from the repo template if missing
#
# After the script finishes, restart Claude Code so that the hook dispatcher
# is loaded into the session. Run `harness doctor` to verify the install.

set -euo pipefail

WITH_CODEX=0
for arg in "$@"; do
  case "$arg" in
    --with-codex)
      WITH_CODEX=1
      ;;
    --help|-h)
      sed -n '2,24p' "$0" | sed 's|^# \?||'
      exit 0
      ;;
    *)
      echo "error: unknown flag: $arg" >&2
      echo "run '$0 --help' for usage" >&2
      exit 2
      ;;
  esac
done

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
if [ "${WITH_CODEX}" -eq 1 ]; then
  echo "==> Codex companion: will install (--with-codex)"
else
  echo "==> Codex companion: skipped (pass --with-codex to enable)"
fi
echo ""

# 1. Marketplaces — 2nd add on an already-registered slug is a no-op warning,
#    so we pipe through `|| true` to keep the script idempotent.
echo "==> Adding harness marketplace (ignored if already registered)..."
claude plugin marketplace add "${HARNESS_SLUG}" 2>&1 | tail -1 || true
if [ "${WITH_CODEX}" -eq 1 ]; then
  echo "==> Adding codex marketplace (ignored if already registered)..."
  claude plugin marketplace add "${CODEX_SLUG}" 2>&1 | tail -1 || true
fi
echo ""

# 2. Harness plugin
echo "==> Installing harness@claude-code-harness (scope: project)..."
claude plugin install harness@claude-code-harness --scope project

# 3. Codex companion (opt-in)
if [ "${WITH_CODEX}" -eq 1 ]; then
  echo "==> Installing codex@openai-codex (scope: project)..."
  claude plugin install codex@openai-codex --scope project
else
  cat <<'EOF'

Note: codex@openai-codex was NOT installed.
      The codex-sync and coderabbit-mimic agents require it to run their
      Codex-powered flows. Re-run this script with --with-codex (or run
      `claude plugin install codex@openai-codex --scope project` manually)
      to enable them. Harness works without Codex; only those specific
      agents are degraded to no-ops.
EOF
fi
echo ""

# 4. harness.config.json
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
echo "  2. Run 'harness doctor' to verify the install + detect missing pieces."
echo "  3. Run '/harness-setup localize' to tune harness.config.json."
echo "  4. Verify with 'claude plugin list' — the installed plugin(s) should be 'enabled'."
