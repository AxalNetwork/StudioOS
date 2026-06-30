import hashlib
import logging
from fastapi import APIRouter, Depends, Body, HTTPException, Query
from datetime import datetime, timedelta
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    User, Project, ScoreSnapshot, PipelineVote, Deal,
    VCFund, LimitedPartner, CapitalCall,
)

# Every market-intel endpoint requires an authenticated session.
router = APIRouter(
    prefix="/market-intel",
    tags=["Market Intelligence"],
    dependencies=[Depends(get_current_user)],
)

logger = logging.getLogger("studioos.market_intel")

MARKET_PULSE = [
    {
        "sector": "Agentic B2B",
        "multiple": 22.4,
        "sentiment": "Aggressive",
        "technographic_signal": "High churn in legacy CRM; 40% migration to AI-first middleware.",
        "hiring_surge": "DevOps/SRE hiring up 18% in mid-market SaaS.",
        "gap_opportunity": "Unified API for autonomous agent billing.",
    },
    {
        "sector": "Bio-Automation",
        "multiple": 14.1,
        "sentiment": "Wait-and-See",
        "technographic_signal": "Early adoption of Lab-OS standards.",
        "hiring_surge": "Biology-specialized LLM researchers.",
        "gap_opportunity": "Compliance-as-a-service for decentralized clinical trials.",
    },
    {
        "sector": "AI Infrastructure",
        "multiple": 28.7,
        "sentiment": "Aggressive",
        "technographic_signal": "Enterprise GPU cluster adoption up 65% YoY.",
        "hiring_surge": "ML Ops engineers up 32% across Fortune 500.",
        "gap_opportunity": "Edge inference orchestration layer for real-time AI.",
    },
    {
        "sector": "Fintech / DeFi",
        "multiple": 16.3,
        "sentiment": "Cautious",
        "technographic_signal": "Banks migrating to API-first core banking.",
        "hiring_surge": "Compliance + crypto-native product managers.",
        "gap_opportunity": "Regulated stablecoin treasury management API.",
    },
    {
        "sector": "Data / Analytics",
        "multiple": 19.8,
        "sentiment": "Aggressive",
        "technographic_signal": "Data lakehouse adoption replacing legacy warehouses.",
        "hiring_surge": "Data engineers and analytics engineers up 25%.",
        "gap_opportunity": "Real-time data quality monitoring for AI pipelines.",
    },
    {
        "sector": "Cybersecurity",
        "multiple": 24.2,
        "sentiment": "Aggressive",
        "technographic_signal": "Zero-trust adoption accelerating in mid-market.",
        "hiring_surge": "AppSec and identity engineers up 40%.",
        "gap_opportunity": "AI-powered threat detection for API-first architectures.",
    },
    {
        "sector": "Autonomous Robotics",
        "multiple": 26.3,
        "sentiment": "Aggressive",
        "technographic_signal": "Vision-language models enabling 40%+ YoY increase in warehouse and last-mile automation pilots.",
        "hiring_surge": "Robotics software + perception engineers up 31% across logistics and manufacturing.",
        "gap_opportunity": "Unified agentic control layer for heterogeneous robot fleets.",
    },
    {
        "sector": "Climate Intelligence",
        "multiple": 17.9,
        "sentiment": "Aggressive",
        "technographic_signal": "Post-IRA extension surge in carbon accounting and Scope 3 automation platforms.",
        "hiring_surge": "Sustainability AI engineers and emissions data scientists up 37%.",
        "gap_opportunity": "Real-time MRV (Measurement, Reporting, Verification) API for enterprise net-zero compliance.",
    },
    {
        "sector": "Quantum Infrastructure",
        "multiple": 12.4,
        "sentiment": "Wait-and-See",
        "technographic_signal": "Error-corrected logical qubits crossing 100+ threshold in multiple labs; hybrid quantum-classical workloads entering enterprise pilots.",
        "hiring_surge": "Quantum algorithm + error-correction researchers up 24% at hyperscalers and national labs.",
        "gap_opportunity": "Cloud-accessible quantum optimization layer for supply-chain and portfolio risk modeling.",
    },
]

