"""Centralised audit logging.

All sensitive actions go through `log_audit()` so the event names, actor
attribution, and metadata format stay uniform across routes. Logs are written
to the `activity_logs` table (model: `ActivityLog`) and surface in the admin
Activity feed.

Conventions:
  * `action` is a stable, snake_case verb-phrase (e.g. `contract.viewed`).
    Dotted namespaces let the frontend filter by prefix.
  * `actor` is the actor's email — keeps logs readable even after a user is
    deleted/renamed.
  * `target_uid` identifies the *resource* the action was performed on
    (contract uid, company uid, etc). Stored in `details` because the
    `ActivityLog` schema is a flat-ish ledger.
  * `meta` is a small dict of extra context (status transitions, member ids,
    etc). Serialised as JSON inside `details` so we never need a schema
    migration when we add a new event.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from sqlmodel import Session

from backend.app.models.entities import ActivityLog, User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Action name constants (dotted namespace, stable wire names)
# ---------------------------------------------------------------------------
class AuditAction:
    # Contracts
    CONTRACT_CREATED = "contract.created"
    CONTRACT_VIEWED = "contract.viewed"
    CONTRACT_DOWNLOADED = "contract.downloaded"
    CONTRACT_SHARE_LINK_ISSUED = "contract.share_link_issued"
    CONTRACT_SENT = "contract.sent"
    CONTRACT_RESENT = "contract.resent"
    CONTRACT_VOIDED = "contract.voided"
    CONTRACT_SIGNED = "contract.signed"

    # Companies
    COMPANY_CREATED = "company.created"
    COMPANY_UPDATED = "company.updated"
    COMPANY_MEMBER_ADDED = "company.member_added"
    COMPANY_MEMBER_REMOVED = "company.member_removed"


# ---------------------------------------------------------------------------
# Core helper
# ---------------------------------------------------------------------------
def log_audit(
    session: Session,
    *,
    action: str,
    actor: Optional[User],
    target_uid: Optional[str] = None,
    project_id: Optional[int] = None,
    summary: str = "",
    meta: Optional[dict[str, Any]] = None,
    commit: bool = False,
) -> ActivityLog:
    """Append a single audit row.

    `commit=False` (default) leaves the transaction open so the caller can
    commit alongside its own state changes atomically. Set `commit=True` only
    for read-only events that aren't part of a write transaction (e.g.
    `contract.viewed`)."""
    actor_email = (actor.email if actor else None) or "system"
    actor_name = (actor.name if actor else None) or actor_email

    payload: dict[str, Any] = {}
    if target_uid:
        payload["target_uid"] = target_uid
    if meta:
        payload["meta"] = meta

    # Human-readable summary first, JSON metadata appended for parsers.
    details = summary or action
    if payload:
        try:
            details = f"{details} {json.dumps(payload, separators=(',', ':'), default=str)}"
        except Exception:  # noqa: BLE001
            details = f"{details} {payload}"

    row = ActivityLog(
        project_id=project_id,
        user_id=actor.id if actor else None,
        action=action,
        details=details,
        actor=actor_email,
    )
    session.add(row)
    if commit:
        try:
            session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("audit log commit failed for action=%s target=%s", action, target_uid)
    # Mirror to app log so structured log aggregation can pick it up too.
    logger.info("AUDIT %s actor=%s target=%s meta=%s", action, actor_email, target_uid, payload.get("meta"))
    return row
