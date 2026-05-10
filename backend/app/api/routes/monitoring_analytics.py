"""Dev-backend port of the Cloudflare Worker `/api/monitoring/analytics/*`
endpoints (see `cloudflare-worker/src/routes/monitoring_analytics.ts`).

This router exists so the Admin Analytics tab on `/monitoring?tab=analytics`
works end-to-end against the FastAPI dev backend (which the Vite dev server
proxies to). The worker remains the source of truth in production; this
file mirrors its response shapes 1:1 so the same React components render
without modification.

Most heavy data sources used by the worker (`subscription_plans`,
`fx_rates`, `system_metrics`, `error_logs`, `admin_audit_log`,
`analytics_snapshots`, etc.) don't exist in the dev SQLModel/Postgres
schema. For those, this router returns the same well-shaped empty/zero
payloads the worker would produce when those tables are empty — the UI
already renders an "EmptyPill" cleanly in that case. Surfaces we CAN
populate (active users, signups, daily active, top actions, user list,
per-user feature usage) read from `users`, `activity_logs`, and
`projects`.

In-memory tables for plans + audit log live for the lifetime of the
process so plan-CRUD round-trips work in dev.
"""
from __future__ import annotations

import csv
import io
import json
import re
import threading
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from sqlalchemy import text
from sqlmodel import Session

from backend.app.database import get_session
from backend.app.models.entities import User, UserRole
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/monitoring/analytics", tags=["Monitoring · Analytics"])


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------
def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# range parsing — mirrors worker's parseRange()
# ---------------------------------------------------------------------------
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class _Range:
    __slots__ = ("from_d", "to_d", "from_iso", "to_iso", "days")

    def __init__(self, from_d: date, to_d: date) -> None:
        self.from_d = from_d
        self.to_d = to_d
        self.from_iso = datetime.combine(from_d, datetime.min.time()).replace(tzinfo=timezone.utc)
        self.to_iso = datetime.combine(to_d, datetime.max.time().replace(microsecond=0)).replace(tzinfo=timezone.utc)
        self.days = max(1, min(366, (to_d - from_d).days or 1))


def _parse_range(from_q: Optional[str], to_q: Optional[str], default_days: int = 30) -> _Range:
    now = datetime.now(timezone.utc).date()
    to_d: date
    from_d: date
    if to_q:
        if not ISO_DATE_RE.match(to_q):
            raise HTTPException(400, "Invalid to (expected YYYY-MM-DD)")
        try:
            to_d = date.fromisoformat(to_q)
        except ValueError:
            raise HTTPException(400, "Invalid to date")
    else:
        to_d = now
    if from_q:
        if not ISO_DATE_RE.match(from_q):
            raise HTTPException(400, "Invalid from (expected YYYY-MM-DD)")
        try:
            from_d = date.fromisoformat(from_q)
        except ValueError:
            raise HTTPException(400, "Invalid from date")
    else:
        from_d = now - timedelta(days=default_days)
    if from_d > to_d:
        raise HTTPException(400, "`from` must be on or before `to`")
    return _Range(from_d, to_d)


