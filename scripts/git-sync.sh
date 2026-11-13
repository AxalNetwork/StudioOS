#!/usr/bin/env bash
#
# scripts/git-sync.sh
#
# Single entry point for "make Sync UI happy". Picks the right tool
# based on the current state of the repo:
#
#   - clean tree, fast-forward push           → scripts/git-push.sh
#   - clean tree, behind upstream             → scripts/sync-reconcile.sh
#   - dirty tree                              → prints what to commit
#
# Usage:
#   bash scripts/git-sync.sh                # interactive
#   bash scripts/git-sync.sh --auto         # non-interactive
#
# Recovery from anything this script does is via the tag the underlying
# scripts create; see scripts/sync-reconcile.sh for the recovery command.
#
set -euo pipefail

AUTO=0
for arg in "$@"; do
  case "$arg" in
    --auto) AUTO=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
HERE="$(dirname "$0")"

# Dirty tree → bail loudly. We never want git-sync.sh to silently
# stash, because that's a class of bug that's hard to recover from.
if [ -n "$(git --no-optional-locks status --porcelain)" ]; then
  echo "✗ working tree is dirty. Commit or stash, then re-run." >&2
  git --no-optional-locks status --short >&2
  exit 1
fi

# Are we behind origin/main? If we can't fetch (sandbox-blocked), ask
# GitHub via REST so we still get an accurate count.
behind=0
if git --no-optional-locks fetch --quiet origin main 2>/dev/null; then
  behind=$(git --no-optional-locks rev-list --count HEAD..origin/main)
else
  remote_url=$(git config --get remote.origin.url)
  slug=$(echo "$remote_url" | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    upstream_sha=$(curl -sS -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      "https://api.github.com/repos/${slug}/git/ref/heads/main" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('object',{}).get('sha',''))" 2>/dev/null || true)
    local_origin_sha=$(git --no-optional-locks rev-parse origin/main 2>/dev/null || echo "")
    if [ -n "$upstream_sha" ] && [ "$upstream_sha" != "$local_origin_sha" ]; then
      behind=1  # we know it's nonzero; exact count requires fetch
    fi
  fi
fi

if [ "$behind" -gt 0 ]; then
  echo "→ origin/main is ahead of local; running sync-reconcile"
  if [ "$AUTO" = "1" ]; then
    bash "$HERE/sync-reconcile.sh" --auto-squash
  else
    bash "$HERE/sync-reconcile.sh"
  fi
  exit $?
fi

# Fast-forward push case.
exec bash "$HERE/git-push.sh"