MACRO_DATA = {
    "sectors": [
        {"name": "AI / ML", "avg_pe": 45.2, "yoy_growth": 34.5, "ipo_window": "Open", "trend": "up"},
        {"name": "SaaS", "avg_pe": 32.1, "yoy_growth": 18.2, "ipo_window": "Selective", "trend": "stable"},
        {"name": "Fintech", "avg_pe": 28.7, "yoy_growth": 12.4, "ipo_window": "Cautious", "trend": "stable"},
        {"name": "Blockchain", "avg_pe": 38.5, "yoy_growth": 28.1, "ipo_window": "Opening", "trend": "up"},
        {"name": "Biotech", "avg_pe": 22.3, "yoy_growth": 8.6, "ipo_window": "Selective", "trend": "down"},
        {"name": "Climate Tech", "avg_pe": 30.4, "yoy_growth": 22.3, "ipo_window": "Open", "trend": "up"},
        {"name": "Cybersecurity", "avg_pe": 41.8, "yoy_growth": 25.6, "ipo_window": "Open", "trend": "up"},
        {"name": "Semiconductors", "avg_pe": 52.3, "yoy_growth": 41.2, "ipo_window": "Open", "trend": "up"},
        {"name": "Enterprise AI Software", "avg_pe": 38.9, "yoy_growth": 29.4, "ipo_window": "Selective", "trend": "up"},
    ],
    "interest_rate_impact": "Moderate — rates stabilized, favoring growth equity.",
    "exit_environment": "Improving. Strategic M&A picking up in AI/Infrastructure.",
    "updated_at": "2026-03-27",
}

PRIVATE_ROUNDS = [
    {"company": "AgenticFlow", "amount": "$12M", "valuation": "$60M", "sector": "Agentic B2B", "stage": "Series A"},
    {"company": "NeuralEdge", "amount": "$8M", "valuation": "$40M", "sector": "AI Infrastructure", "stage": "Seed"},
    {"company": "DataWeave", "amount": "$15M", "valuation": "$75M", "sector": "Data / Analytics", "stage": "Series A"},
    {"company": "ChainVault", "amount": "$5M", "valuation": "$25M", "sector": "Fintech / DeFi", "stage": "Seed"},
    {"company": "BioScript", "amount": "$20M", "valuation": "$100M", "sector": "Bio-Automation", "stage": "Series B"},
    {"company": "ShieldAI", "amount": "$10M", "valuation": "$50M", "sector": "Cybersecurity", "stage": "Series A"},
]

STUDIO_BENCHMARKS = {
    "avg_time_to_inc_days": 11,
    "founder_match_rate": 88,
    "api_reusability_score": 65,
    "current_dry_powder": "$4.5M",
    "avg_time_to_first_check_days": 28,
    "conversion_idea_to_funded": 23,
    "active_batch_size": 8,
    "portfolio_companies": 12,
    "decision_gate_pass_rate": 72,
    "avg_time_to_spinout_days": 68,
    "avg_founder_equity_at_spinout": 68,
    "followon_funding_rate": 75,
    "avg_valuation_first_round": "$9.2M",
    "cost_per_spinout": "$185k",
    "deployment_velocity": 35,
}


@router.get("/market-pulse")
def get_market_pulse():
    return {
        "signals": MARKET_PULSE,
        "updated_at": datetime.utcnow().isoformat(),
        "total_sectors": len(MARKET_PULSE),
    }


@router.get("/macro")
def get_macro_data():
    return MACRO_DATA


@router.get("/private-rounds")
def get_private_rounds():
    return {
        "rounds": PRIVATE_ROUNDS,
        "total": len(PRIVATE_ROUNDS),
        "updated_at": datetime.utcnow().isoformat(),
    }


def _money(n: float) -> str:
    if n >= 1_000_000: return f"${n/1_000_000:.1f}M"
    if n >= 1_000:     return f"${n/1_000:.0f}k"
    return f"${n:.0f}"


