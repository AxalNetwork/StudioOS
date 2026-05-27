#!/usr/bin/env bash
#
# scripts/git-push.sh
#
# Push local commits to origin/main, automatically picking the right
# credential path based on whether any pending commit touches
# .github/workflows/*.
#
# Why this exists:
#   Replit's built-in GitHub OAuth app does NOT request the `workflow`
#   scope. Any commit that touches `.github/workflows/*` is rejected by
#   GitHub:
#       refusing to allow an OAuth App to create or update workflow
#       `.github/workflows/<file>` without `workflow` scope
#   The repo's GITHUB_TOKEN secret DOES have workflow scope, so we use
#   it as a fallback for those commits. Plain commits go through the
#   default origin remote (Replit's OAuth path) to keep Sync UI happy.
#
# Usage:
#   bash scripts/git-push.sh                # auto-detect, push to main
#   bash scripts/git-push.sh --force-with-lease   # safe force push
#   bash scripts/git-push.sh --dry-run      # show what would happen
#   bash scripts/git-push.sh --use-token    # force GITHUB_TOKEN path even
#                                           # for non-workflow commits;
#                                           # use this when the Replit
#                                           # OAuth push hangs / times out
#
# Exit codes:
#   0  pushed (or nothing to push)
#   1  generic error
#   2  workflow commits present (or --use-token passed) but GITHUB_TOKEN
#      is not set
#
set -euo pipefail

DRY_RUN=0
FORCE_WITH_LEASE=0
FORCE_TOKEN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force-with-lease) FORCE_WITH_LEASE=1 ;;
    --use-token) FORCE_TOKEN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "✗ not on main (on '$BRANCH'); refusing to push" >&2
  exit 1
fi

# Find unpushed commits. If `origin/main` ref is stale, fall back to
# asking GitHub for the current upstream tip — sandbox sometimes blocks
# `git fetch`. We don't need the full fetch; just the SHA.
remote_url=$(git config --get remote.origin.url)
slug=$(echo "$remote_url" | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')
owner=${slug%%/*}
repo=${slug##*/}

unpushed_range="origin/main..HEAD"
unpushed_count=$(git --no-optional-locks rev-list --count "$unpushed_range" 2>/dev/null || echo 0)
if [ "$unpushed_count" = "0" ]; then
  echo "✓ nothing to push (origin/main == HEAD)"
  exit 0
fi

echo "→ $unpushed_count commit(s) to push:"
git --no-optional-locks log --oneline "$unpushed_range"

# Does any pending commit touch a workflow file?
touched_workflows=$(git --no-optional-locks diff --name-only "$unpushed_range" -- '.github/workflows/' | head -20 || true)
needs_workflow_scope=0
if [ -n "$touched_workflows" ]; then
  needs_workflow_scope=1
  echo
  echo "→ pending commits touch .github/workflows/:"
  echo "$touched_workflows" | sed 's/^/    /'
fi

# Pick credential path.
remote_for_push="origin"
if [ "$needs_workflow_scope" = "1" ] || [ "$FORCE_TOKEN" = "1" ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo
    if [ "$FORCE_TOKEN" = "1" ]; then
      echo "✗ --use-token requires GITHUB_TOKEN to be set as a Replit Secret." >&2
    else
      echo "✗ pending commits touch .github/workflows/ but GITHUB_TOKEN is not set." >&2
      echo "  Set it as a Replit Secret with 'repo' + 'workflow' scopes, then retry." >&2
      echo "  (Replit's built-in OAuth lacks the 'workflow' scope and will be rejected.)" >&2
    fi
    exit 2
  fi
  remote_for_push="https://x-access-token:${GITHUB_TOKEN}@github.com/${owner}/${repo}"
  if [ "$needs_workflow_scope" = "1" ]; then
    echo "→ using GITHUB_TOKEN (workflow scope) for this push"
  else
    echo "→ using GITHUB_TOKEN (--use-token override; bypassing Replit OAuth path)"
  fi
else
  echo "→ using default 'origin' remote (Replit OAuth path)"
fi

push_args=("$remote_for_push" "main")
if [ "$FORCE_WITH_LEASE" = "1" ]; then
  upstream_sha=$(git --no-optional-locks rev-parse origin/main)
  push_args=("--force-with-lease=main:${upstream_sha}" "$remote_for_push" "main")
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "[dry-run] would run: git push ${push_args[*]/${GITHUB_TOKEN:-__TOKEN__}/<TOKEN>}"
  exit 0
fi

echo
git push "${push_args[@]}"
echo "✓ push complete"
