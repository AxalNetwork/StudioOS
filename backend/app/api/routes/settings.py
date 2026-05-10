"""Epic 3 — Settings page (FastAPI dev mirror).

Mirrors `cloudflare-worker/src/routes/settings.ts` so the frontend works
identically against either backend during local development. The worker is
the production source of truth; this module only needs to be functional, not
identical line-for-line.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session, text

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User
from backend.app.services.email_service import send_verification_email

router = APIRouter(prefix="/settings", tags=["Settings"])


# --- one-shot schema migration ---------------------------------------------

_USER_COLUMNS = [
    ("bio", "TEXT"),
    ("headshot_local_path", "TEXT"),
    ("jurisdictions", "TEXT"),
    ("socials", "TEXT"),
    ("notification_prefs", "TEXT"),
    ("privacy_prefs", "TEXT"),
    ("role_prefs", "TEXT"),
    ("jwt_min_iat", "BIGINT DEFAULT 0"),
    ("deletion_requested_at", "TIMESTAMP"),
    ("totp_recovery_codes", "TEXT"),
]

FOUNDER_INVITE_CAP_PER_PROJECT = 10
FOUNDER_INVITE_EXPIRY_DAYS = 14

_migrated = False


def _ensure_schema(session: Session) -> None:
    """Idempotent ALTER / CREATE — Postgres in dev. Each statement is its own
    transaction so a single failure (e.g. column already exists) doesn't
    poison the rest, and we cache the success flag to keep request latency
    low after first boot."""
    global _migrated
    if _migrated:
        return
    for col, kind in _USER_COLUMNS:
        try:
            session.exec(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {kind}"))
            session.commit()
        except Exception:
            session.rollback()
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS email_change_requests (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    old_email TEXT NOT NULL,
                    new_email TEXT NOT NULL,
                    confirm_token_hash TEXT NOT NULL UNIQUE,
                    revoke_token_hash TEXT NOT NULL UNIQUE,
                    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confirm_expires_at TIMESTAMP NOT NULL,
                    revoke_expires_at TIMESTAMP NOT NULL,
                    confirmed_at TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    try:
        session.exec(text("CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_change_requests(user_id)"))
        session.commit()
    except Exception:
        session.rollback()
    # user_sessions
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    jti TEXT NOT NULL UNIQUE,
                    user_agent TEXT,
                    ip TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_us_user ON user_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_us_jti ON user_sessions(jti)",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    # founder_invites
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS founder_invites (
                    id BIGSERIAL PRIMARY KEY,
                    project_id INTEGER,
                    inviter_user_id INTEGER NOT NULL,
                    invitee_email TEXT NOT NULL,
                    invitee_name TEXT,
                    role TEXT NOT NULL DEFAULT 'co-founder',
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    accepted_at TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_fi_inviter ON founder_invites(inviter_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_fi_project ON founder_invites(project_id)",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    _migrated = True


# --- helpers ----------------------------------------------------------------


def _safe_json(raw: Any, fallback: Any) -> Any:
    if raw is None or raw == "":
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _user_extras(session: Session, user_id: int) -> dict[str, Any]:
    row = session.exec(
        text(
            """
            SELECT bio, headshot_local_path, jurisdictions, socials,
                   notification_prefs, privacy_prefs, role_prefs,
                   jwt_min_iat, deletion_requested_at, totp_recovery_codes
            FROM users WHERE id = :uid
            """
        ).bindparams(uid=user_id)
    ).first()
    if row is None:
        return {}
    return dict(row._mapping)  # type: ignore[attr-defined]


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    return secrets.token_urlsafe(48)


def _app_url() -> str:
    domain = os.environ.get("REPLIT_DEV_DOMAIN")
    if domain:
        return f"https://{domain}"
    return os.environ.get("APP_URL", "http://localhost:5000")


_HEADSHOT_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_HEADSHOT_DIR = Path(os.environ.get("HEADSHOT_DIR", "/tmp/axal_headshots"))


def _is_email(value: str) -> bool:
    import re

    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", value or ""))


# --- GET /api/settings ------------------------------------------------------


@router.get("")
@router.get("/")
def get_settings(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    extras = _user_extras(session, user.id)
    pending_row = session.exec(
        text(
            """
            SELECT id, new_email, requested_at, confirm_expires_at
            FROM email_change_requests
            WHERE user_id = :uid AND confirmed_at IS NULL AND revoked_at IS NULL
              AND confirm_expires_at > CURRENT_TIMESTAMP
            ORDER BY requested_at DESC LIMIT 1
            """
        ).bindparams(uid=user.id)
    ).first()
    pending = None
    if pending_row is not None:
        m = pending_row._mapping  # type: ignore[attr-defined]
        pending = {
            "new_email": m["new_email"],
            "requested_at": str(m["requested_at"]),
            "expires_at": str(m["confirm_expires_at"]),
        }

    recovery_codes = _safe_json(extras.get("totp_recovery_codes"), [])
    return {
        "id": user.id,
        "uid": user.uid,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        # Task #55 — expose the public handle so the Settings UI can
        # show "Your public profile lives at /u/<handle>".
        "handle": getattr(user, "handle", None),
        "email_verified": user.email_verified,
        "totp_configured": bool(user.password_hash),
        "kyc_status": getattr(user, "kyc_status", None) or "not_started",
        "access_level": getattr(user, "access_level", None),
        "last_active_at": str(user.last_active_at) if user.last_active_at else None,
        "created_at": str(user.created_at) if user.created_at else None,
        "profile": {
            "bio": extras.get("bio") or "",
            "headshot_url": (
                f"/api/settings/headshot/{user.uid}" if extras.get("headshot_local_path") else None
            ),
            "socials": _safe_json(extras.get("socials"), {}),
        },
        "jurisdictions": _safe_json(extras.get("jurisdictions"), []),
        "notification_prefs": _safe_json(extras.get("notification_prefs"), {}),
        "privacy_prefs": _safe_json(
            extras.get("privacy_prefs"),
            {"public_profile": {"name": True, "bio": True, "headshot": True, "socials": False}},
        ),
        "role_prefs": _safe_json(extras.get("role_prefs"), {}),
        "deletion_requested_at": (
            str(extras.get("deletion_requested_at")) if extras.get("deletion_requested_at") else None
        ),
        "pending_email_change": pending,
        "totp_recovery_codes_remaining": len(recovery_codes) if isinstance(recovery_codes, list) else 0,
        "current_jti": _current_jti_from_request(request),
    }


def _current_jti_from_request(request: Request) -> Optional[str]:
    """Return the jti claim of the bearer token on this request, or None.

    Decoded without verification — the token has already been validated
    upstream by ``get_current_user``. Used so the Settings → Active sessions
    list can highlight "this device".
    """
    try:
        auth = request.headers.get("authorization") or ""
        if not auth.lower().startswith("bearer "):
            return None
        token = auth.split(" ", 1)[1].strip()
        if not token:
            return None
        payload = jwt.decode(token, options={"verify_signature": False})
        jti = payload.get("jti")
        return jti if isinstance(jti, str) and jti else None
    except Exception:
        return None


# --- PATCH /api/settings ----------------------------------------------------


class _SettingsPatch(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    socials: Optional[dict] = None
    jurisdictions: Optional[list] = None
    notification_prefs: Optional[dict] = None
    privacy_prefs: Optional[dict] = None
    role_prefs: Optional[dict] = None


@router.patch("")
@router.patch("/")
def patch_settings(
    payload: _SettingsPatch,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    updates: list[tuple[str, Any]] = []

    if payload.name is not None:
        n = payload.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        updates.append(("name", n[:120]))
    if payload.bio is not None:
        updates.append(("bio", payload.bio.strip()[:2000] if payload.bio else None))
    if payload.socials is not None:
        safe = {}
        for k in ("linkedin", "twitter", "website", "github"):
            v = payload.socials.get(k) if payload.socials else None
            if isinstance(v, str) and v.strip():
                safe[k] = v.strip()[:300]
        updates.append(("socials", json.dumps(safe)))
    if payload.jurisdictions is not None:
        safe = []
        for x in payload.jurisdictions or []:
            s = str(x or "").strip().upper()
            if 2 <= len(s) <= 3 and s.isalpha():
                safe.append(s)
        updates.append(("jurisdictions", json.dumps(safe[:30])))
    if payload.notification_prefs is not None:
        j = json.dumps(payload.notification_prefs)
        if len(j) > 8000:
            raise HTTPException(status_code=400, detail="notification_prefs too large")
        updates.append(("notification_prefs", j))
    if payload.privacy_prefs is not None:
        j = json.dumps(payload.privacy_prefs)
        if len(j) > 4000:
            raise HTTPException(status_code=400, detail="privacy_prefs too large")
        updates.append(("privacy_prefs", j))
    if payload.role_prefs is not None:
        j = json.dumps(payload.role_prefs)
        if len(j) > 16000:
            raise HTTPException(status_code=400, detail="role_prefs too large")
        updates.append(("role_prefs", j))

    if not updates:
        return {"ok": True, "updated": 0}

    for col, val in updates:
        session.exec(
            text(f"UPDATE users SET {col} = :v WHERE id = :uid").bindparams(v=val, uid=user.id)
        )
    session.commit()
    return {"ok": True, "updated": len(updates)}


# --- Headshot upload + stream -----------------------------------------------


class _HeadshotPayload(BaseModel):
    data_uri: str


@router.post("/headshot")
def upload_headshot(
    payload: _HeadshotPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    data_uri = payload.data_uri or ""
    if not data_uri.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="data_uri must be a data:image/* URI")
    if len(data_uri) > 4_500_000:
        raise HTTPException(status_code=413, detail="Image too large (max ~3MB)")
    try:
        meta_part, b64 = data_uri.split(",", 1)
        content_type = meta_part[5:].split(";")[0].strip()
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed data URI")
    ext = _HEADSHOT_MIME.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {content_type}")
    try:
        raw_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")
    if len(raw_bytes) > 3 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 3MB limit")

    _HEADSHOT_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{user.id}_{uuid.uuid4().hex}.{ext}"
    fpath = _HEADSHOT_DIR / fname
    fpath.write_bytes(raw_bytes)

    # Best-effort cleanup of previous file.
    prev = session.exec(
        text("SELECT headshot_local_path FROM users WHERE id = :uid").bindparams(uid=user.id)
    ).first()
    old_path = prev._mapping["headshot_local_path"] if prev else None  # type: ignore[attr-defined]
    session.exec(
        text("UPDATE users SET headshot_local_path = :p WHERE id = :uid").bindparams(
            p=str(fpath), uid=user.id
        )
    )
    session.commit()
    if old_path and old_path != str(fpath):
        try:
            Path(old_path).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True, "headshot_url": f"/api/settings/headshot/{user.uid}"}


@router.get("/headshot/{user_uid}")
def stream_headshot(user_uid: str, session: Session = Depends(get_session)):
    _ensure_schema(session)
    row = session.exec(
        text(
            "SELECT headshot_local_path, privacy_prefs FROM users WHERE uid = :u OR cast(id as text) = :u"
        ).bindparams(u=user_uid)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    m = row._mapping  # type: ignore[attr-defined]
    if not m.get("headshot_local_path"):
        raise HTTPException(status_code=404, detail="Not found")
    privacy = _safe_json(m.get("privacy_prefs"), {"public_profile": {"headshot": True}})
    if (privacy or {}).get("public_profile", {}).get("headshot") is False:
        raise HTTPException(status_code=404, detail="Not found")
    fpath = Path(m["headshot_local_path"])
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="Not found")
    suffix = fpath.suffix.lower().lstrip(".")
    content_type = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(
        suffix, "application/octet-stream"
    )
    return Response(
        content=fpath.read_bytes(),
        media_type=content_type,
        headers={"cache-control": "public, max-age=300"},
    )


# --- Email change flow ------------------------------------------------------


class _EmailChangeRequest(BaseModel):
    new_email: str


@router.post("/email-change/request")
def email_change_request(
    payload: _EmailChangeRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    new_email = (payload.new_email or "").strip().lower()
    if not _is_email(new_email):
        raise HTTPException(status_code=400, detail="Valid new_email required")
    if new_email == (user.email or "").lower():
        raise HTTPException(status_code=400, detail="New email matches current email")
    taken = session.exec(
        text("SELECT 1 FROM users WHERE lower(email) = :e AND id != :uid").bindparams(
            e=new_email, uid=user.id
        )
    ).first()
    if taken is not None:
        raise HTTPException(status_code=409, detail="That email is already in use")

    # Cancel outstanding pending requests.
    session.exec(
        text(
            """UPDATE email_change_requests
               SET revoked_at = CURRENT_TIMESTAMP
               WHERE user_id = :uid AND confirmed_at IS NULL AND revoked_at IS NULL"""
        ).bindparams(uid=user.id)
    )

    confirm_raw = _generate_token()
    revoke_raw = _generate_token()
    confirm_hash = _hash_token(confirm_raw)
    revoke_hash = _hash_token(revoke_raw)
    now = datetime.utcnow()
    confirm_expires = (now + timedelta(hours=24)).isoformat()
    revoke_expires = (now + timedelta(hours=24)).isoformat()
    session.exec(
        text(
            """INSERT INTO email_change_requests
               (user_id, old_email, new_email, confirm_token_hash, revoke_token_hash,
                confirm_expires_at, revoke_expires_at)
               VALUES (:uid, :oe, :ne, :ch, :rh, :ce, :re)"""
        ).bindparams(
            uid=user.id, oe=user.email, ne=new_email, ch=confirm_hash, rh=revoke_hash,
            ce=confirm_expires, re=revoke_expires,
        )
    )
    session.commit()

    confirm_url = f"{_app_url()}/settings/email/confirm?token={confirm_raw}"
    revoke_url = f"{_app_url()}/settings/email/revoke?token={revoke_raw}"
    sent_confirm = bool(send_verification_email(new_email, user.name or new_email, confirm_url))
    sent_revoke = bool(send_verification_email(user.email, user.name or user.email, revoke_url))

    out = {
        "ok": True,
        "new_email": new_email,
        "confirm_expires_at": confirm_expires,
        "revoke_expires_at": revoke_expires,
        "email_sent": sent_confirm,
    }
    # Surface dev links when email isn't actually delivered (no Gmail creds).
    if not sent_confirm:
        out["confirm_url"] = confirm_url
    if not sent_revoke:
        out["revoke_url"] = revoke_url
    return out


class _TokenPayload(BaseModel):
    token: str


@router.post("/email-change/confirm")
def email_change_confirm(payload: _TokenPayload, session: Session = Depends(get_session)):
    _ensure_schema(session)
    if not payload.token:
        raise HTTPException(status_code=400, detail="Token required")
    th = _hash_token(payload.token)
    rec = session.exec(
        text("SELECT * FROM email_change_requests WHERE confirm_token_hash = :h").bindparams(h=th)
    ).first()
    if rec is None:
        raise HTTPException(status_code=400, detail="Invalid or expired link")
    m = rec._mapping  # type: ignore[attr-defined]
    if m["confirmed_at"]:
        raise HTTPException(status_code=400, detail="Already confirmed")
    if m["revoked_at"]:
        raise HTTPException(status_code=400, detail="This change was revoked")
    expires = m["confirm_expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Confirmation link expired")

    taken = session.exec(
        text("SELECT 1 FROM users WHERE lower(email) = :e AND id != :uid").bindparams(
            e=str(m["new_email"]).lower(), uid=m["user_id"]
        )
    ).first()
    if taken is not None:
        raise HTTPException(status_code=409, detail="That email was claimed by another account")

    session.exec(
        text("UPDATE users SET email = :e WHERE id = :uid").bindparams(
            e=m["new_email"], uid=m["user_id"]
        )
    )
    session.exec(
        text("UPDATE email_change_requests SET confirmed_at = CURRENT_TIMESTAMP WHERE id = :i").bindparams(
            i=m["id"]
        )
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('email_changed', :d, :a, :uid)"""
        ).bindparams(
            d=f"Email changed from {m['old_email']} to {m['new_email']} (revocable until {m['revoke_expires_at']})",
            a=m["new_email"], uid=m["user_id"],
        )
    )
    session.commit()
    return {"ok": True, "email": m["new_email"], "revoke_expires_at": str(m["revoke_expires_at"])}