def _compute_benchmarks(session: Session) -> dict:
    out = dict(STUDIO_BENCHMARKS)
    now = datetime.utcnow()
    six_months_ago = now - timedelta(days=180)

    projects = session.exec(select(Project)).all()
    advanced = [p for p in projects if p.status in ("scoring", "tier_1", "tier_2", "spinout", "active")]
    spinouts = [p for p in projects if p.status in ("spinout", "active", "tier_1", "tier_2")]
    active_batch = [p for p in projects if p.status in ("intake", "scoring")]

    if active_batch: out["active_batch_size"] = len(active_batch)
    if spinouts:     out["portfolio_companies"] = len(spinouts)

    inc_times = [(p.updated_at - p.created_at).days for p in advanced
                 if p.updated_at and p.created_at]
    if inc_times:
        out["avg_time_to_inc_days"] = max(1, round(sum(inc_times) / len(inc_times)))

    funds = session.exec(select(VCFund)).all()
    if funds:
        dry = sum((f.total_commitment or 0) - (f.deployed_capital or 0) for f in funds)
        if dry > 0: out["current_dry_powder"] = _money(dry)

    # --- New: Studio Operations ---
    rev_projects = [p for p in spinouts if (p.revenue or 0) > 0]
    if rev_projects:
        days = [(p.updated_at - p.created_at).days for p in rev_projects]
        out["avg_time_to_first_revenue_days"] = max(1, round(sum(days) / len(days)))
    else:
        out["avg_time_to_first_revenue_days"] = None

    out["avg_founder_equity_at_series_a"] = 62  # studio target — refines once Series A data lands

    burn_pool = [p for p in spinouts if (p.funding_needed or 0) > 0]
    if burn_pool:
        monthly = sum((p.funding_needed or 0) for p in burn_pool) / len(burn_pool) / 12
        out["avg_burn_rate_at_spinout"] = _money(monthly) + "/mo"
    else:
        out["avg_burn_rate_at_spinout"] = None

    old_spinouts = [p for p in spinouts if p.created_at and p.created_at <= six_months_ago]
    if old_spinouts:
        still_active = [p for p in old_spinouts if p.status in ("spinout", "active", "tier_1", "tier_2")]
        out["cohort_survival_rate"] = round(len(still_active) / len(old_spinouts) * 100)
    else:
        out["cohort_survival_rate"] = None

    # --- New: Decision Gate ---
    snapshots = session.exec(select(ScoreSnapshot)).all()
    latest = {}
    for s in snapshots:
        cur = latest.get(s.project_id)
        if not cur or s.created_at > cur.created_at:
            latest[s.project_id] = s
    proj_map = {p.id: p for p in projects}
    high = [s for s in latest.values() if (s.total_score or 0) >= 70]
    if high:
        wins = sum(1 for s in high
                   if proj_map.get(s.project_id)
                   and proj_map[s.project_id].status in ("spinout", "active", "tier_1", "tier_2"))
        out["ai_score_outcome_correlation"] = round(wins / len(high) * 100)
    else:
        out["ai_score_outcome_correlation"] = None

    votes = session.exec(select(PipelineVote)).all()
    if votes:
        deal_ids = {v.deal_id for v in votes}
        out["avg_votes_per_decision_gate"] = round(len(votes) / max(1, len(deal_ids)), 1)
    else:
        out["avg_votes_per_decision_gate"] = None

    deals = session.exec(select(Deal)).all()
    deal_map = {d.id: d for d in deals}
    by_deal = {}
    for v in votes:
        by_deal.setdefault(v.deal_id, []).append(v)
    aligned = total = 0
    for did, vs in by_deal.items():
        d = deal_map.get(did)
        if not d: continue
        buy_w  = sum(v.weight for v in vs if v.vote_type in ("Strong_Buy", "Buy"))
        pass_w = sum(v.weight for v in vs if v.vote_type in ("Pass", "Hold"))
        community_yes = buy_w > pass_w
        deal_yes = (d.status or "").lower() in ("won", "active", "spinout", "approved")
        total += 1
        if community_yes == deal_yes: aligned += 1
    out["community_vote_alignment_rate"] = round(aligned / total * 100) if total else None

    # --- New: Post Spin-Out Performance ---
    spinout_ids = {p.id for p in spinouts}
    calls = session.exec(select(CapitalCall)).all()
    spin_calls = [c for c in calls if c.project_id in spinout_ids and (c.amount or 0) > 0]
    if spin_calls:
        out["avg_followon_round_size"] = _money(sum(c.amount for c in spin_calls) / len(spin_calls))
    elif burn_pool:
        out["avg_followon_round_size"] = _money(sum(p.funding_needed for p in burn_pool) / len(burn_pool))
    else:
        out["avg_followon_round_size"] = None

    out["median_time_to_first_liquidity_days"] = None  # awaiting liquidity_events table

    if funds:
        deployed = sum((f.deployed_capital or 0) for f in funds)
        commitment = sum((f.total_commitment or 0) for f in funds)
        if commitment > 0:
            ratio = deployed / commitment
            out["projected_portfolio_irr"] = round(12 + ratio * 8, 1)  # 12–20% band
        else:
            out["projected_portfolio_irr"] = None
    else:
        out["projected_portfolio_irr"] = None

    lps = session.exec(select(LimitedPartner)).all()
    invested = sum((lp.invested_amount or 0) for lp in lps)
    returns  = sum((lp.returns or 0) for lp in lps)
    if invested > 0 and returns > 0:
        out["lp_return_multiple"] = round(returns / invested, 2)
    elif invested > 0:
        out["lp_return_multiple"] = 1.0  # at-cost, no realized returns yet
    else:
        out["lp_return_multiple"] = None

    out["updated_at"] = now.isoformat()
    return out


@router.get("/studio-benchmarks")
def get_studio_benchmarks(session: Session = Depends(get_session)):
    return _compute_benchmarks(session)


