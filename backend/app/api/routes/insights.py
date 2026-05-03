"""Task #52 — Demand heatmap + insight feed.

Aggregates `founder_needs` rows (joined with `projects` for stage/sector and
`entities` for jurisdiction) into:
- A heatmap (category × stage) with optional sector / geography breakdowns.
- A monthly trend line.
- An auto-generated insight feed (e.g. "62% of seed-stage founders requested
  hiring help this quarter").
- An opt-in weekly newsletter delivering the same.

Custom report builder is intentionally out of scope (per task brief).
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import engine, get_session
from backend.app.models.entities import (
    ActivityLog,
    Entity,
    FounderNeed,
    InsightDigest,
    InsightSubscription,
    Project,
    User,
    UserRole,
)

logger = logging.getLogger("studioos.insights")

router = APIRouter(prefix="/insights", tags=["Insights"])

# Stage buckets we surface in the heatmap. Anything not in this list is
# bucketed under 'other' so the grid stays readable.
STAGE_BUCKETS = ["idea", "prototype", "mvp", "seed", "series_a", "growth", "other"]


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------
def _ensure_insights_audience(user: User) -> None:
    """Insights are aimed at partners/investors/admins. Founders see their own
    needs in /needs already; cross-founder aggregates aren't relevant to them."""
    if user.role not in (UserRole.PARTNER, UserRole.INVESTOR, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Partner / investor / admin only")


# ---------------------------------------------------------------------------
# Query helpers — pulled into module scope so the weekly digest can reuse them
# ---------------------------------------------------------------------------
def _stage_bucket(stage: Optional[str]) -> str:
    if not stage:
        return "other"
    s = stage.lower()
    return s if s in STAGE_BUCKETS else "other"


def _join_rows(session: Session, since: Optional[datetime] = None) -> list[dict]:
    """Return a flat list of need-rows enriched with project sector/stage and
    jurisdiction. Single in-memory join keeps the SQL boring and portable."""
    stmt = select(FounderNeed)
    if since:
        stmt = stmt.where(FounderNeed.created_at >= since)
    needs = session.exec(stmt).all()
    if not needs:
        return []
    project_ids = list({n.project_id for n in needs})
    projects = {p.id: p for p in session.exec(select(Project).where(Project.id.in_(project_ids))).all()}
    entity_ids = list({p.entity_id for p in projects.values() if p.entity_id})
    entities = {}
    if entity_ids:
        entities = {e.id: e for e in session.exec(select(Entity).where(Entity.id.in_(entity_ids))).all()}
    rows = []
    for n in needs:
        proj = projects.get(n.project_id)
        ent = entities.get(proj.entity_id) if proj and proj.entity_id else None
        rows.append({
            "id": n.id,
            "category": n.category,
            "stage": _stage_bucket(proj.stage if proj else None),
            "sector": (proj.sector if proj and proj.sector else "unspecified"),
            "geography": (ent.jurisdiction if ent and ent.jurisdiction else "unspecified"),
            "status": n.status,
            "budget_min": n.budget_min,
            "budget_max": n.budget_max,
            "created_at": n.created_at,
        })
    return rows


def _heatmap(rows: list[dict]) -> dict:
    """category × stage matrix + sector and geography sidebars."""
    by_cs: dict[tuple[str, str], int] = defaultdict(int)
    categories: set[str] = set()
    by_sector: Counter = Counter()
    by_geo: Counter = Counter()
    for r in rows:
        by_cs[(r["category"], r["stage"])] += 1
        categories.add(r["category"])
        by_sector[r["sector"]] += 1
        by_geo[r["geography"]] += 1
    cat_list = sorted(categories)
    stages = STAGE_BUCKETS
    matrix = [
        {"category": c, "row": [{"stage": s, "count": by_cs[(c, s)]} for s in stages]}
        for c in cat_list
    ]
    return {
        "categories": cat_list,
        "stages": stages,
        "matrix": matrix,
        "totals_by_category": {c: sum(by_cs[(c, s)] for s in stages) for c in cat_list},
        "totals_by_stage": {s: sum(by_cs[(c, s)] for c in cat_list) for s in stages},
        "by_sector": [{"sector": k, "count": v} for k, v in by_sector.most_common(12)],
        "by_geography": [{"geography": k, "count": v} for k, v in by_geo.most_common(12)],
        "total_needs": len(rows),
    }


def _trend(rows: list[dict], months: int = 6) -> list[dict]:
    """Return a list of {month, total, by_category{...}} for the last N
    calendar months (oldest → newest)."""
    if months < 1:
        months = 6
    today = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Generate the last `months` month-buckets including the current month.
    buckets: list[date] = []
    cur = today
    for _ in range(months):
        buckets.append(cur.date())
        # walk back one month
        prev_month = cur.month - 1 or 12
        prev_year = cur.year - 1 if cur.month == 1 else cur.year
        cur = cur.replace(year=prev_year, month=prev_month)
    buckets.reverse()
    bucket_set = {b.strftime("%Y-%m"): {"month": b.strftime("%Y-%m"), "total": 0, "by_category": defaultdict(int)} for b in buckets}
    for r in rows:
        key = r["created_at"].strftime("%Y-%m")
        if key in bucket_set:
            bucket_set[key]["total"] += 1
            bucket_set[key]["by_category"][r["category"]] += 1
    out = []
    for b in buckets:
        k = b.strftime("%Y-%m")
        item = bucket_set[k]
        out.append({"month": item["month"], "total": item["total"], "by_category": dict(item["by_category"])})
    return out


def _feed(rows: list[dict]) -> list[dict]:
    """Auto-generated insight bullets. Each item has a stable `id` so the UI
    can render a simple `<ul>` without re-keying churn."""
    out: list[dict] = []
    if not rows:
        return out

    # 1) Top category overall.
    cat_counts = Counter(r["category"] for r in rows)
    top_cat, top_n = cat_counts.most_common(1)[0]
    out.append({
        "id": "top_category",
        "headline": f"{top_cat.replace('_', ' ').title()} is the most-requested category",
        "detail": f"{top_n} of {len(rows)} open posts ({_pct(top_n, len(rows))}%) name it as the primary need.",
        "tone": "neutral",
    })

    # 2) Stage × top-category — "62% of seed-stage founders requested hiring help".
    for stage in ("seed", "mvp", "prototype", "series_a"):
        stage_rows = [r for r in rows if r["stage"] == stage]
        if len(stage_rows) >= 3:
            sc = Counter(r["category"] for r in stage_rows)
            cat, n = sc.most_common(1)[0]
            out.append({
                "id": f"stage_{stage}_top",
                "headline": f"{_pct(n, len(stage_rows))}% of {stage.replace('_', ' ')}-stage founders requested {cat.replace('_', ' ')} help",
                "detail": f"{n}/{len(stage_rows)} {stage}-stage needs in the current window.",
                "tone": "highlight",
            })
            break  # one stage callout is enough — keeps the feed scannable

    # 3) Quarter-over-quarter momentum on the top category.
    now = datetime.utcnow()
    q_start = now - timedelta(days=90)
    prev_q_start = now - timedelta(days=180)
    this_q = sum(1 for r in rows if r["category"] == top_cat and r["created_at"] >= q_start)
    prev_q = sum(1 for r in rows if r["category"] == top_cat and prev_q_start <= r["created_at"] < q_start)
    if prev_q > 0:
        delta = round((this_q - prev_q) / prev_q * 100)
        if abs(delta) >= 10:
            arrow = "↑" if delta > 0 else "↓"
            out.append({
                "id": "momentum_top_cat",
                "headline": f"{top_cat.replace('_', ' ').title()} demand {arrow} {abs(delta)}% quarter-over-quarter",
                "detail": f"{this_q} posts this quarter vs. {prev_q} the previous quarter.",
                "tone": "positive" if delta > 0 else "warning",
            })

    # 4) Median budget by top category, when budgets are present.
    budgets = sorted(
        [(r["budget_min"] + r["budget_max"]) / 2 for r in rows if r["category"] == top_cat and r["budget_min"] and r["budget_max"]]
    )
    if budgets:
        median = budgets[len(budgets) // 2]
        out.append({
            "id": "median_budget_top",
            "headline": f"Median {top_cat.replace('_', ' ')} budget sits at ${int(median):,}",
            "detail": f"Across {len(budgets)} posts with explicit budget ranges.",
            "tone": "neutral",
        })

    # 5) Top sector pulling demand for the top category.
    sec_for_top = Counter(r["sector"] for r in rows if r["category"] == top_cat and r["sector"] != "unspecified")
    if sec_for_top:
        sec, sn = sec_for_top.most_common(1)[0]
        out.append({
            "id": "sector_for_top",
            "headline": f"{sec.title()} founders are the loudest buyers of {top_cat.replace('_', ' ')} services",
            "detail": f"{sn} of the {top_cat.replace('_', ' ')} posts come from {sec} projects.",
            "tone": "neutral",
        })

    # 6) Geographic concentration when we know it.
    geo_counts = Counter(r["geography"] for r in rows if r["geography"] != "unspecified")
    if geo_counts:
        geo, gn = geo_counts.most_common(1)[0]
        if gn / len(rows) >= 0.25:
            out.append({
                "id": "geo_concentration",
                "headline": f"{_pct(gn, len(rows))}% of demand is concentrated in {geo}",
                "detail": f"{gn} of {len(rows)} posts are tied to entities incorporated in {geo}.",
                "tone": "neutral",
            })

    return out


def _pct(num: int, denom: int) -> int:
    if denom <= 0:
        return 0
    return round(num / denom * 100)


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------
class HeatmapResponse(BaseModel):
    window_days: int
    heatmap: dict
    generated_at: datetime


class TrendResponse(BaseModel):
    months: int
    series: list[dict]


class FeedResponse(BaseModel):
    window_days: int
    items: list[dict]
    total_needs: int


class SubscriptionDTO(BaseModel):
    active: bool
    subscribed_at: Optional[datetime] = None
    last_sent_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/heatmap", response_model=HeatmapResponse)
def heatmap(
    window_days: int = 180,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    if window_days < 7:
        window_days = 7
    if window_days > 365:
        window_days = 365
    since = datetime.utcnow() - timedelta(days=window_days)
    rows = _join_rows(session, since=since)
    return HeatmapResponse(window_days=window_days, heatmap=_heatmap(rows), generated_at=datetime.utcnow())


@router.get("/trends", response_model=TrendResponse)
def trends(
    months: int = 6,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    if months < 1:
        months = 6
    if months > 24:
        months = 24
    # Pull a window slightly larger than `months` to cover boundary effects.
    since = datetime.utcnow() - timedelta(days=months * 31 + 7)
    rows = _join_rows(session, since=since)
    return TrendResponse(months=months, series=_trend(rows, months=months))


@router.get("/feed", response_model=FeedResponse)
def feed(
    window_days: int = 90,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    if window_days < 14:
        window_days = 14
    if window_days > 365:
        window_days = 365
    since = datetime.utcnow() - timedelta(days=window_days)
    rows = _join_rows(session, since=since)
    return FeedResponse(window_days=window_days, items=_feed(rows), total_needs=len(rows))


# ---------------------------------------------------------------------------
# Newsletter — opt-in / opt-out / preview
# ---------------------------------------------------------------------------
@router.get("/newsletter", response_model=SubscriptionDTO)
def newsletter_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    sub = session.exec(select(InsightSubscription).where(InsightSubscription.user_id == user.id)).first()
    if not sub:
        return SubscriptionDTO(active=False)
    return SubscriptionDTO(active=sub.active, subscribed_at=sub.subscribed_at, last_sent_at=sub.last_sent_at)


@router.post("/newsletter/subscribe", response_model=SubscriptionDTO)
def newsletter_subscribe(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    sub = session.exec(select(InsightSubscription).where(InsightSubscription.user_id == user.id)).first()
    if sub:
        sub.active = True
    else:
        sub = InsightSubscription(user_id=user.id, active=True)
        session.add(sub)
    session.add(ActivityLog(action="insights_newsletter_subscribe", actor=user.email, user_id=user.id))
    session.commit()
    session.refresh(sub)
    return SubscriptionDTO(active=sub.active, subscribed_at=sub.subscribed_at, last_sent_at=sub.last_sent_at)


@router.post("/newsletter/unsubscribe", response_model=SubscriptionDTO)
def newsletter_unsubscribe(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_insights_audience(user)
    sub = session.exec(select(InsightSubscription).where(InsightSubscription.user_id == user.id)).first()
    if not sub:
        return SubscriptionDTO(active=False)
    sub.active = False
    session.add(ActivityLog(action="insights_newsletter_unsubscribe", actor=user.email, user_id=user.id))
    session.commit()
    session.refresh(sub)
    return SubscriptionDTO(active=sub.active, subscribed_at=sub.subscribed_at, last_sent_at=sub.last_sent_at)


@router.get("/newsletter/preview")
def newsletter_preview(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Render the same digest body the cron would email, so partners can
    eyeball the upcoming issue before subscribing."""
    _ensure_insights_audience(user)
    body = _build_digest_body(session)
    return {"body_md": body, "generated_at": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Digest builder + weekly cron loop
# ---------------------------------------------------------------------------
def _build_digest_body(session: Session) -> str:
    """Compose a markdown digest from the last 7-day window."""
    since = datetime.utcnow() - timedelta(days=7)
    rows = _join_rows(session, since=since)
    lines = [
        "# Axal StudioOS — Demand Insights",
        "",
        f"_Week ending {datetime.utcnow().strftime('%Y-%m-%d')} · {len(rows)} new posts in the last 7 days._",
        "",
    ]
    feed = _feed(rows)
    if feed:
        lines.append("## What changed this week")
        for item in feed:
            lines.append(f"- **{item['headline']}** — {item['detail']}")
    else:
        lines.append("_Quiet week — no significant demand shifts to report._")
    lines.append("")
    if rows:
        cat_counts = Counter(r["category"] for r in rows)
        lines.append("## Top categories (last 7 days)")
        for c, n in cat_counts.most_common(5):
            lines.append(f"- {c.replace('_', ' ').title()} — {n}")
    lines += ["", "—", "_You're receiving this because you opted in via /partner/insights. Reply with `unsubscribe` or toggle in-app to stop._"]
    return "\n".join(lines)


def _send_digest_to_subscribers(session: Session, body_md: str) -> int:
    """Email the digest body to every active subscriber. Returns send count.
    Failures are logged but don't abort the loop — one bad address shouldn't
    block the rest of the list."""
    from backend.app.services.notify import _send_email
    subs = session.exec(select(InsightSubscription).where(InsightSubscription.active == True)).all()  # noqa: E712
    sent = 0
    for sub in subs:
        u = session.get(User, sub.user_id)
        if not u or not u.email:
            continue
        try:
            _send_email(u.email, "[Axal] Weekly demand insights", body_md)
            sub.last_sent_at = datetime.utcnow()
            session.add(sub)
            sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("insights digest: send to %s failed: %s", u.email, exc)
    return sent


def _run_weekly_digest_once() -> Optional[InsightDigest]:
    """Generate this week's digest if it hasn't been generated yet, persist
    it, and email subscribers. Idempotent on `week_start`.

    Concurrency model: claim the week first via INSERT ... ON CONFLICT DO
    NOTHING. Only the worker whose INSERT actually returned a row owns the
    week and goes on to send emails. Other workers see no row returned, log
    the skip, and exit — so a race never produces duplicate sends.

    Returns the digest row if this caller claimed and sent the week, else None.
    """
    from sqlalchemy import text as _text
    # Anchor each week to Monday 00:00 UTC for stable de-dup.
    now = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    with Session(engine) as session:
        # Atomically claim this week. If another worker already claimed it,
        # the RETURNING clause yields no row and we bail without sending.
        row = session.exec(
            _text(
                "INSERT INTO insight_digests (week_start, body_md, sent_count, created_at) "
                "VALUES (:ws, '', 0, NOW()) "
                "ON CONFLICT (week_start) DO NOTHING RETURNING id"
            ).bindparams(ws=week_start)
        ).first()
        session.commit()
        if not row:
            logger.info("insights weekly digest: week=%s already claimed; skipping", week_start.date())
            return None
        digest_id = row[0] if not hasattr(row, "_mapping") else row._mapping["id"]
        # We own the week — build, send, then update the placeholder row.
        body = _build_digest_body(session)
        sent = _send_digest_to_subscribers(session, body)
        session.exec(
            _text(
                "UPDATE insight_digests SET body_md = :b, sent_count = :n WHERE id = :i"
            ).bindparams(b=body, n=sent, i=digest_id)
        )
        session.commit()
        digest = session.get(InsightDigest, digest_id)
        logger.info("insights weekly digest emitted: week=%s sent=%d", week_start.date(), sent)
        return digest


async def weekly_digest_loop(stop_event: asyncio.Event) -> None:
    """In-process scheduler: wakes hourly, fires the weekly digest exactly
    once per ISO week. Cheap and avoids pulling in APScheduler. Survives
    restarts via the `insight_digests.week_start` unique key."""
    logger.info("insights weekly digest loop: started")
    while not stop_event.is_set():
        try:
            # Run the check on a worker thread so the synchronous SQLModel
            # session doesn't block the event loop.
            await asyncio.to_thread(_run_weekly_digest_once)
        except Exception as exc:  # noqa: BLE001
            logger.warning("insights weekly digest tick failed: %s", exc)
        try:
            # Wake every hour; use stop_event so shutdown is responsive.
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            pass
    logger.info("insights weekly digest loop: stopped")


# Admin trigger so tests / ops can force a digest send out-of-band.
@router.post("/newsletter/run-now")
def admin_run_digest_now(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    body = _build_digest_body(session)
    sent = _send_digest_to_subscribers(session, body)
    now = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    existing = session.exec(select(InsightDigest).where(InsightDigest.week_start == week_start)).first()
    if existing:
        existing.body_md = body
        existing.sent_count = (existing.sent_count or 0) + sent
        session.add(existing)
    else:
        session.add(InsightDigest(week_start=week_start, body_md=body, sent_count=sent))
    session.add(ActivityLog(action="insights_digest_admin_run", actor=user.email, user_id=user.id, details=f"sent={sent}"))
    session.commit()
    return {"ok": True, "sent": sent, "week_start": week_start.isoformat()}
