"""Phase 0.2 — Global cmd-K search (FastAPI dev mirror).

Production search runs on Cloudflare Vectorize via the Worker's
`/api/search` route. In dev (FastAPI + SQLite) we don't have access to
Workers AI embeddings, so this mirror falls back to a fast SQL `LIKE`
ranker across the same entity types: projects, deals, founders,
partners (users), legal documents, and academy lessons.

Response shape mirrors the worker so the frontend `CommandPalette`
component is identical against either backend.

GET /api/search?q=...&type=...&limit=10[&grouped=1]
    -> { query, type, allowed_types, groups: {type: [hit, ...]}, hits: [...] }
"""
from __future__ import annotations

from typing import List, Dict, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/search", tags=["Search"])

ALL_TYPES = ["project", "deal", "founder", "partner", "document", "academy_lesson"]
PRIVILEGED = {"admin", "partner", "investor"}


def _allowed_types(role: str) -> List[str]:
    return ALL_TYPES if role in PRIVILEGED else ["project", "academy_lesson"]


def _scrub(hit: Dict) -> Dict:
    # Mirror the worker's defense-in-depth snippet scrub — never wire-leak
    # legal document body text.
    if hit.get("type") == "document":
        return {**hit, "snippet": "Legal document — open to view (download required)"}
    return hit


def _ensure_academy_table(session: Session) -> None:
    # Idempotent CREATE — academy lessons aren't yet a SQLModel entity
    # in dev, but the search surface promises to include them.
    session.exec(text(
        """
        CREATE TABLE IF NOT EXISTS academy_lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE,
            title TEXT NOT NULL,
            summary TEXT,
            body TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
        """
    ))
    session.commit()


def _query_type(
    session: Session,
    entity_type: str,
    q: str,
    limit: int,
) -> List[Dict]:
    like = f"%{q}%"
    if entity_type == "project":
        rows = session.exec(text(
            "SELECT id, name, sector, problem_statement, description "
            "FROM projects "
            "WHERE name LIKE :like OR sector LIKE :like OR problem_statement LIKE :like OR description LIKE :like "
            "ORDER BY updated_at DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"project:{r['id']}",
            "type": "project",
            "entity_id": r["id"],
            "title": r["name"] or f"Project #{r['id']}",
            "url": f"/projects/{r['id']}",
            "snippet": (r["problem_statement"] or r["description"] or "")[:200],
            "score": 0.0,
        } for r in rows]

    if entity_type == "deal":
        rows = session.exec(text(
            "SELECT d.id, d.status, p.name AS project_name, p.sector "
            "FROM deals d LEFT JOIN projects p ON p.id = d.project_id "
            "WHERE p.name LIKE :like OR d.status LIKE :like OR p.sector LIKE :like OR d.notes LIKE :like "
            "ORDER BY d.updated_at DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"deal:{r['id']}",
            "type": "deal",
            "entity_id": r["id"],
            "title": f"Deal — {r['project_name'] or '#' + str(r['id'])}",
            "url": f"/deals?id={r['id']}",
            "snippet": f"{r['status'] or 'applied'} • {r['sector'] or 'sector unknown'}",
            "score": 0.0,
        } for r in rows]

    if entity_type == "founder":
        rows = session.exec(text(
            "SELECT id, name, email, domain_expertise, experience_years "
            "FROM founders "
            "WHERE name LIKE :like OR email LIKE :like OR domain_expertise LIKE :like OR bio LIKE :like "
            "ORDER BY id DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"founder:{r['id']}",
            "type": "founder",
            "entity_id": r["id"],
            "title": r["name"],
            "url": f"/founder?id={r['id']}",
            "snippet": f"{r['domain_expertise'] or 'founder'} • {r['experience_years'] or 0}y exp",
            "score": 0.0,
        } for r in rows]

    if entity_type == "partner":
        rows = session.exec(text(
            "SELECT id, name, email, role FROM users "
            "WHERE name LIKE :like OR email LIKE :like "
            "ORDER BY id DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"partner:{r['id']}",
            "type": "partner",
            "entity_id": r["id"],
            "title": f"{r['name']} ({r['role']})",
            "url": f"/admin?user={r['id']}",
            "snippet": f"{r['role']} • {r['email']}",
            "score": 0.0,
        } for r in rows]

    if entity_type == "document":
        rows = session.exec(text(
            "SELECT id, deal_id, type AS doc_type, status FROM documents "
            "WHERE type LIKE :like OR status LIKE :like "
            "ORDER BY id DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"document:{r['id']}",
            "type": "document",
            "entity_id": r["id"],
            "title": f"{r['doc_type']} (deal #{r['deal_id']})",
            "url": f"/legal?deal={r['deal_id']}",
            "snippet": f"{r['doc_type']} • {r['status'] or 'draft'} • deal #{r['deal_id']}",
            "score": 0.0,
        } for r in rows]

    if entity_type == "academy_lesson":
        _ensure_academy_table(session)
        rows = session.exec(text(
            "SELECT id, slug, title, summary FROM academy_lessons "
            "WHERE title LIKE :like OR summary LIKE :like OR body LIKE :like "
            "ORDER BY id DESC LIMIT :limit"
        ), params={"like": like, "limit": limit}).mappings().all()
        return [{
            "id": f"academy_lesson:{r['id']}",
            "type": "academy_lesson",
            "entity_id": r["id"],
            "title": r["title"],
            "url": f"/academy/{r['slug'] or r['id']}",
            "snippet": (r["summary"] or "")[:200],
            "score": 0.0,
        } for r in rows]

    return []


@router.get("")
def global_search(
    q: str = Query("", max_length=500),
    type: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=25),
    grouped: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    q = (q or "").strip()
    if not q:
        return {"query": "", "hits": [], "groups": {}}

    role = getattr(user.role, "value", user.role)
    role = str(role or "").lower()
    allowed = _allowed_types(role)
    is_grouped = grouped in ("1", "true", "yes")

    requested = type if type in ALL_TYPES else None
    if requested and requested not in allowed:
        return {"query": q, "type": requested, "hits": [], "groups": {}, "warning": "type not available for your role"}

    types_to_query = [requested] if requested else allowed
    groups: Dict[str, List[Dict]] = {t: [] for t in allowed}
    flat: List[Dict] = []
    for t in types_to_query:
        try:
            hits = _query_type(session, t, q, limit)
        except Exception as e:  # noqa: BLE001
            # Missing table or other dev-only schema drift — skip the type
            # so a single misconfigured table doesn't break the palette.
            print(f"search: type={t} failed: {e}")
            hits = []
        hits = [_scrub(h) for h in hits]
        groups[t] = hits[:limit]
        flat.extend(hits)

    if is_grouped or not requested:
        return {"query": q, "type": requested or "all", "allowed_types": allowed, "groups": groups, "hits": flat[:limit]}
    return {"query": q, "type": requested, "allowed_types": allowed, "hits": flat[:limit]}