def _clamp(raw: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


# ---------------------------------------------------------------------------
# in-memory plan catalog + audit log (process-lifetime; dev only)
# ---------------------------------------------------------------------------
_LOCK = threading.Lock()
_PLANS: dict[str, dict[str, Any]] = {
    "mi_pro_monthly": {
        "plan_id": "mi_pro_monthly",
        "display_name": "MI Pro · Monthly",
        "monthly_price_usd": 49.0,
        "stripe_price_id": None,
        "currency": "USD",
        "native_amount": 49.0,
        "is_active": True,
        "subscriber_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    },
    "mi_pro_annual": {
        "plan_id": "mi_pro_annual",
        "display_name": "MI Pro · Annual",
        "monthly_price_usd": 39.0,
        "stripe_price_id": None,
        "currency": "USD",
        "native_amount": 39.0,
        "is_active": True,
        "subscriber_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    },
}
_AUDIT: list[dict[str, Any]] = []
_AUDIT_AUTOID = {"v": 0}


def _audit_insert(
    admin: User,
    action: str,
    report_type: Optional[str],
    fmt: Optional[str],
    filters: Optional[dict[str, Any]] = None,
    download_url: str = "",
) -> None:
    with _LOCK:
        _AUDIT_AUTOID["v"] += 1
        _AUDIT.append({
            "id": _AUDIT_AUTOID["v"],
            "admin_user_id": admin.id,
            "admin_email": admin.email,
            "admin_name": admin.name,
            "action": action,
            "report_type": report_type,
            "format": fmt,
            "filters_json": json.dumps(filters or {}),
            "download_url": download_url,
            "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        })


# ---------------------------------------------------------------------------
# helpers — derive metrics from the dev DB
# ---------------------------------------------------------------------------
def _scalar(session: Session, sql: str, **params: Any) -> int:
    try:
        row = session.execute(text(sql), params).first()
        return int(row[0] or 0) if row else 0
    except Exception:
        return 0


def _rows(session: Session, sql: str, **params: Any) -> list[dict[str, Any]]:
    try:
        result = session.execute(text(sql), params)
        cols = list(result.keys())
        return [dict(zip(cols, r)) for r in result.fetchall()]
    except Exception:
        return []


def _price_for(plan: Optional[str]) -> float:
    if not plan:
        return 0.0
    p = _PLANS.get(plan)
    return float(p["monthly_price_usd"]) if p and p.get("is_active") else 0.0


# ---------------------------------------------------------------------------
# read endpoints
# ---------------------------------------------------------------------------
@router.get("/overview")
def overview(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    rg = _parse_range(from_, to)
    active = _scalar(
        session,
        "SELECT COUNT(DISTINCT user_id) FROM activity_logs WHERE user_id IS NOT NULL AND created_at BETWEEN :a AND :b",
        a=rg.from_iso, b=rg.to_iso,
    )
    new_signups = _scalar(
        session,
        "SELECT COUNT(*) FROM users WHERE created_at BETWEEN :a AND :b",
        a=rg.from_iso, b=rg.to_iso,
    )
    total_users = _scalar(session, "SELECT COUNT(*) FROM users WHERE is_active = TRUE")
    paid_users = 0  # no subscription columns in dev schema
    daily = _rows(
        session,
        """
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(DISTINCT user_id) AS active
        FROM activity_logs
        WHERE user_id IS NOT NULL AND created_at BETWEEN :a AND :b
        GROUP BY day ORDER BY day ASC
        """,
        a=rg.from_iso, b=rg.to_iso,
    )
    top_actions = _rows(
        session,
        """
        SELECT action AS endpoint, COUNT(*) AS hits
        FROM activity_logs
        WHERE created_at BETWEEN :a AND :b
        GROUP BY action ORDER BY hits DESC LIMIT 10
        """,
        a=rg.from_iso, b=rg.to_iso,
    )
    is_empty = active == 0 and new_signups == 0 and not top_actions
    ccy = (currency or "USD").upper()
    return {
        "range": {"from": rg.from_d.isoformat(), "to": rg.to_d.isoformat(), "days": rg.days},
        "active_users": active,
        "new_signups": new_signups,
        "total_users": total_users,
        "paid_users": paid_users,
        "conversion_to_paid_pct": 0,
        "mrr_usd": 0,
        "arr_usd": 0,
        "mrr": 0,
        "arr": 0,
        "display_currency": ccy,
        "fx_as_of": None,
        "churned_subscriptions": 0,
        "churn_rate_pct": 0,
        "avg_session_minutes": 0,
        "p50_latency_ms": 0,
        "p95_latency_ms": 0,
        "error_rate_pct": 0,
        "total_requests": 0,
        "top_pages": [{"endpoint": str(r["endpoint"]), "hits": int(r["hits"])} for r in top_actions],
        "daily_active": [{"day": str(r["day"]), "active": int(r["active"])} for r in daily],
        "meta": {"reason": "no_data" if is_empty else "ok"},
    }


@router.get("/currencies")
def currencies(_: User = Depends(require_admin)):
    # Worker reads from `fx_rates`. Dev backend has no FX table; surface an
    # empty list so the dropdown falls back to its default ['USD',...] set.
    return {"currencies": []}


@router.get("/cohorts")
def cohorts(
    metric: str = Query("retention"),
    granularity: str = Query("week"),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    metric = "revenue" if metric == "revenue" else "retention"
    granularity = "month" if granularity == "month" else "week"
    fmt = "IYYY-IW" if granularity == "week" else "YYYY-MM"
    rows = _rows(
        session,
        f"""
        SELECT to_char(u.created_at, '{fmt}') AS cohort, COUNT(*) AS signups
        FROM users u
        WHERE u.created_at >= now() - interval '12 months'
        GROUP BY cohort ORDER BY cohort ASC
        """,
    )
    if metric == "revenue":
        out = [{"cohort": r["cohort"], "signups": int(r["signups"]), "paying": 0, "mrr_usd": 0} for r in rows]
    else:
        out = [{"cohort": r["cohort"], "signups": int(r["signups"]), "retained_30d": 0} for r in rows]
    return {"metric": metric, "granularity": granularity, "cohorts": out}


@router.get("/users")
def users(
    role: str = Query(""),
    tier: str = Query(""),
    search: str = Query(""),
    limit: int = Query(50),
    offset: int = Query(0),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    limit = _clamp(limit, 50, 1, 200)
    offset = _clamp(offset, 0, 0, 100000)
    clauses = ["u.is_active = TRUE"]
    params: dict[str, Any] = {}
    if role:
        clauses.append("u.role = :role")
        params["role"] = role
    if search:
        clauses.append("(LOWER(u.email) LIKE :s OR LOWER(u.name) LIKE :s)")
        params["s"] = f"%{search.lower()}%"
    where = " AND ".join(clauses)
    rows = _rows(
        session,
        f"""
        SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_active_at,
               (SELECT COUNT(*) FROM activity_logs a
                  WHERE a.user_id = u.id AND a.created_at >= now() - interval '30 days') AS sessions_30d,
               (SELECT COUNT(*) FROM projects p WHERE p.id = u.id) AS project_count
        FROM users u
        WHERE {where}
        ORDER BY u.created_at DESC
        LIMIT :limit OFFSET :offset
        """,
        limit=limit, offset=offset, **params,
    )
    total = _scalar(session, f"SELECT COUNT(*) FROM users u WHERE {where}", **params)
    enriched = []
    for r in rows:
        # `tier` filter is applied in-memory because there's no subscription
        # column in the dev schema. With no tiered users in dev, this filter
        # produces an empty list when set — same as worker behaviour.
        if tier:
            continue
        enriched.append({
            "id": int(r["id"]),
            "email": r["email"] or "",
            "name": r["name"] or "",
            "role": r["role"].value if hasattr(r["role"], "value") else str(r["role"]),
            "created_at": r["created_at"].isoformat() if isinstance(r["created_at"], datetime) else str(r["created_at"]),
            "sub_status": "",
            "sub_plan": "",
            "last_seen_at": r["last_active_at"].isoformat() if isinstance(r["last_active_at"], datetime) else (str(r["last_active_at"]) if r["last_active_at"] else None),
            "sessions_30d": int(r["sessions_30d"] or 0),
            "project_count": int(r["project_count"] or 0),
            "lifetime_value_usd": 0,
        })
    return {"users": enriched, "total": 0 if tier else total, "limit": limit, "offset": offset}


@router.get("/user/{user_id}")
def user_detail(
    user_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    u = session.get(User, user_id)
    if not u:
        raise HTTPException(404, "Not found")
    feature_usage = _rows(
        session,
        """
        SELECT action, COUNT(*) AS c FROM activity_logs
        WHERE user_id = :uid AND created_at >= now() - interval '90 days'
        GROUP BY action ORDER BY c DESC LIMIT 25
        """,
        uid=user_id,
    )
    return {
        "user": {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "created_at": u.created_at.isoformat() if isinstance(u.created_at, datetime) else str(u.created_at),
            "sub_status": "",
            "sub_plan": "",
            "sub_period_end": None,
        },
        "feature_usage": [{"action": str(r["action"]), "c": int(r["c"])} for r in feature_usage],
        "support_tickets": [],
        "billing_history": [],
        "error_count_90d": 0,
        "lifetime_value_usd": 0,
    }


@router.get("/financial")
def financial(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    _: User = Depends(require_admin),
):
    rg = _parse_range(from_, to)
    ccy = (currency or "USD").upper()
    return {
        "range": {"from": rg.from_d.isoformat(), "to": rg.to_d.isoformat()},
        "total_mrr_usd": 0, "arr_usd": 0, "new_mrr_usd": 0,
        "expansion_mrr_usd": 0, "churn_mrr_usd": 0,
        "total_mrr": 0, "arr": 0, "new_mrr": 0, "churn_mrr": 0,
        "display_currency": ccy, "fx_as_of": None,
        "mrr_breakdown_by_tier": [],
        "ltv_by_cohort": [],
        "assistant_cost": {
            "total_conversations": 0, "total_messages": 0,
            "total_cost_usd": 0, "total_cost": 0,
            "avg_cost_per_conversation_usd": 0, "avg_cost_per_conversation": 0,
            "cost_by_model": [], "top_conversations": [],
        },
        "meta": {"reason": "no_data"},
    }


@router.get("/technical")
def technical(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _: User = Depends(require_admin),
):
    rg = _parse_range(from_, to)
    return {
        "range": {"from": rg.from_d.isoformat(), "to": rg.to_d.isoformat()},
        "by_route": [],
        "error_rate_by_route": [],
        "slow_queries": [],
        "queue_depth": 0,
        "dlq_count": 0,
        "top_errors": [],
        "meta": {"reason": "no_data"},
    }


@router.get("/management")
def management(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
):
    return {
        "overview": overview(from_=from_, to=to, currency=currency, session=session, _=user),
        "financial": financial(from_=from_, to=to, currency=currency, _=user),
        "technical": technical(from_=from_, to=to, _=user),
    }


@router.post("/snapshots/backfill")
def snapshots_backfill(
    payload: dict = Body(default_factory=dict),
    _: User = Depends(require_admin),
):
    days = _clamp((payload or {}).get("days", 7), 7, 1, 90)
    return {"ok": True, "days_requested": days, "rebuilt_days": 0, "skipped_today": True}


# ---------------------------------------------------------------------------
# audit (Recent Exports panel + Plan change history)
# ---------------------------------------------------------------------------
def _filter_audit(
    action: str,
    plan_id: Optional[str],
    admin_user_id: Optional[int],
    admin_q: Optional[str],
    from_d: Optional[str],
    to_d: Optional[str],
) -> list[dict[str, Any]]:
    out = []
    aq = (admin_q or "").lower()
    for row in _AUDIT:
        if row["action"] != action:
            continue
        if plan_id and row.get("report_type") != plan_id:
            continue
        if admin_user_id is not None and row.get("admin_user_id") != admin_user_id:
            continue
        if aq:
            email = (row.get("admin_email") or "").lower()
            name = (row.get("admin_name") or "").lower()
            if aq not in email and aq not in name:
                continue
        ts = row["exported_at"]
        if from_d and ts < f"{from_d} 00:00:00":
            continue
        if to_d and ts > f"{to_d} 23:59:59":
            continue
        out.append(row)
    out.sort(key=lambda r: r["exported_at"], reverse=True)
    return out


@router.get("/audit")
def audit(
    limit: int = Query(25),
    offset: int = Query(0),
    action: str = Query("analytics_export"),
    plan_id: Optional[str] = Query(None),
    admin_user_id: Optional[int] = Query(None),
    admin_q: Optional[str] = Query(None),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    _: User = Depends(require_admin),
):
    if action not in ("analytics_export", "subscription_plan_update"):
        action = "analytics_export"
    limit = _clamp(limit, 25, 1, 100)
    offset = _clamp(offset, 0, 0, 100000)
    pid = (plan_id or "").strip()[:100] or None
    aq = (admin_q or "").strip()[:100] or None
    fb = from_ if (from_ and ISO_DATE_RE.match(from_)) else None
    tb = to if (to and ISO_DATE_RE.match(to)) else None
    with _LOCK:
        all_rows = _filter_audit(action, pid, admin_user_id, aq, fb, tb)
    items = all_rows[offset:offset + limit]
    return {
        "items": items,
        "total": len(all_rows),
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < len(all_rows),
        "filters": {
            "action": action,
            "plan_id": pid,
            "admin_user_id": admin_user_id,
            "admin_q": aq,
            "from": fb,
            "to": tb,
        },
    }


@router.get("/audit/export.csv")
def audit_export_csv(
    plan_id: Optional[str] = Query(None),
    admin_user_id: Optional[int] = Query(None),
    admin_q: Optional[str] = Query(None),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    admin: User = Depends(require_admin),
):
    pid = (plan_id or "").strip()[:100] or None
    aq = (admin_q or "").strip()[:100] or None
    fb = from_ if (from_ and ISO_DATE_RE.match(from_)) else None
    tb = to if (to and ISO_DATE_RE.match(to)) else None
    with _LOCK:
        rows = _filter_audit("subscription_plan_update", pid, admin_user_id, aq, fb, tb)[:10000]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "exported_at_utc", "plan_id", "change_type", "change_summary",
                "admin_user_id", "admin_email", "admin_name", "raw_diff_json"])
    for r in rows:
        w.writerow([
            r["id"], r["exported_at"], r.get("report_type") or "",
            r.get("format") or "",
            _describe_plan_patch(r.get("filters_json")),
            r["admin_user_id"], r.get("admin_email") or "",
            r.get("admin_name") or "", r.get("filters_json") or "",
        ])
    _audit_insert(admin, "analytics_export", "subscription_plan_audit", "csv",
                  filters={"plan_id": pid, "admin_user_id": admin_user_id,
                           "admin_q": aq, "from": fb, "to": tb, "row_count": len(rows)})
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H-%M-%S")
    plan_tag = f"-{re.sub(r'[^A-Za-z0-9_-]', '_', pid)[:40]}" if pid else ""
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="plan-change-history{plan_tag}-{ts}.csv"',
            "Cache-Control": "no-store",
        },
    )


def _describe_plan_patch(raw: Optional[str]) -> str:
    if not raw:
        return ""
    try:
        p = json.loads(raw)
    except (TypeError, ValueError):
        return str(raw)
    if not isinstance(p, dict):
        return str(raw)
    parts: list[str] = []
    if p.get("deleted"):
        label = f' ("{p["display_name"]}")' if p.get("display_name") else ""
        return f"deleted{label}"
    if p.get("created"):
        parts.append("created")
        if p.get("stripe_price_id"):
            parts.append(f'stripe → {p["stripe_price_id"]}')
    if p.get("monthly_price_usd") is not None:
        parts.append(f'price → ${p["monthly_price_usd"]}')
    if "display_name" in p:
        v = p["display_name"]
        label = "(none)" if v in (None, "") else '"' + str(v) + '"'
        parts.append(f"name → {label}")
    if "is_active" in p:
        parts.append("activated" if p["is_active"] else "deactivated")
    if p.get("currency") and not p.get("created") and not p.get("deleted"):
        parts.append(f'currency → {p["currency"]}')
    if p.get("native_amount") is not None and not p.get("created") and not p.get("deleted"):
        parts.append(f'native → {p["native_amount"]}')
    return " · ".join(parts)


# ---------------------------------------------------------------------------
# plans
# ---------------------------------------------------------------------------
_PLAN_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}$")


@router.get("/plans")
def list_plans(_: User = Depends(require_admin)):
    with _LOCK:
        plans = [dict(p) for p in _PLANS.values()]
    plans.sort(key=lambda p: p["plan_id"])
    return {"plans": plans}


@router.post("/plans", status_code=201)
def create_plan(payload: dict = Body(default_factory=dict), admin: User = Depends(require_admin)):
    plan_id = str(payload.get("plan_id") or "").strip()
    if not plan_id:
        raise HTTPException(400, "plan_id is required")
    if not _PLAN_ID_RE.match(plan_id):
        raise HTTPException(400, "plan_id must be 1-64 chars: letters, digits, _ . -")
    currency = str(payload.get("currency") or "USD").upper().strip()
    if not re.match(r"^[A-Z]{3}$", currency):
        raise HTTPException(400, "currency must be a 3-letter ISO 4217 code")
    raw_usd = payload.get("monthly_price_usd")
    raw_native = payload.get("native_amount")
    monthly_usd: float
    native_amount: float
    if currency == "USD":
        if raw_usd in (None, ""):
            raise HTTPException(400, "monthly_price_usd is required for USD plans")
        try:
            monthly_usd = float(raw_usd)
        except (TypeError, ValueError):
            raise HTTPException(400, "monthly_price_usd must be a number")
        if monthly_usd < 0:
            raise HTTPException(400, "monthly_price_usd must be ≥ 0")
        native_amount = monthly_usd
    else:
        # Worker FX-derives USD from the native amount; dev has no fx_rates,
        # so we mirror the worker's "no FX" path with a 1:1 fallback so the
        # plan still saves and the UI can later be edited.
        if raw_native in (None, ""):
            raise HTTPException(400, "native_amount is required for non-USD plans")
        try:
            native_amount = float(raw_native)
        except (TypeError, ValueError):
            raise HTTPException(400, "native_amount must be a number")
        if native_amount < 0:
            raise HTTPException(400, "native_amount must be ≥ 0")
        monthly_usd = native_amount
    with _LOCK:
        if plan_id in _PLANS:
            raise HTTPException(409, f"Plan '{plan_id}' already exists")
        now = datetime.now(timezone.utc).isoformat()
        plan = {
            "plan_id": plan_id,
            "display_name": payload.get("display_name") or None,
            "monthly_price_usd": monthly_usd,
            "stripe_price_id": payload.get("stripe_price_id") or None,
            "currency": currency,
            "native_amount": native_amount,
            "is_active": True,
            "subscriber_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        _PLANS[plan_id] = plan
    _audit_insert(admin, "subscription_plan_update", plan_id, "create", filters={
        "plan_id": plan_id, "created": True,
        "monthly_price_usd": monthly_usd,
        "display_name": plan["display_name"],
        "stripe_price_id": plan["stripe_price_id"],
        "currency": currency, "native_amount": native_amount,
    })
    return {"plan": plan}


@router.patch("/plans/{plan_id}")
def update_plan(plan_id: str, payload: dict = Body(default_factory=dict), admin: User = Depends(require_admin)):
    patch: dict[str, Any] = {}
    if "monthly_price_usd" in payload:
        try:
            n = float(payload["monthly_price_usd"])
        except (TypeError, ValueError):
            raise HTTPException(400, "monthly_price_usd must be a number")
        if n < 0:
            raise HTTPException(400, "monthly_price_usd must be ≥ 0")
        patch["monthly_price_usd"] = n
    if payload.get("native_amount") not in (None, ""):
        try:
            n = float(payload["native_amount"])
        except (TypeError, ValueError):
            raise HTTPException(400, "native_amount must be a number")
        if n < 0:
            raise HTTPException(400, "native_amount must be ≥ 0")
        patch["native_amount"] = n
    if payload.get("currency") not in (None, ""):
        code = str(payload["currency"]).upper().strip()
        if not re.match(r"^[A-Z]{3}$", code):
            raise HTTPException(400, "currency must be a 3-letter ISO 4217 code")
        patch["currency"] = code
    if "display_name" in payload:
        v = payload["display_name"]
        patch["display_name"] = None if v is None else str(v)
    if "is_active" in payload:
        patch["is_active"] = bool(payload["is_active"])
    with _LOCK:
        plan = _PLANS.get(plan_id)
        if not plan:
            raise HTTPException(404, "Plan not found")
        # When pricing fields shift in dev (no FX table), keep monthly_usd
        # in sync with native_amount on a 1:1 basis as a sane fallback.
        if "native_amount" in patch and "monthly_price_usd" not in patch:
            if patch.get("currency", plan["currency"]) == "USD":
                patch["monthly_price_usd"] = patch["native_amount"]
        plan.update(patch)
        plan["updated_at"] = datetime.now(timezone.utc).isoformat()
        snapshot = dict(plan)
    _audit_insert(admin, "subscription_plan_update", plan_id, "patch",
                  filters={"plan_id": plan_id, **patch})
    return {"plan": snapshot}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, admin: User = Depends(require_admin)):
    with _LOCK:
        plan = _PLANS.pop(plan_id, None)
    if not plan:
        raise HTTPException(404, "Plan not found")
    _audit_insert(admin, "subscription_plan_update", plan_id, "delete", filters={
        "plan_id": plan_id, "deleted": True,
        "display_name": plan.get("display_name"),
        "monthly_price_usd": plan.get("monthly_price_usd"),
        "currency": plan.get("currency"),
    })
    return {"ok": True, "plan": plan}


# ---------------------------------------------------------------------------
# export — returns a same-origin data: URL since dev has no R2
# ---------------------------------------------------------------------------
_REPORTS = {"overview", "users", "financial", "technical", "management"}


@router.post("/export")
def export_report(
    payload: dict = Body(default_factory=dict),
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    report = str(payload.get("report") or "overview").lower()
    if report not in _REPORTS:
        raise HTTPException(400, "Invalid report")
    fmt = "pdf" if str(payload.get("format") or "csv").lower() == "pdf" else "csv"
    rg = _parse_range(
        payload.get("from") if isinstance(payload.get("from"), str) else None,
        payload.get("to") if isinstance(payload.get("to"), str) else None,
    )
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
    ccy = payload.get("currency") if isinstance(payload.get("currency"), str) else filters.get("currency")

    # Gather data
    if report == "overview":
        data: Any = overview(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), currency=ccy, session=session, _=admin)
    elif report == "financial":
        data = financial(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), currency=ccy, _=admin)
    elif report == "technical":
        data = technical(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), _=admin)
    elif report == "users":
        data = users(role=filters.get("role") or "", tier=filters.get("tier") or "",
                     search=filters.get("search") or "", limit=200, offset=0, session=session, _=admin)
    else:  # management
        data = {
            "overview": overview(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), currency=ccy, session=session, _=admin),
            "financial": financial(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), currency=ccy, _=admin),
            "technical": technical(from_=rg.from_d.isoformat(), to=rg.to_d.isoformat(), _=admin),
        }

    # Render
    if fmt == "csv":
        body_bytes = _render_csv(report, data).encode("utf-8")
        content_type = "text/csv; charset=utf-8"
        ext = "csv"
        actual_format = "csv"
    else:
        # No browser-rendering binding in dev; fall back to styled HTML
        # (matches the worker's HTML fallback behaviour).
        body_bytes = _render_html(report, data, rg).encode("utf-8")
        content_type = "text/html; charset=utf-8"
        ext = "html"
        actual_format = "html"

    import base64
    b64 = base64.b64encode(body_bytes).decode("ascii")
    download_url = f"data:{content_type};base64,{b64}"
    storage_key = f"analytics-exports/{admin.id}/{datetime.now(timezone.utc).isoformat()}-{uuid.uuid4().hex[:12]}.{ext}"
    filters_json = {"from": rg.from_d.isoformat(), "to": rg.to_d.isoformat(), **(filters or {})}
    _audit_insert(admin, "analytics_export", report, actual_format, filters=filters_json, download_url=download_url)
    return {
        "ok": True,
        "report": report,
        "format": actual_format,
        "storage_key": storage_key,
        "download_url": download_url,
        "size_bytes": len(body_bytes),
    }


