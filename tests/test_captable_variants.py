"""Task #29/#36 — cap-table scenario variants (FastAPI dev path).

Mirror of the Worker (D1) regression in
`cloudflare-worker/test/captable_variants.test.ts` against the FastAPI dev API,
so a future edit to `backend/app/api/routes/captable.py` can't silently leak a
draft variant into the project's official cap table (or into the deck) in dev.

Locks the same invariant the Worker test does:

  - A draft variant (is_variant=1) is a fresh INSERT — creating one NEVER trips
    the project_has_cap_table (409) guard, even when the project already has a
    canonical cap table, and it stays a distinct row.
  - The canonical-only lookups (GET by-project, POST upsert) ignore variants, so
    the project's "one cap table" stays the canonical row even when a NEWER
    variant exists (the deck reads the same canonical-filtered SELECT).
  - GET compare returns the canonical row PLUS every variant.
  - An investor (project read, but no project write) cannot create a variant.

Run with: `uv run pytest tests/test_captable_variants.py`
"""
from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.main import app
from backend.app.models.entities import CapTableScenario, Project, User, UserRole

ADMIN_ID = 1
INVESTOR_ID = 2
PROJECT_ID = 1

# Two valid, distinct cap-table inputs (pass validate_inputs): the canonical
# single-founder table, then a co-founder split for the draft variant.
INPUTS_CANON = {"founders": [{"name": "Ada", "shares": 8_000_000}], "option_pool_pct": 10}
INPUTS_VARIANT = {
    "founders": [
        {"name": "Ada", "shares": 6_000_000},
        {"name": "Grace", "shares": 4_000_000},
    ],
    "option_pool_pct": 15,
}

# Admin passes every cap-table access check, keeping the variant tests focused on
# the canonical-vs-variant invariant rather than the auth matrix.
ADMIN = User(id=ADMIN_ID, email="admin@example.com", name="Admin", role=UserRole.ADMIN, is_active=True)
# Investor: can READ a project but has no project WRITE access, so must be
# blocked from minting a variant.
INVESTOR = User(id=INVESTOR_ID, email="lp@example.com", name="LP", role=UserRole.INVESTOR, is_active=True)


@pytest.fixture()
def env():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Project(id=PROJECT_ID, name="Acme", founder_id=7, stage="seed"))
        s.commit()

    def _override_session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    client = TestClient(app)
    try:
        yield client, engine
    finally:
        app.dependency_overrides.clear()


def _as(client_user: User) -> None:
    """Swap the authenticated principal for the remaining calls in a test."""
    app.dependency_overrides[get_current_user] = lambda: client_user


def _rows_for_project(engine, project_id: int):
    with Session(engine) as s:
        return s.exec(
            select(CapTableScenario).where(CapTableScenario.project_id == project_id)
        ).all()


def _seed_canonical(engine, **overrides) -> str:
    """Insert a canonical (is_variant=0) cap table for the project; return uid."""
    with Session(engine) as s:
        row = CapTableScenario(
            owner_user_id=ADMIN_ID,
            project_id=PROJECT_ID,
            name=overrides.get("name", "Canonical"),
            inputs_json=json.dumps(INPUTS_CANON),
            result_json="{}",
            is_variant=0,
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        return row.uid


def test_creating_a_variant_never_trips_409_and_stays_distinct(env):
    client, engine = env
    canon_uid = _seed_canonical(engine)

    r = client.post(
        f"/api/captable/scenarios/by-project/{PROJECT_ID}/variants",
        json={"name": "Aggressive raise", "inputs": INPUTS_VARIANT},
    )
    assert r.status_code == 200, r.text
    variant = r.json()
    assert variant["is_variant"] == 1, "serialized row marks it as a variant"
    assert variant["uid"] != canon_uid, "variant is a NEW row, not the canonical one"
    assert variant["result"] is not None

    # Two rows now: the original canonical + the new variant.
    rows = _rows_for_project(engine, PROJECT_ID)
    assert len(rows) == 2
    assert len([r for r in rows if not r.is_variant]) == 1
    assert len([r for r in rows if r.is_variant]) == 1


def test_canonical_lookups_ignore_a_newer_variant(env):
    client, engine = env
    # Canonical first, then a variant updated AFTER it — a naive "latest row"
    # lookup would wrongly pick the variant.
    canon_uid = _seed_canonical(engine, name="Canonical")
    with Session(engine) as s:
        canon = s.exec(
            select(CapTableScenario).where(CapTableScenario.uid == canon_uid)
        ).first()
        canon.updated_at = datetime.fromisoformat("2026-06-01T00:00:00")
        s.add(canon)
        variant = CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Newer variant",
            inputs_json=json.dumps(INPUTS_VARIANT), result_json="{}", is_variant=1,
        )
        variant.updated_at = datetime.fromisoformat("2026-06-28T00:00:00")
        s.add(variant)
        s.commit()

    # by-project (same canonical-filtered SELECT the deck's loadSimSegments uses).
    r = client.get(f"/api/captable/scenarios/by-project/{PROJECT_ID}")
    assert r.status_code == 200
    scen = r.json()["scenario"]
    assert scen["uid"] == canon_uid, "by-project returns the canonical row, not the newer variant"
    assert scen["is_variant"] == 0

    # POST upsert must UPDATE the canonical row in place — not the variant, and
    # not a brand-new row.
    r = client.post(
        "/api/captable/scenarios",
        json={"name": "Canonical edited", "project_id": PROJECT_ID, "inputs": INPUTS_CANON},
    )
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["uid"] == canon_uid, "upsert targets the canonical row"
    assert up["is_variant"] == 0

    # Still exactly two rows (one canonical, one variant) — no duplicate created.
    rows = _rows_for_project(engine, PROJECT_ID)
    assert len(rows) == 2
    assert len([r for r in rows if not r.is_variant]) == 1


def test_compare_returns_canonical_plus_every_variant(env):
    client, engine = env
    canon_uid = _seed_canonical(engine)
    with Session(engine) as s:
        for name in ("Variant A", "Variant B"):
            s.add(CapTableScenario(
                owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name=name,
                inputs_json=json.dumps(INPUTS_VARIANT), result_json="{}", is_variant=1,
            ))
        s.commit()

    r = client.get(f"/api/captable/scenarios/by-project/{PROJECT_ID}/compare")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["canonical"] is not None, "canonical present"
    assert body["canonical"]["uid"] == canon_uid
    assert body["canonical"]["is_variant"] == 0
    variant_names = sorted(v["name"] for v in body["variants"])
    assert variant_names == ["Variant A", "Variant B"]
    assert all(v["is_variant"] == 1 for v in body["variants"])


def test_investor_cannot_create_a_variant(env):
    client, engine = env
    _seed_canonical(engine)
    _as(INVESTOR)

    r = client.post(
        f"/api/captable/scenarios/by-project/{PROJECT_ID}/variants",
        json={"name": "Investor variant", "inputs": INPUTS_VARIANT},
    )
    assert r.status_code == 403, r.text

    # No variant row was created — only the seeded canonical remains.
    rows = _rows_for_project(engine, PROJECT_ID)
    assert len(rows) == 1
    assert not rows[0].is_variant
