from fastapi import APIRouter, Depends
from datetime import datetime, timedelta
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
