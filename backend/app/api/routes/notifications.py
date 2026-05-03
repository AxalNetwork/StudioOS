"""Phase 0.2 — Notification center API.

Endpoints
    GET  /api/notifications              list (newest first)
    GET  /api/notifications/unread-count  badge count for the bell
    POST /api/notifications/mark-read     {ids:[...]}  or  {all: true}
    GET  /api/notifications/prefs         per-event channel matrix
    PUT  /api/notifications/prefs         persist matrix

Per-event preferences live on `users_extra.notification_prefs` (already
managed by the settings router). We expose dedicated read/write here so
the bell dropdown's "Notification settings" link can call a single API
without coupling to the larger /settings DTO.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select
from datetime import datetime

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Notification, User

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _to_dto(n: Notification) -> dict:
    return {
        "id": n.id,
        "uid": n.uid,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "payload": json.loads(n.payload) if n.payload else None,
        "channel": n.channel,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat(),
    }


@router.get("")
def list_notifications(
    limit: int = 50,
    only_unread: bool = False,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    limit = max(1, min(int(limit or 50), 200))
    stmt = select(Notification).where(Notification.user_id == user.id)
    if only_unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    rows = session.exec(stmt).all()
    return {"notifications": [_to_dto(n) for n in rows]}


@router.get("/unread-count")
def unread_count(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    n = session.exec(
        select(Notification.id)
        .where(Notification.user_id == user.id)
        .where(Notification.read_at.is_(None))
    ).all()
    return {"count": len(n)}


class MarkReadIn(BaseModel):
    ids: Optional[list[int]] = None
    all: Optional[bool] = False


@router.post("/mark-read")
def mark_read(
    data: MarkReadIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    now = datetime.utcnow()
    if data.all:
        rows = session.exec(
            select(Notification)
            .where(Notification.user_id == user.id)
            .where(Notification.read_at.is_(None))
        ).all()
    elif data.ids:
        rows = session.exec(
            select(Notification)
            .where(Notification.user_id == user.id)
            .where(Notification.id.in_(data.ids))
        ).all()
    else:
        raise HTTPException(status_code=422, detail="Provide ids[] or all=true")
    updated = 0
    for r in rows:
        if r.read_at is None:
            r.read_at = now
            session.add(r)
            updated += 1
    session.commit()
    return {"updated": updated}


@router.get("/prefs")
def get_prefs(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # Canonical store is `users.notification_prefs` (owned by settings.py
    # which also adds the column via _ensure_schema). The Cloudflare worker
    # mirrors the same column on D1 so prod + dev stay in lockstep.
    try:
        row = session.exec(
            text("SELECT notification_prefs FROM users WHERE id = :uid").bindparams(uid=user.id)
        ).first()
        raw = row[0] if row else None
        return {"prefs": json.loads(raw) if raw else {}}
    except Exception:
        return {"prefs": {}}


class PrefsIn(BaseModel):
    prefs: dict


@router.put("/prefs")
def put_prefs(
    data: PrefsIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    j = json.dumps(data.prefs or {})
    if len(j) > 16_000:
        raise HTTPException(status_code=400, detail="notification_prefs too large")
    try:
        session.exec(
            text("UPDATE users SET notification_prefs = :p WHERE id = :uid").bindparams(uid=user.id, p=j)
        )
        session.commit()
    except Exception as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save prefs: {exc}")
    return {"ok": True}