def _csv_writer() -> tuple[io.StringIO, csv.writer]:
    buf = io.StringIO()
    return buf, csv.writer(buf)


def _render_csv(report: str, data: Any) -> str:
    if report == "overview":
        buf, w = _csv_writer()
        ccy = (data.get("display_currency") or "USD").lower()
        rows = [
            ("active_users", data.get("active_users", 0)),
            ("new_signups", data.get("new_signups", 0)),
            ("total_users", data.get("total_users", 0)),
            ("paid_users", data.get("paid_users", 0)),
            ("conversion_to_paid_pct", data.get("conversion_to_paid_pct", 0)),
            ("mrr_usd", data.get("mrr_usd", 0)),
            ("arr_usd", data.get("arr_usd", 0)),
            (f"mrr_{ccy}", data.get("mrr", 0)),
            (f"arr_{ccy}", data.get("arr", 0)),
            ("fx_as_of", data.get("fx_as_of") or ""),
            ("churn_rate_pct", data.get("churn_rate_pct", 0)),
            ("avg_session_minutes", data.get("avg_session_minutes", 0)),
            ("p50_latency_ms", data.get("p50_latency_ms", 0)),
            ("p95_latency_ms", data.get("p95_latency_ms", 0)),
            ("error_rate_pct", data.get("error_rate_pct", 0)),
            ("total_requests", data.get("total_requests", 0)),
        ]
        w.writerow(["metric", "value"])
        for r in rows:
            w.writerow(r)
        return buf.getvalue()
    if report == "users":
        buf, w = _csv_writer()
        cols = ["id", "email", "name", "role", "sub_status", "sub_plan", "sessions_30d",
                "project_count", "lifetime_value_usd", "last_seen_at", "created_at"]
        w.writerow(cols)
        for u in (data.get("users") or []):
            w.writerow([u.get(c, "") for c in cols])
        return buf.getvalue()
    # financial / technical / management — emit a minimal flat CSV
    buf, w = _csv_writer()
    w.writerow(["section", "metric", "value"])
    if report == "management":
        o = data.get("overview") or {}
        f = data.get("financial") or {}
        t = data.get("technical") or {}
        for k in ("active_users", "new_signups", "mrr_usd", "arr_usd", "churn_rate_pct"):
            w.writerow(["overview", k, o.get(k, 0)])
        for k in ("new_mrr_usd", "churn_mrr_usd"):
            w.writerow(["financial", k, f.get(k, 0)])
        for k in ("queue_depth", "dlq_count"):
            w.writerow(["technical", k, t.get(k, 0)])
    elif report == "financial":
        for k in ("total_mrr_usd", "arr_usd", "new_mrr_usd", "churn_mrr_usd"):
            w.writerow(["financial", k, data.get(k, 0)])
    else:  # technical
        for k in ("queue_depth", "dlq_count"):
            w.writerow(["technical", k, data.get(k, 0)])
    return buf.getvalue()


def _render_html(report: str, data: Any, rg: _Range) -> str:
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<title>Axal · {report} report</title>"
        "<style>body{font-family:system-ui;padding:24px;color:#111}h1{margin:0 0 8px}"
        "pre{background:#f6f6f7;padding:12px;border-radius:8px;overflow:auto}</style></head><body>"
        f"<h1>{report.title()} report</h1>"
        f"<div>Range: {rg.from_d.isoformat()} → {rg.to_d.isoformat()}</div>"
        "<pre>" + json.dumps(data, indent=2, default=str) + "</pre>"
        "</body></html>"
    )