@router.post("/email-change/revoke")
def email_change_revoke(payload: _TokenPayload, session: Session = Depends(get_session)):
    _ensure_schema(session)
    if not payload.token:
        raise HTTPException(status_code=400, detail="Token required")
    th = _hash_token(payload.token)
    rec = session.exec(
        text("SELECT * FROM email_change_requests WHERE revoke_token_hash = :h").bindparams(h=th)
    ).first()
    if rec is None:
        raise HTTPException(status_code=400, detail="Invalid or expired link")
    m = rec._mapping  # type: ignore[attr-defined]
    if m["revoked_at"]:
        raise HTTPException(status_code=400, detail="Already revoked")
    expires = m["revoke_expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Revocation window expired")
    if m["confirmed_at"]:
        session.exec(
            text("UPDATE users SET email = :e WHERE id = :uid").bindparams(
                e=m["old_email"], uid=m["user_id"]
            )
        )
    session.exec(
        text("UPDATE email_change_requests SET revoked_at = CURRENT_TIMESTAMP WHERE id = :i").bindparams(
            i=m["id"]
        )
    )
    now_sec = int(time.time())
    session.exec(
        text("UPDATE users SET jwt_min_iat = :n WHERE id = :uid").bindparams(
            n=now_sec, uid=m["user_id"]
        )
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('email_change_revoked', :d, :a, :uid)"""
        ).bindparams(
            d=f"Email change revoked: {m['new_email']} -> {m['old_email']}; all sessions invalidated",
            a=m["old_email"], uid=m["user_id"],
        )
    )
    session.commit()
    return {"ok": True, "email": m["old_email"]}


# --- TOTP repair ------------------------------------------------------------


class _TotpRepair(BaseModel):
    totp_code: str


@router.post("/totp/repair")
def totp_repair(
    payload: _TotpRepair,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    import pyotp

    if not user.password_hash:
        raise HTTPException(status_code=400, detail="TOTP is not configured for this account")
    if not pyotp.TOTP(user.password_hash).verify(payload.totp_code or "", valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid current TOTP code")

    new_secret = pyotp.random_base32()
    new_uri = pyotp.TOTP(new_secret).provisioning_uri(name=user.email, issuer_name="Axal VC StudioOS")
    session.exec(
        text("UPDATE users SET password_hash = :p WHERE id = :uid").bindparams(
            p=new_secret, uid=user.id
        )
    )
    now_sec = int(time.time())
    session.exec(
        text("UPDATE users SET jwt_min_iat = :n WHERE id = :uid").bindparams(n=now_sec, uid=user.id)
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('totp_repaired',
                       'User re-paired TOTP from /settings; all sessions invalidated',
                       :a, :uid)"""
        ).bindparams(a=user.email, uid=user.id)
    )
    session.commit()

    qr_b64: Optional[str] = None
    try:
        import qrcode

        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(new_uri)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        pass

    return {
        "ok": True,
        "totp_secret": new_secret,
        "provisioning_uri": new_uri,
        "qr_code": qr_b64,
        "message": "Scan the new QR with your authenticator. Your existing sessions have been signed out.",
    }


