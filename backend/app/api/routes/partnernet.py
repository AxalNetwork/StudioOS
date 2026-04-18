from fastapi import APIRouter, Depends, HTTPException, Query
from backend.app.models.entities import User
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/partnernet", tags=["Partner Network"])

NOT_IMPL = "Partner network module is implemented in the production Cloudflare worker only. Local dev returns empty data."


@router.get("/summary")
def summary(_: User = Depends(get_current_user)):
    return {
        "ok": True,
        "relationships_count": 0,
        "activity_count": 0,
        "leaderboard_rank": None,
        "earned_cents": 0,
    }


@router.get("/relationships")
def relationships(_: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/relationships/{rel_id}/events")
def relationship_events(rel_id: str, _: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/activity/logs")
def activity_logs(
    limit: int = Query(50),
    offset: int = Query(0),
    action_type: str | None = Query(None),
    _: User = Depends(get_current_user),
):
    return {"ok": True, "items": [], "total": 0}


@router.get("/leaderboard")
def leaderboard(_: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/leaderboard/public")
def leaderboard_public():
    return {"ok": True, "items": []}


@router.post("/relationships", status_code=501)
def create_relationship(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.patch("/relationships/{rel_id}", status_code=501)
def update_relationship(rel_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/activity/log", status_code=501)
def log_activity(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)
