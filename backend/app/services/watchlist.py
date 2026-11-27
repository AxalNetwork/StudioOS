"""Task #49 — Watchlist + decision journal service layer.

Pure business logic: validation, owner-scoping, watchlist→deal conversion,
and the anti-portfolio rollup (compares passed-on/declined decisions
against what the project actually did).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.models.entities import (
    Deal,
    DealStatus,
    DecisionJournalEntry,
    PortfolioHealthSnapshot,
    Project,
    ProjectStatus,
    ScoreSnapshot,
    User,
    WatchlistItem,
)

logger = logging.getLogger("studioos.watchlist")

CONVICTION_VALUES = {"low", "medium", "high"}
DECISION_VALUES = {"invest", "pass", "defer"}
OUTCOME_VALUES = {"pending", "hit", "miss", "partial", "inconclusive"}
WATCHLIST_STATUS_VALUES = {"watching", "converted", "passed_on", "archived"}

# Project terminal states for anti-portfolio scoring.
EXIT_STATUSES = {ProjectStatus.SPINOUT, ProjectStatus.ACTIVE}
DEAD_STATUSES = {ProjectStatus.REJECTED}


# ---------------------------------------------------------------------------
# Authorisation helpers
# ---------------------------------------------------------------------------
def role(user: User) -> str:
    return (getattr(user.role, "value", user.role) or "").lower()


def is_admin(user: User) -> bool:
    return role(user) == "admin"


def can_use(user: User) -> bool:
    """Founder + advisor are blocked. Watchlist/journal is a capital-side
    DD instrument."""
    return role(user) in {"admin", "investor", "partner"}


def gate(user: User) -> None:
    if not can_use(user):
        raise HTTPException(status_code=403, detail="Watchlist + decision journal is for admin/investor/partner roles")


def ensure_owner_or_admin(user: User, owner_user_id: int) -> None:
    if is_admin(user):
        return
    if user.id != owner_user_id:
        raise HTTPException(status_code=403, detail="Not your entry")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def _normalise_tags(value) -> str:
    if value is None:
        return "[]"
    if isinstance(value, str):
        # accept either JSON string or comma-separated
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return json.dumps([str(t).strip() for t in parsed if str(t).strip()][:20])
        except Exception:
            # Not JSON at all — this is the expected shape for a plain
            # comma-separated string, not a parse error to report. Fall
            # through to the comma-split branch below.
            pass
        parts = [t.strip() for t in value.split(",") if t.strip()]
        return json.dumps(parts[:20])
    if isinstance(value, list):
        return json.dumps([str(t).strip() for t in value if str(t).strip()][:20])
    return "[]"


def _decode_tags(blob: Optional[str]) -> list[str]:
    if not blob:
        return []
    try:
        parsed = json.loads(blob)
        if isinstance(parsed, list):
            return [str(t) for t in parsed]
    except Exception:
        return []
    return []


# ---------------------------------------------------------------------------
# Watchlist CRUD
# ---------------------------------------------------------------------------
def create_watchlist_item(session: Session, user: User, payload: dict) -> WatchlistItem:
    gate(user)
    project_id = payload.get("project_id")
    project_uid = payload.get("project_uid")
    external_name = (payload.get("external_name") or "").strip() or None
    if project_uid and not project_id:
        proj = session.exec(select(Project).where(Project.uid == project_uid)).first()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_id = proj.id
    if project_id is None and not external_name:
        raise HTTPException(status_code=400, detail="Provide project_uid or external_name")

    conviction = (payload.get("conviction") or "medium").lower()
    if conviction not in CONVICTION_VALUES:
        raise HTTPException(status_code=400, detail=f"conviction must be one of {sorted(CONVICTION_VALUES)}")

    status = (payload.get("status") or "watching").lower()
    if status not in WATCHLIST_STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(WATCHLIST_STATUS_VALUES)}")

    if project_id is not None:
        # Idempotency: same owner + same in-system project → return existing
        existing = session.exec(
            select(WatchlistItem).where(
                WatchlistItem.owner_user_id == user.id,
                WatchlistItem.project_id == project_id,
            )
        ).first()
        if existing:
            return existing

    item = WatchlistItem(
        owner_user_id=user.id,
        project_id=project_id,
        external_name=external_name,
        external_url=(payload.get("external_url") or "").strip() or None,
        sector=(payload.get("sector") or "").strip() or None,
        stage=(payload.get("stage") or "").strip() or None,
        thesis=(payload.get("thesis") or "").strip() or None,
        conviction=conviction,
        source=(payload.get("source") or "").strip() or None,
        tags_json=_normalise_tags(payload.get("tags")),
        status=status,
        passed_reason=(payload.get("passed_reason") or "").strip() or None,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def list_watchlist_items(session: Session, user: User, *, status: Optional[str] = None,
                         owner: str = "me") -> list[WatchlistItem]:
    gate(user)
    q = select(WatchlistItem)
    if owner == "all":
        if not is_admin(user):
            raise HTTPException(status_code=403, detail="Admin only for owner=all")
    else:
        q = q.where(WatchlistItem.owner_user_id == user.id)
    if status:
        if status not in WATCHLIST_STATUS_VALUES:
            raise HTTPException(status_code=400, detail="bad status filter")
        q = q.where(WatchlistItem.status == status)
    q = q.order_by(WatchlistItem.created_at.desc())
    return list(session.exec(q).all())


def get_watchlist_item(session: Session, user: User, uid: str) -> WatchlistItem:
    gate(user)
    item = session.exec(select(WatchlistItem).where(WatchlistItem.uid == uid)).first()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    ensure_owner_or_admin(user, item.owner_user_id)
    return item


def update_watchlist_item(session: Session, user: User, uid: str, payload: dict) -> WatchlistItem:
    item = get_watchlist_item(session, user, uid)
    EDITABLE = {"external_name", "external_url", "sector", "stage", "thesis",
                "source", "passed_reason"}
    for field in EDITABLE:
        if field in payload:
            v = payload[field]
            setattr(item, field, (v.strip() if isinstance(v, str) else v) or None)
    if "conviction" in payload:
        v = (payload["conviction"] or "").lower()
        if v not in CONVICTION_VALUES:
            raise HTTPException(status_code=400, detail="bad conviction")
        item.conviction = v
    if "status" in payload:
        v = (payload["status"] or "").lower()
        if v not in WATCHLIST_STATUS_VALUES:
            raise HTTPException(status_code=400, detail="bad status")
        item.status = v
    if "tags" in payload:
        item.tags_json = _normalise_tags(payload["tags"])
    item.updated_at = datetime.utcnow()
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def delete_watchlist_item(session: Session, user: User, uid: str) -> None:
    item = get_watchlist_item(session, user, uid)
    session.delete(item)
    session.commit()


def convert_watchlist_to_deal(session: Session, user: User, uid: str,
                              *, partner_id: Optional[int] = None,
                              amount: Optional[float] = None,
                              notes: Optional[str] = None) -> tuple[WatchlistItem, Deal]:
    """Promote a watchlist item to a real Deal. Requires the item to be
    linked to an in-system Project (external prospects must be onboarded
    first via the regular project intake).

    Race-safe: locks the watchlist row with ``SELECT … FOR UPDATE`` so
    two concurrent convert calls cannot both create a Deal — the second
    waits for the first to commit, then sees ``converted_deal_id`` set
    and returns the existing Deal instead.
    """
    # Permission + existence check (raises if not allowed/missing)
    item = get_watchlist_item(session, user, uid)

    # Lock the row inside a single transaction. SQLite (used in some test
    # envs) doesn't support FOR UPDATE; fall back silently there.
    try:
        locked_id = session.exec(
            text("SELECT id FROM watchlist_items WHERE uid = :uid FOR UPDATE")
            .bindparams(uid=uid)
        ).first()
        if locked_id is None:
            raise HTTPException(status_code=404, detail="Watchlist item not found")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — non-PG dialects
        pass

    # Re-read after lock to get the freshest state
    session.refresh(item)
    if item.status == "converted" and item.converted_deal_id:
        existing = session.get(Deal, item.converted_deal_id)
        if existing:
            return item, existing
    if item.project_id is None:
        raise HTTPException(status_code=400,
                            detail="External watchlist items must be onboarded as projects before converting")

    deal = Deal(
        project_id=item.project_id,
        partner_id=partner_id if partner_id is not None else (user.partner_id if role(user) == "partner" else None),
        status=DealStatus.APPLIED,
        amount=amount,
        notes=notes or item.thesis,
    )
    session.add(deal)
    session.flush()  # populate deal.id without releasing lock

    item.status = "converted"
    item.converted_deal_id = deal.id
    item.converted_at = datetime.utcnow()
    item.updated_at = datetime.utcnow()
    session.add(item)
    session.commit()
    session.refresh(item)
    session.refresh(deal)
    return item, deal


# ---------------------------------------------------------------------------
# Decision journal CRUD
# ---------------------------------------------------------------------------
def _resolve_targets(session: Session, user: User, payload: dict) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """Resolve user-supplied project_uid / watchlist_uid / deal_uid into
    integer FK ids. Enforces ownership on the watchlist link so a user
    cannot attach a journal entry to another owner's watchlist row
    (security boundary)."""
    project_id = payload.get("project_id")
    project_uid = payload.get("project_uid")
    if project_uid and not project_id:
        proj = session.exec(select(Project).where(Project.uid == project_uid)).first()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        project_id = proj.id

    watchlist_item_id = payload.get("watchlist_item_id")
    watchlist_uid = payload.get("watchlist_uid")
    if watchlist_uid and not watchlist_item_id:
        item = session.exec(select(WatchlistItem).where(WatchlistItem.uid == watchlist_uid)).first()
        if not item:
            raise HTTPException(status_code=404, detail="Watchlist item not found")
        # Ownership check: only the watchlist's owner (or admin) can link to it
        ensure_owner_or_admin(user, item.owner_user_id)
        watchlist_item_id = item.id
    elif watchlist_item_id:
        item = session.get(WatchlistItem, watchlist_item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Watchlist item not found")
        ensure_owner_or_admin(user, item.owner_user_id)

    deal_id = payload.get("deal_id")
    deal_uid = payload.get("deal_uid")
    if deal_uid and not deal_id:
        d = session.exec(select(Deal).where(Deal.uid == deal_uid)).first()
        if not d:
            raise HTTPException(status_code=404, detail="Deal not found")
        deal_id = d.id

    return project_id, watchlist_item_id, deal_id


def create_journal_entry(session: Session, user: User, payload: dict) -> DecisionJournalEntry:
    gate(user)
    thesis = (payload.get("thesis") or "").strip()
    if len(thesis) < 10:
        raise HTTPException(status_code=400, detail="thesis is required (min 10 chars)")
    decision = (payload.get("decision") or "defer").lower()
    if decision not in DECISION_VALUES:
        raise HTTPException(status_code=400, detail=f"decision must be one of {sorted(DECISION_VALUES)}")
    try:
        conviction = int(payload.get("conviction", 3))
    except Exception:
        raise HTTPException(status_code=400, detail="conviction must be an integer 1..5")
    if not 1 <= conviction <= 5:
        raise HTTPException(status_code=400, detail="conviction must be 1..5")

    project_id, watchlist_item_id, deal_id = _resolve_targets(session, user, payload)
    if project_id is None and watchlist_item_id is None:
        raise HTTPException(status_code=400, detail="Provide project_uid or watchlist_uid")

    expected_multiple = payload.get("expected_multiple")
    if expected_multiple is not None:
        try:
            expected_multiple = float(expected_multiple)
            if expected_multiple < 0:
                raise ValueError
        except Exception:
            raise HTTPException(status_code=400, detail="expected_multiple must be a non-negative number")

    expected_timeline_months = payload.get("expected_timeline_months")
    if expected_timeline_months is not None:
        try:
            expected_timeline_months = int(expected_timeline_months)
            if expected_timeline_months < 0:
                raise ValueError
        except Exception:
            raise HTTPException(status_code=400, detail="expected_timeline_months must be a non-negative integer")

    entry = DecisionJournalEntry(
        owner_user_id=user.id,
        project_id=project_id,
        watchlist_item_id=watchlist_item_id,
        deal_id=deal_id,
        decision=decision,
        conviction=conviction,
        thesis=thesis,
        key_risks=(payload.get("key_risks") or "").strip() or None,
        expected_outcome=(payload.get("expected_outcome") or "").strip() or None,
        expected_multiple=expected_multiple,
        expected_timeline_months=expected_timeline_months,
        tags_json=_normalise_tags(payload.get("tags")),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def list_journal_entries(session: Session, user: User, *,
                         decision: Optional[str] = None,
                         outcome_status: Optional[str] = None,
                         project_uid: Optional[str] = None,
                         owner: str = "me") -> list[DecisionJournalEntry]:
    gate(user)
    q = select(DecisionJournalEntry)
    if owner == "all":
        if not is_admin(user):
            raise HTTPException(status_code=403, detail="Admin only for owner=all")
    else:
        q = q.where(DecisionJournalEntry.owner_user_id == user.id)
    if decision:
        if decision not in DECISION_VALUES:
            raise HTTPException(status_code=400, detail="bad decision filter")
        q = q.where(DecisionJournalEntry.decision == decision)
    if outcome_status:
        if outcome_status not in OUTCOME_VALUES:
            raise HTTPException(status_code=400, detail="bad outcome_status filter")
        q = q.where(DecisionJournalEntry.outcome_status == outcome_status)
    if project_uid:
        proj = session.exec(select(Project).where(Project.uid == project_uid)).first()
        if proj:
            q = q.where(DecisionJournalEntry.project_id == proj.id)
        else:
            return []
    q = q.order_by(DecisionJournalEntry.decided_at.desc())
    return list(session.exec(q).all())


def get_journal_entry(session: Session, user: User, uid: str) -> DecisionJournalEntry:
    gate(user)
    entry = session.exec(select(DecisionJournalEntry).where(DecisionJournalEntry.uid == uid)).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    ensure_owner_or_admin(user, entry.owner_user_id)
    return entry


def update_journal_entry(session: Session, user: User, uid: str, payload: dict) -> DecisionJournalEntry:
    entry = get_journal_entry(session, user, uid)
    EDITABLE_TEXT = {"thesis", "key_risks", "expected_outcome"}
    for field in EDITABLE_TEXT:
        if field in payload:
            v = payload[field]
            cleaned = (v.strip() if isinstance(v, str) else v) or None
            if field == "thesis" and (cleaned is None or len(cleaned) < 10):
                raise HTTPException(status_code=400, detail="thesis is required (min 10 chars)")
            setattr(entry, field, cleaned)
    if "decision" in payload:
        v = (payload["decision"] or "").lower()
        if v not in DECISION_VALUES:
            raise HTTPException(status_code=400, detail="bad decision")
        entry.decision = v
    if "conviction" in payload:
        try:
            cv = int(payload["conviction"])
            if not 1 <= cv <= 5:
                raise ValueError
            entry.conviction = cv
        except Exception:
            raise HTTPException(status_code=400, detail="conviction must be 1..5")
    if "expected_multiple" in payload:
        v = payload["expected_multiple"]
        if v is None:
            entry.expected_multiple = None
        else:
            try:
                fv = float(v)
                if fv < 0:
                    raise ValueError
                entry.expected_multiple = fv
            except Exception:
                raise HTTPException(status_code=400, detail="expected_multiple must be non-negative")
    if "expected_timeline_months" in payload:
        v = payload["expected_timeline_months"]
        if v is None:
            entry.expected_timeline_months = None
        else:
            try:
                iv = int(v)
                if iv < 0:
                    raise ValueError
                entry.expected_timeline_months = iv
            except Exception:
                raise HTTPException(status_code=400, detail="expected_timeline_months must be non-negative integer")
    if "tags" in payload:
        entry.tags_json = _normalise_tags(payload["tags"])
    entry.updated_at = datetime.utcnow()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def record_outcome(session: Session, user: User, uid: str, payload: dict) -> DecisionJournalEntry:
    entry = get_journal_entry(session, user, uid)
    status = (payload.get("outcome_status") or "").lower()
    if status not in OUTCOME_VALUES or status == "pending":
        raise HTTPException(status_code=400,
                            detail=f"outcome_status must be one of {sorted(OUTCOME_VALUES - {'pending'})}")
    entry.outcome_status = status
    entry.outcome_notes = (payload.get("outcome_notes") or "").strip() or None
    if "outcome_actual_multiple" in payload:
        v = payload["outcome_actual_multiple"]
        if v is None:
            entry.outcome_actual_multiple = None
        else:
            try:
                fv = float(v)
                if fv < 0:
                    raise ValueError
                entry.outcome_actual_multiple = fv
            except Exception:
                raise HTTPException(status_code=400, detail="outcome_actual_multiple must be a non-negative number")
    entry.outcome_recorded_at = datetime.utcnow()
    entry.updated_at = datetime.utcnow()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def delete_journal_entry(session: Session, user: User, uid: str) -> None:
    entry = get_journal_entry(session, user, uid)
    session.delete(entry)
    session.commit()


# ---------------------------------------------------------------------------
# Anti-portfolio rollup
# ---------------------------------------------------------------------------
def _project_today_signal(session: Session, project_id: int) -> dict:
    """Best-effort 'where is this project now?' summary used to grade
    a past 'pass' decision. Combines current project status, latest score,
    and latest portfolio-health snapshot."""
    proj = session.get(Project, project_id)
    if not proj:
        return {"exists": False}
    latest_score = session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id, ScoreSnapshot.is_sandbox == False)  # noqa: E712
        .order_by(ScoreSnapshot.created_at.desc())
        .limit(1)
    ).first()
    latest_health = session.exec(
        select(PortfolioHealthSnapshot)
        .where(PortfolioHealthSnapshot.project_id == project_id)
        .order_by(PortfolioHealthSnapshot.snapshot_date.desc())
        .limit(1)
    ).first()
    status = getattr(proj.status, "value", proj.status)
    return {
        "exists": True,
        "uid": proj.uid,
        "name": proj.name,
        "status": status,
        "is_alive": proj.status not in DEAD_STATUSES,
        "latest_score": latest_score.total_score if latest_score else None,
        "latest_tier": latest_score.tier if latest_score else None,
        "latest_health_badge": latest_health.badge if latest_health else None,
        "latest_health_score": latest_health.score if latest_health else None,
    }


def _grade_pass(entry: DecisionJournalEntry, signal: dict) -> str:
    """Given a 'pass' decision, derive a verdict label for the
    anti-portfolio: was it a good call ('vindicated'), a clear miss
    ('regret'), or too early to tell ('open').

    Heuristic (deliberately simple, hand-tunable):
      * Project rejected/dead          -> vindicated
      * Project active/spinout AND
        health=green AND score>=70     -> regret
      * else                           -> open
    """
    if not signal.get("exists"):
        return "open"
    if not signal.get("is_alive"):
        return "vindicated"
    badge = signal.get("latest_health_badge")
    score = signal.get("latest_score") or 0
    if badge == "green" and score >= 70:
        return "regret"
    return "open"


def antiportfolio_rollup(session: Session, user: User, *, owner: str = "me") -> dict:
    """Roll up all 'pass' decisions + 'passed_on' watchlist items into
    a single anti-portfolio view. Per-row diff: what we wrote at decision
    time vs. where the project is today.

    Out of scope per brief: making this view public.
    """
    gate(user)
    if owner == "all":
        if not is_admin(user):
            raise HTTPException(status_code=403, detail="Admin only for owner=all")
        owner_filter = None
    else:
        owner_filter = user.id

    # Pull all pass decisions
    jq = select(DecisionJournalEntry).where(DecisionJournalEntry.decision == "pass")
    if owner_filter is not None:
        jq = jq.where(DecisionJournalEntry.owner_user_id == owner_filter)
    pass_entries = list(session.exec(jq.order_by(DecisionJournalEntry.decided_at.desc())).all())

    # Plus passed_on watchlist items (no journal entry written)
    wq = select(WatchlistItem).where(WatchlistItem.status == "passed_on")
    if owner_filter is not None:
        wq = wq.where(WatchlistItem.owner_user_id == owner_filter)
    passed_items = list(session.exec(wq.order_by(WatchlistItem.updated_at.desc())).all())

    rows: list[dict] = []
    counts = {"vindicated": 0, "regret": 0, "open": 0}
    biggest_regret = None
    for e in pass_entries:
        signal = _project_today_signal(session, e.project_id) if e.project_id else {"exists": False}
        verdict = _grade_pass(e, signal)
        counts[verdict] = counts.get(verdict, 0) + 1
        row = {
            "kind": "journal",
            "uid": e.uid,
            "decided_at": e.decided_at.isoformat(),
            "thesis": e.thesis,
            "key_risks": e.key_risks,
            "conviction": e.conviction,
            "expected_multiple": e.expected_multiple,
            "outcome_status": e.outcome_status,
            "outcome_notes": e.outcome_notes,
            "outcome_actual_multiple": e.outcome_actual_multiple,
            "verdict": verdict,
            "project": signal if signal.get("exists") else None,
        }
        rows.append(row)
        if verdict == "regret":
            score = (signal.get("latest_score") or 0) + (signal.get("latest_health_score") or 0)
            if biggest_regret is None or score > biggest_regret[0]:
                biggest_regret = (score, row)

    for item in passed_items:
        signal = _project_today_signal(session, item.project_id) if item.project_id else {"exists": False}
        verdict = _grade_pass_item(item, signal)
        counts[verdict] = counts.get(verdict, 0) + 1
        row = {
            "kind": "watchlist",
            "uid": item.uid,
            "decided_at": (item.updated_at or item.created_at).isoformat(),
            "thesis": item.thesis,
            "passed_reason": item.passed_reason,
            "external_name": item.external_name,
            "verdict": verdict,
            "project": signal if signal.get("exists") else None,
        }
        rows.append(row)
        if verdict == "regret":
            score = (signal.get("latest_score") or 0) + (signal.get("latest_health_score") or 0)
            if biggest_regret is None or score > biggest_regret[0]:
                biggest_regret = (score, row)

    rows.sort(key=lambda r: r["decided_at"], reverse=True)
    total = len(rows)
    return {
        "owner": owner,
        "total_passes": total,
        "counts": counts,
        "regret_rate": round((counts["regret"] / total) * 100, 1) if total else 0.0,
        "biggest_regret": biggest_regret[1] if biggest_regret else None,
        "rows": rows,
    }


def _grade_pass_item(item: WatchlistItem, signal: dict) -> str:
    if not signal.get("exists"):
        return "open"
    if not signal.get("is_alive"):
        return "vindicated"
    if signal.get("latest_health_badge") == "green" and (signal.get("latest_score") or 0) >= 70:
        return "regret"
    return "open"


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------
def serialize_watchlist_item(session: Session, item: WatchlistItem) -> dict:
    project = None
    if item.project_id:
        p = session.get(Project, item.project_id)
        if p:
            project = {
                "uid": p.uid, "name": p.name, "sector": p.sector, "stage": p.stage,
                "status": getattr(p.status, "value", p.status),
            }
    return {
        "uid": item.uid,
        "owner_user_id": item.owner_user_id,
        "project": project,
        "external_name": item.external_name,
        "external_url": item.external_url,
        "sector": item.sector,
        "stage": item.stage,
        "thesis": item.thesis,
        "conviction": item.conviction,
        "source": item.source,
        "tags": _decode_tags(item.tags_json),
        "status": item.status,
        "converted_deal_id": item.converted_deal_id,
        "converted_at": item.converted_at.isoformat() if item.converted_at else None,
        "passed_reason": item.passed_reason,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def serialize_journal_entry(session: Session, entry: DecisionJournalEntry) -> dict:
    project = None
    if entry.project_id:
        p = session.get(Project, entry.project_id)
        if p:
            project = {"uid": p.uid, "name": p.name, "status": getattr(p.status, "value", p.status)}
    watchlist = None
    if entry.watchlist_item_id:
        w = session.get(WatchlistItem, entry.watchlist_item_id)
        if w:
            watchlist = {"uid": w.uid, "external_name": w.external_name, "status": w.status}
    return {
        "uid": entry.uid,
        "owner_user_id": entry.owner_user_id,
        "project": project,
        "watchlist": watchlist,
        "deal_id": entry.deal_id,
        "decision": entry.decision,
        "conviction": entry.conviction,
        "thesis": entry.thesis,
        "key_risks": entry.key_risks,
        "expected_outcome": entry.expected_outcome,
        "expected_multiple": entry.expected_multiple,
        "expected_timeline_months": entry.expected_timeline_months,
        "tags": _decode_tags(entry.tags_json),
        "decided_at": entry.decided_at.isoformat(),
        "outcome_status": entry.outcome_status,
        "outcome_notes": entry.outcome_notes,
        "outcome_actual_multiple": entry.outcome_actual_multiple,
        "outcome_recorded_at": entry.outcome_recorded_at.isoformat() if entry.outcome_recorded_at else None,
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat(),
    }
