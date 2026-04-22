"""Phase A2 — pytest proving lp_investors / vc_fund entity writes are sealed.

These tests boot the real backend module so the SQLAlchemy event
listeners in `backend/app/services/db_guards.py` are installed exactly
the way they are at runtime. We then attempt the deprecated writes via
both ORM `session.add` AND raw SQL Core `session.execute(insert(...))`
to prove both layers are blocked.
"""
from __future__ import annotations

import pytest
from sqlalchemy import insert
from sqlmodel import Session

from backend.app import main as _backend_main  # noqa: F401  side-effect: install guards
from backend.app.database import engine
from backend.app.models.entities import Entity, EntityType, LPInvestor


def test_orm_insert_into_lp_investors_is_blocked():
    with Session(engine) as s:
        s.add(LPInvestor(name="Test LP", email="test-lp@example.com"))
        with pytest.raises(RuntimeError, match="lp_investors is read-only"):
            s.commit()
        s.rollback()


def test_orm_insert_entity_with_vc_fund_type_is_blocked():
    with Session(engine) as s:
        s.add(Entity(name="Block-me Fund", entity_type=EntityType.VC_FUND))
        with pytest.raises(RuntimeError, match="vc_fund.*deprecated"):
            s.commit()
        s.rollback()


def test_core_bulk_insert_into_lp_investors_is_blocked():
    """Core-level path bypasses ORM mapper events — `before_execute`
    must catch this."""
    with Session(engine) as s:
        with pytest.raises(RuntimeError, match="lp_investors is read-only"):
            s.execute(
                insert(LPInvestor).values(name="Core LP", email="core-lp@example.com")
            )
        s.rollback()


def test_core_bulk_insert_vc_fund_entity_is_blocked():
    with Session(engine) as s:
        with pytest.raises(RuntimeError, match="vc_fund.*deprecated"):
            s.execute(
                insert(Entity).values(name="Core Fund", entity_type="vc_fund")
            )
        s.rollback()
