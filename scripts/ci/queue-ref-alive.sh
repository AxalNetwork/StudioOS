#!/usr/bin/env bash
# Git distinguishes a missing ref (2) from an unavailable remote.
set -u

if git ls-remote --exit-code --refs origin "${GITHUB_REF:?GITHUB_REF must name the queue ref}" >/dev/null; then
  exit 0
else
  status=$?
fi

if [[ $status -eq 2 ]]; then
  echo "::error::The merge queue ref no longer exists."
  exit 2
fi

echo "::notice::Could not check the merge queue ref (git exit $status). Continuing."
