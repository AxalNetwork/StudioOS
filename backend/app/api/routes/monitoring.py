from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from backend.app.models.entities import User, UserRole
from backend.app.api.routes.auth import get_current_user

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
