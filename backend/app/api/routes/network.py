"""Task #38 — DEV-ONLY network/payouts shim.

Production hosts ``/api/network/*`` on the Worker
(``cloudflare-worker/src/routes/network.ts``) backed by D1
``commissions``/``payouts`` tables. The dev FastAPI backend has neither,
so the Payouts page 404'd on load.

Dev-only parity shim: returns an empty-but-valid balance/commissions/
payouts envelope (the shape ``PayoutsPage`` consumes) and accepts a payout
request as an in-process no-op stub. Never deploys (replit.md).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.api.routes.auth import get_current_user
from backend.app.models.entities import User

router = APIRouter(prefix="/network", tags=["Network"])

# In-process payout requests: user_id -> [payout dict]. Resets on --reload.
_PAYOUTS: dict[int, list] = {}


@router.get("/payouts/me")
def payouts_me(user: User = Depends(get_current_user)):
    return {
        "balance_cents": 0,
        "lifetime_cents": 0,
        "commissions": [],
        "payouts": _PAYOUTS.get(user.id, []),
    }


class PayoutRequestIn(BaseModel):
    amount_cents: Optional[int] = None
    amount_usd: Optional[float] = None
    payout_method: str = "wire"
    payout_details: Optional[dict] = None
    details: Optional[str] = None


@router.post("/payout/request")
def payout_request(body: PayoutRequestIn, user: User = Depends(get_current_user)):
    amt = body.amount_cents
    if amt is None and body.amount_usd is not None:
        amt = int(round(body.amount_usd * 100))
    amt = amt or 0
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Payout amount must be greater than zero.")
    queue = _PAYOUTS.setdefault(user.id, [])
    payout = {
        "id": len(queue) + 1,
        "amount_cents": amt,
        "status": "requested",
        "payout_method": body.payout_method,
        "created_at": datetime.utcnow().isoformat(),
    }
    queue.insert(0, payout)
    return payout
