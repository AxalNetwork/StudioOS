#!/usr/bin/env bash
# D5398: install the real age CLI for D4558 encryption tests without an
# ubuntu apt mirror. The upstream release is pinned by version + SHA256,
# verified against GitHub's v1.3.2 release asset digest on 2026-11-11.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "Unsupported runner platform for pinned age installation" >&2
  exit 1
fi

version="1.3.2"
digest="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"
archive_name="age-v${version}-linux-amd64.tar.gz"
release_url="https://github.com/FiloSottile/age/releases/download/v${version}/${archive_name}"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
  --connect-timeout 15 --max-time 120 \
  --output "$staging/$archive_name" "$release_url"
printf '%s  %s\n' "$digest" "$staging/$archive_name" | sha256sum --check --status

tar -xzf "$staging/$archive_name" -C "$staging" age/age age/age-keygen
install_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/age-bin"
mkdir -p "$install_dir"
install -m 0755 "$staging/age/age" "$install_dir/age"
install -m 0755 "$staging/age/age-keygen" "$install_dir/age-keygen"
"$install_dir/age" --version
echo "$install_dir" >> "${GITHUB_PATH:?GITHUB_PATH is required}"
