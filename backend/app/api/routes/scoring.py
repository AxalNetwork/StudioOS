import json
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Project, ScoreSnapshot, DealMemo, Founder, Deal, ActivityLog, User, UserRole
from backend.app.schemas.scoring import ScoreRequest, GenerateMemoRequest, ScoreRunRequest
from backend.app.services.scoring import run_full_score, run_brain_score, tier_label
from backend.app.services.ai_memo import generate_memo_with_ai
from backend.app.services.scoring_ai import explain_score
from backend.app.services.score_integrity import (
    assert_no_reserved_fields,
    assert_official_inputs_complete,
    MissingOfficialInputsError,
    sign_score,
    verify_score,
    detect_anomalies,
    INTEGRITY_VERSION,
)
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_role, ensure_founder_access
from datetime import datetime, timedelta

router = APIRouter(prefix="/scoring", tags=["Scoring Engine"])

require_partner = require_role("partner")


def _is_founder(user: User) -> bool:
    role_val = getattr(user.role, "value", user.role)
    return role_val == "founder"


def _strip_admin_fields(payload: dict, viewer: User) -> dict:
    """LP/partner reads must not see admin-only review metadata or raw inputs.
    Admins see the full record so they can adjudicate flagged snapshots."""
    role_val = getattr(viewer.role, "value", viewer.role)
    if role_val == "admin":
        return payload
    safe = dict(payload)
    for key in ("admin_review_notes", "admin_reviewed_by", "admin_reviewed_at", "inputs_json"):
        safe.pop(key, None)
    return safe