@router.get("/competitive-intelligence")
def get_competitive_intelligence():
    high_conviction = []
    for signal in MARKET_PULSE:
        play_type = None
        reasoning = ""
        if signal["sentiment"] == "Aggressive" and signal["multiple"] > 20:
            play_type = "Efficiency Play"
            reasoning = f"High {signal['multiple']}x multiple + aggressive sentiment = launch at 1/10th cost via studio."
        elif "churn" in signal["technographic_signal"].lower() or "migration" in signal["technographic_signal"].lower():
            play_type = "Replacement Play"
            reasoning = f"Tech churn detected: {signal['technographic_signal']} — automation API wins here."
        elif signal["multiple"] > 15:
            play_type = "Exit Play"
            reasoning = f"Sector multiples at {signal['multiple']}x — favorable exit timing for Series A / M&A."

        if play_type:
            high_conviction.append({
                "sector": signal["sector"],
                "play_type": play_type,
                "reasoning": reasoning,
                "gap_opportunity": signal["gap_opportunity"],
                "multiple": signal["multiple"],
                "sentiment": signal["sentiment"],
            })

    return {
        "high_conviction_plays": high_conviction,
        "studio_benchmarks": STUDIO_BENCHMARKS,
        "market_pulse": MARKET_PULSE,
        "updated_at": datetime.utcnow().isoformat(),
    }


# =============================================================================
# Task #35 — Dev parity for the production Cloudflare Worker Market Intelligence
# surfaces (cloudflare-worker/src/routes/market_intel.ts). These ~16 endpoints
# let every MI tab render in the Replit preview. The dev DB has no aggregator
# pipeline, so responses are deterministic synthetic data shaped EXACTLY like
# the Worker's. Numbers are stable across requests (seeded by sector/period)
# so charts don't flicker. Watchlist + the contribution opt-out persist for
# real via `market_intel_watchlist` and two per-user columns on `users`
# (see ensure_market_intel_tables in migrations.py). Dev demo login = admin =
# full lens, so gated tabs return data rather than 402.
# =============================================================================

MI_SECTORS = [
    "Agentic B2B", "Bio-Automation", "AI Infrastructure", "Fintech / DeFi",
    "Data / Analytics", "Cybersecurity", "Autonomous Robotics", "Climate Intelligence",
    "Quantum Infrastructure", "Enterprise AI", "Vertical SaaS", "DevTools",
]
_DIMENSIONS = ("demand", "supply", "capital", "talent", "research", "sentiment")
K_MIN = 5


def _hash_int(*parts) -> int:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:8], 16)


def _hash_hex(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _rand(lo: float, hi: float, *parts) -> float:
    return lo + (_hash_int(*parts) % 10_000) / 10_000 * (hi - lo)


def _period_key() -> str:
    n = datetime.utcnow()
    return f"{n.year:04d}-{n.month:02d}"


def _recent_periods(n: int) -> list:
    """Most recent `n` monthly period keys, oldest -> newest."""
    now = datetime.utcnow()
    y, m = now.year, now.month
    out = []
    for _ in range(max(1, n)):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(out))


def _sector_dimensions(sector: str) -> dict:
    return {
        d: {"value": round(_rand(35, 92, "dim", sector, d), 1),
            "source_count": int(_rand(5, 18, "sc", sector, d))}
        for d in _DIMENSIONS
    }


def _composite(dims: dict) -> float:
    vals = [dims[d]["value"] for d in _DIMENSIONS]
    return round(sum(vals) / len(vals), 1)


# ── Sector compass / lenses ──────────────────────────────────────────────────
@router.get("/sector-compass")
def mi_sector_compass():
    sectors = []
    for s in MI_SECTORS:
        dims = _sector_dimensions(s)
        sectors.append({"sector": s, "composite": _composite(dims), "dimensions": dims})
    return {
        "period_key": _period_key(),
        "computed_at": datetime.utcnow().isoformat(),
        "sectors": sectors,
        "lens": "full",
    }


@router.get("/founder-lens")
def mi_founder_lens():
    picks = []
    for s in MI_SECTORS:
        dims = _sector_dimensions(s)
        demand, supply = dims["demand"]["value"], dims["supply"]["value"]
        picks.append({
            "sector": s, "composite": _composite(dims),
            "demand": demand, "supply": supply,
            "opportunity_gap": round(demand - supply, 1),
        })
    picks.sort(key=lambda x: x["opportunity_gap"], reverse=True)
    return {"period_key": _period_key(), "picks": picks, "computed_at": datetime.utcnow().isoformat()}


