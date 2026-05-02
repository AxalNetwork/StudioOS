"""Epic 5 — unit coverage for the Python parity of `score_integrity`.

Targets the pure helpers (sign / verify / reserved-field rejection) so we
don't need a live DB. The Worker has parallel coverage in TS; this guards
the dev path used by FastAPI tests.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

# Pin the secret BEFORE importing so `_secret()` resolves deterministically.
os.environ.setdefault("SCORING_HMAC_SECRET", "test-secret-epic5")

from backend.app.services.score_integrity import (  # noqa: E402
    RESERVED_INPUT_FIELDS,
    assert_no_reserved_fields,
    sign_score,
    verify_score,
)


class _StubSnapshot:
    """Minimal stand-in for ScoreSnapshot — verify_score only reads a few
    fields so we avoid spinning up SQLModel/the DB."""
    def __init__(self, *, project_id, total_score, created_at, integrity_hash, is_sandbox=False, integrity_version="v1"):
        self.project_id = project_id
        self.total_score = total_score
        self.created_at = created_at
        self.integrity_hash = integrity_hash
        self.is_sandbox = is_sandbox
        self.integrity_version = integrity_version


def test_reserved_fields_rejected():
    for field in RESERVED_INPUT_FIELDS:
        with pytest.raises(ValueError, match="Reserved fields rejected"):
            assert_no_reserved_fields({field: 99})


def test_clean_payload_passes():
    # Sanity: a normal request body must NOT raise.
    assert_no_reserved_fields({"tam": 1_000_000, "team_expertise": 7})


def test_sign_and_verify_roundtrip():
    ts_dt = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    digest, ts_iso = sign_score(project_id=42, total_score=87.5, scored_at=ts_dt)
    snap = _StubSnapshot(
        project_id=42,
        total_score=87.5,
        created_at=ts_dt,
        integrity_hash=digest,
    )
    assert verify_score(snap) is True


def test_verify_rejects_tampered_score():
    ts_dt = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    digest, _ = sign_score(project_id=42, total_score=87.5, scored_at=ts_dt)
    # Adversary bumps the stored score to 99 but keeps the original hash.
    snap = _StubSnapshot(
        project_id=42,
        total_score=99.0,
        created_at=ts_dt,
        integrity_hash=digest,
    )
    assert verify_score(snap) is False


def test_verify_rejects_missing_signature_for_official():
    snap = _StubSnapshot(
        project_id=1,
        total_score=70.0,
        created_at=datetime.now(timezone.utc),
        integrity_hash=None,
        is_sandbox=False,
    )
    assert verify_score(snap) is False


def test_persisted_timestamp_roundtrip_matches_db_format():
    """Regression: round 4 rejection — the founder-submit path used to sign
    with `datetime.now()` BEFORE the snapshot was flushed, so verify_score
    later (which uses the DB's persisted `created_at`) would reject every
    valid intake row. This test pins the signing→storing→verify roundtrip
    against the same exact timestamp object the DB would hand back."""
    # Simulate the post-flush flow: get persisted timestamp first, sign with
    # it, store the digest, verify against the stored row.
    persisted_ts = datetime(2026, 5, 1, 12, 30, 45, 123456, tzinfo=timezone.utc)
    digest, _ = sign_score(project_id=99, total_score=72.5, scored_at=persisted_ts)
    snap = _StubSnapshot(
        project_id=99,
        total_score=72.5,
        created_at=persisted_ts,
        integrity_hash=digest,
    )
    assert verify_score(snap) is True


def test_sandbox_snapshots_are_signed_and_verifiable():
    # Epic 5 hardened path: sandbox runs are signed too so the audit trail is
    # complete. A missing hash on a sandbox row is invalid; a valid HMAC
    # verifies; tampering is rejected.
    ts_dt = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    digest, _ = sign_score(project_id=7, total_score=50.0, scored_at=ts_dt)

    signed = _StubSnapshot(
        project_id=7, total_score=50.0, created_at=ts_dt,
        integrity_hash=digest, is_sandbox=True,
    )
    assert verify_score(signed) is True

    unsigned = _StubSnapshot(
        project_id=7, total_score=50.0, created_at=ts_dt,
        integrity_hash=None, is_sandbox=True,
    )
    assert verify_score(unsigned) is False

    tampered = _StubSnapshot(
        project_id=7, total_score=99.0, created_at=ts_dt,
        integrity_hash=digest, is_sandbox=True,
    )
    assert verify_score(tampered) is False
