"""Task #40 — Founder Wellbeing.

Optional weekly 5-question pulse with privacy-first storage and a
curated resource directory. Per the task brief:

* ``wellbeing_checkins`` is encrypted at rest via Fernet
  (``services.crypto_box``). Plaintext never touches the DB.
* Per-row check-ins are visible ONLY to the authoring founder. Admins
  see anonymized aggregates over the last 30 days (mean + count, no
  per-user breakdown). Investors see nothing — neither rows nor
  aggregates.
* The resource directory (``wellbeing_resources``) is plain-text,
  static-first, readable by all authenticated users, mutable only by
  admins.

Out of scope (per Task #40): tele-therapy bookings.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from statistics import fmean
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PField, validator
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import User, WellbeingCheckin, WellbeingResource
from backend.app.api.routes.auth import get_current_user
from backend.app.services.crypto_box import decrypt, encrypt

router = APIRouter(prefix="/wellbeing", tags=["wellbeing"])
logger = logging.getLogger("studioos.wellbeing")


# Privacy hardening for the admin aggregate (architect-flagged). The
# original 3-founder floor + caller-controlled window allowed
# differencing attacks: an admin could narrow ``days=1`` to leak a
# single founder's mood. Three controls applied:
#
#   1. ``MIN_AGGREGATE_COHORT`` raised to 7 (mental-health-grade floor).
#   2. ``ALLOWED_AGGREGATE_WINDOWS`` restricts ``days`` to two coarse
#      fixed buckets so windows can't be slid around.
#   3. Cohort + submission counts are bucketed to the nearest 5, so the
#      shape of the cohort can't be derived precisely.
#   4. Means are rounded to one decimal place (still useful, less
#      finger-printable than two).
#
# Aggregate access is also recorded to the application logger for
# review in case an account is compromised.
MIN_AGGREGATE_COHORT = 7
ALLOWED_AGGREGATE_WINDOWS = (30, 90)
COUNT_BUCKET = 5

QUESTION_KEYS = ("stress", "sleep", "support", "decisions", "energy")


def _bucket(n: int, step: int = COUNT_BUCKET) -> int:
    """Round ``n`` down to the nearest ``step`` to coarsen counts."""
    if n <= 0:
        return 0
    return (n // step) * step


def _role(user: User) -> str:
    return (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()


def _week_anchor(d: date | None = None) -> date:
    """Monday of the ISO week containing ``d`` (UTC)."""
    d = d or date.today()
    return d - timedelta(days=d.weekday())


# ---------------------------------------------------------------------------
# Pulse check-ins (founder-only writes/reads of own data)
# ---------------------------------------------------------------------------
class CheckinIn(BaseModel):
    stress: int = PField(..., ge=1, le=5)
    sleep: int = PField(..., ge=1, le=5)
    support: int = PField(..., ge=1, le=5)
    decisions: int = PField(..., ge=1, le=5)
    energy: int = PField(..., ge=1, le=5)
    notes: Optional[str] = None

    @validator("notes")
    # codeql[py/not-named-self] -- this is a Pydantic v1-style `@validator`, which Pydantic
    # binds as an implicit classmethod (see https://docs.pydantic.dev/latest/concepts/validators/
    # -- "validators are class methods"). `cls`, not `self`, is the textbook-correct first
    # parameter name here; CodeQL's self-vs-cls heuristic only recognizes the stdlib
    # `@classmethod`/`@staticmethod` decorators and doesn't special-case Pydantic's own
    # decorator, which rebinds the method the same way under the hood.
    def _notes_len(cls, v):
        if v is not None and len(v) > 4000:
            raise ValueError("notes too long")
        return v


def _decrypt_int(value: str) -> Optional[int]:
    plain = decrypt(value)
    if plain is None:
        return None
    try:
        return int(plain)
    except ValueError:
        return None


def _serialize_own(row: WellbeingCheckin) -> dict:
    """Decrypt for the authoring founder only. Never call this for
    admin aggregates — those use ``_decrypt_int`` directly without
    leaking row identifiers."""
    return {
        "id": row.id,
        "uid": row.uid,
        "week_anchor": row.week_anchor.isoformat(),
        "created_at": row.created_at.isoformat(),
        "stress": _decrypt_int(row.stress_enc),
        "sleep": _decrypt_int(row.sleep_enc),
        "support": _decrypt_int(row.support_enc),
        "decisions": _decrypt_int(row.decisions_enc),
        "energy": _decrypt_int(row.energy_enc),
        "notes": decrypt(row.notes_enc) if row.notes_enc else None,
    }


@router.post("/checkins")
def create_checkin(
    payload: CheckinIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Submit this week's pulse. Founders only.

    Idempotent per (user, ISO week): re-submitting overwrites this
    week's row instead of creating a duplicate. Investors and partners
    are blocked — wellbeing is a founder-only surface."""
    role = _role(user)
    if role not in ("founder", "admin"):
        # Admins are allowed for QA / smoke-testing; investors and
        # partners are explicitly blocked.
        raise HTTPException(status_code=403, detail="Founders only")

    anchor = _week_anchor()
    enc = {f"{k}_enc": encrypt(str(getattr(payload, k))) for k in QUESTION_KEYS}
    notes_enc = encrypt(payload.notes) if payload.notes else None
    new_uid = __import__("uuid").uuid4().hex

    # Architect-flagged race fix: atomic UPSERT against the
    # (user_id, week_anchor) unique constraint. The previous
    # SELECT-then-INSERT-with-fallback could lose a write if two
    # submits arrived concurrently — the IntegrityError branch
    # refetched the existing row without re-applying the loser's
    # payload. ``ON CONFLICT DO UPDATE`` guarantees last-write-wins.
    sql = text("""
        INSERT INTO wellbeing_checkins
          (uid, user_id, week_anchor, stress_enc, sleep_enc, support_enc,
           decisions_enc, energy_enc, notes_enc, created_at)
        VALUES
          (:uid, :user_id, :anchor, :stress_enc, :sleep_enc, :support_enc,
           :decisions_enc, :energy_enc, :notes_enc, :created_at)
        ON CONFLICT (user_id, week_anchor) DO UPDATE SET
          stress_enc    = EXCLUDED.stress_enc,
          sleep_enc     = EXCLUDED.sleep_enc,
          support_enc   = EXCLUDED.support_enc,
          decisions_enc = EXCLUDED.decisions_enc,
          energy_enc    = EXCLUDED.energy_enc,
          notes_enc     = EXCLUDED.notes_enc,
          created_at    = EXCLUDED.created_at
        RETURNING id
    """)
    res = session.exec(
        sql.bindparams(
            uid=new_uid,
            user_id=user.id,
            anchor=anchor,
            created_at=datetime.utcnow(),
            **enc,
            notes_enc=notes_enc,
        )
    )
    row_id = res.scalar() or res.first()[0]
    session.commit()
    row = session.get(WellbeingCheckin, row_id)
    return _serialize_own(row)


