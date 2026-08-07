"""Contacts — dev mirror of the worker's inbound relationship hub (list side).

The production hub lives in `cloudflare-worker/src/routes/contacts.ts`. This
mirror covers ONLY what the founder-facing lead surfaces read and write:

    GET /contacts            audience/status-filtered list + per-audience counts
                             (each row carries landing_template_kit /
                             landing_page_name so panels can show which
                             template a lead signed up through)

plus `ingest_contact()`, called by the public landing waitlist capture in
`brand.py` — the same dual-write the worker does — so the "INBOUND LEADS ·
BRAND & PAGES" panels and the Brand page's audience-inflow counts work in
local dev. The rest of the hub (replies, tasks, invites, promote, the raise
pipeline) is prod-only; the frontend already tolerates those being absent in
dev.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/contacts", tags=["Contacts"])

logger = logging.getLogger("studioos.contacts")

# Mirror of CONTACT_AUDIENCES in the worker's contacts.ts.
CONTACT_AUDIENCES = ["customer", "investor", "partner", "advisor", "mentor", "cofounder"]

_schema_ready = False


def _ensure_schema(session: Session) -> None:
    global _schema_ready
    if _schema_ready:
        return
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS contacts (
            id BIGSERIAL PRIMARY KEY,
            uid TEXT UNIQUE NOT NULL,
            project_id INTEGER NOT NULL,
            audience TEXT NOT NULL,
            routed_to TEXT NOT NULL DEFAULT 'network',
            name TEXT,
            email TEXT NOT NULL,
            cta TEXT,
            message TEXT,
            source TEXT,
            landing_page_id INTEGER,
            status TEXT NOT NULL DEFAULT 'new',
            promoted_to TEXT,
            promoted_ref_id INTEGER,
            last_activity_at TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id, audience)",
        "CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)",
    ]
    for stmt in stmts:
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    # codeql[py/unused-global-variable] -- _schema_ready is read via the `global _schema_ready` guard at the top of this
    # same function (`if _schema_ready: return`); the write here is what a LATER, separate
    # call's read observes. CodeQL's dead-store analysis does not model a global's value persisting
    # across separate invocations of the function that sets it, so it sees this write as never
    # consumed. It is: this flag exists specifically to make the schema-migration idempotent-but-
    # skippable after the first successful request in this process.
    _schema_ready = True


def route_for(audience: str) -> str:
    """Audience → founder destination. Mirror of routeFor() in contacts.ts."""
    return {
        "customer": "discovery",
        "investor": "raise",
        "advisor": "advisory",
        "mentor": "advisory",
        "cofounder": "team",
        "partner": "marketplace",
    }.get(audience, "network")


def ingest_contact(
    session: Session,
    *,
    project_id: int,
    email: str,
    landing_page_id: Optional[int] = None,
    name: Optional[str] = None,
    audience: Optional[str] = None,
    cta: Optional[str] = None,
    message: Optional[str] = None,
    source: Optional[str] = None,
) -> None:
    """Best-effort lead ingest — callers must not let a failure break capture."""
    _ensure_schema(session)
    aud = audience if audience in CONTACT_AUDIENCES else "customer"
    now = datetime.utcnow().isoformat()
    session.exec(text(
        "INSERT INTO contacts (uid, project_id, audience, routed_to, name, email, cta, message, "
        "source, landing_page_id, status, last_activity_at, created_at, updated_at) "
        "VALUES (:uid, :pid, :aud, :routed, :name, :email, :cta, :message, "
        ":source, :lid, 'new', :now, :now, :now)"
    ), params={
        "uid": secrets.token_hex(12), "pid": project_id, "aud": aud, "routed": route_for(aud),
        "name": name, "email": (email or "").lower(), "cta": cta, "message": message,
        "source": source or "landing", "lid": landing_page_id, "now": now,
    })


def _owned_project_ids(session: Session, user: User) -> Optional[list]:
    """Project ids the founder owns; None means unrestricted (admin)."""
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role == "admin":
        return None
    founder_id = getattr(user, "founder_id", None)
    if not founder_id:
        return []
    rows = session.exec(text(
        "SELECT id FROM projects WHERE founder_id = :fid AND deleted_at IS NULL"
    ), params={"fid": founder_id}).mappings().all()
    return [int(r["id"]) for r in rows]


def _iso_or_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    return v.isoformat() if isinstance(v, datetime) else str(v)


@router.get("")
def list_contacts(
    audience: Optional[str] = None,
    status: Optional[str] = None,
    routed_to: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    scope = _owned_project_ids(session, user)
    if scope is not None and len(scope) == 0:
        return {"items": [], "counts": {}}

    where = ["1=1"]
    params: dict = {}
    if scope is not None:
        keys = []
        for i, pid in enumerate(scope):
            key = f"pid{i}"
            keys.append(f":{key}")
            params[key] = pid
        where.append(f"c.project_id IN ({', '.join(keys)})")
    if audience in CONTACT_AUDIENCES:
        where.append("c.audience = :audience")
        params["audience"] = audience
    if status:
        where.append("c.status = :status")
        params["status"] = status
    if routed_to:
        where.append("c.routed_to = :routed_to")
        params["routed_to"] = routed_to

    # Same JOIN as the worker: attribute each lead to the landing page (and
    # template) it signed up through. Filters are placeholder-bound; the only
    # interpolated fragments are the numbered :pidN keys generated above.
    # Justification: static SQL skeleton with bound params only; dev-only FastAPI.
    rows = session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        "SELECT c.*, lp.template_kit AS landing_template_kit, lp.name AS landing_page_name "
        "FROM contacts c LEFT JOIN landing_pages lp ON lp.id = c.landing_page_id "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC LIMIT 500"
    ), params=params).mappings().all()

    items = []
    counts: dict = {}
    for r in rows:
        aud = r["audience"]
        counts[aud] = counts.get(aud, 0) + 1
        items.append({
            "id": r["id"],
            "uid": r["uid"],
            "project_id": r["project_id"],
            "audience": aud,
            "routed_to": r["routed_to"],
            "name": r["name"],
            "email": r["email"],
            "cta": r["cta"],
            "message": r["message"],
            "source": r["source"],
            "landing_page_id": r["landing_page_id"],
            "status": r["status"],
            "promoted_to": r["promoted_to"],
            "promoted_ref_id": r["promoted_ref_id"],
            "last_activity_at": _iso_or_str(r["last_activity_at"]),
            "created_at": _iso_or_str(r["created_at"]),
            "updated_at": _iso_or_str(r["updated_at"]),
            "landing_template_kit": r.get("landing_template_kit"),
            "landing_page_name": r.get("landing_page_name"),
        })
    return {"items": items, "counts": counts}
