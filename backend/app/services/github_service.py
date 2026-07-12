import os
import re
import json
import base64
import httpx
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"

# AppSetting keys backing the admin GitHub panel (dev backend). The
# production Worker keeps the same values as Worker secrets instead.
SETTING_TOKEN = "github_access_token"
SETTING_OWNER = "github_repo_owner"
SETTING_REPO = "github_repo_name"
SETTING_WEBHOOK_SECRET = "github_webhook_secret"

DEFAULT_REPO_OWNER = "AxalNetwork"
DEFAULT_REPO_NAME = "StudioOS"


def _load_settings(session) -> dict:
    """Read GitHub AppSetting rows, decrypting the secret values. Returns a
    dict of key→value (missing keys omitted). Never raises."""
    if session is None:
        return {}
    try:
        from sqlmodel import select
        from backend.app.models.entities import AppSetting
        from backend.app.services.crypto_box import decrypt

        rows = session.exec(
            select(AppSetting).where(
                AppSetting.key.in_([
                    SETTING_TOKEN, SETTING_OWNER, SETTING_REPO, SETTING_WEBHOOK_SECRET,
                ])
            )
        ).all()
        out: dict = {}
        for row in rows:
            if row.value is None:
                continue
            out[row.key] = decrypt(row.value) if row.is_secret else row.value
        return out
    except Exception as e:  # pragma: no cover — best-effort config load
        logger.warning("GitHub settings load failed: %s", e)
        return {}


def get_config(session=None):
    """Resolve the effective GitHub config. DB (admin-managed) values take
    precedence, then environment variables. Returns None if token/owner/repo
    are not all resolvable."""
    settings = _load_settings(session)
    token = settings.get(SETTING_TOKEN) or os.getenv("GITHUB_ACCESS_TOKEN")
    owner = settings.get(SETTING_OWNER) or os.getenv("GITHUB_REPO_OWNER")
    repo = settings.get(SETTING_REPO) or os.getenv("GITHUB_REPO_NAME")
    if not all([token, owner, repo]):
        return None
    return {
        "token": token,
        "owner": owner,
        "repo": repo,
        "webhook_secret": settings.get(SETTING_WEBHOOK_SECRET) or os.getenv("GITHUB_WEBHOOK_SECRET"),
    }


# Kept for backward compatibility with callers that read env-only config.
def _get_config():
    return get_config(None)


def get_webhook_secret(session=None) -> str | None:
    """Resolve the webhook secret INDEPENDENTLY of token/owner/repo. The
    webhook must be verifiable even before issue creation is fully
    configured, so this must not depend on the full config being present."""
    settings = _load_settings(session)
    return settings.get(SETTING_WEBHOOK_SECRET) or os.getenv("GITHUB_WEBHOOK_SECRET")


def map_github_status_to_local(state: str, state_reason: str | None = None) -> str:
    """Mirror the Worker's GitHub→local ticket status mapping. A closed issue
    marked not_planned maps to 'closed'; any other close maps to 'resolved';
    an open issue maps back to 'open'."""
    if state == "closed":
        if state_reason == "not_planned":
            return "closed"
        return "resolved"
    return "open"


async def test_connection(session=None) -> dict:
    """Dry-run probe: verify the configured token can reach the target repo.
    Returns {ok, reachable, http_status, detail, repo}."""
    config = get_config(session)
    if not config:
        return {"ok": False, "reachable": False, "http_status": None,
                "detail": "GitHub is not fully configured (token, owner, repo required)."}
    url = f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}"
    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, timeout=15)
    except Exception as e:
        return {"ok": False, "reachable": False, "http_status": None,
                "detail": f"Network error reaching GitHub: {e}"}
    repo_full = f"{config['owner']}/{config['repo']}"
    if resp.status_code == 200:
        return {"ok": True, "reachable": True, "http_status": 200,
                "detail": f"Connected to {repo_full}.", "repo": repo_full}
    if resp.status_code == 404:
        return {"ok": False, "reachable": True, "http_status": 404,
                "detail": f"Repo {repo_full} not found, or the token lacks access to it."}
    if resp.status_code in (401, 403):
        return {"ok": False, "reachable": True, "http_status": resp.status_code,
                "detail": "GitHub rejected the token (check it has Issues read/write on the repo)."}
    return {"ok": False, "reachable": True, "http_status": resp.status_code,
            "detail": f"GitHub returned HTTP {resp.status_code}."}