@router.post("/score")
async def score_startup(
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Reserved-field rejection runs BEFORE Pydantic parsing so we can return
    # a precise error rather than letting Pydantic silently coerce/drop.
    raw = await request.json()
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    try:
        assert_no_reserved_fields(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        req = ScoreRequest(**raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Sandbox is founder-only — coerce for partner/admin actors.
    is_sandbox = bool(req.is_sandbox) and _is_founder(user)

    # Epic 5: OFFICIAL runs must include every required rubric input. Sandbox
    # stays permissive so founders can iterate freely on partial drafts.
    if not is_sandbox:
        try:
            assert_official_inputs_complete(raw)
        except MissingOfficialInputsError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "missing_official_inputs",
                    "missing": exc.missing,
                    "message": str(exc),
                },
            )

    result = run_full_score(req.model_dump(exclude={"is_sandbox"}))

    if req.project_id:
        project = session.get(Project, req.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        # IDOR guard: founders may only score their own project; partner/admin can score any.
        ensure_founder_access(user, project.founder_id)

        # Official-run cooldown: 1 per 7 days. Admin can bypass with `?force=1`.
        if not is_sandbox:
            force = request.query_params.get("force") == "1"
            role_val = getattr(user.role, "value", user.role)
            if not force or role_val != "admin":
                last_official = session.exec(
                    select(ScoreSnapshot)
                    .where(ScoreSnapshot.project_id == project.id)
                    .where(ScoreSnapshot.is_sandbox == False)  # noqa: E712
                    .order_by(ScoreSnapshot.created_at.desc())
                ).first()
                if last_official and last_official.locked_until and last_official.locked_until > datetime.utcnow():
                    locked_iso = last_official.locked_until.isoformat() + "Z"
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "code": "official_cooldown",
                            "locked_until": locked_iso,
                            "previous_snapshot_id": last_official.id,
                            "message": f"Official scoring locked until {locked_iso} (use Practice mode in the meantime).",
                        },
                    )

        # Anomaly detection runs before insert so we know whether to flag.
        flags = detect_anomalies(
            session,
            project_id=project.id,
            new_total=result["total_score"],
            new_inputs=req.model_dump(exclude={"project_id", "startup_name", "is_sandbox"}),
            is_sandbox=is_sandbox,
        )
        review_status = "flagged" if (flags and not is_sandbox) else "auto_approved"

        snapshot = ScoreSnapshot(
            project_id=project.id,
            total_score=result["total_score"],
            tier=result["tier"],
            market_size=result["breakdown"]["market"]["size"],
            market_urgency=result["breakdown"]["market"]["urgency"],
            market_trend=result["breakdown"]["market"]["trend"],
            market_total=result["breakdown"]["market"]["total"],
            team_expertise=result["breakdown"]["team"]["expertise"],
            team_execution=result["breakdown"]["team"]["execution"],
            team_network=result["breakdown"]["team"]["network"],
            team_total=result["breakdown"]["team"]["total"],
            product_mvp_time=result["breakdown"]["product"]["mvp_time"],
            product_complexity=result["breakdown"]["product"]["complexity"],
            product_dependency=result["breakdown"]["product"]["dependency"],
            product_total=result["breakdown"]["product"]["total"],
            capital_cost_mvp=result["breakdown"]["capital"]["cost_mvp"],
            capital_time_revenue=result["breakdown"]["capital"]["time_revenue"],
            capital_burn_traction=result["breakdown"]["capital"]["burn_traction"],
            capital_total=result["breakdown"]["capital"]["total"],
            fit_alignment=result["breakdown"]["fit"]["alignment"],
            fit_synergy=result["breakdown"]["fit"]["synergy"],
            fit_total=result["breakdown"]["fit"]["total"],
            distribution_channels=result["breakdown"]["distribution"]["channels"],
            distribution_virality=result["breakdown"]["distribution"]["virality"],
            distribution_total=result["breakdown"]["distribution"]["total"],
            ai_adjustment=result["ai_adjustment"],
            is_sandbox=is_sandbox,
            inputs_json=json.dumps(req.model_dump(exclude={"project_id", "is_sandbox"})),
            anomaly_flags=json.dumps(flags) if flags else None,
            admin_review_status=review_status,
            integrity_version=INTEGRITY_VERSION,
            locked_until=(None if is_sandbox else datetime.utcnow() + timedelta(days=7)),
        )
        session.add(snapshot)
        session.flush()  # populate snapshot.id for the HMAC message

        # Sign every snapshot — sandbox AND official — so the audit trail is
        # complete. LP visibility is enforced separately (sandbox rows never
        # reach LPs); signing universally lets the nightly audit + admin
        # tooling detect tampering on any row.
        digest, _ = sign_score(project.id, result["total_score"], snapshot.created_at)
        snapshot.integrity_hash = digest
        session.add(snapshot)

        # Project status only flips for official, non-flagged runs. Flagged
        # snapshots stay invisible until admin sign-off (project remains in
        # 'scoring' state).
        if not is_sandbox and review_status == "auto_approved":
            if result["total_score"] >= 85:
                project.status = "tier_1"
            elif result["total_score"] >= 70:
                project.status = "tier_2"
            else:
                project.status = "rejected"
            project.updated_at = datetime.utcnow()
            session.add(project)
        elif review_status == "flagged":
            project.status = "scoring"
            project.updated_at = datetime.utcnow()
            session.add(project)

        session.commit()
        session.refresh(snapshot)
        result["snapshot_id"] = snapshot.id
        result["is_sandbox"] = is_sandbox
        result["integrity_hash"] = snapshot.integrity_hash
        result["requires_admin_review"] = (review_status == "flagged")
        result["anomaly_flags"] = flags

    return result


