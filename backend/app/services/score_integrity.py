"""Score-integrity helpers — Python parity for the Cloudflare Workers
`scoreIntegrity.ts` module.

Why duplicate it in Python?
- The dev FastAPI backend is what unit tests run against; production is the
  Worker. Keeping the canonical message + HMAC scheme byte-identical between
  the two means a hash signed in dev can be verified in prod (useful when
  founders move from local dev to staging).

The canonical message format MUST stay in lockstep with
`cloudflare-worker/src/services/scoreIntegrity.ts`.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlmodel import Session, select

from backend.app.models.entities import ScoreSnapshot

# Reserved fields that founders / partners must NEVER be allowed to send on
# scoring requests — these are server-derived. Kept identical to the Worker.
RESERVED_INPUT_FIELDS: frozenset[str] = frozenset({
    "score",
    "tier",
    "score_breakdown",
    "total_score",
    "breakdown",
    "integrity_hash",
    "integrity_version",
    "admin_review_status",
})

INTEGRITY_VERSION = "v1"

# Numeric rubric inputs an OFFICIAL run must include. Names match the scoring
# engine in `backend/app/services/scoring.py` (and the Worker's
# `REQUIRED_OFFICIAL_INPUTS`). Sandbox runs are permissive — official runs
# reject incomplete payloads so a founder can't submit a partial form, see the
# score, and then iterate during the 7-day cooldown.
REQUIRED_OFFICIAL_INPUTS: tuple[str, ...] = (
    "tam",
    "market_urgency",
    "market_trend",
    "team_expertise",
    "team_execution",
    "team_network",
    "mvp_time_days",
    "product_complexity",
    "product_dependencies",
    "cost_to_mvp",
    "time_to_revenue_months",
    "burn_risk",
    "fit_alignment",
    "fit_synergy",
    "distribution_channels",
    "distribution_virality",
)


class MissingOfficialInputsError(ValueError):
    """Raised when an OFFICIAL run is missing one of REQUIRED_OFFICIAL_INPUTS."""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__(f"Missing required official-run inputs: {', '.join(missing)}")


def assert_official_inputs_complete(payload: dict[str, Any]) -> None:
    """Strict required-field validator used for OFFICIAL runs only. Empty
    strings and None both count as missing so a founder can't bypass with
    blank values."""
    missing: list[str] = []
    for key in REQUIRED_OFFICIAL_INPUTS:
        if key not in payload:
            missing.append(key)
            continue
        value = payload[key]
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(key)
    if missing:
        raise MissingOfficialInputsError(missing)


def _secret() -> bytes:
    """Use the dedicated SCORING_HMAC_SECRET if set, otherwise fall back to
    JWT_SECRET so operators only have to rotate one key. The Worker follows
    the same fallback order.

    We FAIL FAST in ALL environments if neither is set (or is too short).
    A previous version returned a hardcoded `dev-insecure-key` in
    non-production envs, which is unsafe defense-in-depth: if a deploy
    ever ran without ENVIRONMENT=production by mistake, score signatures
    could be forged by anyone reading the public source. Local devs and
    tests must set JWT_SECRET (or SCORING_HMAC_SECRET) explicitly — see
    .env.example.
    """
    secret = os.environ.get("SCORING_HMAC_SECRET") or os.environ.get("JWT_SECRET") or ""
    if len(secret) < 16:
        raise RuntimeError(
            "SCORING_HMAC_SECRET (or JWT_SECRET) is missing or shorter than 16 chars; "
            "set it in your .env (dev) or via `wrangler secret put` (prod). "
            "Refusing to sign with an insecure key."
        )
    return secret.encode("utf-8")


def assert_no_reserved_fields(payload: dict[str, Any]) -> None:
    """Raise ValueError if the request body tries to set a server-derived
    field. Called before the Pydantic model so we can produce a precise
    error before any defaults swallow them."""
    bad = [k for k in payload if k in RESERVED_INPUT_FIELDS]
    if bad:
        raise ValueError(f"Reserved fields rejected: {', '.join(sorted(bad))}")


def _canonical_message(project_id: int, total_score: float, ts: str, version: str = INTEGRITY_VERSION) -> str:
    # Exactly the same wire format as the Worker.
    return f"pid={project_id}|score={total_score:.2f}|ver={version}|ts={ts}"


def sign_score(project_id: int, total_score: float, scored_at: datetime | None = None) -> tuple[str, str]:
    """Return (integrity_hash_hex, scored_at_iso) signed with HMAC-SHA256."""
    ts = (scored_at or datetime.now(timezone.utc)).isoformat()
    msg = _canonical_message(project_id, float(total_score), ts).encode("utf-8")
    digest = hmac.new(_secret(), msg, hashlib.sha256).hexdigest()
    return digest, ts


def verify_score(snapshot: ScoreSnapshot) -> bool:
    """Constant-time HMAC verification. Every snapshot — sandbox or
    official — must carry a valid signature; a missing/mismatched hash is
    treated as invalid for both tracks. (LP-visibility filtering is the
    layer that hides sandbox rows from non-owners; signing happens
    universally so the audit trail is complete.)"""
    if not snapshot.integrity_hash:
        return False
    ts = snapshot.created_at.isoformat() if isinstance(snapshot.created_at, datetime) else str(snapshot.created_at)
    msg = _canonical_message(snapshot.project_id, float(snapshot.total_score), ts, snapshot.integrity_version or INTEGRITY_VERSION).encode("utf-8")
    expected = hmac.new(_secret(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, snapshot.integrity_hash)


# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------
# Heuristics intentionally identical to the Worker so flagged-in-prod and
# flagged-in-dev produce the same `anomaly_flags` JSON.
def detect_anomalies(
    session: Session,
    *,
    project_id: int,
    new_total: float,
    new_inputs: dict[str, Any],
    is_sandbox: bool,
) -> list[dict[str, str]]:
    """Returns a list of {type, severity, detail} dicts. Empty list = clean."""
    flags: list[dict[str, str]] = []
    cutoff = datetime.utcnow() - timedelta(days=14)

    # 1) Input-jump: any single numeric input changed by >50% in 14 days.
    recent = session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .where(ScoreSnapshot.created_at >= cutoff)
        .where(ScoreSnapshot.is_sandbox == is_sandbox)
        .order_by(ScoreSnapshot.created_at.desc())
    ).all()

    if recent:
        prev = recent[0]
        try:
            prev_inputs = json.loads(prev.inputs_json or "{}")
        except json.JSONDecodeError:
            prev_inputs = {}
        for key, value in new_inputs.items():
            if not isinstance(value, (int, float)):
                continue
            old = prev_inputs.get(key)
            if not isinstance(old, (int, float)) or old == 0:
                continue
            if abs(value - old) / max(abs(old), 1e-6) > 0.5:
                flags.append({
                    "type": "input_jump",
                    "severity": "medium",
                    "detail": f"{key} moved {old} -> {value} (>50%) in 14d",
                })

        # 2) Practice-jump: any single run (sandbox or official) more than
        # 25pt above the previous sandbox total within 14 days. Catches the
        # "tune in practice till the number is high then submit" exploit AND
        # the "ramp practice scores rapidly" pattern that often precedes an
        # official submission.
        sandbox_recent = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id == project_id)
            .where(ScoreSnapshot.is_sandbox == True)  # noqa: E712 — SQLAlchemy
            .where(ScoreSnapshot.created_at >= cutoff)
            .order_by(ScoreSnapshot.created_at.desc())
        ).first()
        if sandbox_recent and (new_total - sandbox_recent.total_score) > 25:
            flags.append({
                "type": "practice_jump",
                "severity": "high" if not is_sandbox else "medium",
                "detail": (
                    f"{'Official' if not is_sandbox else 'Sandbox'} {new_total} "
                    f">25pt above last sandbox {sandbox_recent.total_score}"
                ),
            })

    # 3) Rapid iteration: >10 runs in the past hour.
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    recent_count = len(session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .where(ScoreSnapshot.created_at >= one_hour_ago)
    ).all())
    if recent_count > 10:
        flags.append({
            "type": "rapid_iteration",
            "severity": "low",
            "detail": f"{recent_count} runs in last hour",
        })

    # 4) Duplicate-text: any text input >=80 chars matching another project's
    # last 14 days of inputs (cheap copy-paste detection).
    long_text_inputs = {k: v for k, v in new_inputs.items() if isinstance(v, str) and len(v.strip()) >= 80}
    if long_text_inputs:
        # Light-touch query: pull a small sample of recent inputs from other
        # projects. This is a dev-only heuristic — production runs the full
        # check via D1 in the Worker.
        others: Iterable[ScoreSnapshot] = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id != project_id)
            .where(ScoreSnapshot.created_at >= cutoff)
            .order_by(ScoreSnapshot.created_at.desc())
            .limit(50)
        ).all()
        for other in others:
            try:
                other_inputs = json.loads(other.inputs_json or "{}")
            except json.JSONDecodeError:
                continue
            for key, value in long_text_inputs.items():
                other_val = other_inputs.get(key)
                if isinstance(other_val, str) and other_val.strip() == value.strip():
                    flags.append({
                        "type": "duplicate_text",
                        "severity": "high",
                        "detail": f"{key} matches project #{other.project_id} snapshot #{other.id}",
                    })
                    break  # one flag per snapshot is enough
            else:
                continue
            break

    return flags
