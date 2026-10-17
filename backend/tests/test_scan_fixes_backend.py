"""Code-scanning fixes in the dev FastAPI, pinned by behaviour.

- LinkedIn import (py/full-ssrf): the photo fetched is the URL stored at the
  OAuth callback, never the one in the request body.
- delete_project (avoid-sqlalchemy-text): the referencing-row DELETEs are
  SQLAlchemy Core, and still quote the identifiers that need it.
- Run-once flags (py/unused-global-variable): a dict entry, as D476 did for
  settings.py, still skips the work on the second call.
- auth.py (py/cyclic-import): it imports the two helpers it needs from
  services/, not from routers that import it back.
"""
import ast
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from backend.app.api.routes import (
    brand,
    captable,
    contacts,
    decks,
    email as email_routes,
    follows,
    investor_signals,
    onboarding,
    personas,
    progress,
    projects,
    settings,
    tickets,
)
from backend.app.services import cf_access, settings_schema

ROOT = Path(__file__).resolve().parents[2]


class _Result:
    def __init__(self, first=None, rows=()):
        self._first = first
        self._rows = list(rows)

    def first(self):
        return self._first

    def all(self):
        return self._rows

    def fetchall(self):
        return self._rows

    def scalar(self):
        return None

    def __iter__(self):
        return iter(self._rows)


class _Counting:
    """A session that accepts every statement and counts them."""

    def __init__(self):
        self.statements = 0

    def exec(self, *_a, **_k):
        self.statements += 1
        return _Result()

    execute = exec

    def commit(self):
        pass

    def rollback(self):
        pass


# --- LinkedIn photo: the server fetches only what it stored ------------------

STORED = "https://media.licdn.com/dms/image/v2/stored-at-oauth/profile.jpg"


class _PhotoSession(_Counting):
    def __init__(self, stored):
        super().__init__()
        self.stored = stored

    def exec(self, *_a, **_k):
        self.statements += 1
        return _Result(first=SimpleNamespace(_mapping={"linkedin_picture_url": self.stored}))


@pytest.fixture
def fetched(monkeypatch):
    urls = []
    monkeypatch.setattr(settings, "_ensure_schema", lambda _s: None)
    monkeypatch.setattr(settings, "_load_extras", lambda _s, _uid: {"personal": {}})

    def _fake_apply(_session, _user, url):
        urls.append(url)
        return True

    monkeypatch.setattr(settings, "_apply_linkedin_photo", _fake_apply)
    return urls


def _apply(photo_url, stored):
    resp = settings.linkedin_import_apply(
        payload={"photo_url": photo_url},
        user=SimpleNamespace(id=7),
        session=_PhotoSession(stored),
    )
    return json.loads(resp.body)


def test_the_photo_offered_by_the_preview_is_fetched_from_the_stored_url(fetched):
    body = _apply(STORED, STORED)
    assert fetched == [STORED]
    assert body["photo_applied"] is True and "photo" in body["applied"]


def test_a_request_body_cannot_choose_another_linkedin_url(fetched):
    other = "https://www.linkedin.com/redir/redirect?url=http%3A%2F%2F169.254.169.254%2F"
    body = _apply(other, STORED)
    assert fetched == []
    assert body["photo_applied"] is False and "photo" not in body["applied"]


def test_no_photo_is_fetched_when_none_was_stored(fetched):
    body = _apply(STORED, None)
    assert fetched == []
    assert body["photo_applied"] is False


# --- delete_project: Core DELETEs, identifiers quoted by the dialect ----------


class _DeleteSession:
    def __init__(self, fk_rows):
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
        self._fk_rows = fk_rows
        self.deletes = []
        self.deleted = None

    def get(self, _model, project_id):
        return SimpleNamespace(id=project_id)

    def execute(self, stmt, *_a):
        if not self.deletes and self._fk_rows is not None:
            rows, self._fk_rows = self._fk_rows, None
            return _Result(rows=rows)
        self.deletes.append(stmt)
        return _Result()

    def delete(self, obj):
        self.deleted = obj

    def commit(self):
        pass

    def rollback(self):
        raise AssertionError("rollback")


