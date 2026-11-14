"""Dev-parity shim for the credits-based Network → Introductions propositions.

CONTEXT: this router mirrors the production Cloudflare Worker routes at
``cloudflare-worker/src/routes/introductions.ts`` (+ ``services/introductions.ts``),
which back the "Introductions" tab on the unified Network page
(``frontend/src/pages/IntroductionsPanel.jsx``). Production holds the real
matching data + credit ledger in D1; the dev FastAPI backend has neither, so
``/api/introductions/*`` used to 404 and the panel rendered a red "Not found".

This shim makes the feature render and round-trip in the local preview:
  * GET  /introductions/propositions            list (+ lazy generate/expire)
  * POST /introductions/propositions/{uid}/accept   spends 1 credit (402 when out)
  * POST /introductions/propositions/{uid}/decline  free
  * GET  /introductions/credits                 credit balance breakdown
  * GET  /introductions/credits/history         append-only ledger
  * GET  /introductions/packs                   purchasable credit packs
  * GET  /introductions/quota                   investor quarterly request quota
  * GET  /introductions/                        investor request history
  * POST /introductions/request                 investor → founder warm-intro

Proposition scoring reuses the SAME deterministic dev-parity helpers as the
``/network-introductions`` candidate feed (values / skills / archetype /
specialization / jurisdiction), so both surfaces stay consistent locally.

Distinct from ``routes/network_introductions.py`` (``/network-introductions``),
which backs the separate privacy-preserving intro flow.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User, UserRole

# Reuse the deterministic scoring/profile shims that already back the
# /network-introductions candidate feed so both surfaces agree in dev.
from backend.app.api.routes.network_introductions import (
    _candidate_from_user,
    _score_candidate,
    _viewer_profile,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/introductions", tags=["Introductions"])

PROPOSITION_TTL_DAYS = 14
MIN_PENDING = 3          # top the list up when fewer than this are live
GEN_BATCH = 5            # how many to generate per top-up
LIST_LIMIT = 200

# Purchasable credit packs — mirrors INTRO_PACKS in services/introductions.ts.
INTRO_PACKS = {
    "intro_10": {
        "credits": 10, "amount_cents": 4_900, "currency": "usd",
        "label": "10 introductions",
        "blurb": "A focused batch of warm intros for the current push.",
    },
    "intro_100": {
        "credits": 100, "amount_cents": 39_900, "currency": "usd",
        "label": "100 introductions",
        "blurb": "A quarter of serious relationship building.",
    },
    "intro_1000": {
        "credits": 1_000, "amount_cents": 299_000, "currency": "usd",
        "label": "1,000 introductions",
        "blurb": "Firm-scale allocation for teams and funds.",
    },
}


def _role_str(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _month_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.utcnow()
    return f"{now.year:04d}-{now.month:02d}"


def _monthly_allowance_for(user: User) -> int:
    """Per-plan monthly credit allowance. Prod derives this from the real
    subscription tier via the worker's ``monthlyAllowanceFor``; dev keys off
    role (most dev users are free-tier → 3, matching the worker default)."""
    role = _role_str(user).lower()
    if role == "admin":
        return 25
    return 3


# ---------------------------------------------------------------------------
# Credit state — lazy monthly grant + balance math derived from the ledger.
# ---------------------------------------------------------------------------
def _credit_state(session: Session, user: User) -> dict:
    _grant_monthly_allowance(session, user)
    return _read_credit_state(session, user)


def _grant_monthly_allowance(session: Session, user: User) -> None:
    """Lazy monthly grant — one allowance row per user per month (idempotent).
    Commits on its own so it is safe to call before opening a locked critical
    section in accept()."""
    month = _month_key()
    cap = _monthly_allowance_for(user)
    try:
        session.execute(
            text(
                "INSERT INTO intro_credit_ledger "
                "(user_id, delta, bucket, kind, source_ref, note) "
                "VALUES (:uid, :delta, 'allowance', 'monthly_grant', :ref, :note) "
                "ON CONFLICT (user_id, kind, source_ref) DO NOTHING"
            ),
            {"uid": user.id, "delta": cap, "ref": f"month:{month}",
             "note": f"Monthly allowance ({cap})"},
        )
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("intro credit grant failed: %s", exc)
        session.rollback()


def _read_credit_state(session: Session, user: User) -> dict:
    """Compute the credit breakdown from the ledger WITHOUT committing — safe to
    call inside a locked transaction. Does not grant; call _grant_monthly_
    allowance (or _credit_state) first when a fresh month may need seeding."""
    month = _month_key()
    cap = _monthly_allowance_for(user)
    row = session.execute(
        text(
            "SELECT "
            "COALESCE(SUM(CASE WHEN bucket='allowance' AND to_char(created_at,'YYYY-MM')=:m "
            "                  THEN delta ELSE 0 END),0) AS allowance_month, "
            "COALESCE(SUM(CASE WHEN bucket='purchased' THEN delta ELSE 0 END),0) AS purchased, "
            "COALESCE(SUM(CASE WHEN bucket='referral' THEN delta ELSE 0 END),0) AS referral, "
            "COALESCE(SUM(CASE WHEN kind='purchase' THEN delta ELSE 0 END),0) AS purchased_granted, "
            "COALESCE(SUM(CASE WHEN kind='referral_reward' THEN delta ELSE 0 END),0) AS referral_granted, "
            "COALESCE(SUM(CASE WHEN kind='spend' AND to_char(created_at,'YYYY-MM')=:m "
            "                  THEN 1 ELSE 0 END),0) AS spent_month "
            "FROM intro_credit_ledger WHERE user_id=:uid"
        ),
        {"m": month, "uid": user.id},
    ).mappings().first() or {}

    allowance_remaining = max(0, int(row.get("allowance_month", 0)))
    purchased_remaining = max(0, int(row.get("purchased", 0)))
    referral_remaining = max(0, int(row.get("referral", 0)))
    return {
        "month": month,
        "monthly_allowance": cap,
        "allowance_remaining": allowance_remaining,
        "used_this_month": int(row.get("spent_month", 0)),
        "purchased_total": int(row.get("purchased_granted", 0)),
        "purchased_remaining": purchased_remaining,
        "referral_total": int(row.get("referral_granted", 0)),
        "referral_remaining": referral_remaining,
        "balance": allowance_remaining + purchased_remaining + referral_remaining,
    }


def _pick_spend_bucket(state: dict) -> str:
    """Spend priority: monthly allowance → referral-earned → purchased."""
    if state["allowance_remaining"] > 0:
        return "allowance"
    if state["referral_remaining"] > 0:
        return "referral"
    return "purchased"


# ---------------------------------------------------------------------------
# Proposition generation — lazy, invoked from the list read.
# ---------------------------------------------------------------------------
def _existing_target_ids(session: Session, user_id: int) -> set[int]:
    # Only the viewer's OWN outgoing proposals — propositions are per-direction
    # (unique index on (user_id, target_user_id)), so A→B existing must not
    # suppress B→A. Each viewer builds an independent feed.
    rows = session.execute(
        text("SELECT target_user_id AS other FROM intro_propositions WHERE user_id=:uid"),
        {"uid": user_id},
    ).mappings().all()
    return {int(r["other"]) for r in rows}


def _generate_propositions(session: Session, user: User, max_n: int = GEN_BATCH) -> int:
    """Score the candidate pool and persist the best unseen matches."""
    viewer = _viewer_profile(session, user)
    seen = _existing_target_ids(session, user.id)
    seen.add(user.id)

    from sqlmodel import select  # local import keeps module import light
    pool: list[tuple[User, dict]] = []
    for u in session.exec(select(User).where(User.is_active == True)).all():  # noqa: E712
        if u.id in seen or u.role == UserRole.ADMIN or not u.name:
            continue
        cand = _candidate_from_user(session, u)
        _score_candidate(cand, viewer)
        pool.append((u, cand))

    if not pool:
        return 0
    pool.sort(key=lambda pc: pc[1]["match_score"], reverse=True)

    now = datetime.utcnow()
    expires = now + timedelta(days=PROPOSITION_TTL_DAYS)
    inserted = 0
    for u, cand in pool[:max_n]:
        breakdown = {
            "reasons": cand.get("why", []),
            "shared_values": cand.get("shared_values", []),
            "complementary_skills": cand.get("complementary_skills", []),
            "archetypes": {
                "viewer": viewer["archetype"]["label"],
                "candidate": cand["archetype"]["label"],
            },
            "specializations": cand.get("specializations", []),
            "jurisdiction": {
                "viewer": viewer.get("location"),
                "candidate": cand.get("location"),
                "match": cand.get("location") == viewer.get("location"),
            },
            "relationship_context": None,
        }
        target = {
            "uid": u.uid,
            "name": cand["name"],
            "role": cand["role"],
            "headline": cand.get("headline"),
            "country": cand.get("location"),
            "headshot_url": cand.get("photo_url"),
            "persona": None,
            "profile_path": f"/u/{u.uid}" if u.uid else None,
        }
        payload = json.dumps({"breakdown": breakdown, "target": target})
        try:
            res = session.execute(
                text(
                    "INSERT INTO intro_propositions "
                    "(uid, user_id, target_user_id, status, score, breakdown_json, "
                    " source, expires_at, created_at) "
                    "VALUES (:uid, :user_id, :target_user_id, 'pending', :score, "
                    "        :breakdown, 'matching', :expires, :created) "
                    "ON CONFLICT (user_id, target_user_id) DO NOTHING"
                ),
                {
                    "uid": str(uuid.uuid4()), "user_id": user.id,
                    "target_user_id": u.id, "score": float(cand["match_score"]),
                    "breakdown": payload, "expires": expires, "created": now,
                },
            )
            if res.rowcount:
                inserted += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("intro proposition insert failed: %s", exc)
            session.rollback()
    session.commit()
    return inserted


def _proposition_dto(row) -> dict:
    try:
        parsed = json.loads(row["breakdown_json"]) if row["breakdown_json"] else {}
    except Exception:  # noqa: BLE001
        parsed = {}
    created = row.get("created_at")
    expires = row.get("expires_at")
    responded = row.get("responded_at")
    return {
        "uid": row["uid"],
        "status": row["status"],
        "score": round(float(row.get("score") or 0)),
        "source": row.get("source") or "matching",
        "expires_at": expires.isoformat() if isinstance(expires, datetime) else expires,
        "responded_at": responded.isoformat() if isinstance(responded, datetime) else responded,
        "created_at": created.isoformat() if isinstance(created, datetime) else created,
        "breakdown": parsed.get("breakdown"),
        "target": parsed.get("target") or {},
    }


# ---------------------------------------------------------------------------
# Propositions
# ---------------------------------------------------------------------------
@router.get("/propositions")
def list_propositions(
    status: Optional[str] = None,
    refresh: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Lazy expiry — spending nothing.
    try:
        session.execute(
            text(
                "UPDATE intro_propositions SET status='expired' "
                "WHERE user_id=:uid AND status='pending' "
                "AND expires_at IS NOT NULL AND expires_at < :now"
            ),
            {"uid": user.id, "now": datetime.utcnow()},
        )
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()

    generated = 0
    try:
        pending = session.execute(
            text("SELECT COUNT(*) AS n FROM intro_propositions "
                 "WHERE user_id=:uid AND status='pending'"),
            {"uid": user.id},
        ).mappings().first()
        if refresh == "1" or int((pending or {}).get("n", 0)) < MIN_PENDING:
            generated = _generate_propositions(session, user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("intro proposition generation failed: %s", exc)
        session.rollback()

    wheres = ["user_id=:uid"]
    params: dict = {"uid": user.id}
    st = (status or "").strip().lower()
    if st in {"pending", "accepted", "declined", "expired"}:
        wheres.append("status=:st")
        params["st"] = st
    sql = (
        "SELECT uid, status, score, breakdown_json, source, expires_at, "
        "responded_at, created_at FROM intro_propositions WHERE "
        + " AND ".join(wheres)
        + " ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, "
        "score DESC, created_at DESC LIMIT :lim"
    )
    params["lim"] = LIST_LIMIT
    rows = session.execute(text(sql), params).mappings().all()

    return {
        "propositions": [_proposition_dto(r) for r in rows],
        "credits": _credit_state(session, user),
        "generated": generated,
    }


@router.post("/propositions/{uid}/accept")
def accept_proposition(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Fast-path existence/status check (cheap, no lock) so obvious 404/409s
    # avoid taking the per-user lock at all.
    row = session.execute(
        text("SELECT uid, status FROM intro_propositions "
             "WHERE uid=:uid AND user_id=:user_id"),
        {"uid": uid, "user_id": user.id},
    ).mappings().first()
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    if row["status"] != "pending":
        return JSONResponse(
            status_code=409,
            content={"error": "already_responded", "status": row["status"]},
        )

    # Seed this month's allowance (commits on its own) BEFORE we open the
    # locked critical section, so the grant's commit can't release the lock.
    _grant_monthly_allowance(session, user)

    try:
        # Per-user transaction advisory lock: serializes ALL concurrent accepts
        # for this user until commit. This closes the cross-proposition
        # overspend race — two accepts for different uids can no longer both
        # observe the last credit and both spend it. Held only for the brief
        # check→spend section; different users never contend (keyed on user.id).
        session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": int(user.id)})

        # Recompute balance INSIDE the lock (no commit) — this is the
        # authoritative sufficiency check.
        state = _read_credit_state(session, user)
        if state["balance"] <= 0:
            session.rollback()  # releases the advisory lock
            # Raw body (not wrapped) so the panel reads e.data.code/packs/credits.
            return JSONResponse(
                status_code=402,
                content={
                    "error": "no_credits",
                    "code": "intro_credits_exhausted",
                    "message": "You are out of introduction credits for now.",
                    "credits": state,
                    "packs": [{"key": k, **v} for k, v in INTRO_PACKS.items()],
                    "buy_path": "/products#introduction-packs",
                    "refer_path": "/settings/referrals",
                },
            )

        bucket = _pick_spend_bucket(state)
        # The status UPDATE is the atomic gate: it applies only while the row is
        # still pending, so we charge ONLY if acceptance actually landed.
        upd = session.execute(
            text(
                "UPDATE intro_propositions SET status='accepted', responded_at=:now "
                "WHERE uid=:uid AND user_id=:user_id AND status='pending'"
            ),
            {"now": datetime.utcnow(), "uid": uid, "user_id": user.id},
        )
        if not upd.rowcount:
            # Lost the race — someone else already responded. No charge.
            row2 = session.execute(
                text("SELECT status FROM intro_propositions "
                     "WHERE uid=:uid AND user_id=:user_id"),
                {"uid": uid, "user_id": user.id},
            ).mappings().first()
            session.rollback()
            if not row2:
                return JSONResponse(status_code=404, content={"error": "not_found"})
            return JSONResponse(
                status_code=409,
                content={"error": "already_responded", "status": row2["status"]},
            )
        # Acceptance landed — record the (idempotent) spend in the same txn.
        session.execute(
            text(
                "INSERT INTO intro_credit_ledger "
                "(user_id, delta, bucket, kind, source_ref, note) "
                "VALUES (:uid, -1, :bucket, 'spend', :ref, 'Accepted introduction') "
                "ON CONFLICT (user_id, kind, source_ref) DO NOTHING"
            ),
            {"uid": user.id, "bucket": bucket, "ref": f"intro:{uid}"},
        )
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("intro accept failed: %s", exc)
        session.rollback()
        return JSONResponse(status_code=500, content={"error": "accept_failed"})

    return {
        "ok": True, "uid": uid, "status": "accepted", "spent_bucket": bucket,
        "credits": _credit_state(session, user),
    }


@router.post("/propositions/{uid}/decline")
def decline_proposition(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    res = session.execute(
        text(
            "UPDATE intro_propositions SET status='declined', responded_at=:now "
            "WHERE uid=:uid AND user_id=:user_id AND status='pending'"
        ),
        {"now": datetime.utcnow(), "uid": uid, "user_id": user.id},
    )
    if not res.rowcount:
        row = session.execute(
            text("SELECT status FROM intro_propositions "
                 "WHERE uid=:uid AND user_id=:user_id"),
            {"uid": uid, "user_id": user.id},
        ).mappings().first()
        session.rollback()
        if not row:
            return JSONResponse(status_code=404, content={"error": "not_found"})
        return JSONResponse(
            status_code=409,
            content={"error": "already_responded", "status": row["status"]},
        )
    session.commit()
    return {
        "ok": True, "uid": uid, "status": "declined",
        "credits": _credit_state(session, user),
    }


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------
@router.get("/credits")
def get_credits(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return {
        "credits": _credit_state(session, user),
        "buy_path": "/products#introduction-packs",
        "refer_path": "/settings/referrals",
    }


@router.get("/credits/history")
def get_credit_history(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.execute(
        text(
            "SELECT delta, bucket, kind, source_ref, note, created_at "
            "FROM intro_credit_ledger WHERE user_id=:uid "
            "ORDER BY created_at DESC, id DESC LIMIT 100"
        ),
        {"uid": user.id},
    ).mappings().all()
    history = []
    for r in rows:
        created = r.get("created_at")
        history.append({
            "delta": int(r["delta"]),
            "bucket": r["bucket"],
            "kind": r["kind"],
            "source_ref": r["source_ref"],
            "note": r.get("note"),
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
        })
    return {"history": history}


@router.get("/packs")
def get_packs(user: User = Depends(get_current_user)):
    return {"packs": [{"key": k, **v} for k, v in INTRO_PACKS.items()]}


# ---------------------------------------------------------------------------
# Investor quarterly request quota (Task #6 W-1 parity). Investor/admin only.
# ---------------------------------------------------------------------------
_QUOTA_CAP_BY_ROLE = {"admin": 100, "investor": 3}


def _quarter_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.utcnow()
    return f"{now.year:04d}-Q{(now.month - 1) // 3 + 1}"


def _quota_tier(user: User) -> str:
    """Dev has no investor subscription-tier data, so map role → worker tier
    label: investors are treated as the free tier (cap 3); admin is unlimited-ish."""
    return "admin" if _role_str(user).lower() == "admin" else "free"


def _quota_state(session: Session, user: User) -> dict:
    quarter = _quarter_key()
    role = _role_str(user).lower()
    cap = _QUOTA_CAP_BY_ROLE.get(role, 3)
    used_row = session.execute(
        text("SELECT COUNT(*) AS n FROM investor_introductions "
             "WHERE investor_user_id=:uid AND quarter=:q"),
        {"uid": user.id, "q": quarter},
    ).mappings().first()
    used = int((used_row or {}).get("n", 0))
    return {"tier": _quota_tier(user), "quarter": quarter, "used": used, "cap": cap}


@router.get("/quota")
def get_quota(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if _role_str(user).lower() not in ("investor", "admin"):
        return JSONResponse(status_code=403, content={"error": "investor_only"})
    s = _quota_state(session, user)
    return {"tier": s["tier"], "quarter": s["quarter"], "used": s["used"],
            "cap": s["cap"], "remaining": max(0, s["cap"] - s["used"])}


@router.post("/request")
def request_introduction(
    body: dict | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Investor → founder warm-intro request with a quarterly quota — dev parity
    for the worker's Task #6 W-1 flow (used by the deal-card "Request intro"
    button). The 3-way NDA envelope is a separate Trust Center call in prod, so
    this route only enforces the paid quota + records the request."""
    if _role_str(user).lower() != "investor":
        return JSONResponse(status_code=403, content={"error": "investor_only"})
    body = body or {}

    def _as_int(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    founder_user_id = _as_int(body.get("founder_user_id"))
    founder_id = _as_int(body.get("founder_id"))
    project_id = _as_int(body.get("project_id"))
    message = body.get("message")
    if isinstance(message, str):
        message = message[:2000]
    else:
        message = None

    if not founder_user_id and not founder_id and not project_id:
        return JSONResponse(
            status_code=400,
            content={"error": "target_required",
                     "message": "Provide founder_user_id, founder_id, or project_id"},
        )

    # Per-user lock serializes concurrent requests so two can't both read a
    # below-cap quota and both insert past it (same guard as accept()).
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": int(user.id)})

    s = _quota_state(session, user)
    if s["used"] >= s["cap"]:
        session.rollback()  # releases the advisory lock
        return JSONResponse(
            status_code=402,
            content={
                "error": "quota_exceeded",
                "code": "quota_intros_exhausted",
                "message": f"You have used all {s['cap']} introductions for {s['quarter']}.",
                "used": s["used"], "cap": s["cap"], "tier": s["tier"],
                "upgrade_to": "professional" if s["tier"] == "free" else "institutional",
                "checkout_path": "/api/billing/investor/checkout",
            },
        )

    new_uid = str(uuid.uuid4())
    try:
        session.execute(
            text(
                "INSERT INTO investor_introductions "
                "(uid, investor_user_id, founder_user_id, founder_id, project_id, "
                " message, status, quarter) "
                "VALUES (:uid, :inv, :fu, :fi, :pj, :msg, 'pending', :q)"
            ),
            {"uid": new_uid, "inv": user.id, "fu": founder_user_id,
             "fi": founder_id, "pj": project_id, "msg": message, "q": s["quarter"]},
        )
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("intro request failed: %s", exc)
        session.rollback()
        return JSONResponse(status_code=500, content={"error": "request_failed"})

    return {"ok": True, "uid": new_uid, "used": s["used"] + 1, "cap": s["cap"],
            "remaining": max(0, s["cap"] - s["used"] - 1), "tier": s["tier"]}


@router.get("/")
def list_investor_intros(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if _role_str(user).lower() not in ("investor", "admin"):
        return JSONResponse(status_code=403, content={"error": "investor_only"})
    rows = session.execute(
        text(
            "SELECT uid, investor_user_id, founder_user_id, founder_id, project_id, "
            "       message, status, quarter, created_at "
            "FROM investor_introductions WHERE investor_user_id=:uid "
            "ORDER BY created_at DESC LIMIT 200"
        ),
        {"uid": user.id},
    ).mappings().all()
    out = []
    for r in rows:
        created = r.get("created_at")
        out.append({
            "uid": r["uid"],
            "investor_user_id": r["investor_user_id"],
            "founder_user_id": r["founder_user_id"],
            "founder_id": r["founder_id"],
            "project_id": r["project_id"],
            "message": r.get("message"),
            "status": r["status"],
            "quarter": r["quarter"],
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
        })
    return {"introductions": out}