# --- Sessions: sign out everywhere ------------------------------------------


@router.post("/sessions/revoke-all")
def revoke_all_sessions(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    _ensure_schema(session)
    now_sec = int(time.time()) + 1
    session.exec(
        text("UPDATE users SET jwt_min_iat = :n WHERE id = :uid").bindparams(n=now_sec, uid=user.id)
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('sessions_revoked_all', 'User revoked all active sessions from /settings',
                       :a, :uid)"""
        ).bindparams(a=user.email, uid=user.id)
    )
    session.commit()
    return {"ok": True, "revoked_at": now_sec}


# --- Account: delete request + data export ----------------------------------


@router.post("/account/delete-request")
def request_account_deletion(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    _ensure_schema(session)
    session.exec(
        text(
            "UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, CURRENT_TIMESTAMP) WHERE id = :uid"
        ).bindparams(uid=user.id)
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('account_deletion_requested',
                       'User requested account deletion via /settings (manual review required)',
                       :a, :uid)"""
        ).bindparams(a=user.email, uid=user.id)
    )
    session.commit()
    return {"ok": True, "message": "Deletion request received. Our team will reach out within 7 days."}


@router.post("/account/delete-request/cancel")
def cancel_account_deletion(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    _ensure_schema(session)
    session.exec(
        text("UPDATE users SET deletion_requested_at = NULL WHERE id = :uid").bindparams(uid=user.id)
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('account_deletion_cancelled', 'User cancelled their pending deletion request',
                       :a, :uid)"""
        ).bindparams(a=user.email, uid=user.id)
    )
    session.commit()
    return {"ok": True}


# --- Sessions: list + per-session revoke ------------------------------------


@router.get("/sessions")
def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    current_jti = _current_jti_from_request(request)
    rows = session.exec(
        text(
            """SELECT id, jti, user_agent, ip, created_at, last_seen_at, revoked_at
               FROM user_sessions WHERE user_id = :uid
               ORDER BY last_seen_at DESC LIMIT 100"""
        ).bindparams(uid=user.id)
    ).all()
    return {
        "sessions": [
            {
                "id": r._mapping["id"],  # type: ignore[attr-defined]
                "jti": r._mapping["jti"],  # type: ignore[attr-defined]
                "user_agent": r._mapping["user_agent"],  # type: ignore[attr-defined]
                "ip": r._mapping["ip"],  # type: ignore[attr-defined]
                "created_at": str(r._mapping["created_at"]),  # type: ignore[attr-defined]
                "last_seen_at": str(r._mapping["last_seen_at"]),  # type: ignore[attr-defined]
                "revoked_at": str(r._mapping["revoked_at"]) if r._mapping["revoked_at"] else None,  # type: ignore[attr-defined]
                "is_current": bool(current_jti and r._mapping["jti"] == current_jti),  # type: ignore[attr-defined]
            }
            for r in rows
        ]
    }


@router.post("/sessions/{session_id}/revoke")
def revoke_session(
    session_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    owned = session.exec(
        text("SELECT id FROM user_sessions WHERE id = :i AND user_id = :uid").bindparams(
            i=session_id, uid=user.id
        )
    ).first()
    if owned is None:
        raise HTTPException(status_code=404, detail="Not found")
    session.exec(
        text(
            "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = :i AND user_id = :uid"
        ).bindparams(i=session_id, uid=user.id)
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('session_revoked', :d, :a, :uid)"""
        ).bindparams(d=f"User revoked session {session_id} from /settings", a=user.email, uid=user.id)
    )
    session.commit()
    return {"ok": True}


