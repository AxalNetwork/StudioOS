"""D476 — the two dev-only FastAPI findings, with the same checks as before."""
from pathlib import Path

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]

from backend.app.api.routes.settings import (
    _ensure_profile_extras_schema,
    _ensure_user_settings_schema,
    _schema_once,
)
from backend.app.api.routes.wellbeing import CheckinIn, ResourceIn


class _Ok:
    def __init__(self):
        self.execs = 0
        self.commits = 0

    def exec(self, *_a, **_k):
        self.execs += 1

    def commit(self):
        self.commits += 1

    def rollback(self):
        raise AssertionError("rollback")


class _Boom:
    def __init__(self):
        self.rollbacks = 0

    def exec(self, *_a, **_k):
        raise RuntimeError("no table")

    def commit(self):
        raise AssertionError("commit")

    def rollback(self):
        self.rollbacks += 1


def setup_function():
    _schema_once["user_settings"] = False
    _schema_once["profile_extras"] = False


def test_user_settings_schema_runs_once_even_when_the_statement_fails():
    first = _Boom()
    _ensure_user_settings_schema(first)
    assert first.rollbacks == 1
    assert _schema_once["user_settings"] is True
    second = _Ok()
    _ensure_user_settings_schema(second)
    assert second.execs == 0


def test_profile_extras_schema_retries_after_a_failure_and_then_skips():
    first = _Boom()
    _ensure_profile_extras_schema(first)
    assert first.rollbacks == 1
    assert _schema_once["profile_extras"] is False
    second = _Ok()
    _ensure_profile_extras_schema(second)
    assert second.execs == 1 and second.commits == 1
    third = _Ok()
    _ensure_profile_extras_schema(third)
    assert third.execs == 0


def _checkin(**extra):
    body = dict(stress=1, sleep=1, support=1, decisions=1, energy=1)
    body.update(extra)
    return CheckinIn(**body)


def test_notes_over_4000_characters_are_refused():
    try:
        _checkin(notes="x" * 4001)
    except ValidationError:
        return
    raise AssertionError("a 4001-character note was accepted")


def test_a_short_note_is_kept():
    assert _checkin(notes="ok").notes == "ok"


def test_an_unknown_resource_category_is_refused():
    try:
        ResourceIn(category="other", name="A line")
    except ValidationError:
        return
    raise AssertionError("an unknown category was accepted")


def test_the_flags_are_one_dict_and_the_validators_are_field_validators():
    settings = (ROOT / "backend/app/api/routes/settings.py").read_text()
    wellbeing = (ROOT / "backend/app/api/routes/wellbeing.py").read_text()
    assert "_schema_once" in settings
    assert "_user_settings_migrated" not in settings
    assert "_profile_extras_migrated" not in settings
    assert '@field_validator("notes")' in wellbeing
    assert '@field_validator("category")' in wellbeing
    assert "codeql[py/not-named-self]" not in wellbeing


def test_a_known_resource_category_is_kept():
    assert ResourceIn(category="hotline", name="A line").category == "hotline"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            setup_function()
            fn()
            print("ok", name)
