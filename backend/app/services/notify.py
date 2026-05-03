"""Phase 0.2 — notification publisher.

Single fan-out helper used by every downstream feature (ticket update,
score generated, deal stage change, capital call, vote threshold). Writes
the in-app row first (durable, mark-readable from the bell), then best-
effort dispatches to email + Slack based on the user's per-event channel
preferences in `users_extra.notification_prefs`.

Dispatch is intentionally fire-and-forget: a downed Slack webhook must
never break the underlying business action. WebSocket fan-out happens
via `pipeline_votes.manager` (already established broadcast hub) so the
NotificationBell on connected clients gets a push without a new DO.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Iterable, Optional
from urllib.request import Request as _UrlRequest, urlopen

from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import Notification, User

logger = logging.getLogger("studioos.notify")

DEFAULT_CHANNELS = ("in_app",)


def _user_prefs(session: Session, user_id: int) -> dict:
    """Read notification_prefs JSON from users_extra; tolerant of absence."""
    try:
        from sqlalchemy import text
        row = session.exec(
            text("SELECT notification_prefs FROM users_extra WHERE user_id = :uid").bindparams(uid=user_id)
        ).first()
        raw = row[0] if row else None
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _resolve_channels(prefs: dict, ntype: str, requested: Iterable[str]) -> list[str]:
    """Honor user opt-outs. in_app is always on (it's the inbox).

    `requested` is the set the caller wants to attempt; the per-event matrix
    in /settings/notifications can suppress email/slack per type.
    """
    out = ["in_app"]
    ev = (prefs.get(ntype) or {}) if isinstance(prefs, dict) else {}
    for ch in requested:
        if ch == "in_app":
            continue
        if ev.get(ch, True):  # default-on if user hasn't toggled
            out.append(ch)
    return out


def _post_slack(webhook: str, text_msg: str) -> None:
    try:
        req = _UrlRequest(
            webhook,
            data=json.dumps({"text": text_msg}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urlopen(req, timeout=3).read()
    except Exception as exc:
        logger.warning("notify: slack post failed: %s", exc)


def _send_email(to_email: str, subject: str, body: str) -> None:
    try:
        from backend.app.services.email_service import send_transactional_email
        send_transactional_email(to_email, subject, body)
    except Exception as exc:
        logger.warning("notify: email send failed: %s", exc)


def _broadcast_ws(user_id: int, payload: dict) -> None:
    """Push to any connected WebSocket clients via the pipeline overview hub.

    The pipeline_votes manager broadcasts to ALL connected clients; the
    frontend filters by user_id so other users ignore the message. This
    keeps us from standing up a per-user channel for v1.
    """
    try:
        from backend.app.api.routes.pipeline_votes import manager
        msg = {"type": "notification", "user_id": user_id, "notification": payload}
        # manager.broadcast is async; schedule on running loop or run sync.
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast(msg))
        except RuntimeError:
            asyncio.run(manager.broadcast(msg))
    except Exception as exc:
        logger.debug("notify: ws broadcast skipped: %s", exc)


def notify(
    user_id: int,
    type: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    payload: Optional[dict] = None,
    channels: Iterable[str] = DEFAULT_CHANNELS,
) -> Optional[int]:
    """Persist + fan out one notification. Returns the row id on success."""
    try:
        with Session(engine) as session:
            prefs = _user_prefs(session, user_id)
            resolved = _resolve_channels(prefs, type, channels)

            row = Notification(
                user_id=user_id,
                type=type,
                title=title,
                body=body,
                link=link,
                payload=json.dumps(payload) if payload is not None else None,
                channel=",".join(resolved),
            )
            session.add(row)
            session.commit()
            session.refresh(row)

            user = session.get(User, user_id)
            if not user:
                return row.id

            ws_payload = {
                "id": row.id,
                "uid": row.uid,
                "type": row.type,
                "title": row.title,
                "body": row.body,
                "link": row.link,
                "created_at": row.created_at.isoformat(),
                "read_at": None,
            }
            _broadcast_ws(user_id, ws_payload)

            if "email" in resolved and user.email:
                _send_email(user.email, f"[Axal] {title}", body or title)

            if "slack" in resolved:
                hook = os.environ.get("SLACK_WEBHOOK_URL")
                if hook:
                    _post_slack(hook, f"*{title}*\n{body or ''}\n{link or ''}")

            return row.id
    except Exception as exc:
        logger.exception("notify failed for user=%s type=%s: %s", user_id, type, exc)
        return None
