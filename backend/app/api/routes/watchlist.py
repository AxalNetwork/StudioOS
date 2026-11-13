"""Task #49 — Watchlist + decision journal routes. Mounted at ``/api``.

  GET    /watchlist                     — list owner's items
  POST   /watchlist                     — create
  GET    /watchlist/{uid}               — fetch one
  PUT    /watchlist/{uid}               — edit
  DELETE /watchlist/{uid}               — drop
  POST   /watchlist/{uid}/convert       — promote watchlist item -> Deal

  GET    /journal                       — list owner's entries
  POST   /journal                       — create (pre-vote rationale)
  GET    /journal/{uid}                 — fetch one
  PUT    /journal/{uid}                 — edit body
  POST   /journal/{uid}/outcome         — record post-decision outcome
  DELETE /journal/{uid}                 — drop

  GET    /antiportfolio                 — aggregate roll-up of pass-decisions

Role gate (admin/investor/partner only — founders + advisors get 403):
the watchlist + journal is a capital-side DD instrument, not a founder
self-service tool.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User
from backend.app.services import watchlist as svc

logger = logging.getLogger("studioos.watchlist")
router = APIRouter(tags=["Watchlist & Decision Journal"])


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------
@router.get("/watchlist")
def watchlist_list(
    status: Optional[str] = Query(default=None),
    owner: str = Query(default="me", regex="^(me|all)$"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    items = svc.list_watchlist_items(session, user, status=status, owner=owner)
    counts = {"watching": 0, "converted": 0, "passed_on": 0, "archived": 0}
    for it in items:
        counts[it.status] = counts.get(it.status, 0) + 1
    return {
        "items": [svc.serialize_watchlist_item(session, it) for it in items],
        "counts": counts,
    }


@router.post("/watchlist", status_code=201)
def watchlist_create(
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = svc.create_watchlist_item(session, user, payload)
    return svc.serialize_watchlist_item(session, item)


@router.get("/watchlist/{uid}")
def watchlist_get(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return svc.serialize_watchlist_item(session, svc.get_watchlist_item(session, user, uid))


@router.put("/watchlist/{uid}")
def watchlist_update(
    uid: str,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    item = svc.update_watchlist_item(session, user, uid, payload)
    return svc.serialize_watchlist_item(session, item)


@router.delete("/watchlist/{uid}", status_code=204)
def watchlist_delete(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    svc.delete_watchlist_item(session, user, uid)
    return None


@router.post("/watchlist/{uid}/convert")
def watchlist_convert(
    uid: str,
    payload: dict = Body(default={}),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    partner_id = payload.get("partner_id")
    amount = payload.get("amount")
    notes = payload.get("notes")
    item, deal = svc.convert_watchlist_to_deal(
        session, user, uid, partner_id=partner_id, amount=amount, notes=notes,
    )
    return {
        "watchlist": svc.serialize_watchlist_item(session, item),
        "deal": {
            "id": deal.id, "uid": deal.uid, "project_id": deal.project_id,
            "status": getattr(deal.status, "value", deal.status),
            "amount": deal.amount,
        },
    }


# ---------------------------------------------------------------------------
# Decision journal
# ---------------------------------------------------------------------------
@router.get("/journal")
def journal_list(
    decision: Optional[str] = Query(default=None),
    outcome_status: Optional[str] = Query(default=None),
    project_uid: Optional[str] = Query(default=None),
    owner: str = Query(default="me", regex="^(me|all)$"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entries = svc.list_journal_entries(
        session, user,
        decision=decision, outcome_status=outcome_status,
        project_uid=project_uid, owner=owner,
    )
    counts_dec = {"invest": 0, "pass": 0, "defer": 0}
    counts_out = {"pending": 0, "hit": 0, "miss": 0, "partial": 0, "inconclusive": 0}
    for e in entries:
        counts_dec[e.decision] = counts_dec.get(e.decision, 0) + 1
        counts_out[e.outcome_status] = counts_out.get(e.outcome_status, 0) + 1
    return {
        "items": [svc.serialize_journal_entry(session, e) for e in entries],
        "counts_by_decision": counts_dec,
        "counts_by_outcome": counts_out,
    }


@router.post("/journal", status_code=201)
def journal_create(
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entry = svc.create_journal_entry(session, user, payload)
    return svc.serialize_journal_entry(session, entry)


@router.get("/journal/{uid}")
def journal_get(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return svc.serialize_journal_entry(session, svc.get_journal_entry(session, user, uid))


@router.put("/journal/{uid}")
def journal_update(
    uid: str,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entry = svc.update_journal_entry(session, user, uid, payload)
    return svc.serialize_journal_entry(session, entry)


@router.post("/journal/{uid}/outcome")
def journal_outcome(
    uid: str,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    entry = svc.record_outcome(session, user, uid, payload)
    return svc.serialize_journal_entry(session, entry)


@router.delete("/journal/{uid}", status_code=204)
def journal_delete(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    svc.delete_journal_entry(session, user, uid)
    return None


# ---------------------------------------------------------------------------
# Anti-portfolio rollup
# ---------------------------------------------------------------------------
@router.get("/antiportfolio")
def antiportfolio(
    owner: str = Query(default="me", regex="^(me|all)$"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return svc.antiportfolio_rollup(session, user, owner=owner)
