"""KYC status (FastAPI dev mirror).

The prod Worker (`cloudflare-worker/src/routes/kyc.ts`) backs a full KYC/AML
flow on D1: `kyc_status`/`kyc_data`/`kyc_submitted_at`/… columns on `users`,
document storage, and an admin review queue. The dev FastAPI `users` table has
none of those columns, so a full mirror is out of scope here.

This module provides just enough for the SPA's KYC page to render cleanly in
dev instead of showing an inline "Not Found" when `GET /api/kyc/status` 404s:

    GET  /api/kyc/status   -> always { kyc_status: 'not_started', ... }

Submission is not backable in dev (no columns to persist to), so `POST
/api/kyc/submit` returns an explicit 400 rather than a confusing 404. Investors
therefore stay permanently KYC-gated in dev — which matches the documented dev
behaviour. Dev FastAPI is never deployed, so this partial mirror is a dev-only
convenience, not contract drift (the drift check compares the SPA against the
Worker, not against this mirror).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/kyc", tags=["kyc"])


@router.get("/status")
def kyc_status(user=Depends(get_current_user)):
    """Mirror the Worker's GET /kyc/status response shape. Dev `users` has no
    kyc_* columns, so the status is always the initial 'not_started'."""
    return {
        "user_id": user.id,
        "kyc_status": "not_started",
        "kyc_provider": None,
        "kyc_data": None,
        "submitted_at": None,
        "reviewed_at": None,
        "rejection_reason": None,
    }


@router.post("/submit")
def kyc_submit(user=Depends(get_current_user)):
    """KYC submission is not available in the dev environment — there are no
    persistence columns on the dev `users` table. Return an explicit error
    (not a 404) so the SPA surfaces a clear message instead of a crash."""
    raise HTTPException(
        status_code=400,
        detail="KYC submission is not available in the dev environment.",
    )
