"""Admin-only cross-platform contract management.

Surfaces every Document on the platform (regardless of project) with
recipient/signatory enrichment so admins can see what was sent, what's
pending, and what's been signed — and act on it (resend / void / download).
"""

from datetime import datetime, timedelta
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import (
    User, ActivityLog, Document, DocumentStatus, Project, Founder, Partner,
)
from backend.app.api.routes.admin import require_admin

router = APIRouter(prefix="/admin/contracts", tags=["Admin · Contracts"])


# ---------------------------------------------------------------------------
# DTO helper
# ---------------------------------------------------------------------------
def _project_name(session: Session, project_id: Optional[int]) -> Optional[str]:
    if not project_id:
        return None
    p = session.get(Project, project_id)
    return p.name if p else None


def _recipient_email(session: Session, doc: Document) -> Optional[str]:
    """Best-effort recipient: signed_by takes precedence; otherwise the
    project's founder email."""
    if doc.signed_by:
        return doc.signed_by
    if doc.project_id:
        p = session.get(Project, doc.project_id)
        if p and p.founder_id:
            f = session.get(Founder, p.founder_id)
            if f:
                return f.email
    return None


def _days_to_sign(doc: Document) -> Optional[int]:
    if doc.signed_at and doc.created_at:
        return max(0, (doc.signed_at - doc.created_at).days)
    return None


def _doc_dto(session: Session, doc: Document, *, include_content: bool = False) -> dict:
    out = {
        "id": doc.id,
        "uid": doc.uid,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "template_name": doc.template_name,
        "project_id": doc.project_id,
        "project_name": _project_name(session, doc.project_id),
        "recipient_email": _recipient_email(session, doc),
        "signed_by": doc.signed_by,
        "signed_at": doc.signed_at.isoformat() if doc.signed_at else None,
        "days_to_sign": _days_to_sign(doc),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }
    if include_content:
        out["content"] = doc.content
    return out


# ---------------------------------------------------------------------------
# List + filter
# ---------------------------------------------------------------------------
@router.get("")
def list_contracts(
    status: Optional[str] = Query(None, description="draft|generated|sent|signed|void"),
    doc_type: Optional[str] = None,
    project_id: Optional[int] = None,
    q: Optional[str] = Query(None, description="Search title/recipient/template"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    stmt = select(Document).order_by(Document.created_at.desc())
    if status:
        stmt = stmt.where(Document.status == status)
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)

    docs = session.exec(stmt).all()
    rows = [_doc_dto(session, d) for d in docs]

    if q:
        needle = q.lower()
        rows = [
            r for r in rows
            if (r["title"] or "").lower().find(needle) >= 0
            or (r["recipient_email"] or "").lower().find(needle) >= 0
            or (r["template_name"] or "").lower().find(needle) >= 0
            or (r["project_name"] or "").lower().find(needle) >= 0
        ]

    total = len(rows)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": rows[offset: offset + limit],
    }


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
@router.get("/stats")
def contract_stats(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    docs = session.exec(select(Document)).all()
    by_status: Counter = Counter()
    by_type: Counter = Counter()
    sign_days: list = []
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    signed_recent = 0

    def _val(x):
        # Normalize enum-or-str to its string value for stable counting.
        return getattr(x, "value", x) if x is not None else None

    for d in docs:
        by_status[_val(d.status)] += 1
        by_type[_val(d.doc_type)] += 1
        days = _days_to_sign(d)
        if days is not None:
            sign_days.append(days)
        if d.signed_at and d.signed_at >= thirty_days_ago:
            signed_recent += 1

    pending = by_status.get("sent", 0) + by_status.get("generated", 0)

    return {
        "total": len(docs),
        "by_status": {
            "draft":     by_status.get("draft", 0),
            "generated": by_status.get("generated", 0),
            "sent":      by_status.get("sent", 0),
            "signed":    by_status.get("signed", 0),
            "void":      by_status.get("void", 0),
        },
        "by_type": [{"type": t, "count": n} for t, n in by_type.most_common() if t],
        "avg_days_to_sign": round(sum(sign_days) / len(sign_days), 1) if sign_days else None,
        "signed_last_30d": signed_recent,
        "pending_signature": pending,
    }


# ---------------------------------------------------------------------------
# Templates with usage counts
# ---------------------------------------------------------------------------
@router.get("/templates")
def contract_templates(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    # Lazy import to avoid circular reference with legal router
    from backend.app.api.routes.legal import TEMPLATES, TEMPLATE_LAYERS

    docs = session.exec(select(Document)).all()
    usage: Counter = Counter()
    last_used: dict = {}
    for d in docs:
        key = d.template_name or d.doc_type
        if not key:
            continue
        usage[key] += 1
        if not last_used.get(key) or (d.created_at and d.created_at > last_used[key]):
            last_used[key] = d.created_at

    out = []
    for k, v in TEMPLATES.items():
        out.append({
            "key": k,
            "title": v["title"],
            "doc_type": k,  # template key doubles as doc_type in this codebase
            "layer": v["layer"],
            "layer_label": TEMPLATE_LAYERS[v["layer"]]["label"],
            "usage_count": usage.get(k, 0),
            "last_used_at": last_used[k].isoformat() if last_used.get(k) else None,
        })
    out.sort(key=lambda r: (-r["usage_count"], r["title"]))
    return out


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
def _get_by_uid(session: Session, uid: str) -> Document:
    doc = session.exec(select(Document).where(Document.uid == uid)).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    return doc


@router.get("/{uid}")
def get_contract(
    uid: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    doc = _get_by_uid(session, uid)
    return _doc_dto(session, doc, include_content=True)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
@router.post("/{uid}/resend")
def resend_contract(
    uid: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    doc = _get_by_uid(session, uid)
    if doc.status == DocumentStatus.SIGNED:
        raise HTTPException(status_code=400, detail="Cannot resend a signed contract")
    doc.status = DocumentStatus.SENT
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    session.add(ActivityLog(
        project_id=doc.project_id,
        user_id=admin.id,
        action="contract_resent",
        details=f"Admin {admin.email} resent contract '{doc.title}' (uid={doc.uid})",
        actor=admin.email,
    ))
    session.commit()
    session.refresh(doc)
    return {"ok": True, "contract": _doc_dto(session, doc)}


@router.post("/{uid}/void")
def void_contract(
    uid: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    doc = _get_by_uid(session, uid)
    if doc.status == DocumentStatus.SIGNED:
        raise HTTPException(status_code=400, detail="Cannot void a signed contract")
    doc.status = DocumentStatus.VOID
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    session.add(ActivityLog(
        project_id=doc.project_id,
        user_id=admin.id,
        action="contract_voided",
        details=f"Admin {admin.email} voided contract '{doc.title}' (uid={doc.uid})",
        actor=admin.email,
    ))
    session.commit()
    session.refresh(doc)
    return {"ok": True, "contract": _doc_dto(session, doc)}


@router.get("/{uid}/download")
def download_contract(
    uid: str,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    doc = _get_by_uid(session, uid)
    body = doc.content or ""
    # Detect HTML payloads coming from the template engine
    looks_html = "<html" in body.lower() or "<div" in body.lower() or "<p>" in body.lower()
    media_type = "text/html" if looks_html else "text/plain"
    ext = "html" if looks_html else "txt"
    safe_title = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in (doc.title or "contract"))[:64]
    filename = f"{safe_title}_{doc.uid[:8]}.{ext}"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
