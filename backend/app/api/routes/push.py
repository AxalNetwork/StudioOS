"""Task #57 — Web Push subscription management.

Surface owned by the notification center: the bell dropdown's "Enable
push" button calls these endpoints to register the browser's PushManager
subscription, and to revoke it on toggle-off / sign-out.

Endpoints
    GET  /api/notifications/push/vapid-key       -> {public_key}
    POST /api/notifications/push/subscribe       body = full subscription JSON
    POST /api/notifications/push/unsubscribe     body = {endpoint}
    GET  /api/notifications/push/subscriptions   -> list (count only, not the JSON)
    POST /api/notifications/push/test            -> fire a test push to caller
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User
from backend.app.services.web_push import public_key_b64, send_to_user

logger = logging.getLogger("studioos.push")

router = APIRouter(prefix="/notifications/push", tags=["Notifications"])


@router.get("/vapid-key")
def vapid_key():
    pk = public_key_b64()
    if not pk:
        raise HTTPException(status_code=503, detail="Push is not configured on this server")
    return {"public_key": pk}


class SubscribeIn(BaseModel):
    endpoint: str
    keys: dict
    expirationTime: Optional[int] = None
    user_agent: Optional[str] = None


@router.post("/subscribe", status_code=201)
def subscribe(body: SubscribeIn, request: Request,
              user: User = Depends(get_current_user),
              session: Session = Depends(get_session)):
    """Idempotent on (user_id, endpoint). Re-subscribing replaces the
    stored keys + user_agent in case the browser rotated them."""
    if not body.endpoint or not body.keys.get("p256dh") or not body.keys.get("auth"):
        raise HTTPException(status_code=400, detail="Subscription must include endpoint + keys.p256dh + keys.auth")

    sub_json = json.dumps({
        "endpoint": body.endpoint,
        "keys": {"p256dh": body.keys["p256dh"], "auth": body.keys["auth"]},
        "expirationTime": body.expirationTime,
    })
    ua = body.user_agent or request.headers.get("user-agent") or ""

    # Upsert by (user_id, endpoint)
    existing = session.exec(text(
        "SELECT id FROM push_subscriptions WHERE user_id = :u AND endpoint = :e"
    ).bindparams(u=user.id, e=body.endpoint)).first()
    if existing:
        session.exec(text("""
            UPDATE push_subscriptions
               SET subscription_json = :s, user_agent = :ua, updated_at = CURRENT_TIMESTAMP
             WHERE id = :i
        """).bindparams(s=sub_json, ua=ua, i=existing[0]))
    else:
        session.exec(text("""
            INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, user_agent)
            VALUES (:u, :e, :s, :ua)
        """).bindparams(u=user.id, e=body.endpoint, s=sub_json, ua=ua))
    session.commit()
    return {"ok": True, "endpoint": body.endpoint}


class UnsubscribeIn(BaseModel):
    endpoint: str


@router.post("/unsubscribe")
def unsubscribe(body: UnsubscribeIn,
                user: User = Depends(get_current_user),
                session: Session = Depends(get_session)):
    session.exec(text(
        "DELETE FROM push_subscriptions WHERE user_id = :u AND endpoint = :e"
    ).bindparams(u=user.id, e=body.endpoint))
    session.commit()
    return {"ok": True}


@router.get("/subscriptions")
def list_subscriptions(user: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    rows = session.exec(text(
        "SELECT endpoint, user_agent, created_at, updated_at FROM push_subscriptions WHERE user_id = :u ORDER BY updated_at DESC"
    ).bindparams(u=user.id)).all()
    return {
        "count": len(rows),
        "subscriptions": [
            {"endpoint": r[0], "user_agent": r[1],
             "created_at": r[2].isoformat() if r[2] else None,
             "updated_at": r[3].isoformat() if r[3] else None}
            for r in rows
        ],
    }


@router.post("/test")
def push_test(user: User = Depends(get_current_user)):
    """Fire a tiny push to the calling user's subscriptions — used by the
    bell's "Enable push" wizard to confirm end-to-end delivery."""
    sent = send_to_user(user.id, {
        "title": "Push enabled",
        "body": "Notifications will now be delivered to this device.",
        "link": "/dashboard",
        "type": "push_test",
    })
    return {"ok": True, "sent": sent}