# --- TOTP recovery codes ----------------------------------------------------


def _generate_recovery_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"


class _RecoveryRegen(BaseModel):
    totp_code: str


@router.post("/totp/recovery-codes/regenerate")
def regenerate_recovery_codes(
    payload: _RecoveryRegen,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    import pyotp

    if not user.password_hash:
        raise HTTPException(status_code=400, detail="TOTP is not configured for this account")
    if not pyotp.TOTP(user.password_hash).verify(payload.totp_code or "", valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid current TOTP code")
    plain = [_generate_recovery_code() for _ in range(8)]
    hashes = [_hash_token(c) for c in plain]
    session.exec(
        text("UPDATE users SET totp_recovery_codes = :j WHERE id = :uid").bindparams(
            j=json.dumps(hashes), uid=user.id
        )
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('totp_recovery_codes_regenerated',
                       'User regenerated TOTP recovery codes', :a, :uid)"""
        ).bindparams(a=user.email, uid=user.id)
    )
    session.commit()
    return {
        "ok": True,
        "codes": plain,
        "message": (
            "Save these codes somewhere safe — they will not be shown again. "
            "Each code can be used once if you lose access to your authenticator."
        ),
    }


# --- Founder co-founder invites ---------------------------------------------


class _FounderInvite(BaseModel):
    invitee_email: str
    invitee_name: Optional[str] = None
    role: Optional[str] = "co-founder"
    project_id: Optional[int] = None


@router.get("/founder/invites")
def list_founder_invites(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    _ensure_schema(session)
    if user.role != "founder":
        raise HTTPException(status_code=403, detail="Founder role required")
    rows = session.exec(
        text(
            """SELECT id, project_id, invitee_email, invitee_name, role,
                      created_at, expires_at, accepted_at, revoked_at
               FROM founder_invites WHERE inviter_user_id = :uid
               ORDER BY created_at DESC LIMIT 100"""
        ).bindparams(uid=user.id)
    ).all()
    return {
        "invites": [
            {
                "id": r._mapping["id"],  # type: ignore[attr-defined]
                "project_id": r._mapping["project_id"],  # type: ignore[attr-defined]
                "invitee_email": r._mapping["invitee_email"],  # type: ignore[attr-defined]
                "invitee_name": r._mapping["invitee_name"],  # type: ignore[attr-defined]
                "role": r._mapping["role"],  # type: ignore[attr-defined]
                "created_at": str(r._mapping["created_at"]),  # type: ignore[attr-defined]
                "expires_at": str(r._mapping["expires_at"]),  # type: ignore[attr-defined]
                "accepted_at": str(r._mapping["accepted_at"]) if r._mapping["accepted_at"] else None,  # type: ignore[attr-defined]
                "revoked_at": str(r._mapping["revoked_at"]) if r._mapping["revoked_at"] else None,  # type: ignore[attr-defined]
            }
            for r in rows
        ],
        "cap_per_project": FOUNDER_INVITE_CAP_PER_PROJECT,
    }


@router.post("/founder/invites")
def create_founder_invite(
    payload: _FounderInvite,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    if user.role != "founder":
        raise HTTPException(status_code=403, detail="Founder role required")
    invitee_email = (payload.invitee_email or "").strip().lower()
    if not _is_email(invitee_email):
        raise HTTPException(status_code=400, detail="Valid invitee_email required")
    invitee_name = (payload.invitee_name or "").strip()[:120] or None
    role = (payload.role or "co-founder").strip()[:40] or "co-founder"
    project_id = payload.project_id

    if project_id is not None:
        # Authorization: inviter must own the target project. Mirrors the
        # worker's broken-access-control fix.
        if not user.founder_id:
            raise HTTPException(status_code=403, detail="Founder profile required to invite to a project")
        owns = session.exec(
            text("SELECT id FROM projects WHERE id = :p AND founder_id = :fid").bindparams(
                p=project_id, fid=user.founder_id
            )
        ).first()
        if owns is None:
            raise HTTPException(status_code=403, detail="Project not found or not owned by you")
        count_row = session.exec(
            text(
                "SELECT COUNT(*) AS n FROM founder_invites WHERE project_id = :p AND revoked_at IS NULL"
            ).bindparams(p=project_id)
        ).first()
    else:
        count_row = session.exec(
            text(
                """SELECT COUNT(*) AS n FROM founder_invites
                   WHERE project_id IS NULL AND inviter_user_id = :uid AND revoked_at IS NULL"""
            ).bindparams(uid=user.id)
        ).first()
    n = int(count_row._mapping["n"] or 0) if count_row is not None else 0  # type: ignore[attr-defined]
    if n >= FOUNDER_INVITE_CAP_PER_PROJECT:
        raise HTTPException(
            status_code=409,
            detail=f"Invite cap reached ({FOUNDER_INVITE_CAP_PER_PROJECT} per project)",
        )

    token_raw = _generate_token()
    token_hash = _hash_token(token_raw)
    expires = (datetime.utcnow() + timedelta(days=FOUNDER_INVITE_EXPIRY_DAYS)).isoformat()
    session.exec(
        text(
            """INSERT INTO founder_invites
               (project_id, inviter_user_id, invitee_email, invitee_name, role, token_hash, expires_at)
               VALUES (:p, :uid, :e, :n, :r, :h, :ex)"""
        ).bindparams(
            p=project_id, uid=user.id, e=invitee_email, n=invitee_name,
            r=role, h=token_hash, ex=expires,
        )
    )
    session.exec(
        text(
            """INSERT INTO activity_logs (action, details, actor, user_id)
               VALUES ('cofounder_invited', :d, :a, :uid)"""
        ).bindparams(d=f"Invited {invitee_email} as {role}", a=user.email, uid=user.id)
    )
    session.commit()

    accept_url = f"{_app_url()}/invites/cofounder?token={token_raw}"
    sent = bool(send_verification_email(invitee_email, invitee_name or invitee_email, accept_url))
    out = {
        "ok": True,
        "invitee_email": invitee_email,
        "expires_at": expires,
        "email_sent": sent,
    }
    if not sent:
        out["accept_url"] = accept_url
    return out


@router.delete("/founder/invites/{invite_id}")
def revoke_founder_invite(
    invite_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    if user.role != "founder":
        raise HTTPException(status_code=403, detail="Founder role required")
    owned = session.exec(
        text(
            """SELECT id FROM founder_invites
               WHERE id = :i AND inviter_user_id = :uid AND revoked_at IS NULL"""
        ).bindparams(i=invite_id, uid=user.id)
    ).first()
    if owned is None:
        raise HTTPException(status_code=404, detail="Not found")
    session.exec(
        text(
            "UPDATE founder_invites SET revoked_at = CURRENT_TIMESTAMP WHERE id = :i"
        ).bindparams(i=invite_id)
    )
    session.commit()
    return {"ok": True}


@router.get("/data-export")
def data_export(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _ensure_schema(session)
    extras = _user_extras(session, user.id)
    activity = session.exec(
        text(
            """SELECT action, details, created_at
               FROM activity_logs WHERE user_id = :uid
               ORDER BY created_at DESC LIMIT 500"""
        ).bindparams(uid=user.id)
    ).all()
    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "user": {
            "id": user.id,
            "uid": user.uid,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "bio": extras.get("bio"),
            "jurisdictions": _safe_json(extras.get("jurisdictions"), []),
            "socials": _safe_json(extras.get("socials"), {}),
            "notification_prefs": _safe_json(extras.get("notification_prefs"), {}),
            "privacy_prefs": _safe_json(extras.get("privacy_prefs"), {}),
            "role_prefs": _safe_json(extras.get("role_prefs"), {}),
            "created_at": str(user.created_at) if user.created_at else None,
            "last_active_at": str(user.last_active_at) if user.last_active_at else None,
        },
        "recent_activity": [
            {"action": r._mapping["action"], "details": r._mapping["details"], "created_at": str(r._mapping["created_at"])}  # type: ignore[attr-defined]
            for r in activity
        ],
        "note": "Profile + last 500 activity entries. Full cross-system export: contact support.",
    }
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={
            "content-disposition": f'attachment; filename="axal-data-export-{user.uid or user.id}.json"',
        },
    )


# ---------------------------------------------------------------------------
# Task #1 / Task #20 — Settings sub-routes (privacy, appearance, notifications,
# v2 read). Mirrors `cloudflare-worker/src/routes/settings.ts` so the dev
# backend serves the same shape as production. Backed by a new `user_settings`
# table with one row per user, lazily upserted on first read.
# ---------------------------------------------------------------------------

_user_settings_migrated = False

def _ensure_user_settings_schema(session: Session) -> None:
    global _user_settings_migrated
    if _user_settings_migrated:
        return
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                timezone TEXT DEFAULT 'UTC',
                locale TEXT DEFAULT 'en',
                pronouns TEXT,
                profile_slug TEXT UNIQUE,
                visibility TEXT DEFAULT 'network',
                show_in_directory INTEGER DEFAULT 1,
                discoverable INTEGER DEFAULT 1,
                digest_frequency TEXT DEFAULT 'weekly',
                notif_categories_email TEXT DEFAULT '{}',
                notif_categories_inapp TEXT DEFAULT '{}',
                quiet_hours_start TEXT,
                quiet_hours_end TEXT,
                quiet_hours_tz TEXT DEFAULT 'UTC',
                theme TEXT DEFAULT 'system',
                density TEXT DEFAULT 'comfy',
                sidebar_default TEXT DEFAULT 'expanded',
                feature_flags TEXT DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        session.commit()
    except Exception:
        session.rollback()
    _user_settings_migrated = True


_DEFAULT_USER_SETTINGS = {
    "timezone": "UTC",
    "locale": "en",
    "pronouns": None,
    "profile_slug": None,
    "visibility": "network",
    "show_in_directory": 1,
    "discoverable": 1,
    "digest_frequency": "weekly",
    "notif_categories_email": "{}",
    "notif_categories_inapp": "{}",
    "quiet_hours_start": None,
    "quiet_hours_end": None,
    "quiet_hours_tz": "UTC",
    "theme": "light",
    "density": "comfy",
    "sidebar_default": "expanded",
    "feature_flags": "{}",
}

_ALLOWED_VISIBILITY = {"public", "network", "private"}
_ALLOWED_THEME = {"light", "dark"}
_ALLOWED_DENSITY = {"comfy", "compact"}
_ALLOWED_SIDEBAR = {"expanded", "collapsed"}
_ALLOWED_DIGEST = {"off", "daily", "weekly", "monthly"}


def _get_user_settings(session: Session, user_id: int) -> dict:
    _ensure_user_settings_schema(session)
    row = session.exec(
        text("SELECT * FROM user_settings WHERE user_id = :uid"),
        params={"uid": user_id},
    ).first()
    if row is None:
        # Lazily insert defaults so PUT can UPDATE without a separate path.
        try:
            session.exec(
                text("INSERT INTO user_settings (user_id) VALUES (:uid) ON CONFLICT (user_id) DO NOTHING"),
                params={"uid": user_id},
            )
            session.commit()
        except Exception:
            session.rollback()
        return {"user_id": user_id, **_DEFAULT_USER_SETTINGS}
    m = dict(row._mapping)  # type: ignore[attr-defined]
    return m


def _pick_privacy(row: dict) -> dict:
    return {
        "visibility": row.get("visibility") or "network",
        "show_in_directory": bool(row.get("show_in_directory")),
        "discoverable": bool(row.get("discoverable")),
    }


def _pick_appearance(row: dict) -> dict:
    theme = row.get("theme") or "light"
    if theme not in _ALLOWED_THEME:
        theme = "light"
    return {
        "theme": theme,
        "density": row.get("density") or "comfy",
        "sidebar_default": row.get("sidebar_default") or "expanded",
    }


def _pick_notifications(row: dict) -> dict:
    try:
        email = json.loads(row.get("notif_categories_email") or "{}")
    except Exception:
        email = {}
    try:
        inapp = json.loads(row.get("notif_categories_inapp") or "{}")
    except Exception:
        inapp = {}
    return {
        "digest_frequency": row.get("digest_frequency") or "weekly",
        "notif_categories_email": email,
        "notif_categories_inapp": inapp,
        "quiet_hours_start": row.get("quiet_hours_start"),
        "quiet_hours_end": row.get("quiet_hours_end"),
        "quiet_hours_tz": row.get("quiet_hours_tz") or "UTC",
    }


def _pick_profile(row: dict) -> dict:
    return {
        "timezone": row.get("timezone") or "UTC",
        "locale": row.get("locale") or "en",
        "pronouns": row.get("pronouns"),
        "profile_slug": row.get("profile_slug"),
    }


def _apply_user_settings_patch(session: Session, user_id: int, patch: dict) -> dict:
    if not patch:
        return _get_user_settings(session, user_id)
    # Ensure the row exists first.
    _get_user_settings(session, user_id)
    sets = ", ".join(f"{k} = :{k}" for k in patch.keys())
    params = {**patch, "uid": user_id}
    try:
        session.exec(
            text(f"UPDATE user_settings SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE user_id = :uid"),
            params=params,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(status_code=500, detail="Update failed")
    return _get_user_settings(session, user_id)


# --- Privacy --------------------------------------------------------------
@router.get("/privacy")
def get_privacy_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _pick_privacy(_get_user_settings(session, user.id))


@router.put("/privacy")
def update_privacy_settings(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    patch: dict = {}
    if "visibility" in payload:
        v = payload["visibility"]
        if v not in _ALLOWED_VISIBILITY:
            raise HTTPException(status_code=400, detail="Invalid visibility")
        patch["visibility"] = v
    if "show_in_directory" in payload:
        patch["show_in_directory"] = 1 if payload["show_in_directory"] else 0
    if "discoverable" in payload:
        patch["discoverable"] = 1 if payload["discoverable"] else 0
    return _pick_privacy(_apply_user_settings_patch(session, user.id, patch))


# --- Appearance -----------------------------------------------------------
@router.get("/appearance")
def get_appearance_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _pick_appearance(_get_user_settings(session, user.id))


@router.put("/appearance")
def update_appearance_settings(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    patch: dict = {}
    if "theme" in payload:
        if payload["theme"] not in _ALLOWED_THEME:
            raise HTTPException(status_code=400, detail="Invalid theme")
        patch["theme"] = payload["theme"]
    if "density" in payload:
        if payload["density"] not in _ALLOWED_DENSITY:
            raise HTTPException(status_code=400, detail="Invalid density")
        patch["density"] = payload["density"]
    if "sidebar_default" in payload:
        if payload["sidebar_default"] not in _ALLOWED_SIDEBAR:
            raise HTTPException(status_code=400, detail="Invalid sidebar_default")
        patch["sidebar_default"] = payload["sidebar_default"]
    return _pick_appearance(_apply_user_settings_patch(session, user.id, patch))


# --- Notifications --------------------------------------------------------
@router.get("/notifications")
def get_notification_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _pick_notifications(_get_user_settings(session, user.id))


@router.put("/notifications")
def update_notification_settings(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    patch: dict = {}
    if "digest_frequency" in payload:
        if payload["digest_frequency"] not in _ALLOWED_DIGEST:
            raise HTTPException(status_code=400, detail="Invalid digest_frequency")
        patch["digest_frequency"] = payload["digest_frequency"]
    if "notif_categories_email" in payload:
        patch["notif_categories_email"] = json.dumps(payload["notif_categories_email"] or {})
    if "notif_categories_inapp" in payload:
        patch["notif_categories_inapp"] = json.dumps(payload["notif_categories_inapp"] or {})
    for k in ("quiet_hours_start", "quiet_hours_end", "quiet_hours_tz"):
        if k in payload:
            patch[k] = payload[k]
    return _pick_notifications(_apply_user_settings_patch(session, user.id, patch))


# --- v2 (full snapshot for SettingsContext bootstrap) --------------------
@router.get("/v2")
def get_settings_v2(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    row = _get_user_settings(session, user.id)
    try:
        flags = json.loads(row.get("feature_flags") or "{}")
    except Exception:
        flags = {}
    return {
        "profile": _pick_profile(row),
        "privacy": _pick_privacy(row),
        "appearance": _pick_appearance(row),
        "notifications": _pick_notifications(row),
        "feature_flags": flags,
    }


# --- Profile sub-route -----------------------------------------------------
@router.get("/profile")
def get_profile_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _pick_profile(_get_user_settings(session, user.id))


@router.put("/profile")
def update_profile_settings(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    patch: dict = {}
    if "timezone" in payload:
        v = payload["timezone"]
        if v is not None and (not isinstance(v, str) or len(v) > 64):
            raise HTTPException(status_code=400, detail="Invalid timezone")
        patch["timezone"] = v
    if "locale" in payload:
        v = payload["locale"]
        if v is not None and (not isinstance(v, str) or len(v) > 16):
            raise HTTPException(status_code=400, detail="Invalid locale")
        patch["locale"] = v
    if "pronouns" in payload:
        v = payload["pronouns"]
        if v is not None and (not isinstance(v, str) or len(v) > 32):
            raise HTTPException(status_code=400, detail="Invalid pronouns")
        patch["pronouns"] = v
    if "profile_slug" in payload:
        v = payload["profile_slug"]
        if v is not None:
            if not isinstance(v, str) or not v or len(v) > 64 or not all(ch.isalnum() or ch in "-_" for ch in v):
                raise HTTPException(status_code=400, detail="Invalid profile_slug")
        patch["profile_slug"] = v
    return _pick_profile(_apply_user_settings_patch(session, user.id, patch))


# --- Security read-only summary -------------------------------------------
@router.get("/security")
def get_security_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    try:
        recovery = json.loads(getattr(user, "totp_recovery_codes", None) or "[]") or []
    except Exception:
        recovery = []
    try:
        active = session.exec(
            text("SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = :uid AND revoked_at IS NULL"),
            params={"uid": user.id},
        ).first()
        active_sessions = int(active._mapping["c"]) if active else 0  # type: ignore[attr-defined]
    except Exception:
        active_sessions = 0
    return {
        "email_verified": bool(getattr(user, "email_verified", False)),
        "totp_configured": bool(getattr(user, "totp_secret", None)),
        "totp_recovery_codes_remaining": len(recovery) if isinstance(recovery, list) else 0,
        "active_sessions": active_sessions,
    }


# --- Integrations connected accounts (best-effort) ------------------------
@router.get("/integrations")
def get_integrations_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    def _connected(table: str) -> bool:
        try:
            r = session.exec(
                text(f"SELECT 1 FROM {table} WHERE user_id = :uid LIMIT 1"),
                params={"uid": user.id},
            ).first()
            return r is not None
        except Exception:
            return False
    return {
        "accounts": [
            {"provider": "linkedin", "connected": _connected("linkedin_oauth_tokens"), "disconnect_url": "/api/linkedin/disconnect"},
            {"provider": "google",   "connected": _connected("google_oauth_tokens"),   "disconnect_url": "/api/calendar/google/disconnect"},
            {"provider": "outlook",  "connected": _connected("microsoft_oauth_tokens"), "disconnect_url": "/api/calendar/microsoft/disconnect"},
            {"provider": "slack",    "connected": False, "disconnect_url": None},
        ],
        "api_keys_enabled": False,
        "api_keys": [],
    }


# --- Developer (admin only) ----------------------------------------------
def _require_admin(user: User) -> None:
    if (getattr(user, "role", "") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


@router.get("/developer")
def get_developer_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _require_admin(user)
    row = _get_user_settings(session, user.id)
    try:
        flags = json.loads(row.get("feature_flags") or "{}")
    except Exception:
        flags = {}
    return {
        "feature_flags": flags,
        "raw_user": {
            "id": user.id,
            "uid": getattr(user, "uid", None),
            "email": user.email,
            "name": getattr(user, "name", None),
            "role": getattr(user, "role", None),
            "email_verified": bool(getattr(user, "email_verified", False)),
            "kyc_status": getattr(user, "kyc_status", None),
            "created_at": str(user.created_at) if getattr(user, "created_at", None) else None,
            "last_active_at": str(user.last_active_at) if getattr(user, "last_active_at", None) else None,
        },
    }


@router.put("/developer")
def update_developer_settings(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _require_admin(user)
    patch: dict = {}
    if "feature_flags" in payload and isinstance(payload["feature_flags"], dict):
        safe: dict = {}
        for k, v in payload["feature_flags"].items():
            if isinstance(k, str) and len(k) <= 64:
                safe[k] = bool(v)
        patch["feature_flags"] = json.dumps(safe)
    row = _apply_user_settings_patch(session, user.id, patch)
    try:
        flags = json.loads(row.get("feature_flags") or "{}")
    except Exception:
        flags = {}
    return {"feature_flags": flags}


@router.post("/developer/resync-indices")
def resync_developer_indices(user: User = Depends(get_current_user)):
    _require_admin(user)
    return {"ok": True, "queued": True, "message": "Re-sync request logged. The next scheduled cron will pick this up."}


# ===========================================================================
# Task #16 — Profile expansion + Task #15 — Page explainers (FastAPI port).
#
# Worker reference: cloudflare-worker/src/routes/settings.ts (915-1023) +
# services/profileExpansion.ts. The dev backend stores both blocks as JSON
# in a single helper table to keep migrations simple — full per-column
# encryption + UBO row-level validation are intentionally out of scope here
# (the worker is the production source of truth).
# ===========================================================================

_profile_extras_migrated = False


def _ensure_profile_extras_schema(session: Session) -> None:
    global _profile_extras_migrated
    if _profile_extras_migrated:
        return
    try:
        session.exec(text("""
            CREATE TABLE IF NOT EXISTS user_profile_extras (
                user_id INTEGER PRIMARY KEY,
                personal_data TEXT NOT NULL DEFAULT '{}',
                corporate_data TEXT NOT NULL DEFAULT '{}',
                dismissed_explainers TEXT NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        session.commit()
        _profile_extras_migrated = True
    except Exception:
        session.rollback()


_PERSONAL_TEXT_FIELDS = (
    "full_legal_name", "date_of_birth", "nationality", "tax_residency_country",
    "address_line1", "address_line2", "city", "state_or_region",
    "postal_code", "country",
)
_PERSONAL_COMPLETION_FIELDS = (
    "full_legal_name", "date_of_birth", "nationality", "tax_residency_country",
    "address_line1", "city", "postal_code", "country",
)
_CORPORATE_TEXT_FIELDS = (
    "entity_name", "entity_type", "registration_number", "registered_country",
    "registered_address_line1", "registered_address_line2", "registered_city",
    "registered_state", "registered_postal", "signing_authority_name",
    "signing_authority_title", "signing_authority_email",
)


def _last4(raw: str) -> str:
    s = (raw or "").strip()
    return s[-4:] if len(s) >= 4 else s


def _load_extras(session: Session, user_id: int) -> dict:
    _ensure_profile_extras_schema(session)
    row = session.exec(
        text("SELECT personal_data, corporate_data, dismissed_explainers FROM user_profile_extras WHERE user_id = :uid"),
        params={"uid": user_id},
    ).first()
    if row is None:
        try:
            session.exec(
                text("INSERT INTO user_profile_extras (user_id) VALUES (:uid) ON CONFLICT (user_id) DO NOTHING"),
                params={"uid": user_id},
            )
            session.commit()
        except Exception:
            session.rollback()
        return {"personal": {}, "corporate": {}, "dismissed": []}
    m = dict(row._mapping)  # type: ignore[attr-defined]
    return {
        "personal": _safe_json(m.get("personal_data"), {}),
        "corporate": _safe_json(m.get("corporate_data"), {}),
        "dismissed": _safe_json(m.get("dismissed_explainers"), []),
    }


def _save_extras_field(session: Session, user_id: int, column: str, value: Any) -> None:
    _load_extras(session, user_id)  # ensure row exists
    try:
        session.exec(
            text(f"UPDATE user_profile_extras SET {column} = :val, updated_at = CURRENT_TIMESTAMP WHERE user_id = :uid"),
            params={"uid": user_id, "val": json.dumps(value)},
        )
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(status_code=500, detail="Update failed")


def _personal_view(personal: dict) -> dict:
    filled = sum(1 for f in _PERSONAL_COMPLETION_FIELDS if personal.get(f))
    if personal.get("tax_id_enc"):
        filled += 1
    if personal.get("phone_enc"):
        filled += 1
    pct = int(round(filled * 100 / (len(_PERSONAL_COMPLETION_FIELDS) + 2)))
    return {
        **{f: personal.get(f) or None for f in _PERSONAL_TEXT_FIELDS},
        "tax_id_last4": personal.get("tax_id_last4") or None,
        "has_tax_id": bool(personal.get("tax_id_enc")),
        "phone_last4": personal.get("phone_last4") or None,
        "has_phone": bool(personal.get("phone_enc")),
        "profile_completion_pct": pct,
    }


def _corporate_view(corporate: dict) -> dict:
    return {
        **{f: corporate.get(f) or None for f in _CORPORATE_TEXT_FIELDS},
        "tax_id_last4": corporate.get("tax_id_last4") or None,
        "has_tax_id": bool(corporate.get("tax_id_enc")),
        "ubos": corporate.get("ubos") or [],
        "directors": corporate.get("directors") or [],
        "insurance_carriers": corporate.get("insurance_carriers") or [],
        "ubo_disclosed": bool(corporate.get("ubo_disclosed")),
        "aml_high_risk_jurisdiction": False,
        "sanctions_last_checked_at": None,
        "updated_at": None,
    }


def _trim(v: Any, maxlen: int = 200) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s[:maxlen] if s else None


def _apply_personal_patch(personal: dict, patch: dict) -> dict:
    out = dict(personal)
    for f in _PERSONAL_TEXT_FIELDS:
        if f in patch:
            v = _trim(patch[f])
            if f in ("nationality", "tax_residency_country", "country") and v:
                v = v.upper()[:2]
            out[f] = v
    if "tax_id_number" in patch:
        raw = patch["tax_id_number"]
        if raw is None or str(raw).strip() == "":
            out.pop("tax_id_enc", None)
            out.pop("tax_id_last4", None)
        else:
            s = str(raw).strip()
            if len(s) < 4 or len(s) > 64:
                raise HTTPException(status_code=400, detail={"error": "tax_id_number must be 4-64 chars", "field": "tax_id_number"})
            out["tax_id_enc"] = base64.b64encode(s.encode("utf-8")).decode("ascii")
            out["tax_id_last4"] = _last4(s)
    if "phone_e164" in patch:
        raw = patch["phone_e164"]
        if raw is None or str(raw).strip() == "":
            out.pop("phone_enc", None)
            out.pop("phone_last4", None)
        else:
            s = str(raw).strip()
            import re as _re
            if not _re.match(r"^\+[1-9]\d{6,14}$", s):
                raise HTTPException(status_code=400, detail={"error": "phone must be in E.164 format, e.g. +14155551234", "field": "phone_e164"})
            out["phone_enc"] = base64.b64encode(s.encode("utf-8")).decode("ascii")
            out["phone_last4"] = _last4(s)
    return out


def _apply_corporate_patch(corporate: dict, patch: dict) -> dict:
    out = dict(corporate)
    for f in _CORPORATE_TEXT_FIELDS:
        if f in patch:
            v = _trim(patch[f])
            if f == "registered_country" and v:
                v = v.upper()[:2]
            out[f] = v
    if "tax_id_number" in patch:
        raw = patch["tax_id_number"]
        if raw is None or str(raw).strip() == "":
            out.pop("tax_id_enc", None)
            out.pop("tax_id_last4", None)
        else:
            s = str(raw).strip()
            out["tax_id_enc"] = base64.b64encode(s.encode("utf-8")).decode("ascii")
            out["tax_id_last4"] = _last4(s)
    for k in ("ubos", "directors", "insurance_carriers"):
        if k in patch and isinstance(patch[k], list):
            out[k] = patch[k]
            if k == "ubos":
                out["ubo_disclosed"] = len(patch[k]) > 0
    return out


@router.get("/profile/personal")
def get_personal_profile(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    extras = _load_extras(session, user.id)
    return _personal_view(extras["personal"])


@router.put("/profile/personal")
def update_personal_profile(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    extras = _load_extras(session, user.id)
    next_personal = _apply_personal_patch(extras["personal"], payload or {})
    _save_extras_field(session, user.id, "personal_data", next_personal)
    return _personal_view(next_personal)


@router.get("/profile/corporate")
def get_corporate_profile(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    extras = _load_extras(session, user.id)
    return _corporate_view(extras["corporate"])


@router.put("/profile/corporate")
def update_corporate_profile(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    extras = _load_extras(session, user.id)
    next_corporate = _apply_corporate_patch(extras["corporate"], payload or {})
    _save_extras_field(session, user.id, "corporate_data", next_corporate)
    return _corporate_view(next_corporate)


# --- Page header explainers (Task #15) -------------------------------------

import re as _re_explainer  # noqa: E402


def _normalize_explainer_key(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    s = raw.strip()[:64]
    if not s or not _re_explainer.match(r"^[a-z0-9_]+$", s):
        return None
    return s


@router.get("/explainers")
def get_explainers(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    extras = _load_extras(session, user.id)
    dismissed = extras["dismissed"] if isinstance(extras["dismissed"], list) else []
    return {"dismissed": [k for k in dismissed if isinstance(k, str)]}


@router.post("/explainer-dismissed")
def dismiss_explainer(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    key = _normalize_explainer_key((payload or {}).get("page_key"))
    if not key:
        raise HTTPException(status_code=400, detail="page_key is required (a-z, 0-9, _, ≤64 chars)")
    extras = _load_extras(session, user.id)
    current = extras["dismissed"] if isinstance(extras["dismissed"], list) else []
    if key not in current:
        current = list(current) + [key]
    _save_extras_field(session, user.id, "dismissed_explainers", current)
    return {"dismissed": current}


@router.post("/explainer-restore")
def restore_explainer(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    raw = ((payload or {}).get("page_key") or "").strip()
    extras = _load_extras(session, user.id)
    current = extras["dismissed"] if isinstance(extras["dismissed"], list) else []
    if raw == "all":
        nxt: list = []
    else:
        key = _normalize_explainer_key(raw)
        if not key:
            raise HTTPException(status_code=400, detail='page_key must be a valid key or "all"')
        nxt = [k for k in current if k != key]
    _save_extras_field(session, user.id, "dismissed_explainers", nxt)
    return {"dismissed": nxt}
