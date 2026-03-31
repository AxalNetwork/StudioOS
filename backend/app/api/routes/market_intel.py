from fastapi import APIRouter
from datetime import datetime

router = APIRouter(prefix="/market-intel", tags=["Market Intelligence"])

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
]

MACRO_DATA = {
    "sectors": [
        {"name": "AI / ML", "avg_pe": 45.2, "yoy_growth": 34.5, "ipo_window": "Open", "trend": "up"},
        {"name": "SaaS", "avg_pe": 32.1, "yoy_growth": 18.2, "ipo_window": "Selective", "trend": "stable"},
        {"name": "Fintech", "avg_pe": 28.7, "yoy_growth": 12.4, "ipo_window": "Cautious", "trend": "stable"},
        {"name": "Blockchain", "avg_pe": 38.5, "yoy_growth": 28.1, "ipo_window": "Opening", "trend": "up"},
        {"name": "Biotech", "avg_pe": 22.3, "yoy_growth": 8.6, "ipo_window": "Selective", "trend": "down"},
        {"name": "Climate Tech", "avg_pe": 30.4, "yoy_growth": 22.3, "ipo_window": "Open", "trend": "up"},
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


@router.get("/studio-benchmarks")
def get_studio_benchmarks():
    return STUDIO_BENCHMARKS


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
