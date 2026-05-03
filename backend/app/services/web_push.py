"""Task #57 — Web Push (VAPID) fan-out helper.

Used by `notify()` to mirror in-app notifications to any browser that
the user has subscribed for push from. Subscriptions are stored in the
`push_subscriptions` table (see migrations.py); each row is a JSON blob
containing the endpoint + p256dh + auth keys returned by the browser's
`PushManager.subscribe()` call.

VAPID keys are read from environment variables — generated once via
`generate_vapid_keys()` (called automatically on first read if missing
and the runtime allows ephemeral keys, used in dev). In production the
operator should set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`VAPID_CLAIM_EMAIL` so subscriptions survive restarts.

Delivery is fire-and-forget: a 410/404 from the push service marks the
subscription as gone and prunes it; any other error is logged and
swallowed so a downed browser never breaks an in-app notification.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session

from backend.app.database import engine

logger = logging.getLogger("studioos.webpush")

# Cached in-process so we don't re-generate ephemeral keys on every send.
_VAPID_CACHE: dict[str, Optional[str]] = {"public": None, "private": None, "claim": None}


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_vapid_keys() -> dict[str, str]:
    """Generate a fresh P-256 VAPID keypair, returning urlsafe-b64 strings."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    priv_bytes = priv.private_numbers().private_value.to_bytes(32, "big")
    pub_bytes = priv.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return {"public": _b64u(pub_bytes), "private": _b64u(priv_bytes)}


def get_vapid() -> tuple[Optional[str], Optional[str], str]:
    """Return (public_key_b64u, private_key_b64u, claim_email).

    Reads from env first; on first call without env vars in dev, mints an
    ephemeral keypair and caches it in process — the public key is then
    served to the browser so a subscribe still works for the duration of
    this process. The operator should set env vars for production.
    """
    pub = os.environ.get("VAPID_PUBLIC_KEY") or _VAPID_CACHE["public"]
    priv = os.environ.get("VAPID_PRIVATE_KEY") or _VAPID_CACHE["private"]
    claim = os.environ.get("VAPID_CLAIM_EMAIL") or _VAPID_CACHE["claim"] or "mailto:ops@axal.vc"
    if not pub or not priv:
        keys = generate_vapid_keys()
        _VAPID_CACHE["public"] = pub = keys["public"]
        _VAPID_CACHE["private"] = priv = keys["private"]
        _VAPID_CACHE["claim"] = claim
        logger.warning("web_push: VAPID env not set — generated ephemeral keypair "
                       "(subscriptions made now will fail after restart). "
                       "Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in env.")
    return pub, priv, claim


def public_key_b64() -> str:
    return get_vapid()[0] or ""


def send_to_user(user_id: int, payload: dict) -> int:
    """Push `payload` (a small JSON dict) to every subscription this user
    has registered. Returns the count actually attempted. Dead endpoints
    (410/404) are pruned. Wrapped so this never raises."""
    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # noqa: BLE001
        logger.warning("web_push: pywebpush not installed: %s", exc)
        return 0

    pub, priv, claim = get_vapid()
    if not priv:
        return 0

    sent = 0
    with Session(engine) as session:
        rows = session.exec(text(
            "SELECT id, subscription_json FROM push_subscriptions WHERE user_id = :u"
        ).bindparams(u=user_id)).all()
        if not rows:
            return 0

        body = json.dumps(payload, default=str)
        for row_id, sub_json in rows:
            try:
                sub = json.loads(sub_json) if isinstance(sub_json, str) else sub_json
                webpush(
                    subscription_info=sub,
                    data=body,
                    vapid_private_key=priv,
                    vapid_claims={"sub": claim},
                    timeout=5,
                )
                sent += 1
            except WebPushException as exc:  # noqa: BLE001
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    # Subscription is dead — prune.
                    session.exec(text("DELETE FROM push_subscriptions WHERE id = :i")
                                 .bindparams(i=row_id))
                    session.commit()
                    logger.info("web_push: pruned dead subscription id=%s", row_id)
                else:
                    logger.warning("web_push: send failed (status=%s): %s", status, exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("web_push: unexpected send failure: %s", exc)
    return sent
