#!/bin/bash
set -e

if [ -f pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  uv sync --frozen 2>/dev/null || uv sync
elif [ -f requirements.txt ]; then
  pip install -q -r requirements.txt
fi

if [ -f frontend/package.json ]; then
  (cd frontend && npm install --no-audit --no-fund --silent)
fi

if [ -f cloudflare-worker/package.json ]; then
  (cd cloudflare-worker && npm install --no-audit --no-fund --silent)
fi
