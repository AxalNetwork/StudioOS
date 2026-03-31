import os
import re
import json
import base64
import httpx
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


def _get_config():
    token = os.getenv("GITHUB_ACCESS_TOKEN")
    owner = os.getenv("GITHUB_REPO_OWNER")
    repo = os.getenv("GITHUB_REPO_NAME")
    if not all([token, owner, repo]):
        return None
    return {"token": token, "owner": owner, "repo": repo}


def _priority_label(priority: str) -> str:
    mapping = {
        "low": "priority: low",
        "medium": "priority: medium",
        "high": "priority: high",
        "urgent": "priority: urgent",
    }
    return mapping.get(priority, "priority: medium")


async def create_github_issue(title: str, description: str = None, priority: str = "medium", submitted_by: str = None):
    config = _get_config()
    if not config:
        logger.warning("GitHub not configured — skipping issue creation")
        return None

    labels = [_priority_label(priority), "support-ticket"]

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
