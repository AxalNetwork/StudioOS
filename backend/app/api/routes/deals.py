import io
import zipfile
import uuid as _uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text as _sql
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import Deal, Project, Partner, User, Document
from backend.app.schemas.scoring import DealCreate, DealUpdate
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import (
    is_privileged,
    ensure_founder_access,
    require_role,
    require_admin,
)

# Phase 0.1 split: legacy "partner" callers were almost all capital
# allocators (now `investor`). Allow both during transition; tighten in
# Phase 4 once investor-only deal-flow surfaces ship.
require_partner = require_role("partner", "investor")
# Task #4 — advancing a deal stage is an operator action (admin / partner).
require_operator = require_role("partner")
# Task #4 — recording a capital commitment is an investor action (admin passes).
require_investor = require_role("investor")

router = APIRouter(prefix="/deals", tags=["Deal Flow"])

PIPELINE = ["applied", "scored", "active", "funded"]


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class DealDraftCreate(BaseModel):
    project_id: int
    partner_id: int | None = None
    lead_partner_id: int | None = None
    status: str = "applied"
    notes: str | None = None
    description: str | None = None
    website: str | None = None
    amount: float | None = None
    target_raise: float | None = None
    minimum_check: float | None = None
    valuation_cap: float | None = None
    carry_pct: float | None = None
    management_fee_pct: float | None = None
    instrument: str | None = None
    spv_jurisdiction: str | None = None
    closing_deadline: str | None = None


class CommitmentCreate(BaseModel):
    amount: float
    notes: str | None = None


class InvitationCreate(BaseModel):
    investor_user_ids: list[int]
    message: str | None = None
    send_email: bool = False


class InvitationRespond(BaseModel):
    response: str  # 'interested' | 'passed'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _days_in_stage(deal: Deal) -> int:
    ref = deal.stage_changed_at or deal.updated_at or deal.created_at
    if not ref:
        return 0
    try:
        return max(0, (datetime.utcnow() - ref).days)
    except Exception:
        return 0


def _serialize_deal(deal: Deal, session: Session) -> dict:
    project = session.get(Project, deal.project_id) if deal.project_id else None
    partner = session.get(Partner, deal.partner_id) if deal.partner_id else None
    lead = session.get(User, deal.lead_partner_id) if deal.lead_partner_id else None
    target = deal.target_raise or 0
    committed = deal.capital_committed or 0
    progress = round((committed / target) * 100, 1) if target else 0
    return {
        **deal.model_dump(),
        "project_name": project.name if project else None,
        "project_sector": project.sector if project else None,
        "partner_name": partner.name if partner else None,
        "lead_partner_name": lead.name if lead else None,
        "progress_pct": progress,
        "days_in_stage": _days_in_stage(deal),
    }


def _founder_user_id(session: Session, project_id: int | None) -> int | None:
    if not project_id:
        return None
    project = session.get(Project, project_id)
    if not project or not getattr(project, "founder_id", None):
        return None
    # The founder→user link lives on users.founder_id (there is no
    # founders.user_id column).
    row = session.exec(
        _sql("SELECT id FROM users WHERE founder_id = :fid LIMIT 1").bindparams(fid=project.founder_id)
    ).first()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Funnel aggregates