def test_delete_project_removes_each_referencing_row_with_quoted_identifiers():
    session = _DeleteSession([("project_members", "project_id"), ("FounderNotes", "project_id"), ("user", "Project Id")])
    assert projects.delete_project(5, session=session, admin=None) == {"ok": True}
    sql = [
        str(s.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        for s in session.deletes
    ]
    assert sql == [
        "DELETE FROM project_members WHERE project_members.project_id = 5",
        'DELETE FROM "FounderNotes" WHERE "FounderNotes".project_id = 5',
        'DELETE FROM "user" WHERE "user"."Project Id" = 5',
    ]
    assert session.deleted.id == 5


# --- run-once flags ------------------------------------------------------------

RUN_ONCE = [
    (brand, "_ensure_schema", "_schema_once", "brand"),
    (captable, "_ensure_schema", "_schema_once", "captable"),
    (contacts, "_ensure_schema", "_schema_once", "contacts"),
    (decks, "_ensure_schema", "_schema_once", "decks"),
    (follows, "_ensure_follows_schema", "_schema_once", "follows"),
    (investor_signals, "_ensure_schema", "_schema_once", "investor_profiles"),
    (onboarding, "_ensure_schema", "_schema_once", "onboarding"),
    (onboarding, "_ensure_checklist_schema", "_checklist_once", "checklist"),
    (personas, "_ensure_personas_schema", "_schema_once", "personas"),
    (progress, "_ensure_waitlist_crm_schema", "_schema_once", "waitlist_crm"),
    (tickets, "_ensure_type_column", "_schema_once", "ticket_type"),
    (settings_schema, "ensure_settings_schema", "_schema_once", "settings"),
]


@pytest.mark.parametrize("module,fn,flags,key", RUN_ONCE, ids=lambda v: getattr(v, "__name__", str(v)))
def test_a_schema_bootstrap_runs_once_then_skips(module, fn, flags, key, monkeypatch):
    monkeypatch.setitem(getattr(module, flags), key, False)
    first = _Counting()
    getattr(module, fn)(first)
    assert first.statements > 0
    assert getattr(module, flags)[key] is True
    second = _Counting()
    getattr(module, fn)(second)
    assert second.statements == 0


def test_settings_and_auth_share_one_settings_bootstrap():
    assert settings._ensure_schema is settings_schema.ensure_settings_schema


def test_the_cf_access_disabled_warning_is_logged_once(monkeypatch):
    monkeypatch.delenv("CF_ACCESS_TEAM_DOMAIN", raising=False)
    monkeypatch.delenv("CF_ACCESS_AUD", raising=False)
    monkeypatch.setitem(cf_access._warned_once, "disabled", False)
    logged = []
    monkeypatch.setattr(cf_access.logger, "warning", lambda *a, **_k: logged.append(a))
    assert cf_access.verify_cf_access_jwt(None) is None
    assert cf_access.verify_cf_access_jwt(None) is None
    assert len(logged) == 1


# --- referral fallback code ----------------------------------------------------


def test_the_fallback_referral_code_is_stable_per_user():
    a = SimpleNamespace(id=3, email="a@example.com", partner_id=None)
    b = SimpleNamespace(id=4, email="b@example.com", partner_id=None)
    code_a, link_a = email_routes._resolve_referral_for(a, session=None)
    assert re.fullmatch(r"AXAL-[0-9A-F]{8}", code_a)
    assert email_routes._resolve_referral_for(a, session=None)[0] == code_a
    assert email_routes._resolve_referral_for(b, session=None)[0] != code_a
    assert link_a.endswith(f"/register?ref={code_a}")


# --- import cycles -------------------------------------------------------------


def _imported_modules(path: Path) -> set:
    tree = ast.parse(path.read_text())
    return {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}


def test_auth_imports_no_router_that_imports_it_back():
    mods = _imported_modules(ROOT / "backend/app/api/routes/auth.py")
    assert "backend.app.api.routes.settings" not in mods
    assert "backend.app.api.routes.network_introductions" not in mods
    assert "backend.app.services.settings_schema" in mods
    assert "backend.app.services.network_intro_claim" in mods
    for lower in ("services/settings_schema.py", "services/network_intro_claim.py"):
        assert not any(m.startswith("backend.app.api") for m in _imported_modules(ROOT / "backend/app" / lower))


def test_the_claim_helper_has_one_definition():
    router = (ROOT / "backend/app/api/routes/network_introductions.py").read_text()
    assert "def claim_offplatform_introductions" not in router