def _priority_label(priority: str) -> str:
    mapping = {
        "low": "priority: low",
        "medium": "priority: medium",
        "high": "priority: high",
        "urgent": "priority: urgent",
    }
    return mapping.get(priority, "priority: medium")


def _origin_label() -> str:
    """Discriminator label so production tickets are filterable from staging /
    dev probes. Defaults to 'staging' so a misconfigured environment never
    silently flags real tickets as production. Set STUDIOOS_ENV=production in
    the prod backend's environment to flip this on."""
    env = (os.getenv("STUDIOOS_ENV") or "staging").strip().lower()
    if env not in ("production", "staging", "dev", "preview"):
        env = "staging"
    return f"origin: {env}"


async def create_github_issue(title: str, description: str = None, priority: str = "medium", submitted_by: str = None, session=None):
    config = get_config(session)
    if not config:
        logger.warning("GitHub not configured — skipping issue creation")
        return None

    labels = [_priority_label(priority), "support-ticket", _origin_label()]

    body_parts = []
    if description:
        body_parts.append(description)
    body_parts.append("")
    body_parts.append("---")
    if submitted_by:
        body_parts.append(f"**Submitted by:** {submitted_by}")
    body_parts.append(f"**Priority:** {priority}")
    body_parts.append(f"**Source:** StudioOS Support Hub")

    body = "\n".join(body_parts)

    url = f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}/issues"
    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {
        "title": title,
        "body": body,
        "labels": labels,
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers, timeout=15)
            if resp.status_code == 201:
                data = resp.json()
                logger.info(f"GitHub issue created: #{data['number']} - {data['html_url']}")
                return {
                    "number": data["number"],
                    "url": data["html_url"],
                    "id": data["id"],
                }
            else:
                logger.error(f"GitHub issue creation failed: {resp.status_code} - {resp.text}")
                return None
    except Exception as e:
        logger.error(f"GitHub issue creation error: {e}")
        return None


async def sync_activity_logs_to_github(logs: list, user_email: str):
    config = _get_config()
    if not config:
        logger.warning("GitHub not configured — skipping activity log sync")
        return None

    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', user_email)
    file_path = f"activity-logs/{safe_name}.json"
    timestamp = datetime.utcnow().isoformat()

    content_data = {
        "user": user_email,
        "exported_at": timestamp,
        "total_entries": len(logs),
        "logs": logs,
    }
    content_str = json.dumps(content_data, indent=2, default=str)
    encoded = base64.b64encode(content_str.encode()).decode()

    url = f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}/contents/{file_path}"
    headers = {
        "Authorization": f"Bearer {config['token']}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        async with httpx.AsyncClient() as client:
            existing = await client.get(url, headers=headers, timeout=15)
            sha = None
            if existing.status_code == 200:
                sha = existing.json().get("sha")

            payload = {
                "message": f"Update activity log for {user_email} — {timestamp}",
                "content": encoded,
                "branch": "main",
            }
            if sha:
                payload["sha"] = sha

            resp = await client.put(url, json=payload, headers=headers, timeout=15)
            if resp.status_code in (200, 201):
                data = resp.json()
                logger.info(f"Activity logs synced to GitHub: {file_path}")
                return {
                    "url": data.get("content", {}).get("html_url"),
                    "path": file_path,
                }
            else:
                logger.error(f"GitHub activity sync failed: {resp.status_code} - {resp.text}")
                return None
    except Exception as e:
        logger.error(f"GitHub activity sync error: {e}")
        return None
