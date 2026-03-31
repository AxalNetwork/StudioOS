#!/bin/bash
export PYTHONPATH=/home/runner/workspace/.pkgs:$PYTHONPATH
exec python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 5000
