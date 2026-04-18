from fastapi import APIRouter, Depends, HTTPException
from backend.app.models.entities import User
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/liquidity", tags=["Liquidity"])

NOT_IMPL = "Liquidity module is implemented in the production Cloudflare worker only. Local dev returns empty data."


@router.get("/marketplace")
def marketplace(_: User = Depends(get_current_user)):
    return {"ok": True, "items": [], "listings": []}


@router.get("/my-portfolio")
def my_portfolio(_: User = Depends(get_current_user)):
    return {
        "ok": True,
        "holdings": [],
        "my_listings": [],
        "uncalled_capital_cents": 0,
        "summary": {
            "holdings_count": 0,
            "uncalled_capital": 0,
            "open_listings": 0,
            "my_listings_count": 0,
        },
    }


@router.get("/events")
def events(_: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/listings/{listing_id}/matches")
def listing_matches(listing_id: str, _: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.post("/list", status_code=501)
def create_listing(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/match", status_code=501)
def match_listing(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/execute-exit", status_code=501)
def execute_exit(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)
