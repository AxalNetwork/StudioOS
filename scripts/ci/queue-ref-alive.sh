#!/usr/bin/env bash
# Git distinguishes a missing ref (2) from an unavailable remote.
set -u

if git ls-remote --exit-code --refs origin "${GITHUB_REF:?GITHUB_REF must name the queue ref}" >/dev/null; then
  exit 0
else
  status=$?
fi

if [[ $status -eq 2 ]]; then
  if [[ ${GITHUB_EVENT_NAME:-} == merge_group &&
        ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]*$ &&
        ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]*$ &&
        ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ &&
        $GITHUB_REF =~ ^refs/heads/gh-readonly-queue/main/pr-[1-9][0-9]*-[a-f0-9]{40}$ ]]; then
    echo "::notice title=StudioOS queue outcome v1::ref-lost $GITHUB_RUN_ID $GITHUB_RUN_ATTEMPT $GITHUB_SHA $GITHUB_REF"
  fi
  echo "::error::The merge queue ref no longer exists."
  exit 2
fi

echo "::notice::Could not check the merge queue ref (git exit $status). Continuing."
