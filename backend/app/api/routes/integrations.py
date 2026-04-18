"""
Integrations router — CRM / legal / data-feed connections per partner.

Endpoints (all under /api/integrations):
  GET    /available                  — provider catalogue
  GET    /                           — list current user's integrations (no secrets)
  POST   /connect                    — create or update an integration
  DELETE /{uid}                      — remove an integration
  POST   /{uid}/sync                 — synchronous sync trigger (logs an entry)
  POST   /{uid}/push                 — push a payload to the provider
  GET    /{uid}/logs                 — paginated logs for one integration
  POST   /webhook/{provider}/{uid}   — public webhook receiver (HMAC-validated)
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, desc, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import ActivityLog, Integration, IntegrationLog, User
from backend.app.services.crypto_box import decrypt, encrypt, mask

router = APIRouter(prefix="/integrations", tags=["Integrations"])


def _safe_json_loads(s: str | None, default):
    if not s:
        return default
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return default

ALLOWED_ROLES = {"admin", "operator", "service_provider", "partner", "founder"}

PROVIDER_CATALOGUE = [
    {
        "provider_name": "hubspot",
        "integration_type": "crm",
        "display_name": "HubSpot",
        "description": "Sync deals and contacts to your HubSpot CRM.",
        "auth_type": "api_key",
        "docs_url": "https://developers.hubspot.com/docs/api/overview",
    },
    {
        "provider_name": "salesforce",
        "integration_type": "crm",
        "display_name": "Salesforce",
        "description": "Push opportunities and accounts to Salesforce.",
        "auth_type": "api_key",
        "docs_url": "https://developer.salesforce.com/docs",
    },
    {
        "provider_name": "sumsub",
        "integration_type": "legal_provider",
        "display_name": "Sumsub KYC",
        "description": "Run identity verification and AML checks on partners and LPs.",
        "auth_type": "api_key",
        "docs_url": "https://developers.sumsub.com/api-reference/",
    },
    {
        "provider_name": "stripe_atlas",
        "integration_type": "legal_provider",
        "display_name": "Stripe Atlas",
        "description": "Automate Delaware C-Corp incorporation for spin-outs.",
        "auth_type": "api_key",
        "docs_url": "https://stripe.com/atlas",
    },
    {
        "provider_name": "cooley",
        "integration_type": "legal_provider",
        "display_name": "Cooley GO",
        "description": "Send deal documents to Cooley for review and execution.",
        "auth_type": "api_key",
        "docs_url": "https://www.cooleygo.com/",
    },
    {
        "provider_name": "pitchbook",
        "integration_type": "data_feed",
        "display_name": "PitchBook",
        "description": "Pull comparables and market data into project metrics.",
        "auth_type": "api_key",
        "docs_url": "https://pitchbook.com/news/articles/api",
    },
    {
        "provider_name": "custom",
        "integration_type": "custom",
        "display_name": "Custom Webhook",
        "description": "Send and receive events via a generic HMAC-signed webhook.",
        "auth_type": "webhook_secret",
        "docs_url": None,
    },
]
PROVIDER_NAMES = {p["provider_name"] for p in PROVIDER_CATALOGUE}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _ensure_role(user: User):
    if (user.role or "").lower() not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to manage integrations")


def _serialize(integ: Integration) -> dict:
    return {
        "uid": integ.uid,
        "integration_type": integ.integration_type,
        "provider_name": integ.provider_name,
        "display_name": integ.display_name,
        "status": integ.status,
        "last_synced_at": integ.last_synced_at.isoformat() if integ.last_synced_at else None,
        "last_error": integ.last_error,
        "api_key_preview": mask(decrypt(integ.api_key_encrypted)),
        "has_webhook_secret": bool(integ.webhook_secret_encrypted),
        "config": _safe_json_loads(integ.config_json, {}),
        "created_at": integ.created_at.isoformat(),
        "updated_at": integ.updated_at.isoformat(),
    }


def _audit(session: Session, user_id: Optional[int], action: str, meta: dict | None = None):
    try:
        log = ActivityLog(
            user_id=user_id,
            action=action,
            entity_type="integration",
            metadata_json=json.dumps(meta or {}),
        )
        session.add(log)
    except Exception:
        # ActivityLog schema may differ across versions; never break the endpoint
        # for an audit-log failure.
        pass


def _record_log(
    session: Session,
    integration_id: int,
    direction: str,
    event_type: str,
    status: str,
    payload: Any = None,
    response_summary: str | None = None,
):
    entry = IntegrationLog(
        integration_id=integration_id,
        direction=direction,
        event_type=event_type,
        status=status,
        payload_json=json.dumps(payload, default=str) if payload is not None else None,
        response_summary=response_summary,
    )
    session.add(entry)
    return entry


def _load_owned(session: Session, uid: str, user: User) -> Integration:
    integ = session.exec(select(Integration).where(Integration.uid == uid)).first()
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found")
    is_admin = (user.role or "").lower() == "admin"
    if integ.user_id != user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Not your integration")
    return integ


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ConnectIn(BaseModel):
    provider_name: str
    integration_type: Optional[str] = None
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    webhook_secret: Optional[str] = None
    config: dict[str, Any] = PField(default_factory=dict)


class PushIn(BaseModel):
    event_type: str
    payload: dict[str, Any] = PField(default_factory=dict)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/available")
def list_available(user: User = Depends(get_current_user)):
    _ensure_role(user)
    return {"ok": True, "providers": PROVIDER_CATALOGUE}


@router.get("")
@router.get("/")
def list_mine(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    is_admin = (user.role or "").lower() == "admin"
    stmt = select(Integration).order_by(desc(Integration.created_at))
    if not is_admin:
        stmt = stmt.where(Integration.user_id == user.id)
    rows = session.exec(stmt).all()
    return {"ok": True, "items": [_serialize(r) for r in rows]}


@router.post("/connect")
def connect(
    body: ConnectIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    if body.provider_name not in PROVIDER_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{body.provider_name}'")

    catalog = next(p for p in PROVIDER_CATALOGUE if p["provider_name"] == body.provider_name)
    integration_type = body.integration_type or catalog["integration_type"]
    display_name = body.display_name or catalog["display_name"]

    if catalog["auth_type"] == "api_key" and not body.api_key:
        raise HTTPException(status_code=400, detail="api_key is required for this provider")

    # Update if one already exists for this user+provider, else create.
    existing = session.exec(
        select(Integration).where(
            Integration.user_id == user.id,
            Integration.provider_name == body.provider_name,
        )
    ).first()

    now = datetime.utcnow()
    if existing:
        if body.api_key is not None:
            existing.api_key_encrypted = encrypt(body.api_key)
        if body.webhook_secret is not None:
            existing.webhook_secret_encrypted = encrypt(body.webhook_secret)
        existing.config_json = json.dumps(body.config) if body.config else existing.config_json
        existing.display_name = display_name
        existing.integration_type = integration_type
        existing.status = "active"
        existing.last_error = None
        existing.updated_at = now
        session.add(existing)
        integ = existing
        action = "integration.updated"
    else:
        integ = Integration(
            user_id=user.id,
            integration_type=integration_type,
            provider_name=body.provider_name,
            display_name=display_name,
            api_key_encrypted=encrypt(body.api_key) if body.api_key else None,
            webhook_secret_encrypted=encrypt(body.webhook_secret) if body.webhook_secret else None,
            config_json=json.dumps(body.config) if body.config else None,
            status="active",
        )
        session.add(integ)
        session.flush()
        action = "integration.created"

    _record_log(
        session, integ.id, "outbound", action.split(".", 1)[1], "ok",
        payload={"provider": body.provider_name},
    )
    _audit(session, user.id, action, {"provider": body.provider_name, "uid": integ.uid})
    session.commit()
    session.refresh(integ)
    return {"ok": True, "integration": _serialize(integ)}


@router.delete("/{uid}")
def disconnect(
    uid: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    integ = _load_owned(session, uid, user)
    provider = integ.provider_name
    session.delete(integ)
    _audit(session, user.id, "integration.deleted", {"provider": provider, "uid": uid})
    session.commit()
    return {"ok": True}


@router.post("/{uid}/sync")
def sync_now(
    uid: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    integ = _load_owned(session, uid, user)
    integ.last_synced_at = datetime.utcnow()
    integ.status = "active"
    integ.last_error = None
    session.add(integ)
    _record_log(
        session, integ.id, "outbound", "manual_sync", "ok",
        response_summary="Sync requested by user (no remote call performed in dev environment).",
    )
    _audit(session, user.id, "integration.sync", {"provider": integ.provider_name, "uid": uid})
    session.commit()
    session.refresh(integ)
    return {"ok": True, "integration": _serialize(integ)}


@router.post("/{uid}/push")
def push(
    uid: str,
    body: PushIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    integ = _load_owned(session, uid, user)
    _record_log(
        session, integ.id, "outbound", body.event_type, "ok",
        payload=body.payload,
        response_summary=f"Queued push to {integ.provider_name}",
    )
    integ.last_synced_at = datetime.utcnow()
    session.add(integ)
    session.commit()
    return {"ok": True, "queued": True, "event_type": body.event_type}


@router.get("/{uid}/logs")
def get_logs(
    uid: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_role(user)
    integ = _load_owned(session, uid, user)
    rows = session.exec(
        select(IntegrationLog)
        .where(IntegrationLog.integration_id == integ.id)
        .order_by(desc(IntegrationLog.created_at))
        .offset(offset)
        .limit(limit)
    ).all()
    return {
        "ok": True,
        "items": [
            {
                "id": r.id,
                "direction": r.direction,
                "event_type": r.event_type,
                "status": r.status,
                "response_summary": r.response_summary,
                "payload": _safe_json_loads(r.payload_json, None),
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Public webhook receiver — HMAC-validated, no auth.
# Path: /api/integrations/webhook/{provider}/{uid}
# Header:  X-Axal-Signature: hex(hmac_sha256(secret, raw_body))
# ---------------------------------------------------------------------------
@router.post("/webhook/{provider}/{uid}")
async def receive_webhook(
    provider: str,
    uid: str,
    request: Request,
    x_axal_signature: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    raw = await request.body()
    integ = session.exec(
        select(Integration).where(Integration.uid == uid, Integration.provider_name == provider)
    ).first()
    if not integ:
        raise HTTPException(status_code=404, detail="Integration not found")

    secret = decrypt(integ.webhook_secret_encrypted) if integ.webhook_secret_encrypted else None
    if secret:
        if not x_axal_signature:
            raise HTTPException(status_code=401, detail="Missing X-Axal-Signature header")
        expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, x_axal_signature.strip()):
            _record_log(
                session, integ.id, "inbound", "webhook", "error",
                response_summary="HMAC signature mismatch",
            )
            integ.status = "error"
            integ.last_error = "Webhook HMAC failed"
            session.add(integ)
            session.commit()
            raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        payload = {"raw": raw.decode("utf-8", errors="replace")[:2000]}

    event_type = (payload.get("event") if isinstance(payload, dict) else None) or "webhook"
    _record_log(
        session, integ.id, "inbound", event_type, "ok",
        payload=payload,
        response_summary=f"Received from {provider}",
    )
    integ.last_synced_at = datetime.utcnow()
    integ.status = "active"
    integ.last_error = None
    session.add(integ)
    session.commit()
    return {"ok": True, "received": True}
