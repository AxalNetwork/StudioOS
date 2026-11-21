#!/usr/bin/env bash
# #6674: load timings only from an eligible main artifact with a verified numeric ID.
set -euo pipefail

tmp=$(mktemp -d "${RUNNER_TEMP:?}/test-timings.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
rm -f test-timings.json

if ! gh api "repos/${REPO:?}/commits?sha=main&per_page=100" > "$tmp/commits.json" ||
   ! gh api "repos/$REPO/actions/artifacts?per_page=100" > "$tmp/artifacts.json"; then
  echo '::warning::Could not query main timing artifacts. Using equal weights.'
  exit 0
fi

if ! artifact=$(node scripts/test-drift-parts.mjs --main-artifact "$tmp/artifacts.json" "$tmp/commits.json"); then
  echo '::error::Invalid main timing artifact selector input.'
  exit 1
fi
if [[ -z $artifact ]]; then
  echo '::notice::No eligible main timing artifact. Using equal weights.'
  exit 0
fi
if [[ ! $artifact =~ ^[1-9][0-9]*$ ]]; then
  echo '::error::Invalid main timing artifact selector output.'
  exit 1
fi

if ! gh api "repos/$REPO/actions/artifacts/$artifact/zip" > "$tmp/timings.zip"; then
  echo "::warning::Timing artifact $artifact could not be downloaded. Using equal weights."
  exit 0
fi
unzip -p "$tmp/timings.zip" test-timings.json > "$tmp/test-timings.json"
mv "$tmp/test-timings.json" test-timings.json
echo "Using main timing artifact $artifact."
