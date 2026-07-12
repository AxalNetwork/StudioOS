"""GitHub ticket-sync admin config + inbound webhook (dev backend).

The admin router (`/api/admin/github`) lets an admin configure/rotate the
GitHub token, target repo, and webhook secret, see live connection status,
run a test-connection probe, and read the webhook payload URL + secret to
register manually in GitHub.

The webhook router (`/api/github/webhook`) is public but signature-verified:
GitHub signs each delivery with `X-Hub-Signature-256`, which we validate
against the stored webhook secret before updating the matching ticket.

The production Cloudflare Worker mirrors both of these (keeping the same
settings as Worker secrets); this module is the dev-parity implementation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets as _secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import AppSetting, Ticket, User, UserRole
from backend.app.api.routes.auth import get_current_user
from backend.app.services.crypto_box import decrypt, encrypt, mask
from backend.app.services import github_service as gh

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/github", tags=["Admin — GitHub"])
webhook_router = APIRouter(prefix="/github", tags=["GitHub Webhook"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# AppSetting helpers
# ---------------------------------------------------------------------------
def _get_setting(session: Session, key: str) -> Optional[AppSetting]:
    return session.get(AppSetting, key)


def _upsert_setting(session: Session, key: str, value: Optional[str], is_secret: bool) -> None:
    row = session.get(AppSetting, key)
    stored = encrypt(value) if (is_secret and value is not None) else value
    if row:
        row.value = stored
        row.is_secret = is_secret
        row.updated_at = datetime.utcnow()
        session.add(row)
    else:
        session.add(AppSetting(key=key, value=stored, is_secret=is_secret))


def _webhook_url(request: Request) -> str:
    # Build from the incoming request so it works in dev and prod without
    # hardcoding a host. base_url ends with '/'.
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/github/webhook"


# ---------------------------------------------------------------------------
# Admin config
# ---------------------------------------------------------------------------
@router.get("")
@router.get("/")
def get_github_config(
    request: Request,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    settings = {r.key: r for r in session.exec(
        select(AppSetting).where(AppSetting.key.in_([
            gh.SETTING_TOKEN, gh.SETTING_OWNER, gh.SETTING_REPO, gh.SETTING_WEBHOOK_SECRET,
        ]))
    ).all()}

    def _plain(key: str) -> Optional[str]:
        row = settings.get(key)
        if not row or row.value is None:
            return None
        return decrypt(row.value) if row.is_secret else row.value

    token = _plain(gh.SETTING_TOKEN)
    owner = _plain(gh.SETTING_OWNER)
    repo = _plain(gh.SETTING_REPO)
    webhook_secret = _plain(gh.SETTING_WEBHOOK_SECRET)

    import os
    env_token = bool(os.getenv("GITHUB_ACCESS_TOKEN"))

    has_token = bool(token) or env_token
    source = "db" if token else ("env" if env_token else "unconfigured")
    configured = has_token and bool(owner or os.getenv("GITHUB_REPO_OWNER")) and bool(repo or os.getenv("GITHUB_REPO_NAME"))

    return {
        "configured": configured,
        "source": source,
        "has_token": has_token,
        "token_preview": mask(token) if token else None,
        "repo_owner": owner or os.getenv("GITHUB_REPO_OWNER") or gh.DEFAULT_REPO_OWNER,
        "repo_name": repo or os.getenv("GITHUB_REPO_NAME") or gh.DEFAULT_REPO_NAME,
        "default_repo_owner": gh.DEFAULT_REPO_OWNER,
        "default_repo_name": gh.DEFAULT_REPO_NAME,
        "has_webhook_secret": bool(webhook_secret) or bool(os.getenv("GITHUB_WEBHOOK_SECRET")),
        "webhook_url": _webhook_url(request),
        "updated_at": (settings.get(gh.SETTING_TOKEN).updated_at.isoformat()
                       if settings.get(gh.SETTING_TOKEN) else None),
    }


class GithubConfigBody(BaseModel):
    token: Optional[str] = None
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    webhook_secret: Optional[str] = None
    generate_webhook_secret: Optional[bool] = None


@router.put("")
@router.put("/")
def save_github_config(
    body: GithubConfigBody,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    generated_secret: Optional[str] = None

    if body.token is not None:
        token = body.token.strip()
        if token:
            if len(token) > 4096:
                raise HTTPException(status_code=400, detail="Token is too long")
            _upsert_setting(session, gh.SETTING_TOKEN, token, is_secret=True)

    if body.repo_owner is not None:
        owner = body.repo_owner.strip()
        if owner:
            _upsert_setting(session, gh.SETTING_OWNER, owner, is_secret=False)

    if body.repo_name is not None:
        repo = body.repo_name.strip()
        if repo:
            _upsert_setting(session, gh.SETTING_REPO, repo, is_secret=False)

    if body.generate_webhook_secret or (body.webhook_secret is not None and not body.webhook_secret.strip()):
        generated_secret = _secrets.token_hex(32)
        _upsert_setting(session, gh.SETTING_WEBHOOK_SECRET, generated_secret, is_secret=True)
    elif body.webhook_secret is not None and body.webhook_secret.strip():
        _upsert_setting(session, gh.SETTING_WEBHOOK_SECRET, body.webhook_secret.strip(), is_secret=True)
    else:
        # Ensure a webhook secret always exists so the endpoint can verify.
        existing = _get_setting(session, gh.SETTING_WEBHOOK_SECRET)
        if not existing or not existing.value:
            generated_secret = _secrets.token_hex(32)
            _upsert_setting(session, gh.SETTING_WEBHOOK_SECRET, generated_secret, is_secret=True)

    session.commit()

    resp = {"ok": True}
    # Return the plaintext webhook secret ONCE right after (re)generation so
    # the admin can copy it into GitHub. It is never returned by GET.
    if generated_secret:
        resp["webhook_secret"] = generated_secret
    return resp


@router.post("/test")
async def test_github(
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    return await gh.test_connection(session)


@router.delete("")
@router.delete("/")
def delete_github_config(
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    for key in (gh.SETTING_TOKEN, gh.SETTING_OWNER, gh.SETTING_REPO, gh.SETTING_WEBHOOK_SECRET):
        row = session.get(AppSetting, key)
        if row:
            session.delete(row)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Inbound webhook — public, signature-verified
# ---------------------------------------------------------------------------
def _verify_signature(secret: str, raw: bytes, header: Optional[str]) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.strip())


@webhook_router.post("/webhook")
async def github_webhook(
    request: Request,
    x_hub_signature_256: Optional[str] = Header(default=None),
    x_github_event: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    raw = await request.body()

    # Resolve the webhook secret INDEPENDENTLY of token/owner/repo so the
    # webhook stays verifiable even if issue creation isn't fully configured.
    secret = gh.get_webhook_secret(session)
    if not secret:
        # No secret configured — refuse rather than accept unauthenticated writes.
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    if not _verify_signature(secret, raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Only issue events drive ticket status. Ack everything else so GitHub
    # doesn't retry (ping, etc.).
    if x_github_event != "issues":
        return {"ok": True, "ignored": x_github_event or "unknown"}

    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    action = payload.get("action")
    issue = payload.get("issue") or {}
    issue_number = issue.get("number")
    if not issue_number:
        return {"ok": True, "ignored": "no_issue_number"}

    if action not in ("closed", "reopened", "edited"):
        return {"ok": True, "ignored": f"action:{action}"}

    ticket = session.exec(
        select(Ticket).where(Ticket.github_issue_number == issue_number)
    ).first()
    if not ticket:
        return {"ok": True, "ignored": "no_matching_ticket", "issue": issue_number}

    new_status = gh.map_github_status_to_local(issue.get("state", "open"), issue.get("state_reason"))
    if str(ticket.status) != new_status and getattr(ticket.status, "value", ticket.status) != new_status:
        ticket.status = new_status
        ticket.updated_at = datetime.utcnow()
        session.add(ticket)
        session.commit()
        logger.info("GitHub webhook: ticket #%s → %s (issue #%s %s)",
                    ticket.id, new_status, issue_number, action)
        return {"ok": True, "updated": True, "ticket_id": ticket.id, "status": new_status}

    return {"ok": True, "updated": False, "ticket_id": ticket.id, "status": new_status}
