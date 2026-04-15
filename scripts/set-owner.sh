#!/usr/bin/env bash
# scripts/set-owner.sh — substitute the `OWNER` placeholder throughout the
# repo with your real GitHub user/org name.
#
# Usage:
#   scripts/set-owner.sh <owner>
#
# Example:
#   scripts/set-owner.sh my-github-user

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <owner>" >&2
  exit 2
fi

OWNER="$1"

if [ -z "$OWNER" ]; then
  echo "error: owner must be non-empty" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# Files that reference the placeholder. Keep the list explicit so we don't
# accidentally substitute strings in user-authored code under protected-data/ etc.
FILES=(
  "CHANGELOG.md"
  "plugins/harness/schemas/harness.config.schema.json"
  "plugins/harness/.claude-plugin/plugin.json"
  "template/README.md"
  "template/.claude/harness.config.json.tmpl"
  "docs/en/configuration.md"
  "docs/en/development.md"
  "docs/en/installation.md"
  "docs/en/migration-from-v2.md"
  "docs/ja/installation.md"
  "README.md"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    # macOS and BSD sed require `-i ''`; Linux accepts `-i`.
    if sed --version >/dev/null 2>&1; then
      sed -i "s|OWNER/claude-code-harness|${OWNER}/claude-code-harness|g" "$f"
    else
      sed -i '' "s|OWNER/claude-code-harness|${OWNER}/claude-code-harness|g" "$f"
    fi
    echo "rewrote $f"
  fi
done

echo ""
echo "Done. Check the diff:"
echo "  git diff"
