"""Task #44 — Portfolio health score + predictive failure.

Daily background sweep that, for every active project, computes a
0-100 health score from four signals and persists a snapshot row.
The latest row per project drives the green/yellow/red badge + the
"intervention needed" flag in the investor notification center.

Signals (each scored 0..1 then weighted):

* **Runway** (40%) — months of cash left. Source: latest
  `FinancialModel.computed_json["runway_months"]`. Maps:
  >=18mo→1.0, 12mo→0.85, 6mo→0.4, 3mo→0.15, 0mo→0.

* **Growth velocity** (25%) — MRR change between the two most recent
  `MetricsSnapshot` rows, expressed as %/month. Source: snapshots.
  Maps: >=15%→1.0, 5%→0.7, 0%→0.4, -5%→0.15, -15%→0.

* **Churn delta** (20%) — change in `monthly_churn_pct` between the
  two most recent snapshots. Lower is better. Maps:
  delta<=-2pp→1.0, 0→0.6, +2pp→0.25, +5pp→0.

* **Sentiment delta** (15%) — proxy from founder check-in cadence
  in the trailing 30 days minus the prior 30 days, plus a flag for
  "no check-in for 21+ days". When no check-in data exists at all,
  this falls back to neutral (0.5) so a fresh project doesn't get
  red-flagged for missing telemetry.

The result rolls up to:
* `score` (0..100)
* `badge`: >=70 green, 40..70 yellow, <40 red
* `intervention`: True when (a) badge==red OR (b) any single signal
  scored <=0.2 (catches the case where overall is yellow but runway
  is critical).

Notifications fire the *moment* a project transitions into the
intervention state (false→true day-over-day). They go to admins +
investors with a deal on the project; founders see the dashboard
themselves but don't get pinged about their own bad news.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import (
    Deal,
    FinancialModel,
    MetricsSnapshot,
    PortfolioHealthSnapshot,
    Project,
    ProjectStatus,
    User,
    UserRole,
)
from backend.app.services.notify import notify

logger = logging.getLogger("studioos.portfolio_health")


# ---------------------------------------------------------------------------
# Sub-score helpers (each returns float in [0,1] or None when unknown)
# ---------------------------------------------------------------------------
def _score_runway(runway_months: Optional[float]) -> Optional[float]:
    if runway_months is None:
        return None
    if runway_months >= 18:
        return 1.0
    if runway_months >= 12:
        return 0.85
    if runway_months >= 9:
        return 0.7
    if runway_months >= 6:
        return 0.5
    if runway_months >= 3:
        return 0.25
    if runway_months >= 1:
        return 0.1
    return 0.0


def _score_growth(velocity_pct: Optional[float]) -> Optional[float]:
    if velocity_pct is None:
        return None
    if velocity_pct >= 15:
        return 1.0
    if velocity_pct >= 8:
        return 0.85
    if velocity_pct >= 3:
        return 0.65
    if velocity_pct >= 0:
        return 0.45
    if velocity_pct >= -5:
        return 0.25
    if velocity_pct >= -15:
        return 0.1
    return 0.0


def _score_churn(churn_delta_pp: Optional[float]) -> Optional[float]:
    """Delta in percentage points (this period - prior). Lower is better."""
    if churn_delta_pp is None:
        return None
    if churn_delta_pp <= -2:
        return 1.0
    if churn_delta_pp <= -0.5:
        return 0.8
    if churn_delta_pp <= 0.5:
        return 0.6
    if churn_delta_pp <= 2:
        return 0.35
    if churn_delta_pp <= 5:
        return 0.15
    return 0.0


def _score_sentiment(sentiment_delta: Optional[float]) -> float:
    """`sentiment_delta` ∈ [-1,1] roughly — see `_compute_sentiment`."""
    if sentiment_delta is None:
        return 0.5  # neutral fallback so missing telemetry isn't a red flag
    # Clamp + map [-1, 1] → [0, 1]
    s = max(-1.0, min(1.0, sentiment_delta))
    return (s + 1.0) / 2.0


# ---------------------------------------------------------------------------
# Signal extraction
# ---------------------------------------------------------------------------
def _get_runway_months(session: Session, project_id: int) -> Optional[float]:
    fm = session.exec(
        select(FinancialModel).where(FinancialModel.project_id == project_id)
    ).first()
    if not fm or not fm.computed_json:
        return None
    try:
        data = json.loads(fm.computed_json)
    except Exception:
        return None
    val = data.get("runway_months") or data.get("runway") or data.get("runway_months_est")
    if val is None:
        return None
    try:
        v = float(val)
        if v < 0:
            return 0.0
        # Cap at 60mo so a sentinel "999" doesn't dominate.
        return min(v, 60.0)
    except (TypeError, ValueError):
        return None


def _get_recent_snapshots(session: Session, project_id: int, limit: int = 6) -> list[MetricsSnapshot]:
    return list(session.exec(
        select(MetricsSnapshot)
        .where(MetricsSnapshot.project_id == project_id)
        .order_by(MetricsSnapshot.snapshot_date.desc())
        .limit(limit)
    ).all())


def _compute_growth_velocity(snaps: list[MetricsSnapshot]) -> Optional[float]:
    """%/month MRR change between the two most recent snapshots. Falls
    back to active_users when MRR is missing on either side."""
    if len(snaps) < 2:
        return None
    cur, prev = snaps[0], snaps[1]
    days = max((cur.snapshot_date - prev.snapshot_date).days, 1)
    months = days / 30.0

    def _pct(c: Optional[float], p: Optional[float]) -> Optional[float]:
        if c is None or p is None:
            return None
        if p <= 0:
            # Going from 0 to anything positive is great, but undefined %.
            return 25.0 if (c or 0) > 0 else 0.0
        return ((c - p) / p) * 100.0 / months

    pct = _pct(cur.mrr, prev.mrr)
    if pct is None:
        pct = _pct(
            float(cur.active_users) if cur.active_users is not None else None,
            float(prev.active_users) if prev.active_users is not None else None,
        )
    return pct


def _compute_churn_delta(snaps: list[MetricsSnapshot]) -> Optional[float]:
    if len(snaps) < 2:
        return None
    cur, prev = snaps[0], snaps[1]
    if cur.monthly_churn_pct is None or prev.monthly_churn_pct is None:
        return None
    return cur.monthly_churn_pct - prev.monthly_churn_pct


def _compute_sentiment(session: Session, project_id: int) -> Optional[float]:
    """Proxy: founder check-in cadence over trailing 30d vs prior 30d.

    A check-in is any FounderCheckin row whose `start_at` falls in the
    window. Returns delta normalised into [-1, 1]:
      * +1: at least 4 check-ins this 30d, none prior (engagement up)
      *  0: same cadence as prior 30d
      * -1: zero check-ins in the last 30d AND >=2 in the prior 30d
            (drop-off — strongest negative signal)

    Falls back to None when the FounderCheckin model isn't loaded.
    """
    try:
        # FounderCheckin lives in the calendar feature. Import lazily
        # so unit tests that don't import the calendar layer still work.
        from backend.app.models.entities import FounderCheckin
    except ImportError:
        return None
    now = datetime.utcnow()
    cutoff_30 = now - timedelta(days=30)
    cutoff_60 = now - timedelta(days=60)
    rows = session.exec(
        select(FounderCheckin).where(
            FounderCheckin.project_id == project_id,
            FounderCheckin.start_at >= cutoff_60,
        )
    ).all()
    recent = sum(1 for r in rows if r.start_at >= cutoff_30)
    prior = sum(1 for r in rows if cutoff_60 <= r.start_at < cutoff_30)
    if recent == 0 and prior == 0:
        return None  # no telemetry → neutral score
    # Normalise the count delta to [-1, 1] using a soft cap of 4 check-ins.
    raw = (recent - prior) / 4.0
    return max(-1.0, min(1.0, raw))


# ---------------------------------------------------------------------------
# Roll-up
# ---------------------------------------------------------------------------
WEIGHTS = {"runway": 0.40, "growth": 0.25, "churn": 0.20, "sentiment": 0.15}
NEUTRAL = 0.5  # used when a sub-score is unavailable


def compute_health(session: Session, project: Project) -> dict:
    """Pure function: read signals, return the snapshot payload (without
    persisting). The daily sweep persists; routes can call this for an
    on-demand recompute preview."""
    runway = _get_runway_months(session, project.id)
    snaps = _get_recent_snapshots(session, project.id, limit=2)
    growth = _compute_growth_velocity(snaps)
    churn = _compute_churn_delta(snaps)
    sentiment = _compute_sentiment(session, project.id)

    scores = {
        "runway":    _score_runway(runway),
        "growth":    _score_growth(growth),
        "churn":     _score_churn(churn),
        "sentiment": _score_sentiment(sentiment),
    }

    # Weighted average — missing signals fall back to NEUTRAL so we don't
    # punish brand-new portfolio companies for not having data yet.
    total = 0.0
    for k, w in WEIGHTS.items():
        total += w * (scores[k] if scores[k] is not None else NEUTRAL)
    score_100 = round(total * 100.0, 1)

    if score_100 >= 70:
        badge = "green"
    elif score_100 >= 40:
        badge = "yellow"
    else:
        badge = "red"

    # Intervention: red overall, OR any *known* signal in the danger zone.
    danger_signals = [k for k, v in scores.items() if v is not None and v <= 0.2]
    intervention = (badge == "red") or (len(danger_signals) > 0)

    reasons: list[str] = []
    if runway is not None and runway < 6:
        reasons.append(f"Runway under 6 months ({runway:.1f}mo)")
    elif runway is None:
        reasons.append("No financial model — runway unknown")
    if growth is not None and growth < 0:
        reasons.append(f"Negative growth ({growth:+.1f}%/mo)")
    if churn is not None and churn > 2:
        reasons.append(f"Churn rising ({churn:+.1f}pp)")
    if sentiment is not None and sentiment < -0.5:
        reasons.append("Founder check-in cadence dropping")
    if not reasons and badge == "green":
        reasons.append("All signals healthy")

    return {
        "score": score_100,
        "badge": badge,
        "intervention": intervention,
        "runway_months": runway,
        "growth_velocity": growth,
        "churn_delta": churn,
        "sentiment_delta": sentiment,
        "components": {
            k: {
                "weight": WEIGHTS[k],
                "score": scores[k],
                "available": scores[k] is not None,
            }
            for k in WEIGHTS
        },
        "danger_signals": danger_signals,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Persistence + notification
# ---------------------------------------------------------------------------
ACTIVE_STATUSES = {
    ProjectStatus.TIER_1,
    ProjectStatus.TIER_2,
    ProjectStatus.ACTIVE,
    ProjectStatus.SPINOUT,
}


def _notify_recipients_for(session: Session, project: Project) -> set[int]:
    """Who gets told when a project enters intervention state?

    * All admins (always).
    * Investors with a Deal on this project.
    * The partner attached to any Deal on this project.

    Founders intentionally do NOT receive automated red-flag pings on
    their own company — they see the dashboard already and we don't
    want to surprise them with "your investors think you're failing".
    """
    user_ids: set[int] = set()
    admins = session.exec(select(User).where(User.role == UserRole.ADMIN, User.is_active == True)).all()  # noqa: E712
    for u in admins:
        if u.id is not None:
            user_ids.add(u.id)
    deals = session.exec(select(Deal).where(Deal.project_id == project.id)).all()
    partner_ids = {d.partner_id for d in deals if d.partner_id is not None}
    if partner_ids:
        # Map partners.id -> users.id via users.partner_id
        for u in session.exec(select(User).where(User.partner_id.in_(list(partner_ids)))).all():
            if u.id is not None and u.is_active:
                user_ids.add(u.id)
    # Investors with deals — same as above via investor_id link
    # (Deals don't carry investor_id today; fall back to all active investors
    # only when explicitly opted-in via Phase 0.2 prefs. Keep tight by default.)
    return user_ids


def _persist_snapshot(session: Session, project: Project, today: date, payload: dict) -> tuple[PortfolioHealthSnapshot, bool]:
    """Insert-or-update the (project_id, today) row. Returns (row, was_new_row)."""
    existing = session.exec(
        select(PortfolioHealthSnapshot).where(
            PortfolioHealthSnapshot.project_id == project.id,
            PortfolioHealthSnapshot.snapshot_date == today,
        )
    ).first()
    components_blob = json.dumps(payload["components"])
    reasons_blob = json.dumps(payload["reasons"])
    if existing:
        existing.score = payload["score"]
        existing.badge = payload["badge"]
        existing.intervention = payload["intervention"]
        existing.runway_months = payload["runway_months"]
        existing.growth_velocity = payload["growth_velocity"]
        existing.churn_delta = payload["churn_delta"]
        existing.sentiment_delta = payload["sentiment_delta"]
        existing.components_json = components_blob
        existing.reasons_json = reasons_blob
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing, False
    row = PortfolioHealthSnapshot(
        project_id=project.id,
        snapshot_date=today,
        score=payload["score"],
        badge=payload["badge"],
        intervention=payload["intervention"],
        runway_months=payload["runway_months"],
        growth_velocity=payload["growth_velocity"],
        churn_delta=payload["churn_delta"],
        sentiment_delta=payload["sentiment_delta"],
        components_json=components_blob,
        reasons_json=reasons_blob,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, True


def _previous_intervention(session: Session, project_id: int, today: date) -> Optional[bool]:
    """Look up the most recent prior snapshot's intervention flag (None if
    no prior snapshot exists). Used to fire a notification only on the
    *transition* false→true, not on every red day."""
    prior = session.exec(
        select(PortfolioHealthSnapshot)
        .where(
            PortfolioHealthSnapshot.project_id == project_id,
            PortfolioHealthSnapshot.snapshot_date < today,
        )
        .order_by(PortfolioHealthSnapshot.snapshot_date.desc())
        .limit(1)
    ).first()
    return prior.intervention if prior else None


def recompute_for_project(session: Session, project: Project, *, today: Optional[date] = None, fire_notifications: bool = True) -> PortfolioHealthSnapshot:
    """Run the full pipeline for one project and persist. Public so the
    admin "recompute now" route can call this synchronously."""
    today = today or date.today()
    payload = compute_health(session, project)
    # The "prior" for notification-edge purposes is whichever snapshot we
    # are about to displace: today's existing row if any (so a same-day
    # re-run never re-fires), else the most recent earlier day.
    existing_today = session.exec(
        select(PortfolioHealthSnapshot).where(
            PortfolioHealthSnapshot.project_id == project.id,
            PortfolioHealthSnapshot.snapshot_date == today,
        )
    ).first()
    if existing_today is not None:
        prior_intervention: Optional[bool] = existing_today.intervention
    else:
        prior_intervention = _previous_intervention(session, project.id, today)
    row, _ = _persist_snapshot(session, project, today, payload)

    if fire_notifications and row.intervention and not prior_intervention:
        # Edge: project newly entered intervention state today. Fan out.
        recipients = _notify_recipients_for(session, project)
        title = f"Intervention needed: {project.name}"
        body = " · ".join(payload["reasons"][:3]) or f"Health score dropped to {row.score:.0f} (red)"
        link = f"/portfolio/health?project={project.uid}"
        for uid in recipients:
            try:
                notify(
                    user_id=uid,
                    type="portfolio_health_intervention",
                    title=title,
                    body=body,
                    link=link,
                    payload={
                        "project_id": project.id,
                        "project_uid": project.uid,
                        "project_name": project.name,
                        "score": row.score,
                        "badge": row.badge,
                        "reasons": payload["reasons"],
                        "snapshot_uid": row.uid,
                    },
                    channels=("in_app", "email", "slack"),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("portfolio_health: notify failed for user=%s: %s", uid, exc)
    return row


def run_daily_health_sweep(*, today: Optional[date] = None) -> dict:
    """Iterate every active portfolio project, recompute + persist, fire
    notifications for *new* interventions. Returns a summary dict."""
    today = today or date.today()
    summary = {"date": today.isoformat(), "scanned": 0, "green": 0, "yellow": 0, "red": 0, "interventions_new": 0, "interventions_total": 0}
    # Resolve project IDs in their own short-lived session, then process
    # each project in a fresh per-iteration session. This avoids the
    # SQLAlchemy expire-on-commit footgun where one commit during the
    # loop body would expire every other Project ORM object still held
    # in the loop's session.
    with Session(engine) as session:
        project_ids = list(session.exec(
            select(Project.id).where(Project.status.in_(list(ACTIVE_STATUSES)))
        ).all())
    for pid in project_ids:
        summary["scanned"] += 1
        try:
            with Session(engine) as session:
                p = session.get(Project, pid)
                if p is None:
                    continue
                # Match recompute_for_project's edge logic: same-day re-runs
                # must NOT count as "new" interventions even if no prior-day
                # snapshot exists.
                existing_today = session.exec(
                    select(PortfolioHealthSnapshot).where(
                        PortfolioHealthSnapshot.project_id == p.id,
                        PortfolioHealthSnapshot.snapshot_date == today,
                    )
                ).first()
                prior = (existing_today.intervention if existing_today is not None
                         else _previous_intervention(session, p.id, today))
                row = recompute_for_project(session, p, today=today, fire_notifications=True)
                summary[row.badge] += 1
                if row.intervention:
                    summary["interventions_total"] += 1
                    if not prior:
                        summary["interventions_new"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("portfolio_health: project %s sweep failed: %s", pid, exc)
    logger.info(
        "portfolio_health: sweep done date=%s scanned=%d green=%d yellow=%d red=%d new_interventions=%d",
        summary["date"], summary["scanned"], summary["green"], summary["yellow"], summary["red"], summary["interventions_new"],
    )
    return summary


# ---------------------------------------------------------------------------
# Background loop — wakes hourly, fires once per UTC day
# ---------------------------------------------------------------------------
async def daily_health_loop(stop_event: asyncio.Event) -> None:
    """In-process scheduler mirroring the insights weekly digest pattern.

    Wakes hourly, runs the sweep at most once per UTC date by checking
    the latest snapshot's `snapshot_date` for any project. Cheap, no
    external scheduler, survives restarts via the unique-day index."""
    logger.info("portfolio_health daily loop: started")
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(_tick_if_due)
        except Exception as exc:  # noqa: BLE001
            logger.warning("portfolio_health tick failed: %s", exc)
        try:
            # Wake every hour; use stop_event so shutdown is responsive.
            # TimeoutError here is the expected outcome of every iteration
            # but the last one — it means no stop signal arrived, keep looping.
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            # Expected on every iteration but the last — no stop signal arrived.
            pass
    logger.info("portfolio_health daily loop: stopped")


def _tick_if_due() -> None:
    today = date.today()
    with Session(engine) as session:
        latest = session.exec(
            select(PortfolioHealthSnapshot)
            .order_by(PortfolioHealthSnapshot.snapshot_date.desc())
            .limit(1)
        ).first()
        if latest and latest.snapshot_date >= today:
            return
    run_daily_health_sweep(today=today)


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------
def serialize_snapshot(row: PortfolioHealthSnapshot, project: Optional[Project] = None) -> dict:
    out = {
        "uid": row.uid,
        "project_id": row.project_id,
        "snapshot_date": row.snapshot_date.isoformat() if row.snapshot_date else None,
        "score": row.score,
        "badge": row.badge,
        "intervention": row.intervention,
        "runway_months": row.runway_months,
        "growth_velocity": row.growth_velocity,
        "churn_delta": row.churn_delta,
        "sentiment_delta": row.sentiment_delta,
        "components": json.loads(row.components_json or "{}"),
        "reasons": json.loads(row.reasons_json or "[]"),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
    if project is not None:
        out["project"] = {
            "uid": project.uid,
            "name": project.name,
            "sector": project.sector,
            "stage": project.stage,
            "status": getattr(project.status, "value", project.status),
        }
    return out
