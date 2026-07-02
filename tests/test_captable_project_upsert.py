"""Task #30 — one-cap-table-per-project, end-to-end (FastAPI dev path).

Drives the *real* FastAPI app through TestClient with an isolated in-memory
SQLite session and a stubbed admin user, proving the user-visible guarantee
behind Task #28: selecting a project, saving a scenario, then editing and
saving again UPSERTS a single `cap_table_scenarios` row — it never creates a
duplicate. Also exercises the `?project=` deep-link bootstrap endpoint
(`GET /scenarios/by-project/{id}`) the CapTablePage calls on load.

The Worker (D1) path has a parallel regression in
`cloudflare-worker/test/captable_project_upsert.test.ts`.

Run with: `uv run pytest tests/test_captable_project_upsert.py`
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.main import app
from backend.app.models.entities import CapTableScenario, Project, User, UserRole

ADMIN_ID = 1
PROJECT_ID = 1

# Two valid, distinct cap-table inputs (pass validate_inputs): a single founder,
# then a co-founder added on the "edit" save so the second save changes content.
INPUTS_V1 = {"founders": [{"name": "Ada", "shares": 8_000_000}], "option_pool_pct": 10}
INPUTS_V2 = {
    "founders": [
        {"name": "Ada", "shares": 8_000_000},
        {"name": "Grace", "shares": 2_000_000},
    ],
    "option_pool_pct": 10,
}

# Admin bypasses tier gating and passes every cap-table access check, keeping
# the test focused on the upsert behaviour rather than the auth matrix (which
# is already covered by captableAccess.test.ts).
ADMIN = User(id=ADMIN_ID, email="admin@example.com", name="Admin", role=UserRole.ADMIN, is_active=True)


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


def _rows_for_project(engine, project_id: int):
    with Session(engine) as s:
        return s.exec(
            select(CapTableScenario).where(CapTableScenario.project_id == project_id)
        ).all()


def test_post_upsert_keeps_exactly_one_scenario_per_project(env):
    client, engine = env

    # 1. Deep-link bootstrap on first load: the project has no cap table yet.
    r = client.get(f"/api/captable/scenarios/by-project/{PROJECT_ID}")
    assert r.status_code == 200
    assert r.json()["scenario"] is None

    # 2. Save #1 — the frontend always saves through the POST upsert.
    r = client.post(
        "/api/captable/scenarios",
        json={"name": "Seed plan", "project_id": PROJECT_ID, "inputs": INPUTS_V1},
    )
    assert r.status_code == 200, r.text
    created = r.json()
    uid1 = created["uid"]
    assert created["project_id"] == PROJECT_ID
    assert created["result"] is not None
    assert len(_rows_for_project(engine, PROJECT_ID)) == 1

    # 3. Deep-link bootstrap reload now finds the saved table.
    r = client.get(f"/api/captable/scenarios/by-project/{PROJECT_ID}")
    assert r.json()["scenario"]["uid"] == uid1

    # 4. Save #2 — edit (add a co-founder) and save again for the SAME project.
    r = client.post(
        "/api/captable/scenarios",
        json={"name": "Seed plan v2", "project_id": PROJECT_ID, "inputs": INPUTS_V2},
    )
    assert r.status_code == 200, r.text
    updated = r.json()

    # 5. Still exactly ONE row for the project; uid is stable; content updated.
    rows = _rows_for_project(engine, PROJECT_ID)
    assert len(rows) == 1
    assert rows[0].uid == uid1
    assert updated["uid"] == uid1
    assert updated["name"] == "Seed plan v2"
    assert len(json.loads(rows[0].inputs_json)["founders"]) == 2

    # 6. by-project bootstrap returns the single, updated row.
    r = client.get(f"/api/captable/scenarios/by-project/{PROJECT_ID}")
    boot = r.json()["scenario"]
    assert boot["uid"] == uid1
    assert boot["name"] == "Seed plan v2"


def test_put_refuses_binding_a_second_scenario_to_a_used_project(env):
    """The other duplicate path: a PUT that tries to bind a free scenario to a
    project that already has a cap table must 409 and leave the row unbound."""
    client, engine = env

    with Session(engine) as s:
        bound = CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Bound",
            inputs_json=json.dumps(INPUTS_V1), result_json="{}",
        )
        free = CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=None, name="Free",
            inputs_json=json.dumps(INPUTS_V1), result_json="{}",
        )
        s.add(bound)
        s.add(free)
        s.commit()
        s.refresh(free)
        free_uid = free.uid

    r = client.put(
        f"/api/captable/scenarios/{free_uid}",
        json={"name": "Free", "project_id": PROJECT_ID, "inputs": INPUTS_V1},
    )
    assert r.status_code == 409, r.text
    # The dev FastAPI app reshapes HTTPException into {"ok": false, "error": {...}}.
    assert r.json()["error"]["error_code"] == "project_has_cap_table"

    # The free scenario stayed unbound and no duplicate was created.
    assert len(_rows_for_project(engine, PROJECT_ID)) == 1
    with Session(engine) as s:
        still_free = s.exec(
            select(CapTableScenario).where(CapTableScenario.uid == free_uid)
        ).first()
    assert still_free.project_id is None


def test_db_rejects_second_canonical_but_allows_variants(env):
    """Task #32 — the partial unique index enforces one canonical cap table per
    project at the DB level, while draft variants (is_variant=1) coexist freely.
    This is the guarantee the app-code upsert can't make under real concurrency."""
    client, engine = env

    with Session(engine) as s:
        s.add(CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Canonical",
            inputs_json=json.dumps(INPUTS_V1),
        ))
        s.commit()

    # A SECOND canonical for the same project is rejected by the unique index.
    with Session(engine) as s:
        s.add(CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Dupe",
            inputs_json=json.dumps(INPUTS_V1),
        ))
        with pytest.raises(IntegrityError):
            s.commit()
        s.rollback()

    # Variants (is_variant=1) are NOT blocked — many can share the project.
    with Session(engine) as s:
        s.add(CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Variant A",
            inputs_json=json.dumps(INPUTS_V1), is_variant=1,
        ))
        s.add(CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Variant B",
            inputs_json=json.dumps(INPUTS_V1), is_variant=1,
        ))
        s.commit()  # must not raise

    rows = _rows_for_project(engine, PROJECT_ID)
    assert sum(1 for r in rows if not r.is_variant) == 1
    assert sum(1 for r in rows if r.is_variant) == 2