@router.get("/investor-lens")
def mi_investor_lens():
    ranked = []
    for s in MI_SECTORS:
        dims = _sector_dimensions(s)
        capital, sentiment = dims["capital"]["value"], dims["sentiment"]["value"]
        ranked.append({
            "sector": s, "capital": capital, "sentiment": sentiment,
            "composite": _composite(dims),
            "score": round(capital * 0.6 + sentiment * 0.4, 1),
        })
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return {"period_key": _period_key(), "ranked": ranked, "computed_at": datetime.utcnow().isoformat()}


def _geography_payload() -> dict:
    sectors = [{"sector": s, "composite": _composite(_sector_dimensions(s))} for s in MI_SECTORS]
    return {"period_key": _period_key(), "geos": [{"geo": "global", "sectors": sectors}]}


@router.get("/geography")
def mi_geography():
    return _geography_payload()


@router.get("/geography-lens")
def mi_geography_lens():
    return _geography_payload()


# ── Sources + citations ──────────────────────────────────────────────────────
MI_SOURCES = [
    {"key": "crunchbase", "display_name": "Crunchbase", "category": "funding", "cadence": "daily", "dimensions": ["capital", "demand"], "weight": 1.0, "paid": True},
    {"key": "pitchbook", "display_name": "PitchBook", "category": "funding", "cadence": "daily", "dimensions": ["capital"], "weight": 1.0, "paid": True},
    {"key": "github_trending", "display_name": "GitHub Trending", "category": "developer", "cadence": "daily", "dimensions": ["research", "talent"], "weight": 0.7, "paid": False},
    {"key": "hn_frontpage", "display_name": "Hacker News", "category": "community", "cadence": "hourly", "dimensions": ["sentiment", "demand"], "weight": 0.5, "paid": False},
    {"key": "arxiv", "display_name": "arXiv", "category": "research", "cadence": "daily", "dimensions": ["research"], "weight": 0.8, "paid": False},
    {"key": "linkedin_jobs", "display_name": "LinkedIn Jobs", "category": "hiring", "cadence": "weekly", "dimensions": ["talent", "demand"], "weight": 0.6, "paid": True},
    {"key": "g2_reviews", "display_name": "G2 Reviews", "category": "product", "cadence": "weekly", "dimensions": ["supply", "sentiment"], "weight": 0.5, "paid": False},
    {"key": "advisor_network", "display_name": "Axal Advisor Network", "category": "advisor", "cadence": "continuous", "dimensions": ["demand", "supply", "sentiment"], "weight": 1.0, "paid": False},
]
_METRIC_KEYS = ["funding_total", "round_count", "job_openings", "repo_stars", "paper_count", "review_score", "mention_count"]


@router.get("/sources")
def mi_sources():
    # In dev, free sources are "live", paid ones are stubbed (no API keys).
    rows = [{**s, "paid": bool(s["paid"]), "live": not s["paid"]} for s in MI_SOURCES]
    return {"count": len(rows), "sources": rows}


@router.get("/citations")
def mi_citations(sector: str = Query(default=""), limit: int = Query(default=50), since: str = Query(default="")):
    limit = max(1, min(200, limit))
    cutoff = datetime.utcnow() - timedelta(days=30)
    if since:
        try:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            # unparseable `since` query param — keep the default 30-day cutoff
            logger.debug("market_intel: ignoring unparseable 'since' param", exc_info=True)
    secs = ([sector] if sector in MI_SECTORS else []) if sector else MI_SECTORS
    now = datetime.utcnow()
    rows = []
    for s in secs:
        for src in MI_SOURCES:
            mk = _METRIC_KEYS[_hash_int("mk", s, src["key"]) % len(_METRIC_KEYS)]
            ts = now - timedelta(hours=int(_rand(1, 600, "ts", s, src["key"])))
            slug = s.lower().replace(" / ", "-").replace(" ", "-")
            rows.append({
                "source_key": src["key"],
                "sector": s,
                "metric_key": mk,
                "metric_value": round(_rand(1, 9999, "mv", s, src["key"]), 2),
                "ts": ts.isoformat(),
                "ingested_at": (ts + timedelta(minutes=12)).isoformat(),
                "citation_url": f"https://sources.axal.vc/{src['key']}/{slug}",
            })
    rows.sort(key=lambda r: r["ts"], reverse=True)
    return {"rows": rows[:limit], "since": cutoff.isoformat()}


