#!/bin/bash
set -e

echo "=== Installing Python dependencies ==="
mkdir -p /home/runner/workspace/.pkgs
python3 -m pip install --no-cache-dir --target /home/runner/workspace/.pkgs -r requirements.txt

echo "=== Building frontend ==="
cd frontend
npx vite build
cp -r ../docs ../static

echo "=== Build complete ==="
