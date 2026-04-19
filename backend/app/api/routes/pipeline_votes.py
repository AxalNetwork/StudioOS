"""Pipeline community voting — real-time, role-weighted.

Sits between the AI Scoring/Diligence step and the final Decision Gate in
the Pipeline Board. Lets every authenticated platform user (founder,
partner, admin, LP) cast one vote per deal with optional comment.

Endpoints
    POST /api/pipeline/vote/{deal_id}     cast or update vote
    GET  /api/pipeline/votes/{deal_id}    live tally
    GET  /api/pipeline/votes/leaderboard  top voters across the platform
    WS   /api/pipeline/ws/overview        broadcast hub

Vote weights
    admin   = 3   (treated as investor authority)
    LP      = 3   (resolved by matching User.email to LimitedPartner.email)
    partner = 2
    founder = 1   (default for any other role)

Threshold
    A deal is considered "vote threshold reached" once it has at least
    `VOTE_THRESHOLD_VOTERS` distinct voters AND total weighted score >=
    `VOTE_THRESHOLD_WEIGHT`. The `threshold_reached` flag in the tally
    response drives the "Vote threshold reached" banner in the UI.

WebSocket protocol
    Client connects to `/api/pipeline/ws/overview?token=<jwt>`. After auth,
    the connection is registered with the global `manager`. Any vote write
    fans out a `{type: "vote_updated", deal_id, tally}` message to every
    connected client. The PipelinePage already listens for board events
    on this socket; we extend `BOARD_EVENTS` on the frontend to include
    `vote_updated`.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field as PField
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from backend.app.api.routes.auth import decode_jwt, get_current_user
from backend.app.database import engine, get_session
from backend.app.models.entities import (
    Deal,
    LimitedPartner,
    PipelineVote,
    User,
    UserRole,
)

logger = logging.getLogger("studioos.votes")

router = APIRouter(prefix="/pipeline", tags=["Pipeline Voting"])

VOTE_TYPES = {"Strong_Buy", "Buy", "Hold", "Pass"}
VOTE_THRESHOLD_VOTERS = 5
VOTE_THRESHOLD_WEIGHT = 12

# ---------------------------------------------------------------------------
# Connection manager — one global instance, used by both the WS endpoint and
# the REST POST handler to broadcast vote updates in real time.
# ---------------------------------------------------------------------------
class _ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, message: dict) -> None:
        # Snapshot to avoid mutating the set while iterating.
        async with self._lock:
            sockets = list(self._connections)
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)


manager = _ConnectionManager()


# ---------------------------------------------------------------------------
# Weighting + tally helpers
# ---------------------------------------------------------------------------
def _user_weight(user: User, session: Session) -> int:
    """Role-weighted vote weight. LPs (matched by email) get investor weight."""
    if user.role == UserRole.ADMIN:
        return 3
    is_lp = session.exec(
        select(LimitedPartner.id).where(LimitedPartner.email == user.email)
    ).first()
    if is_lp:
        return 3
    if user.role == UserRole.PARTNER:
        return 2
    return 1  # founder + any unknown role


def _build_public_tally(deal_id: int, session: Session) -> dict:
    """Aggregate-only tally — safe to broadcast to every WS subscriber.

    Contains zero per-user information. Anonymity and personal vote state
    are preserved by keeping `my_vote` out of this payload.
    """
    rows = session.exec(
        select(
            PipelineVote.vote_type,
            func.count(PipelineVote.id),
            func.coalesce(func.sum(PipelineVote.weight), 0),
        )
        .where(PipelineVote.deal_id == deal_id)
        .group_by(PipelineVote.vote_type)
    ).all()

    by_type: dict[str, dict] = {vt: {"count": 0, "weight": 0} for vt in VOTE_TYPES}
    total_voters = 0
    total_weight = 0
    for vote_type, count, weight in rows:
        if vote_type in by_type:
            by_type[vote_type] = {"count": int(count), "weight": int(weight)}
        total_voters += int(count)
        total_weight += int(weight)

    sb_weight = by_type["Strong_Buy"]["weight"] + by_type["Buy"]["weight"]
    strong_buy_pct = round((sb_weight / total_weight) * 100, 1) if total_weight else 0.0
    threshold_reached = (
        total_voters >= VOTE_THRESHOLD_VOTERS and total_weight >= VOTE_THRESHOLD_WEIGHT
    )

    return {
        "deal_id": deal_id,
        "total_voters": total_voters,
        "total_weight": total_weight,
        "strong_buy_pct": strong_buy_pct,
        "by_type": by_type,
        "threshold_reached": threshold_reached,
        "threshold": {
            "voters_required": VOTE_THRESHOLD_VOTERS,
            "weight_required": VOTE_THRESHOLD_WEIGHT,
        },
    }


def _build_tally(deal_id: int, session: Session, viewer: Optional[User] = None) -> dict:
    """Aggregate the vote table for a single deal into the tally payload.

    Single read — sums weights per vote_type plus distinct-voter count, then
    derives % strong-buy and threshold flag in Python.
    """
    payload = _build_public_tally(deal_id, session)
    if viewer is not None:
        my = session.exec(
            select(PipelineVote)
            .where(PipelineVote.deal_id == deal_id)
            .where(PipelineVote.user_id == viewer.id)
        ).first()
        payload["my_vote"] = (
            {
                "vote_type": my.vote_type,
                "weight": my.weight,
                "comment": my.comment,
                "anonymous": my.anonymous,
                "updated_at": my.updated_at.isoformat(),
            }
            if my
            else None
        )

    return payload


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class VoteRequest(BaseModel):
    vote_type: str = PField(..., description="One of Strong_Buy | Buy | Hold | Pass")
    comment: Optional[str] = None
    anonymous: bool = False


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@router.post("/vote/{deal_id}")
async def cast_vote(
    deal_id: int,
    body: VoteRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Cast or update a vote, then fan out a sanitized tally to WS clients.

    `async def` is required so the in-process WS broadcast can `await`
    directly on the same event loop. Sync handlers run in a worker thread
    where there is no running loop, which would silently drop broadcasts.
    """
    if body.vote_type not in VOTE_TYPES:
        raise HTTPException(status_code=400, detail=f"vote_type must be one of {sorted(VOTE_TYPES)}")

    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    weight = _user_weight(user, session)
    now = datetime.utcnow()

    def _apply_existing(existing: PipelineVote) -> None:
        existing.vote_type = body.vote_type
        existing.weight = weight
        existing.comment = body.comment
        existing.anonymous = body.anonymous
        existing.updated_at = now
        session.add(existing)

    existing = session.exec(
        select(PipelineVote)
        .where(PipelineVote.deal_id == deal_id)
        .where(PipelineVote.user_id == user.id)
    ).first()

    if existing:
        _apply_existing(existing)
        session.commit()
    else:
        session.add(PipelineVote(
            deal_id=deal_id,
            user_id=user.id,
            vote_type=body.vote_type,
            weight=weight,
            comment=body.comment,
            anonymous=body.anonymous,
        ))
        try:
            session.commit()
        except IntegrityError:
            # Race: another concurrent request created the row between our
            # SELECT and INSERT. Roll back, refetch, and update in place so
            # the user sees a deterministic upsert instead of a 500.
            session.rollback()
            existing = session.exec(
                select(PipelineVote)
                .where(PipelineVote.deal_id == deal_id)
                .where(PipelineVote.user_id == user.id)
            ).first()
            if existing is None:
                raise
            _apply_existing(existing)
            session.commit()

    # Public tally — safe to broadcast (no per-user fields).
    public = _build_public_tally(deal_id, session)
    await manager.broadcast({"type": "vote_updated", "deal_id": deal_id, "tally": public})

    # Caller gets the same public tally PLUS their own vote attached.
    return _build_tally(deal_id, session, viewer=user)


