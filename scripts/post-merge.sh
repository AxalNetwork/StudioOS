#!/bin/bash
# Replit post-merge hook: installs the Python dependencies (uv, else pip) and
# the frontend and worker npm packages after a merge.
set -e

if [ -f pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  UV_PROJECT_ENVIRONMENT=.venv uv sync --frozen 2>/dev/null || UV_PROJECT_ENVIRONMENT=.venv uv sync
elif [ -f requirements.txt ]; then
  pip install -q -r requirements.txt
fi

if [ -f frontend/package.json ]; then
  (cd frontend && npm install --no-audit --no-fund --silent)
fi

if [ -f cloudflare-worker/package.json ]; then
  (cd cloudflare-worker && npm install --no-audit --no-fund --silent)
fi