# ---------------------------------------------------------------------------
@router.get("/funnel")
def deal_funnel(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """Per-stage aggregates for the Deal Flow funnel cards: count, summed
    target raise, and a 7-day 'deals added' trend. Privileged roles only —
    founders don't see the firm-wide funnel."""
    if not is_privileged(user):
        return {"stages": [], "total": 0}
    stages = []
    for stage in PIPELINE + ["rejected"]:
        deals = session.exec(select(Deal).where(Deal.status == stage)).all()
        count = len(deals)
        total_target = sum((d.target_raise or d.amount or 0) for d in deals)
        total_committed = sum((d.capital_committed or 0) for d in deals)
        added_7d = 0
        for d in deals:
            ref = d.created_at
            if ref and (datetime.utcnow() - ref).days <= 7:
                added_7d += 1
        stages.append({
            "stage": stage,
            "count": count,
            "total_target": total_target,
            "total_committed": total_committed,
            "added_7d": added_7d,
        })
    return {"stages": stages, "total": sum(s["count"] for s in stages)}


# ---------------------------------------------------------------------------
# List + create
# ---------------------------------------------------------------------------
@router.get("/")
def list_deals(status: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Deal).order_by(Deal.created_at.desc())
    # IDOR guard: founders can only list deals on their own projects.
    if not is_privileged(user):
        if not user.founder_id:
            return []
        stmt = stmt.join(Project, Project.id == Deal.project_id).where(Project.founder_id == user.founder_id)
    if status:
        stmt = stmt.where(Deal.status == status)
    deals = session.exec(stmt).all()

    result = []
    for d in deals:
        row = _serialize_deal(d, session)
        row["founder_user_id"] = _founder_user_id(session, d.project_id)
        result.append(row)
    return result


@router.post("/")
def create_deal(data: DealCreate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, data.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # IDOR guard: founders may only create deals against their own project.
    ensure_founder_access(user, project.founder_id)

    deal = Deal(
        project_id=data.project_id,
        partner_id=data.partner_id,
        status=data.status,
        notes=data.notes,
        amount=data.amount,
        stage_changed_at=datetime.utcnow(),
    )
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal


@router.post("/draft")
def draft_deal(data: DealDraftCreate, session: Session = Depends(get_session), user: User = Depends(require_admin)):
    """Admin-only 'Draft Deal': create a fully-specified deal defaulting to the
    Applied stage with stage_changed_at set to now."""
    project = session.get(Project, data.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    status = data.status if data.status in (PIPELINE + ["rejected"]) else "applied"
    deal = Deal(
        project_id=data.project_id,
        partner_id=data.partner_id,
        lead_partner_id=data.lead_partner_id,
        status=status,
        notes=data.notes,
        description=data.description,
        website=data.website,
        amount=data.amount,
        target_raise=data.target_raise,
        minimum_check=data.minimum_check,
        valuation_cap=data.valuation_cap,
        carry_pct=data.carry_pct,
        management_fee_pct=data.management_fee_pct,
        instrument=data.instrument,
        spv_jurisdiction=data.spv_jurisdiction,
        closing_deadline=data.closing_deadline,
        capital_committed=0,
        stage_changed_at=datetime.utcnow(),
    )
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return _serialize_deal(deal, session)


# ---------------------------------------------------------------------------
# Lead-partner + investor pickers (for the admin forms)
# ---------------------------------------------------------------------------
@router.get("/lead-partners")
def lead_partner_options(session: Session = Depends(get_session), user: User = Depends(require_partner)):
    users = session.exec(
        select(User).where(User.role.in_(["admin", "partner"])).where(User.is_active == True)  # noqa: E712
    ).all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users]


@router.get("/investors")
def investor_options(session: Session = Depends(get_session), user: User = Depends(require_admin)):
    users = session.exec(
        select(User).where(User.role == "investor").where(User.is_active == True)  # noqa: E712
    ).all()
    return [{"id": u.id, "name": u.name, "email": u.email} for u in users]


# Static path — declared BEFORE the dynamic `/{deal_id}` routes so it is never
# shadowed by path-parameter matching.
@router.get("/invitations/mine")
def my_invitations(session: Session = Depends(get_session), user: User = Depends(require_investor)):
    rows = session.exec(
        _sql(
            "SELECT di.id, di.uid, di.deal_id, di.status, di.message, di.created_at, di.responded_at, "
            "p.name AS project_name, d.status AS deal_status "
            "FROM deal_invitations di LEFT JOIN deals d ON d.id = di.deal_id "
            "LEFT JOIN projects p ON p.id = d.project_id "
            "WHERE di.investor_user_id = :iid ORDER BY di.created_at DESC"
        ).bindparams(iid=user.id)
    ).all()
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/{deal_id}")
def get_deal(deal_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    # Deal-room read access: operators full, founders own-project only,
    # investors relationship-gated (see _ensure_deal_read_access).
    _ensure_deal_read_access(session, user, deal)
    row = _serialize_deal(deal, session)
    row["founder_user_id"] = _founder_user_id(session, deal.project_id)
    return row


@router.put("/{deal_id}")
def update_deal(deal_id: int, data: DealUpdate, session: Session = Depends(get_session), user: User = Depends(require_operator)):
    # Deal mutation is partner/admin only.
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    update_data = data.model_dump(exclude_unset=True)
    prior_stage = str(getattr(deal, "status", None) or "")
    for key, val in update_data.items():
        setattr(deal, key, val)
    new_stage = str(getattr(deal, "status", None) or "")
    if new_stage and new_stage != prior_stage:
        deal.stage_changed_at = datetime.utcnow()
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()
    session.refresh(deal)

    # Phase 0.2 — notify the owning founder when a deal stage advances.
    if new_stage and new_stage != prior_stage and deal.project_id:
        try:
            from backend.app.services.notify import notify
            founder_user_id = _founder_user_id(session, deal.project_id)
            if founder_user_id:
                notify(
                    user_id=founder_user_id,
                    type="deal_stage_change",
                    title=f"Deal stage: {new_stage}",
                    body=f"Your deal moved from {prior_stage or 'open'} to {new_stage}",
                    link="/deals",
                    payload={"deal_id": deal.id, "from": prior_stage, "to": new_stage},
                    channels=("in_app", "email", "slack"),
                )
        except Exception:
            pass
    return _serialize_deal(deal, session)


@router.post("/{deal_id}/advance")
def advance_deal(deal_id: int, session: Session = Depends(get_session), user: User = Depends(require_operator)):
    """Advance a deal to the next pipeline stage (operator action)."""
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    cur = str(deal.status.value if hasattr(deal.status, "value") else deal.status)
    if cur not in PIPELINE or PIPELINE.index(cur) >= len(PIPELINE) - 1:
        raise HTTPException(status_code=400, detail="Deal cannot advance further")
    nxt = PIPELINE[PIPELINE.index(cur) + 1]
    deal.status = nxt
    deal.stage_changed_at = datetime.utcnow()
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return _serialize_deal(deal, session)


# ---------------------------------------------------------------------------
# Deal Room — documents, data room, commitments, activity
# ---------------------------------------------------------------------------
def _investor_has_deal_relationship(session: Session, user_id: int, deal_id: int) -> bool:
    """Investors may read a specific deal room only via an explicit
    relationship: an invitation to this deal, or an existing commitment on it.
    Deal rooms carry UNMASKED founder data, so investors get no blanket access
    (kept in lockstep with the Cloudflare Worker predicate)."""
    inv = session.exec(
        _sql("SELECT 1 FROM deal_invitations WHERE deal_id = :d AND investor_user_id = :u LIMIT 1").bindparams(d=deal_id, u=user_id)
    ).first()
    if inv:
        return True
    com = session.exec(
        _sql("SELECT 1 FROM commitments WHERE deal_id = :d AND investor_user_id = :u LIMIT 1").bindparams(d=deal_id, u=user_id)
    ).first()
    return bool(com)


def _ensure_deal_read_access(session: Session, user: User, deal: Deal) -> None:
    """Deal-room read authorization, aligned across both backends:
    - admin / partner: full access (studio-wide staff)
    - founder: only their own project (via ensure_founder_access)
    - investor: relationship-gated (invited or committed)
    """
    _role = getattr(user, "role", None)
    role = (_role.value if hasattr(_role, "value") else str(_role or "")).lower()
    if role == "investor":
        if not _investor_has_deal_relationship(session, user.id, deal.id):
            raise HTTPException(status_code=403, detail="Forbidden: you are not invited to this deal")
        return
    project = session.get(Project, deal.project_id) if deal.project_id else None
    ensure_founder_access(user, project.founder_id if project else None)


def _load_deal_for_read(deal_id: int, session: Session, user: User) -> Deal:
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    _ensure_deal_read_access(session, user, deal)
    return deal


@router.get("/{deal_id}/documents")
def deal_documents(deal_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    deal = _load_deal_for_read(deal_id, session, user)
    if not deal.project_id:
        return []
    docs = session.exec(select(Document).where(Document.project_id == deal.project_id)).all()
    return [{
        "id": d.id,
        "uid": d.uid,
        "title": d.title,
        "doc_type": d.doc_type.value if hasattr(d.doc_type, "value") else d.doc_type,
        "status": d.status.value if hasattr(d.status, "value") else d.status,
        "created_at": d.created_at,
    } for d in docs]


@router.get("/{deal_id}/data-room")
def download_data_room(deal_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    deal = _load_deal_for_read(deal_id, session, user)
    project = session.get(Project, deal.project_id) if deal.project_id else None
    docs = session.exec(select(Document).where(Document.project_id == deal.project_id)).all() if deal.project_id else []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        readme = [
            f"Data Room — {project.name if project else 'Deal #' + str(deal_id)}",
            f"Stage: {deal.status.value if hasattr(deal.status, 'value') else deal.status}",
            f"Documents: {len(docs)}",
            f"Exported: {datetime.utcnow().isoformat()}Z",
        ]
        zf.writestr("README.txt", "\n".join(readme))
        seen = set()
        for d in docs:
            base = "".join(c if c.isalnum() or c in " -_." else "_" for c in (d.title or f"document_{d.id}"))
            name = f"{base}.txt"
            i = 1
            while name in seen:
                name = f"{base}_{i}.txt"
                i += 1
            seen.add(name)
            zf.writestr(name, d.content or "(document stored externally — no inline content)")
    buf.seek(0)
    fname = f"data-room-deal-{deal_id}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/{deal_id}/commitments")
def list_commitments(deal_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _load_deal_for_read(deal_id, session, user)
    rows = session.exec(
        _sql(
            "SELECT c.id, c.uid, c.deal_id, c.investor_user_id, c.amount, c.status, "
            "c.notes, c.created_at, u.name AS investor_name "
            "FROM commitments c LEFT JOIN users u ON u.id = c.investor_user_id "
            "WHERE c.deal_id = :did ORDER BY c.created_at DESC"
        ).bindparams(did=deal_id)
    ).all()
    return [dict(r._mapping) for r in rows]


@router.post("/{deal_id}/commitments")
def create_commitment(deal_id: int, data: CommitmentCreate, session: Session = Depends(get_session), user: User = Depends(require_investor)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="Commitment amount must be positive")
    # An investor must be invited to a deal before committing capital. This also
    # prevents self-granting deal-room read access by committing to any deal id.
    invited = session.exec(
        _sql("SELECT 1 FROM deal_invitations WHERE deal_id = :d AND investor_user_id = :u LIMIT 1").bindparams(d=deal_id, u=user.id)
    ).first()
    if not invited:
        raise HTTPException(status_code=403, detail="You must be invited to this deal before committing capital")
    uid = str(_uuid.uuid4())
    session.exec(
        _sql(
            "INSERT INTO commitments (uid, deal_id, investor_user_id, amount, status, notes) "
            "VALUES (:uid, :did, :iid, :amt, 'pending', :notes)"
        ).bindparams(uid=uid, did=deal_id, iid=user.id, amt=data.amount, notes=data.notes)
    )
    # Roll the commitment into the deal's capital_committed total.
    deal.capital_committed = (deal.capital_committed or 0) + data.amount
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()

    # Notify the founder that capital was committed.
    try:
        from backend.app.services.notify import notify
        founder_user_id = _founder_user_id(session, deal.project_id)
        if founder_user_id:
            notify(
                user_id=founder_user_id,
                type="deal_commitment",
                title="New capital commitment",
                body=f"{user.name} committed ${data.amount:,.0f} to your deal",
                link=f"/deals/{deal_id}",
                payload={"deal_id": deal_id, "amount": data.amount},
                channels=("in_app", "email"),
            )
    except Exception:
        pass
    return {"ok": True, "uid": uid, "capital_committed": deal.capital_committed}


@router.get("/{deal_id}/activity")
def deal_activity(deal_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    deal = _load_deal_for_read(deal_id, session, user)
    events = []
    events.append({
        "type": "created",
        "label": "Deal created",
        "at": deal.created_at,
    })
    if deal.stage_changed_at:
        events.append({
            "type": "stage",
            "label": f"Moved to {deal.status.value if hasattr(deal.status, 'value') else deal.status}",
            "at": deal.stage_changed_at,
        })
    commits = session.exec(
        _sql(
            "SELECT c.amount, c.created_at, u.name AS investor_name FROM commitments c "
            "LEFT JOIN users u ON u.id = c.investor_user_id WHERE c.deal_id = :did ORDER BY c.created_at DESC"
        ).bindparams(did=deal_id)
    ).all()
    for r in commits:
        m = r._mapping
        events.append({
            "type": "commitment",
            "label": f"{m['investor_name'] or 'An investor'} committed ${(m['amount'] or 0):,.0f}",
            "at": m["created_at"],
        })
    invites = session.exec(
        _sql(
            "SELECT di.status, di.created_at, di.responded_at, u.name AS investor_name FROM deal_invitations di "
            "LEFT JOIN users u ON u.id = di.investor_user_id WHERE di.deal_id = :did ORDER BY di.created_at DESC"
        ).bindparams(did=deal_id)
    ).all()
    for r in invites:
        m = r._mapping
        events.append({
            "type": "invitation",
            "label": f"{m['investor_name'] or 'An investor'} invited"
                     + (f" — {m['status']}" if m["status"] != "invited" else ""),
            "at": m["responded_at"] or m["created_at"],
        })
    events.sort(key=lambda e: e["at"] or datetime.min, reverse=True)
    return events


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------
@router.get("/{deal_id}/invitations")
def list_invitations(deal_id: int, session: Session = Depends(get_session), user: User = Depends(require_admin)):
    rows = session.exec(
        _sql(
            "SELECT di.id, di.uid, di.deal_id, di.investor_user_id, di.status, di.message, "
            "di.email_opt_in, di.created_at, di.responded_at, u.name AS investor_name, u.email AS investor_email "
            "FROM deal_invitations di LEFT JOIN users u ON u.id = di.investor_user_id "
            "WHERE di.deal_id = :did ORDER BY di.created_at DESC"
        ).bindparams(did=deal_id)
    ).all()
    return [dict(r._mapping) for r in rows]


@router.post("/{deal_id}/invitations")
def create_invitations(deal_id: int, data: InvitationCreate, session: Session = Depends(get_session), user: User = Depends(require_admin)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    status = str(deal.status.value if hasattr(deal.status, "value") else deal.status)
    if status not in ("active", "scored"):
        raise HTTPException(status_code=400, detail="Investors can only be invited to Active or Scored deals")
    project = session.get(Project, deal.project_id) if deal.project_id else None
    company = project.name if project else f"Deal #{deal_id}"

    created = 0
    for iid in data.investor_user_ids:
        invitee = session.get(User, iid)
        if not invitee or invitee.role != "investor":
            continue
        uid = str(_uuid.uuid4())
        try:
            row = session.exec(
                _sql(
                    "INSERT INTO deal_invitations (uid, deal_id, investor_user_id, invited_by_user_id, message, email_opt_in, status) "
                    "VALUES (:uid, :did, :iid, :inv, :msg, :email, 'invited') "
                    "ON CONFLICT (deal_id, investor_user_id) DO NOTHING RETURNING id"
                ).bindparams(uid=uid, did=deal_id, iid=iid, inv=user.id, msg=data.message, email=bool(data.send_email))
            ).first()
            session.commit()
        except Exception:
            session.rollback()
            continue
        # Duplicate invite (ON CONFLICT no-op) — don't double-count or re-notify.
        if not row:
            continue
        created += 1
        try:
            from backend.app.services.notify import notify
            channels = ["in_app", "email"] if data.send_email else ["in_app"]
            notify(
                user_id=iid,
                type="deal_invitation",
                title=f"You're invited to review {company}",
                body=data.message or f"{user.name} invited you to review a deal.",
                link=f"/deals/{deal_id}",
                payload={"deal_id": deal_id},
                channels=tuple(channels),
            )
        except Exception:
            pass
    return {"ok": True, "invited": created}


@router.post("/{deal_id}/invitations/respond")
def respond_invitation(deal_id: int, data: InvitationRespond, session: Session = Depends(get_session), user: User = Depends(require_investor)):
    resp = data.response
    if resp not in ("interested", "passed"):
        raise HTTPException(status_code=400, detail="response must be 'interested' or 'passed'")
    row = session.exec(
        _sql(
            "SELECT id, invited_by_user_id FROM deal_invitations WHERE deal_id = :did AND investor_user_id = :iid"
        ).bindparams(did=deal_id, iid=user.id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No invitation found for this deal")
    session.exec(
        _sql(
            "UPDATE deal_invitations SET status = :st, responded_at = CURRENT_TIMESTAMP "
            "WHERE deal_id = :did AND investor_user_id = :iid"
        ).bindparams(st=resp, did=deal_id, iid=user.id)
    )
    session.commit()
    # Notify the inviting admin of the response.
    try:
        from backend.app.services.notify import notify
        inviter = row[1]
        if inviter:
            notify(
                user_id=inviter,
                type="deal_invitation_response",
                title=f"{user.name} is {resp} in a deal",
                body=f"{user.name} responded '{resp}' to your invitation.",
                link=f"/deals/{deal_id}",
                payload={"deal_id": deal_id, "response": resp},
                channels=("in_app",),
            )
    except Exception:
        pass
    return {"ok": True, "status": resp}