# IMPORTANT: declare the static `/votes/leaderboard` route BEFORE the
# parametrized `/votes/{deal_id}` route. FastAPI matches in registration
# order, so flipping these would route /votes/leaderboard into {deal_id}
# and 422 on int validation.
@router.get("/votes/leaderboard")
def leaderboard(
    limit: int = Query(10, ge=1, le=50),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """Top voters by number of distinct deals they've weighed in on."""
    rows = session.exec(
        select(
            PipelineVote.user_id,
            func.count(func.distinct(PipelineVote.deal_id)),
            func.coalesce(func.sum(PipelineVote.weight), 0),
        )
        .group_by(PipelineVote.user_id)
        .order_by(func.count(func.distinct(PipelineVote.deal_id)).desc())
        .limit(limit)
    ).all()
    out = []
    for user_id, deals_voted, total_weight in rows:
        u = session.get(User, user_id)
        out.append({
            "user_id": user_id,
            "name": u.name if u else f"User #{user_id}",
            "role": u.role.value if u and hasattr(u.role, "value") else (u.role if u else None),
            "deals_voted": int(deals_voted),
            "total_weight_cast": int(total_weight),
        })
    return out


@router.get("/votes/{deal_id}")
def get_votes(
    deal_id: int,
    include_comments: bool = Query(False),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not session.get(Deal, deal_id):
        raise HTTPException(status_code=404, detail="Deal not found")

    payload = _build_tally(deal_id, session, viewer=user)

    if include_comments:
        votes = session.exec(
            select(PipelineVote)
            .where(PipelineVote.deal_id == deal_id)
            .order_by(PipelineVote.updated_at.desc())
        ).all()
        comments = []
        for v in votes:
            if not v.comment:
                continue
            voter_name = "Anonymous"
            if not v.anonymous:
                voter = session.get(User, v.user_id)
                voter_name = voter.name if voter else f"User #{v.user_id}"
            comments.append({
                "voter_name": voter_name,
                "vote_type": v.vote_type,
                "weight": v.weight,
                "comment": v.comment,
                "at": v.updated_at.isoformat(),
            })
        payload["comments"] = comments

    return payload


# ---------------------------------------------------------------------------
# WebSocket endpoint — broadcasts vote (and any future board) events
# ---------------------------------------------------------------------------
@router.websocket("/ws/overview")
async def ws_overview(websocket: WebSocket, token: str = Query(...)):
    """Realtime fan-out for the Pipeline Board.

    Auth: JWT comes via query param because browsers can't set headers on
    the WebSocket handshake. We resolve and validate the user once, then
    register the socket with the global manager.
    """
    try:
        payload = decode_jwt(token)
    except HTTPException:
        # FastAPI's WS doesn't have a great way to return 401; the standard
        # is to accept then close with a policy-violation code.
        await websocket.accept()
        await websocket.close(code=4401)
        return

    # Optional sanity check that the user still exists / is active.
    with Session(engine) as session:
        user = None
        if "user_id" in payload:
            user = session.get(User, payload["user_id"])
        if user is None and "sub" in payload:
            user = session.exec(select(User).where(User.email == payload["sub"])).first()
        if not user or not user.is_active:
            await websocket.accept()
            await websocket.close(code=4401)
            return

    await manager.connect(websocket)
    try:
        while True:
            msg = await websocket.receive_json()
            # Heartbeat support — see frontend useWebSocket hook.
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("ws_overview connection error: %s", e)
    finally:
        await manager.disconnect(websocket)