@router.get("/checkins")
def list_my_checkins(
    limit: int = 26,  # ~6 months of weekly pulses
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Return THIS user's own check-in history. Per the privacy
    contract there is no path that returns another user's rows."""
    if _role(user) == "investor":
        raise HTTPException(status_code=403, detail="Not available for investors")
    rows = session.exec(
        select(WellbeingCheckin)
        .where(WellbeingCheckin.user_id == user.id)
        .order_by(WellbeingCheckin.created_at.desc())
        .limit(max(1, min(limit, 200)))
    ).all()
    this_week = _week_anchor()
    return {
        "checkins": [_serialize_own(r) for r in rows],
        "this_week_anchor": this_week.isoformat(),
        "submitted_this_week": any(r.week_anchor == this_week for r in rows),
    }


# ---------------------------------------------------------------------------
# Anonymized aggregate (admin only — explicitly NOT investor)
# ---------------------------------------------------------------------------
@router.get("/aggregate")
def aggregate(
    days: int = 30,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Anonymized aggregate over the last ``days`` days.

    Privacy rules (matching the task brief):
      * Admins only — investors are explicitly forbidden, partners/founders too.
      * Returns mean (1-5) per question + cohort size (distinct
        founders) + total submissions. Never per-user data.
      * If cohort < ``MIN_AGGREGATE_COHORT`` we return
        ``insufficient_data`` rather than means, so a single founder's
        score can't be reverse-engineered.
    """
    if _role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    # Architect-flagged: caller-controlled ``days`` enables
    # window-narrowing inference. Restrict to fixed coarse buckets so
    # the window can't be slid around to isolate individuals.
    if days not in ALLOWED_AGGREGATE_WINDOWS:
        raise HTTPException(
            status_code=400,
            detail=f"days must be one of {list(ALLOWED_AGGREGATE_WINDOWS)} for privacy",
        )
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = session.exec(
        select(WellbeingCheckin).where(WellbeingCheckin.created_at >= cutoff)
    ).all()
    distinct_users = {r.user_id for r in rows}
    cohort = len(distinct_users)
    # Audit trail: aggregate access is sensitive even when anonymized.
    logger.info(
        "wellbeing aggregate access by admin user_id=%s window_days=%d cohort=%d",
        user.id, days, cohort,
    )
    if cohort < MIN_AGGREGATE_COHORT:
        return {
            "window_days": days,
            "cohort_size": _bucket(cohort),
            "submissions": _bucket(len(rows)),
            "insufficient_data": True,
            "min_cohort": MIN_AGGREGATE_COHORT,
            "averages": None,
        }
    buckets: dict[str, list[int]] = {k: [] for k in QUESTION_KEYS}
    for r in rows:
        for key in QUESTION_KEYS:
            v = _decrypt_int(getattr(r, f"{key}_enc"))
            if v is not None:
                buckets[key].append(v)
    # Round means to 1dp (less fingerprintable than 2dp) and bucket the
    # cohort + submission counts so they can't be differenced across
    # adjacent queries.
    averages = {
        k: round(fmean(v), 1) if v else None for k, v in buckets.items()
    }
    return {
        "window_days": days,
        "cohort_size": _bucket(cohort),
        "submissions": _bucket(len(rows)),
        "insufficient_data": False,
        "averages": averages,
    }


# ---------------------------------------------------------------------------
# Resource directory
# ---------------------------------------------------------------------------
class ResourceIn(BaseModel):
    category: str
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    region: Optional[str] = None
    is_24_7: bool = False
    is_free: bool = False
    sort_order: int = 100

    @validator("category")
    # codeql[py/not-named-self] -- this is a Pydantic v1-style `@validator`, which Pydantic
    # binds as an implicit classmethod (see https://docs.pydantic.dev/latest/concepts/validators/
    # -- "validators are class methods"). `cls`, not `self`, is the textbook-correct first
    # parameter name here; CodeQL's self-vs-cls heuristic only recognizes the stdlib
    # `@classmethod`/`@staticmethod` decorators and doesn't special-case Pydantic's own
    # decorator, which rebinds the method the same way under the hood.
    def _cat(cls, v):
        allowed = {"therapy", "peer_group", "hotline", "reading", "coaching"}
        if v not in allowed:
            raise ValueError(f"category must be one of {sorted(allowed)}")
        return v


def _serialize_resource(r: WellbeingResource) -> dict:
    return {
        "id": r.id,
        "uid": r.uid,
        "category": r.category,
        "name": r.name,
        "description": r.description,
        "url": r.url,
        "region": r.region,
        "is_24_7": r.is_24_7,
        "is_free": r.is_free,
        "sort_order": r.sort_order,
        "created_at": r.created_at.isoformat(),
    }


# Static-first seed list. Ensured on first GET /resources so the
# directory is non-empty out of the box. Admins can add more.
DEFAULT_RESOURCES: list[dict] = [
    {
        "category": "hotline",
        "name": "988 Suicide & Crisis Lifeline (US)",
        "description": "Free, confidential 24/7 support if you're in crisis or know someone who is. Call or text 988.",
        "url": "https://988lifeline.org",
        "region": "us", "is_24_7": True, "is_free": True, "sort_order": 1,
    },
    {
        "category": "hotline",
        "name": "Samaritans (UK & Ireland)",
        "description": "Free 24/7 emotional support. Call 116 123 from UK or Ireland.",
        "url": "https://www.samaritans.org",
        "region": "uk", "is_24_7": True, "is_free": True, "sort_order": 2,
    },
    {
        "category": "peer_group",
        "name": "Founders Network — Mental Health Circle",
        "description": "Peer support group for founders navigating burnout, stress, and isolation.",
        "url": "https://foundersnetwork.com",
        "region": "global", "is_free": False, "sort_order": 10,
    },
    {
        "category": "peer_group",
        "name": "Reboot.io — Founder Coaching Community",
        "description": "Coaching circles + writing on the inner work of leadership.",
        "url": "https://www.reboot.io",
        "region": "global", "is_free": False, "sort_order": 11,
    },
    {
        "category": "therapy",
        "name": "BetterHelp — online therapy",
        "description": "Matched 1:1 with a licensed therapist; sessions by video, phone, or chat.",
        "url": "https://www.betterhelp.com",
        "region": "global", "is_free": False, "sort_order": 20,
    },
    {
        "category": "therapy",
        "name": "Open Path Collective",
        "description": "Affordable in-person and online therapy ($30-$70/session) with vetted clinicians.",
        "url": "https://openpathcollective.org",
        "region": "us", "is_free": False, "sort_order": 21,
    },
    {
        "category": "coaching",
        "name": "The Founder Coach Directory",
        "description": "Curated directory of executive coaches who specialize in early-stage founders.",
        "url": "https://www.foundercoach.directory",
        "region": "global", "is_free": False, "sort_order": 30,
    },
    {
        "category": "reading",
        "name": "The Founder's Dilemmas (Noam Wasserman)",
        "description": "Evidence-based read on the human side of starting a company — co-founder splits, equity, control.",
        "url": "https://press.princeton.edu/books/paperback/9780691158303/the-founders-dilemmas",
        "region": "global", "is_free": False, "sort_order": 40,
    },
    {
        "category": "reading",
        "name": "It's Called Imposter Syndrome (First Round Review)",
        "description": "Free essay on naming and working through imposter syndrome as a founder.",
        "url": "https://review.firstround.com",
        "region": "global", "is_free": True, "sort_order": 41,
    },
]


def _ensure_default_resources(session: Session) -> None:
    """Idempotently seed the static-first directory. Re-runs are safe
    because we key on (category, name)."""
    have = {
        (r.category, r.name)
        for r in session.exec(select(WellbeingResource)).all()
    }
    inserted = 0
    for spec in DEFAULT_RESOURCES:
        if (spec["category"], spec["name"]) in have:
            continue
        try:
            session.add(WellbeingResource(**spec))
            session.commit()
            inserted += 1
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            logger.warning("seed wellbeing resource failed: %s", exc)
    if inserted:
        logger.info("wellbeing: seeded %d default resources", inserted)


@router.get("/resources")
def list_resources(
    category: Optional[str] = None,
    region: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List curated resources. Readable by all authenticated users."""
    _ensure_default_resources(session)
    stmt = select(WellbeingResource)
    if category:
        stmt = stmt.where(WellbeingResource.category == category)
    if region:
        stmt = stmt.where(
            (WellbeingResource.region == region) | (WellbeingResource.region == "global")
        )
    rows = session.exec(stmt.order_by(WellbeingResource.sort_order.asc())).all()
    return {"resources": [_serialize_resource(r) for r in rows]}


@router.post("/resources")
def create_resource(
    payload: ResourceIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if _role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    row = WellbeingResource(
        **payload.dict(),
        created_by_user_id=user.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _serialize_resource(row)


@router.delete("/resources/{resource_id}")
def delete_resource(
    resource_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if _role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    row = session.get(WellbeingResource, resource_id)
    if not row:
        raise HTTPException(status_code=404, detail="Resource not found")
    session.delete(row)
    session.commit()
    return {"deleted": True}