@router.post("/run")
def run_brain(req: ScoreRunRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """
    v2 — "The Brain" 100-point scoring engine. Stateless preview only.

    Epic 5: this endpoint MUST NOT persist snapshots or mutate project status.
    All persistence + tier transitions go through `/scoring/score`, which
    enforces reserved-field rejection, the 7-day cooldown, HMAC signing, and
    the anomaly review queue. `save_to_project` is intentionally rejected
    here so there is exactly one anti-cheat-guarded write path.
    """
    if req.save_to_project:
        raise HTTPException(
            status_code=400,
            detail=(
                "Persistence via /scoring/run was disabled by Epic 5 anti-cheat. "
                "Submit through /scoring/score (the anti-cheat-guarded path) instead."
            ),
        )

    payload = {
        "market":   req.market.model_dump(),
        "team":     req.team.model_dump(),
        "product":  req.product.model_dump(),
        "traction": req.traction.model_dump(),
        "capital":  req.capital.model_dump(),
        "fit":      req.fit.model_dump(),
        "ai_adjustment": req.ai_adjustment,
    }
    result = run_brain_score(payload)
    explanation = explain_score(result, startup_name=req.startup_name, context=req.notes)
    result["ai_explanation"] = explanation
    result["saved"] = False
    return result


@router.post("/score/{project_id}/deal-memo")
def generate_deal_memo(project_id: int, session: Session = Depends(get_session), user: User = Depends(require_partner)):
    # Memo creation is partner/admin only.
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Epic 5: memos may only be built from APPROVED, OFFICIAL, hash-VERIFIED
    # snapshots. Sandbox/flagged/rejected/tampered rows must never become an
    # LP-facing memo.
    stmt = (
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .where(ScoreSnapshot.is_sandbox == False)  # noqa: E712
        .where(ScoreSnapshot.admin_review_status.in_(("auto_approved", "approved")))
        .order_by(ScoreSnapshot.created_at.desc())
    )
    snapshot = session.exec(stmt).first()
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail="No approved official score found. Run /scoring/score or have admin approve the flagged snapshot first.",
        )
    if not snapshot.integrity_hash or not verify_score(snapshot):
        raise HTTPException(
            status_code=409,
            detail="Score integrity check failed; admin must re-verify before memo generation.",
        )

    founder = session.get(Founder, project.founder_id) if project.founder_id else None
    founder_name = founder.name if founder else "Unknown"

    decision = "INVEST / SPINOUT" if snapshot.tier == "TIER_1" else ("CONDITIONAL" if snapshot.tier == "TIER_2" else "PASS")

    memo = DealMemo(
        project_id=project.id,
        score_snapshot_id=snapshot.id,
        startup_name=project.name,
        founders=founder_name,
        sector=project.sector,
        stage=project.stage,
        total_score=snapshot.total_score,
        tier=snapshot.tier,
        problem=project.problem_statement,
        solution=project.solution,
        why_now=project.why_now,
        users=str(project.users_count) if project.users_count else None,
        revenue_info=str(project.revenue) if project.revenue else None,
        growth_signals=project.growth_signals,
        cost_to_mvp=str(project.cost_to_mvp) if project.cost_to_mvp else None,
        funding_needed=str(project.funding_needed) if project.funding_needed else None,
        use_of_funds=project.use_of_funds,
        decision=decision,
    )
    session.add(memo)
    session.commit()
    session.refresh(memo)

    return {
        "id": memo.id,
        "startup_name": memo.startup_name,
        "founders": memo.founders,
        "sector": memo.sector,
        "stage": memo.stage,
        "score": memo.total_score,
        "tier": memo.tier,
        "tier_label": tier_label(memo.tier),
        "problem": memo.problem,
        "solution": memo.solution,
        "why_now": memo.why_now,
        "traction": {
            "users": memo.users,
            "revenue": memo.revenue_info,
            "growth_signals": memo.growth_signals,
        },
        "economics": {
            "cost_to_mvp": memo.cost_to_mvp,
            "funding_needed": memo.funding_needed,
            "use_of_funds": memo.use_of_funds,
        },
        "axal_fit": {
            "strategic_alignment": memo.strategic_alignment,
            "partner_synergies": memo.partner_synergies,
        },
        "risks": memo.risks,
        "decision": memo.decision,
        "terms": {
            "amount": memo.terms_amount,
            "equity": memo.terms_equity,
            "structure": memo.terms_structure,
        },
    }


