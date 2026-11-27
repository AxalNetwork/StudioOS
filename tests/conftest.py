"""Shared pytest fixtures.

The db guards are normally installed by the FastAPI lifespan handler
when uvicorn boots; in pure-import test contexts that handler doesn't
run, so we call `install_db_guards()` here explicitly.
"""
import os

os.environ.setdefault("JWT_SECRET", "dev-secret-do-not-use-in-prod-aaaaaaaaaa")
os.environ.setdefault("STUDIOOS_ENV", "dev")

from backend.app.services.db_guards import install_db_guards  # noqa: E402

install_db_guards()
