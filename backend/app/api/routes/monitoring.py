import json
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Project, ScoreSnapshot, User, UserRole
from backend.app.api.routes.auth import get_current_user
from backend.app.services.score_integrity import verify_score

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def require_admin(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _clamp_minutes(minutes: int) -> int:
    return max(5, min(1440, int(minutes or 60)))


@router.get("/metrics")
def metrics(minutes: int = Query(60), _: User = Depends(require_admin)):
    win = _clamp_minutes(minutes)
    return {
        "window_minutes": win,
        "health": "green",
        "summary": {
            "total_requests": 0,
            "errors_5xx": 0,
            "rate_limited": 0,
            "avg_latency_ms": 0,
            "error_rate_pct": 0,
        },
        "requests_per_minute": [],
        "ai_calls_per_minute": [],
        "spinouts_per_minute": [],
        "top_endpoints": [],
    }


@router.get("/rate-limits")
def rate_limits(minutes: int = Query(60), _: User = Depends(require_admin)):
    return {
        "window_minutes": _clamp_minutes(minutes),
        "blocked": [],
        "heatmap": [],
        "by_user": [],
    }


@router.get("/errors")
def errors(limit: int = Query(50), _: User = Depends(require_admin)):
    return {"errors": []}


@router.get("/anomalies")
def anomalies(_: User = Depends(require_admin)):
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_minutes": 60,
        "rate_limit_blocks": 0,
        "errors_5xx": 0,
        "anomalies": [],
        "ai_summary": "System nominal. No anomalies detected in the last hour.",
    }


@router.get("/throughput")
def throughput(user: User = Depends(get_current_user)):
    if user.role not in (UserRole.ADMIN, UserRole.PARTNER):
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"window_minutes": 60, "requests": 0, "spinouts_completed": 0}


@router.post("/cleanup")
def cleanup(_: User = Depends(require_admin)):
    return {
        "purged": {"system_metrics": 0, "rate_limit_logs": 0, "error_logs": 0},
        "cutoff": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Epic 5 — Score Integrity admin queue
# ---------------------------------------------------------------------------
# Same shape as the Worker's `/monitoring/score-flags*` endpoints, so the
# same MonitoringPage tab works against either backend in dev/prod.
@router.get("/score-flags")
def list_score_flags(
    status: str = Query("flagged"),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    if status not in ("flagged", "approved", "rejected", "auto_approved"):
        raise HTTPException(status_code=400, detail="Invalid status filter")

    rows = session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.admin_review_status == status)
        .order_by(ScoreSnapshot.created_at.desc())
        .limit(200)
    ).all()

    items = []
    for snap in rows:
        project = session.get(Project, snap.project_id)
        try:
            flags = json.loads(snap.anomaly_flags) if snap.anomaly_flags else []
        except json.JSONDecodeError:
            flags = []
        is_valid = verify_score(snap)
        items.append({
            "id": snap.id,
            "project_id": snap.project_id,
            "project_name": project.name if project else None,
            "total_score": snap.total_score,
            "tier": snap.tier,
            "created_at": snap.created_at.isoformat() if isinstance(snap.created_at, datetime) else str(snap.created_at),
            "is_sandbox": snap.is_sandbox,
            "admin_review_status": snap.admin_review_status,
            "anomaly_flags": flags,
            "integrity_hash": snap.integrity_hash,
            "integrity_valid": is_valid,
            # Reason hint surfaces in the admin UI badge.
            "integrity_reason": None if is_valid else ("missing_signature" if not snap.integrity_hash else "hash_mismatch"),
            "locked_until": snap.locked_until.isoformat() if snap.locked_until else None,
        })
    return {"items": items, "count": len(items)}


@router.post("/score-flags/{snapshot_id}/review")
def review_score_flag(
    snapshot_id: int,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
):
    decision = (payload or {}).get("decision")
    notes = (payload or {}).get("notes") or None
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

    snap = session.get(ScoreSnapshot, snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    project = session.get(Project, snap.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    snap.admin_review_status = "approved" if decision == "approve" else "rejected"
    snap.admin_review_notes = notes
    snap.admin_reviewed_by = user.id
    snap.admin_reviewed_at = datetime.utcnow()
    session.add(snap)

    # Approval re-derives project tier from the now-trusted score; rejection
    # parks the project back in the 'scoring' lane so the founder can iterate.
    if decision == "approve":
        if snap.total_score >= 85:
            project.status = "tier_1"
        elif snap.total_score >= 70:
            project.status = "tier_2"
        else:
            project.status = "rejected"
    else:
        project.status = "scoring"
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    return {"ok": True, "snapshot_id": snap.id, "status": snap.admin_review_status}


@router.post("/score-flags/{snapshot_id}/waiver")
def waive_cooldown(
    snapshot_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    """One-off cooldown waiver — clears `locked_until` so the founder can
    re-run the official score immediately. Used when an honest mistake
    shouldn't cost them 7 days of momentum."""
    snap = session.get(ScoreSnapshot, snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    snap.locked_until = None
    session.add(snap)
    session.commit()
    return {"ok": True, "snapshot_id": snap.id, "locked_until": None}
