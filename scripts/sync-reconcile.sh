#!/usr/bin/env bash
#
# scripts/sync-reconcile.sh
#
# Reconcile local main with origin/main when Replit's Sync UI shows a
# big stack of duplicate task-merge commits and a PUSH_REJECTED error.
#
# Designed to be safe to re-run: it tags a recovery point before doing
# anything destructive, and uses --force-with-lease (NOT --force).
#
# Usage:
#   bash scripts/sync-reconcile.sh                 # interactive
#   bash scripts/sync-reconcile.sh --auto-squash   # non-interactive
#
# What it does (in order):
#   1. Verifies the working tree is clean.
#   2. Tags HEAD as `pre-sync-reconcile-YYYYMMDD-HHMMSS` for easy recovery.
#   3. `git fetch origin main`.
#   4. Prints the ahead/behind counts and the upstream commit list so you
#      can sanity-check before continuing.
#   5. Soft-resets HEAD to origin/main (working tree preserved) so all
#      local divergence collapses into the index.
#   6. Restores lockfiles + workflow files from origin/main (takes
#      Dependabot's upstream version of package-lock.json, requirements.txt,
#      and .github/workflows/*).
#   7. Re-runs `npm install` in each workspace so node_modules match the
#      restored lockfile.
#   8. Commits everything as ONE consolidated commit.
#   9. Runs `npm run test:drift` — aborts on failure.
#  10. Pushes with --force-with-lease (safe against concurrent pushes).
#
# Recovery from any step:
#   git reset --hard pre-sync-reconcile-YYYYMMDD-HHMMSS
#
set -euo pipefail

AUTO_SQUASH=0
for arg in "$@"; do
  case "$arg" in
    --auto-squash) AUTO_SQUASH=1 ;;
    *) echo "unknown arg: $arg"; exit 2 ;;
  esac
done

confirm() {
  if [ "$AUTO_SQUASH" -eq 1 ]; then return 0; fi
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# 1. clean tree
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ working tree is dirty. Commit or stash first." >&2
  exit 1
fi

# 2. recovery tag
TAG="pre-sync-reconcile-$(date -u +%Y%m%dT%H%M%SZ)"
git tag "$TAG"
echo "✓ tagged HEAD as $TAG (recover with: git reset --hard $TAG)"

# 3. fetch
git fetch origin main
LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse origin/main)
AHEAD=$(git rev-list --count "$UPSTREAM..$LOCAL")
BEHIND=$(git rev-list --count "$LOCAL..$UPSTREAM")
echo "✓ HEAD: $LOCAL"
echo "✓ origin/main: $UPSTREAM"
echo "  ahead: $AHEAD  behind: $BEHIND"

# 4. show upstream commits
echo
echo "Upstream commits we are integrating ($BEHIND):"
git --no-pager log --oneline "$LOCAL..$UPSTREAM"
echo
echo "Local commits being squashed ($AHEAD):"
git --no-pager log --oneline "$UPSTREAM..$LOCAL"
echo

confirm "Continue with soft-reset to origin/main and squash?" || { echo "aborted."; exit 0; }

# 5. soft reset — working tree preserved, index now diffs against upstream
git reset --soft "$UPSTREAM"

# 6. take upstream's version of dependency / CI files
UPSTREAM_FILES=(
  requirements.txt
  package.json
  package-lock.json
  frontend/package.json
  frontend/package-lock.json
  cloudflare-worker/package.json
  cloudflare-worker/package-lock.json
)
for f in "${UPSTREAM_FILES[@]}"; do
  if git cat-file -e "$UPSTREAM:$f" 2>/dev/null; then
    git checkout "$UPSTREAM" -- "$f"
  fi
done
# all .github/workflows/*
git checkout "$UPSTREAM" -- .github/workflows/ 2>/dev/null || true
echo "✓ took upstream versions of lockfiles + workflows"

# 7. regen node_modules so they match the upstream lockfile
if confirm "Run npm install in root, frontend, cloudflare-worker?"; then
  (cd "$(git rev-parse --show-toplevel)"          && npm ci --no-audit --no-fund)
  (cd "$(git rev-parse --show-toplevel)/frontend" && npm ci --no-audit --no-fund)
  (cd "$(git rev-parse --show-toplevel)/cloudflare-worker" && npm ci --no-audit --no-fund)
fi

# 8. one consolidated commit
MSG_FILE=$(mktemp)
cat > "$MSG_FILE" <<EOF
Consolidate local task merges onto origin/main

Squashes $AHEAD local task-merge commits (many duplicates from the task
pipeline replaying the same change multiple times) into a single commit
on top of origin/main, and integrates $BEHIND upstream Dependabot bumps.

Files where upstream's version was preferred: requirements.txt, root
+ frontend + cloudflare-worker package.json/package-lock.json, and
.github/workflows/*. All other files are the local working tree.

Recovery tag: $TAG
EOF
git add -A
git commit -F "$MSG_FILE"
rm -f "$MSG_FILE"

# 9. drift
npm run test:drift

# 10. push
confirm "Push with --force-with-lease=main:$LOCAL?" || { echo "stopped before push."; exit 0; }
git push --force-with-lease="main:$LOCAL" origin main

echo
echo "✓ done. Sync UI should now show 0 commits to push."
echo "  recovery tag (if you need to undo): $TAG"
