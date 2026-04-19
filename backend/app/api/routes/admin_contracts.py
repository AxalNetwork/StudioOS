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
from backend.app.services.file_storage import (
    get_storage,
    store_contract_bytes,
    mint_signed_token,
    verify_signed_token,
)
from backend.app.services.audit import log_audit, AuditAction

router = APIRouter(prefix="/admin/contracts", tags=["Admin · Contracts"])


def _resolve_bytes(session: Session, doc: Document) -> tuple[bytes, str]:
    """Return (bytes, content_type) for a document.

    Behaviour:
      - If `file_key` is set and the object exists, stream from storage.
      - Otherwise, if inline `content` exists, migrate-on-read into storage
        (clearing the inline copy) and return the bytes.
      - If `file_key` is set but the object is *missing* and there is no
        inline fallback, raise 410 Gone so we never silently serve empty
        content. (Storage data loss must be visible.)
    """
    storage = get_storage()
    if doc.file_key:
        try:
            data = storage.get(doc.file_key)
            return data, doc.file_content_type or "application/octet-stream"
        except Exception as exc:  # noqa: BLE001
            if not doc.content:
                raise HTTPException(
                    status_code=410,
                    detail=f"Stored contract object is missing (file_key={doc.file_key}); cannot serve.",
                ) from exc
            # else: fall through to inline content as a recovery path
    body = doc.content or ""
    if not body:
        raise HTTPException(status_code=410, detail="Contract has no content")
    looks_html = "<html" in body.lower() or "<div" in body.lower() or "<p>" in body.lower()
    content_type = "text/html" if looks_html else "text/plain"
    try:
        obj = store_contract_bytes(doc.uid, body.encode("utf-8"), content_type)
        doc.file_key = obj.file_key
        doc.file_size = obj.size
        doc.file_sha256 = obj.sha256
        doc.file_content_type = obj.content_type
        doc.content = None  # purge from DB now that storage holds it
        session.add(doc)
        session.commit()
    except Exception:  # noqa: BLE001
        # Migration failed but we still have the bytes in hand — serve them.
        pass
    return body.encode("utf-8"), content_type


def _safe_filename(doc: Document, content_type: str) -> str:
    safe_title = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in (doc.title or "contract"))[:64]
    ext = "html" if "html" in (content_type or "") else ("pdf" if "pdf" in (content_type or "") else "txt")
    return f"{safe_title}_{doc.uid[:8]}.{ext}"


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
        # Legal-proof evidence — admin DTO only. The founder/legal route DTO
        # never surfaces this field (see services/signatures.py).
        "signed_ip": doc.signed_ip,
        "days_to_sign": _days_to_sign(doc),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }
    out["file_key"] = doc.file_key
    out["file_size"] = doc.file_size
    out["file_content_type"] = doc.file_content_type
    out["file_sha256"] = doc.file_sha256
    if include_content:
        # Prefer the stored copy; fall back to inline `content` for legacy rows.
        if doc.file_key:
            try:
                data = get_storage().get(doc.file_key)
                out["content"] = data.decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                out["content"] = doc.content
        else:
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
    admin: User = Depends(require_admin),
):
    doc = _get_by_uid(session, uid)
    # Read-access to a contract body is sensitive — log it. Use commit=True
    # because GET handlers don't have their own write transaction.
    log_audit(
        session,
        action=AuditAction.CONTRACT_VIEWED,
        actor=admin,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"Admin {admin.email} viewed contract '{doc.title}'",
        meta={"status": str(doc.status), "doc_type": doc.doc_type},
        commit=True,
    )
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
    prev_status = str(doc.status)
    doc.status = DocumentStatus.SENT
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    log_audit(
        session,
        action=AuditAction.CONTRACT_RESENT,
        actor=admin,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"Admin {admin.email} resent contract '{doc.title}'",
        meta={"prev_status": prev_status, "new_status": "sent"},
    )
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
    prev_status = str(doc.status)
    doc.status = DocumentStatus.VOID
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    log_audit(
        session,
        action=AuditAction.CONTRACT_VOIDED,
        actor=admin,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"Admin {admin.email} voided contract '{doc.title}'",
        meta={"prev_status": prev_status, "new_status": "void"},
    )
    session.commit()
    session.refresh(doc)
    return {"ok": True, "contract": _doc_dto(session, doc)}


@router.get("/{uid}/download")
def download_contract(
    uid: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    """Auth-gated proxy that streams the contract bytes from object storage.

    Legacy rows whose body still sits inline in `documents.content` are
    migrated into storage on first access. Every successful download is
    audit-logged."""
    doc = _get_by_uid(session, uid)
    data, content_type = _resolve_bytes(session, doc)
    log_audit(
        session,
        action=AuditAction.CONTRACT_DOWNLOADED,
        actor=admin,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"Admin {admin.email} downloaded contract '{doc.title}'",
        meta={"size": len(data), "content_type": content_type},
    )
    session.commit()
    return Response(
        content=data,
        media_type=content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(doc, content_type)}"'},
    )


@router.post("/{uid}/download-url")
def issue_contract_download_url(
    uid: str,
    ttl_seconds: int = Query(300, ge=30, le=3600),
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    """Issue a short-lived signed URL the admin can share or open in a new tab.

    The URL is valid for `ttl_seconds` (default 5 min, max 1 hour) and grants
    read access to *only* this one contract. Audit-logged on issuance."""
    doc = _get_by_uid(session, uid)
    # Make sure storage has a copy (migrate legacy inline content if needed)
    if not doc.file_key:
        _resolve_bytes(session, doc)
        if not doc.file_key:
            raise HTTPException(status_code=410, detail="Contract has no file content")
    # Verify the object still exists in storage before handing out a link;
    # otherwise the recipient would just hit a 404 a few minutes from now.
    storage = get_storage()
    if not (hasattr(storage, "exists") and storage.exists(doc.file_key)):
        raise HTTPException(
            status_code=410,
            detail=f"Stored contract object is missing (file_key={doc.file_key}); cannot issue link.",
        )
    token = mint_signed_token(doc.file_key, ttl_seconds=ttl_seconds, actor=admin.email)
    log_audit(
        session,
        action=AuditAction.CONTRACT_SHARE_LINK_ISSUED,
        actor=admin,
        target_uid=doc.uid,
        project_id=doc.project_id,
        summary=f"Admin {admin.email} issued share link for '{doc.title}'",
        meta={"ttl_seconds": ttl_seconds},
    )
    session.commit()
    return {
        "url": f"/api/files/contracts/{token}",
        "expires_in": ttl_seconds,
        "filename": _safe_filename(doc, doc.file_content_type or "application/octet-stream"),
    }
