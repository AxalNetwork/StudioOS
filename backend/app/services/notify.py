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

from sqlmodel import Session

from backend.app.database import engine
from backend.app.models.entities import Notification, User

logger = logging.getLogger("studioos.notify")

DEFAULT_CHANNELS = ("in_app",)


def _user_prefs(session: Session, user_id: int) -> dict:
    """Read notification_prefs JSON from users (canonical store, owned by
    settings.py and mirrored on the worker)."""
    try:
        from sqlalchemy import text
        row = session.exec(
            text("SELECT notification_prefs FROM users WHERE id = :uid").bindparams(uid=user_id)
        ).first()
        raw = row[0] if row else None
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _resolve_channels(prefs: dict, ntype: str, requested: Iterable[str]) -> list[str]:
    """Honor per-event, per-channel opt-outs from /settings/notifications.

    All three channels (in_app/email/slack) are user-toggleable via the
    matrix and default-on. If the user opts out of in_app for an event,
    we skip the inbox row + bell push entirely for that event but still
    deliver any other channels the user kept on.
    """
    ev = (prefs.get(ntype) or {}) if isinstance(prefs, dict) else {}
    out: list[str] = []
    for ch in requested:
        if ev.get(ch, True):  # default-on if user hasn't toggled
            out.append(ch)
    return out


def _post_slack(webhook: str, text_msg: str) -> None:
    # Defense-in-depth: only ever POST to Slack's incoming-webhook host over
    # https, so a tampered/misconfigured webhook value can't be used to reach
    # internal services (SSRF) or downgrade to http.
    if not webhook.lower().startswith("https://hooks.slack.com/"):
        logger.warning("notify: refusing webhook URL that is not https://hooks.slack.com/")
        return
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


# Captured by main.py:lifespan at startup. Lets sync route handlers
# (which run on a worker thread) schedule async WS broadcasts on the
# server's main event loop in a thread-safe way. None until startup.
MAIN_LOOP: Optional["asyncio.AbstractEventLoop"] = None


def _broadcast_ws(user_id: int, payload: dict) -> None:
    """Push to any connected WebSocket clients via the pipeline overview hub.

    Three call contexts to handle:
      1. Async route already running on the server loop -> create_task.
      2. Sync route running on a worker thread, MAIN_LOOP captured at
         startup -> run_coroutine_threadsafe (loop-safe, no new loop).
      3. Test / standalone scripts with no captured loop -> asyncio.run
         as a last-resort fallback so logic still exercises in unit tests.

    The PipelineRoom DO + backend manager filter `type:"notification"`
    frames to the recipient's socket(s); other connected clients never
    see them.
    """
    try:
        from backend.app.api.routes.pipeline_votes import manager
        msg = {"type": "notification", "user_id": user_id, "notification": payload}
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast(msg))
            return
        except RuntimeError:
            pass
        if MAIN_LOOP is not None and MAIN_LOOP.is_running():
            try:
                asyncio.run_coroutine_threadsafe(manager.broadcast(msg), MAIN_LOOP)
                return
            except Exception as exc:  # noqa: BLE001
                logger.warning("notify: run_coroutine_threadsafe failed: %s", exc)
        try:
            asyncio.run(manager.broadcast(msg))
        except Exception as exc:  # noqa: BLE001
            logger.warning("notify: ws broadcast fallback failed: %s", exc)
    except Exception as exc:
        logger.warning("notify: ws broadcast skipped: %s", exc)


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
            if not resolved:
                # User opted out of every requested channel for this event.
                return None

            user = session.get(User, user_id)
            if not user:
                return None

            row_id: Optional[int] = None
            if "in_app" in resolved:
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
                row_id = row.id
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
                # Task #57 — also fan out to web push subscriptions.
                # Best-effort AND non-blocking: pywebpush is synchronous and
                # network-bound (5s timeout × N devices). Running it inline
                # would stall the request that triggered notify(), so we
                # punt to a daemon thread. Exceptions inside the thread are
                # logged by web_push.send_to_user itself.
                try:
                    import threading
                    from backend.app.services.web_push import send_to_user as _push
                    _payload = {
                        "title": title,
                        "body": body,
                        "link": link,
                        "type": type,
                        "uid": row.uid,
                    }
                    _uid = user_id
                    threading.Thread(
                        target=_push,
                        args=(_uid, _payload),
                        daemon=True,
                        name=f"webpush-u{_uid}",
                    ).start()
                except Exception as _exc:  # noqa: BLE001
                    logger.warning("notify: web_push fan-out dispatch failed: %s", _exc)

            if "email" in resolved and user.email:
                _send_email(user.email, f"[Axal] {title}", body or title)

            if "slack" in resolved:
                hook = os.environ.get("SLACK_WEBHOOK_URL")
                if hook:
                    _post_slack(hook, f"*{title}*\n{body or ''}\n{link or ''}")

            return row_id
    except Exception as exc:
        logger.exception("notify failed for user=%s type=%s: %s", user_id, type, exc)
        return None