@router.get("/scores/{project_id}")
def get_project_scores(
    project_id: int,
    include_sandbox: int = Query(0, ge=0, le=1),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # IDOR guard: founders may only see their own project's scores.
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_founder_access(user, project.founder_id)

    role_val = getattr(user.role, "value", user.role)
    is_admin = role_val == "admin"
    is_founder = role_val == "founder"

    stmt = (
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .order_by(ScoreSnapshot.created_at.desc())
    )
    snapshots = session.exec(stmt).all()

    visible: list[dict] = []
    audit_entries: list[ActivityLog] = []
    for snap in snapshots:
        # Verify FIRST so we can audit the mismatch even when we hide the
        # row. The audit trail's whole point is to make tamper attempts
        # discoverable, including the ones we silently dropped from the
        # response — otherwise an LP dispute can't be replayed.
        integrity_valid = verify_score(snap) if not snap.is_sandbox else None
        hidden_reason: str | None = None

        if snap.is_sandbox:
            if not (is_admin or (is_founder and include_sandbox)):
                hidden_reason = "sandbox_visibility"
        else:
            if snap.admin_review_status not in ("auto_approved", "approved") and not is_admin:
                hidden_reason = f"review_status:{snap.admin_review_status}"
            elif not is_admin and not integrity_valid:
                hidden_reason = "integrity_invalid"

        # Audit non-sandbox reads regardless of visibility — including the
        # hidden-on-mismatch case the reviewer flagged. Founder reads of
        # their own row stay un-audited (the LP-visibility guarantee is
        # what we're auditing).
        if role_val in ("lp", "partner", "admin") and not snap.is_sandbox:
            audit_entries.append(ActivityLog(
                project_id=snap.project_id,
                user_id=user.id,
                action="score_read",
                actor=role_val,
                details=json.dumps({
                    "snapshot_id": snap.id,
                    "total_score": snap.total_score,
                    "tier": snap.tier,
                    "integrity_hash": snap.integrity_hash,
                    "integrity_valid": integrity_valid,
                    "admin_review_status": snap.admin_review_status,
                    "hidden_reason": hidden_reason,
                }),
            ))

        if hidden_reason is not None:
            continue

        payload = snap.model_dump() if hasattr(snap, "model_dump") else dict(snap.__dict__)
        payload["integrity_valid"] = integrity_valid
        visible.append(_strip_admin_fields(payload, user))

    if audit_entries:
        for entry in audit_entries:
            session.add(entry)
        session.commit()

    return visible


@router.get("/deal-memos/{project_id}")
def get_deal_memos(project_id: int, session: Session = Depends(get_session), _: User = Depends(require_partner)):
    stmt = (
        select(DealMemo)
        .where(DealMemo.project_id == project_id)
        .order_by(DealMemo.created_at.desc())
    )
    memos = session.exec(stmt).all()
    return memos


@router.get("/queue")
def scoring_queue(session: Session = Depends(get_session), _: User = Depends(require_partner)):
    stmt = (
        select(Project)
        .where(Project.status.in_(["intake", "scoring"]))
        .order_by(Project.created_at.desc())
    )
    projects = session.exec(stmt).all()
    return projects


@router.post("/generateMemo")
def generate_memo_standalone(data: GenerateMemoRequest, session: Session = Depends(get_session), _: User = Depends(require_partner)):
    memo_input = {
        "startup_name": data.startup_name,
        "problem": data.problem,
        "solution": data.solution,
        "traction": data.traction,
        "sector": data.sector,
        "tam": data.tam or 0,
        "team_info": data.team_info,
        "funding_needed": data.funding_needed or 0,
        "use_of_funds": data.use_of_funds,
        "risks": data.risks,
    }

    result = generate_memo_with_ai(memo_input)

    return {
        "startup_name": data.startup_name,
        "ai_generated": result["ai_generated"],
        "memo": result["memo"],
    }