# ── Watchlist (persisted) + digest pause ─────────────────────────────────────
@router.get("/watchlist")
def mi_watchlist_get(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    rows = session.exec(text(
        "SELECT id, sector, geo, cadence, created_at FROM market_intel_watchlist "
        "WHERE user_id = :uid ORDER BY id DESC"
    ).bindparams(uid=user.id)).all()
    out = []
    for r in rows:
        m = r._mapping
        created = m["created_at"]
        out.append({
            "id": m["id"], "sector": m["sector"], "geo": m["geo"], "cadence": m["cadence"],
            "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        })
    pause_row = session.exec(text(
        "SELECT mi_digest_paused_until AS until FROM users WHERE id = :uid"
    ).bindparams(uid=user.id)).first()
    until = pause_row._mapping["until"] if pause_row else None
    now_iso = datetime.utcnow().isoformat()
    is_active = bool(until and str(until) > now_iso)
    indefinite = bool(until and str(until).startswith("9999-"))
    return {
        "rows": out,
        "digest_pause": {"paused_until": until if is_active else None, "indefinite": is_active and indefinite},
    }


@router.post("/watchlist")
def mi_watchlist_add(payload: dict = Body(default={}), user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    sector = str(payload.get("sector") or "").strip()
    if not sector or sector not in MI_SECTORS:
        raise HTTPException(status_code=400, detail="invalid_sector")
    geo = payload.get("geo") or "global"
    cadence = "monthly" if payload.get("cadence") == "monthly" else "weekly"
    session.exec(text(
        "INSERT INTO market_intel_watchlist (user_id, sector, geo, cadence) "
        "VALUES (:uid, :sector, :geo, :cadence) "
        "ON CONFLICT (user_id, sector, geo) DO UPDATE SET cadence = EXCLUDED.cadence"
    ).bindparams(uid=user.id, sector=sector, geo=geo, cadence=cadence))
    session.commit()
    return {"ok": True}


@router.post("/watchlist/pause")
def mi_watchlist_pause(payload: dict = Body(default={}), user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    until = payload.get("until")
    value = None
    if until is not None:
        if until == "indefinite":
            value = "9999-12-31T00:00:00.000Z"
        else:
            try:
                d = datetime.fromisoformat(str(until).replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                raise HTTPException(status_code=400, detail="invalid_until")
            max_d = datetime.utcnow() + timedelta(days=366)
            value = (max_d if d > max_d else d).isoformat()
    session.exec(text(
        "UPDATE users SET mi_digest_paused_until = :v WHERE id = :uid"
    ).bindparams(v=value, uid=user.id))
    session.commit()
    return {"ok": True, "paused_until": value}


@router.delete("/watchlist/{item_id}")
def mi_watchlist_delete(item_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    session.exec(text(
        "DELETE FROM market_intel_watchlist WHERE id = :id AND user_id = :uid"
    ).bindparams(id=item_id, uid=user.id))
    session.commit()
    return {"ok": True}


# ── Contribution opt-out (persisted on users) ────────────────────────────────
@router.get("/contribution-optout")
def mi_contribution_optout_get(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    r = session.exec(text(
        "SELECT mi_contribution_optout AS x FROM users WHERE id = :uid"
    ).bindparams(uid=user.id)).first()
    val = r._mapping["x"] if r else 0
    return {"opted_out": int(val or 0) == 1}


@router.post("/contribution-optout")
def mi_contribution_optout_set(payload: dict = Body(default={}), user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    flag = 1 if payload.get("opt_out") else 0
    session.exec(text(
        "UPDATE users SET mi_contribution_optout = :f WHERE id = :uid"
    ).bindparams(f=flag, uid=user.id))
    session.commit()
    return {
        "ok": True, "opted_out": flag == 1,
        "note": "Existing contributions purged within 6h by the next reducer pass.",
    }


# ── Advisor-derived aggregate surfaces (k>=5) ────────────────────────────────
@router.get("/sentiment")
def mi_sentiment(weeks: int = Query(default=8)):
    periods = _recent_periods(max(1, min(12, weeks)))
    items = []
    for s in MI_SECTORS:
        for pk in periods:
            items.append({
                "sector": s, "period_key": pk,
                "valence": round(_rand(-0.6, 0.8, "val", s, pk), 3),
                "energy": round(_rand(0.2, 0.95, "en", s, pk), 3),
                "n": int(_rand(5, 45, "n", s, pk)),
            })
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


@router.get("/talc")
def mi_talc(months: int = Query(default=6)):
    periods = _recent_periods(max(1, min(12, months)))
    stages = ["discovery", "building", "scaling", "distributing"]
    items = []
    for persona in ("founder", "investor"):
        for s in MI_SECTORS:
            for pk in periods:
                dist = {st: int(_rand(2, 40, "talc", persona, s, pk, st)) for st in stages}
                total = sum(dist.values()) or 1
                mode = max(dist, key=dist.get)
                items.append({
                    "persona": persona, "sector": s, "period_key": pk,
                    "mode": mode, "distribution": dist,
                    "dominance": round(dist[mode] / total, 3), "n": total,
                })
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


_DEMAND_TOPICS = ["GTM strategy", "Pricing", "Fundraising", "Regulatory", "Hiring", "Technical architecture"]
_SUPPLY_TOPICS = ["Engineering", "Design", "Growth marketing", "Legal", "Finance", "Data science"]


@router.get("/demand-supply")
def mi_demand_supply(sector: str = Query(default="")):
    secs = ([sector] if sector in MI_SECTORS else []) if sector else MI_SECTORS
    pk = _period_key()
    items = []
    for s in secs:
        for topic in _DEMAND_TOPICS:
            items.append({"sector": s, "side": "demand", "topic": topic, "period_key": pk,
                          "count": int(_rand(5, 60, "ds", s, "demand", topic)),
                          "n": int(_rand(5, 30, "dsn", s, "demand", topic))})
        for topic in _SUPPLY_TOPICS:
            items.append({"sector": s, "side": "supply", "topic": topic, "period_key": pk,
                          "count": int(_rand(5, 60, "ds", s, "supply", topic)),
                          "n": int(_rand(5, 30, "dsn", s, "supply", topic))})
    items.sort(key=lambda x: x["count"], reverse=True)
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


_SUB_SECTORS = {
    "Agentic B2B": ["Agent orchestration", "Workflow automation"],
    "AI Infrastructure": ["Inference serving", "Vector databases"],
    "Fintech / DeFi": ["Payments", "Lending"],
}


@router.get("/sector-heat")
def mi_sector_heat(weeks: int = Query(default=8)):
    periods = _recent_periods(max(1, min(12, weeks)))
    items = []
    for s in MI_SECTORS:
        for pk in periods:
            items.append({"sector": s, "sub_sector": None, "period_key": pk,
                          "heat": round(_rand(0.5, 5.0, "heat", s, pk), 3),
                          "contributions": int(_rand(5, 40, "hc", s, pk)),
                          "mean_valence": round(_rand(-0.4, 0.7, "hv", s, pk), 3),
                          "n": int(_rand(5, 40, "hn", s, pk))})
        for sub in _SUB_SECTORS.get(s, []):
            for pk in periods:
                items.append({"sector": s, "sub_sector": sub, "period_key": pk,
                              "heat": round(_rand(0.3, 4.0, "heat", s, sub, pk), 3),
                              "contributions": int(_rand(5, 25, "hc", s, sub, pk)),
                              "mean_valence": round(_rand(-0.4, 0.7, "hv", s, sub, pk), 3),
                              "n": int(_rand(5, 25, "hn", s, sub, pk))})
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


_GEOS = ["global", "North America", "Europe", "Asia / Pacific"]


@router.get("/sentiment-geo")
def mi_sentiment_geo(weeks: int = Query(default=4)):
    periods = _recent_periods(max(1, min(8, weeks)))
    items = []
    for geo in _GEOS:
        for s in MI_SECTORS:
            for pk in periods:
                items.append({"geo": geo, "sector": s, "period_key": pk,
                              "valence": round(_rand(-0.5, 0.8, "sg", geo, s, pk), 3),
                              "n": int(_rand(5, 35, "sgn", geo, s, pk))})
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


@router.get("/capital-velocity")
def mi_capital_velocity(months: int = Query(default=6)):
    periods = _recent_periods(max(1, min(12, months)))
    items = []
    for s in MI_SECTORS:
        for pk in periods:
            distributing = _rand(0.1, 0.5, "cv_d", s, pk)
            scaling = _rand(0.2, 0.5, "cv_s", s, pk)
            items.append({"sector": s, "period_key": pk,
                          "velocity": round(distributing + 0.5 * scaling, 3),
                          "distributing_share": round(distributing, 3),
                          "scaling_share": round(scaling, 3),
                          "n": int(_rand(5, 30, "cvn", s, pk))})
    return {"items": items, "k_min": K_MIN, "source": "advisor"}


@router.get("/partner-pulse")
def mi_partner_pulse():
    pk = _period_key()
    items = []
    for s in MI_SECTORS:
        for topic in _SUPPLY_TOPICS:
            items.append({"sector": s, "topic": topic, "period_key": pk,
                          "supply_count": int(_rand(5, 50, "pp", s, topic)),
                          "n": int(_rand(5, 30, "ppn", s, topic))})
    items.sort(key=lambda x: x["supply_count"], reverse=True)
    rate_cards = []
    for s in MI_SECTORS:
        for topic in _SUPPLY_TOPICS[:3]:
            median = _rand(80, 320, "rc", s, topic)
            rate_cards.append({"sector": s, "topic": topic, "period_key": pk,
                               "median_hourly": round(median),
                               "p25_hourly": round(median * 0.75),
                               "p75_hourly": round(median * 1.3),
                               "median_project": round(median * 90),
                               "n": int(_rand(5, 20, "rcn", s, topic))})
    comp_models = []
    for s in MI_SECTORS:
        dist = {
            "hourly": int(_rand(5, 40, "cm_h", s)),
            "retainer": int(_rand(5, 30, "cm_r", s)),
            "equity": int(_rand(2, 20, "cm_e", s)),
            "project": int(_rand(5, 35, "cm_p", s)),
        }
        comp_models.append({"sector": s, "period_key": pk, "distribution": dist, "n": sum(dist.values())})
    return {"items": items, "rate_cards": rate_cards, "comp_models": comp_models, "k_min": K_MIN, "source": "advisor"}


# ── Founder/investor fit (counter-party ids hashed until NDA) ─────────────────
@router.get("/fit/founder/{project_id}")
def mi_fit_founder(project_id: int, user: User = Depends(get_current_user)):
    matches = [{
        "score": round(_rand(0.55, 0.97, "fitf", project_id, i), 3),
        "investor_user_id": None,
        "investor_id_hash": _hash_hex("inv", project_id, i),
        "nda_required": True,
    } for i in range(6)]
    matches.sort(key=lambda m: m["score"], reverse=True)
    return {"matches": matches, "k_min": K_MIN, "source": "advisor"}


@router.get("/fit/investor/me")
def mi_fit_investor(user: User = Depends(get_current_user)):
    matches = [{
        "score": round(_rand(0.55, 0.97, "fiti", user.id, i), 3),
        "founder_user_id": None,
        "founder_id_hash": _hash_hex("fnd", user.id, i),
        "nda_required": True,
    } for i in range(6)]
    matches.sort(key=lambda m: m["score"], reverse=True)
    return {"matches": matches, "k_min": K_MIN, "source": "advisor"}


# ── Platform personas (8 charts) ─────────────────────────────────────────────
@router.get("/platform-personas")
def mi_platform_personas():
    roles = ["founder", "investor", "partner", "mentor"]
    role_labels = {"founder": "Founders", "investor": "Investors", "partner": "Partners", "mentor": "Mentors"}
    stages = ["Idea", "Pre-seed", "Seed", "Series A", "Growth"]

    role_buckets = [{"group": "role", "label": role_labels[r], "n": int(_rand(8, 120, "pd_role", r))} for r in roles]
    stage_buckets = [{"group": "stage", "label": st, "n": int(_rand(5, 60, "pd_stage", st))} for st in stages]

    cells = [{"sector": s, "persona": p, "n": int(_rand(K_MIN, 40, "heat", s, p))}
             for s in MI_SECTORS for p in ("founder", "investor")]

    stage_rows = [{"stage": st, "role": r, "n": int(_rand(K_MIN, 35, "sf", st, r))}
                  for st in stages for r in ("founder", "investor")]

    countries = ["United States", "United Kingdom", "Germany", "India", "Singapore", "Canada", "France", "Brazil"]
    geo_rows = [{"country": c, "n": int(_rand(K_MIN, 80, "geo", c))} for c in countries]

    activity_rows = [{"role": r, "active_users": int(_rand(10, 200, "act", r)),
                      "events_per_user": round(_rand(3, 40, "epu", r), 1)} for r in roles]
    feature_actions = {"founder": "Submitted scoring run", "investor": "Viewed deal room",
                       "partner": "Updated service listing", "mentor": "Booked office hours"}
    top_features = [{"role": r, "action": feature_actions[r]} for r in roles]

    funnel_rows = [{"week": w + 1, "n": int(_rand(5, 60, "funnel", w))} for w in range(6)]

    signup_rows = [{"week": f"W{w + 1}", "role": r, "n": int(_rand(K_MIN, 25, "su", w, r))}
                   for w in range(8) for r in ("founder", "investor", "partner")]

    tiers = ["Free", "Growth", "Investor Pro", "Studio"]
    pipeline_rows = [{"tier_bucket": t, "n": int(_rand(5, 70, "pc", t)),
                      "weighted_coverage": round(_rand(0.2, 0.95, "pcw", t), 2)} for t in tiers]

    return {
        "tier": "full",
        "k_min": K_MIN,
        "generated_at": datetime.utcnow().isoformat(),
        "role_donut": {"buckets": role_buckets + stage_buckets},
        "sector_heatmap": {"cells": cells},
        "stage_focus": {"rows": stage_rows},
        "geo_distribution": {"rows": geo_rows},
        "activity_composite": {"rows": activity_rows, "top_features": top_features},
        "spinout_lab_funnel": {"rows": funnel_rows, "completion_rate": int(_rand(20, 60, "cr")), "started_band": "40–60"},
        "signups_trend": {"rows": signup_rows},
        "pipeline_coverage": {"rows": pipeline_rows},
    }
