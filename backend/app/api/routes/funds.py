from fastapi import APIRouter, Depends, HTTPException, Query
from backend.app.models.entities import User
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/funds", tags=["Funds"])

NOT_IMPL = "Funds module is implemented in the production Cloudflare worker only. Local dev returns empty data."


@router.get("")
def list_funds(status: str | None = Query(None), _: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/lp-portal")
def lp_portal(_: User = Depends(get_current_user)):
    return {"ok": True, "lp_records": [], "funds": []}


@router.get("/syndication")
def syndication(_: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/distributions")
def distributions(fund_id: str = Query(...), _: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/{fund_id}")
def get_fund(fund_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=404, detail="Fund not found")


@router.get("/{fund_id}/lps")
def list_lps(fund_id: str, _: User = Depends(get_current_user)):
    return {"ok": True, "items": []}


@router.get("/{fund_id}/lpa")
def get_lpa(fund_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=404, detail="No LPA on file yet")


@router.post("", status_code=501)
def create_fund(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/{fund_id}/regenerate-lpa", status_code=501)
def regenerate_lpa(fund_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/{fund_id}/capital-call", status_code=501)
def capital_call(fund_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/{fund_id}/lps", status_code=501)
def add_lp(fund_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/lps/{lp_id}/sign-lpa", status_code=501)
def sign_lpa(lp_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/distributions/execute", status_code=501)
def execute_distribution(_: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)


@router.post("/distributions/{dist_id}/mark-paid", status_code=501)
def mark_distribution_paid(dist_id: str, _: User = Depends(get_current_user)):
    raise HTTPException(status_code=501, detail=NOT_IMPL)
