#!/usr/bin/env bash
# Bootstrap guard for any Claude Code invocation (Replit shell + GitHub
# Actions). Verifies that ANTHROPIC_API_KEY is present and non-empty,
# and prints a human-readable remediation message if not.
#
# Exit codes:
#   0 — key is present (length only is logged, never the value)
#   1 — key is missing or empty
#
# Usage:
#   bash scripts/check-anthropic-key.sh
#   npm run claude:check
set -euo pipefail

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  cat >&2 <<'EOF'
ERROR: ANTHROPIC_API_KEY is not set.

Claude Code in this repo authenticates with an Anthropic API key
(NOT a Claude.ai subscription — that path is disabled at the
organization level for this account).

To fix:

  Replit:
    1. Open the Secrets pane (lock icon in the left sidebar).
    2. Add a new secret named ANTHROPIC_API_KEY.
    3. Paste the API key from https://console.anthropic.com/settings/keys
    4. Restart the workflow / open a new shell so the env var loads.

  GitHub Actions:
    1. Repo → Settings → Secrets and variables → Actions → New repository secret.
    2. Name: ANTHROPIC_API_KEY
    3. Value: the API key from the Anthropic console.
    4. Save. The next workflow run will pick it up.

  Local shell (one-off):
    export ANTHROPIC_API_KEY="sk-ant-…"

See docs/claude-code-setup.md for the full walkthrough and how to
diagnose auth issues.
EOF
  exit 1
fi

# Don't print the key — only its length, so we can confirm it loaded
# without leaking the value into CI logs.
key_len=${#ANTHROPIC_API_KEY}
echo "ANTHROPIC_API_KEY detected (length=${key_len})."
