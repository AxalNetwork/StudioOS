"""Task #66 — Follow graph for people + startups. Mounted at ``/api/follows``.

Dev-only FastAPI mirror of ``cloudflare-worker/src/routes/follows.ts`` so the
shared frontend renders identically against prod (Worker) and dev (FastAPI).

Open to any signed-in user (unlike the investor-only watchlist, which is a DD
instrument). A follow is a ``(follower_user_id, entity_type, entity_id)`` triple
where ``entity_type`` is ``'user'`` or ``'project'``. Follower counts are public;
the caller's own following state requires auth.

    POST   /api/follows            { entity_type, entity_id }  — follow
    DELETE /api/follows            { entity_type, entity_id }  — unfollow
    GET    /api/follows/status?entity_type=&entity_id=         — { following, followers }
    GET    /api/follows/mine                                   — { users:[], projects:[] }
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlmodel import Session, text

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

logger = logging.getLogger("studioos.follows")
router = APIRouter(prefix="/follows", tags=["follows"])

_schema_ready = False


def _ensure_follows_schema(session: Session) -> None:
    """Idempotent CREATE TABLE / INDEX. Mirrors the worker's follows table.
    Each statement is its own transaction so one failure doesn't poison the
    rest, and we cache the success flag to keep request latency low."""
    global _schema_ready
    if _schema_ready:
        return
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS follows (
                id BIGSERIAL PRIMARY KEY,
                follower_user_id INTEGER NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (follower_user_id, entity_type, entity_id)
            )
            """
        ))
        session.commit()
    except Exception:
        session.rollback()
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_follows_entity ON follows(entity_type, entity_id)",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    _schema_ready = True


def _parse_target(entity_type, entity_id) -> Optional[tuple[str, int]]:
    t = str(entity_type or "").strip().lower()
    try:
        i = int(entity_id)
    except (TypeError, ValueError):
        return None
    if t not in ("user", "project") or i <= 0:
        return None
    return (t, i)


def _target_exists(session: Session, t: str, i: int) -> bool:
    """Validate the target exists (and, for users, is active) so we don't
    accrue follows against phantom ids. Projects have no soft-delete column
    in the dev schema, so a plain existence check is used there."""
    if t == "user":
        row = session.exec(text(
            "SELECT id FROM users WHERE id = :i AND is_active = TRUE"
        ).bindparams(i=i)).first()
        return bool(row)
    row = session.exec(text(
        "SELECT id FROM projects WHERE id = :i"
    ).bindparams(i=i)).first()
    return bool(row)


def _follower_count(session: Session, t: str, i: int) -> int:
    try:
        row = session.exec(text(
            "SELECT COUNT(*) AS c FROM follows WHERE entity_type = :t AND entity_id = :i"
        ).bindparams(t=t, i=i)).first()
        return int((row._mapping["c"] if row else 0) or 0)  # type: ignore[attr-defined]
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        return 0


def _optional_user(authorization: Optional[str], session: Session) -> Optional[User]:
    """Resolve the caller when a valid bearer token is present, else None.
    Lets ``/status`` return follower counts to anonymous visitors while still
    reporting the caller's own following state when authenticated."""
    if not authorization:
        return None
    try:
        return get_current_user(authorization=authorization, session=session)
    except Exception:
        return None


@router.post("")
@router.post("/")
def follow(
    payload: dict = Body(default={}),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_follows_schema(session)
    tgt = _parse_target(payload.get("entity_type"), payload.get("entity_id"))
    if not tgt:
        raise HTTPException(status_code=400, detail="entity_type (user|project) and entity_id required")
    t, i = tgt
    if t == "user" and i == user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    if not _target_exists(session, t, i):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        session.exec(text(
            "INSERT INTO follows (follower_user_id, entity_type, entity_id) "
            "VALUES (:f, :t, :i) "
            "ON CONFLICT (follower_user_id, entity_type, entity_id) DO NOTHING"
        ).bindparams(f=user.id, t=t, i=i))
        session.commit()
    except Exception:
        session.rollback()
    return {"following": True, "followers": _follower_count(session, t, i)}


@router.delete("")
@router.delete("/")
def unfollow(
    payload: dict = Body(default={}),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_follows_schema(session)
    tgt = _parse_target(payload.get("entity_type"), payload.get("entity_id"))
    if not tgt:
        raise HTTPException(status_code=400, detail="entity_type (user|project) and entity_id required")
    t, i = tgt
    try:
        session.exec(text(
            "DELETE FROM follows WHERE follower_user_id = :f AND entity_type = :t AND entity_id = :i"
        ).bindparams(f=user.id, t=t, i=i))
        session.commit()
    except Exception:
        session.rollback()
    return {"following": False, "followers": _follower_count(session, t, i)}


@router.get("/status")
def follow_status(
    entity_type: Optional[str] = Query(default=None),
    entity_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    _ensure_follows_schema(session)
    tgt = _parse_target(entity_type, entity_id)
    if not tgt:
        raise HTTPException(status_code=400, detail="entity_type (user|project) and entity_id required")
    t, i = tgt
    following = False
    user = _optional_user(authorization, session)
    if user is not None:
        try:
            row = session.exec(text(
                "SELECT 1 FROM follows WHERE follower_user_id = :f AND entity_type = :t AND entity_id = :i"
            ).bindparams(f=user.id, t=t, i=i)).first()
            following = bool(row)
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
    return {"following": following, "followers": _follower_count(session, t, i)}


@router.get("/mine")
def follows_mine(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_follows_schema(session)
    try:
        rows = session.exec(text(
            "SELECT entity_type, entity_id FROM follows "
            "WHERE follower_user_id = :f ORDER BY created_at DESC LIMIT 500"
        ).bindparams(f=user.id)).all()
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        rows = []
    user_ids = [int(r._mapping["entity_id"]) for r in rows if r._mapping["entity_type"] == "user"]  # type: ignore[attr-defined]
    project_ids = [int(r._mapping["entity_id"]) for r in rows if r._mapping["entity_type"] == "project"]  # type: ignore[attr-defined]

    users: list[dict] = []
    if user_ids:
        try:
            ur = session.exec(text(
                "SELECT id, uid, name, role FROM users WHERE id = ANY(:ids)"
            ).bindparams(ids=user_ids)).all()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
            ur = []
        for u in ur:
            m = u._mapping  # type: ignore[attr-defined]
            users.append({
                "id": m["id"],
                "handle": m["uid"],
                "name": m["name"] or None,
                "headline": None,
                "role": (m["role"].value if hasattr(m["role"], "value") else m["role"]),
            })

    projects: list[dict] = []
    if project_ids:
        try:
            pr = session.exec(text(
                "SELECT id, uid, name, sector, stage FROM projects WHERE id = ANY(:ids)"
            ).bindparams(ids=project_ids)).all()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass
            pr = []
        for p in pr:
            m = p._mapping  # type: ignore[attr-defined]
            projects.append({
                "id": m["id"],
                "handle": m["uid"],
                "name": m["name"],
                "sector": m["sector"],
                "stage": m["stage"],
            })

    return {"users": users, "projects": projects}