def test_concurrent_create_resolves_to_single_row(env, monkeypatch):
    """Task #32 — two near-simultaneous saves for the same project must resolve to
    ONE canonical row. Simulate the race: the winner's row already exists, but OUR
    request's pre-check reads a stale snapshot (returns None), so it takes the
    INSERT path and collides with the partial unique index. The endpoint must
    recover by editing the winner — 200, not 500 — leaving exactly one row."""
    import backend.app.api.routes.captable as cap

    client, engine = env

    # The race winner: a canonical row already committed for the project.
    with Session(engine) as s:
        winner = CapTableScenario(
            owner_user_id=ADMIN_ID, project_id=PROJECT_ID, name="Winner",
            inputs_json=json.dumps(INPUTS_V1), result_json="{}",
        )
        s.add(winner); s.commit(); s.refresh(winner)
        winner_uid = winner.uid

    # Force the create endpoint's canonical pre-check to MISS once (stale read),
    # so it attempts the INSERT the DB unique index rejects. The recovery
    # re-lookup (2nd call) sees the real winner.
    real = cap._find_canonical_for_project
    calls = {"n": 0}

    def flaky(session, project_id):
        calls["n"] += 1
        if calls["n"] == 1:
            return None
        return real(session, project_id)

    monkeypatch.setattr(cap, "_find_canonical_for_project", flaky)

    r = client.post(
        "/api/captable/scenarios",
        json={"name": "Loser save", "project_id": PROJECT_ID, "inputs": INPUTS_V2},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Recovered by editing the winner: same uid, content updated to our payload.
    assert body["uid"] == winner_uid
    assert body["name"] == "Loser save"
    assert len(body["inputs"]["founders"]) == 2

    # Exactly ONE canonical row for the project — the race created no duplicate.
    rows = _rows_for_project(engine, PROJECT_ID)
    assert len(rows) == 1
    assert rows[0].uid == winner_uid
