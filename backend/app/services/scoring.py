from typing import Optional


def score_market(tam: float, urgency: float, trend: float) -> dict:
    size_score = 0
    if tam >= 1_000_000_000:
        size_score = 10
    elif tam >= 500_000_000:
        size_score = 8
    elif tam >= 100_000_000:
        size_score = 7
    elif tam >= 50_000_000:
        size_score = 5
    else:
        size_score = 3

    urgency_score = min(max(urgency, 0), 10)
    trend_score = min(max(trend, 0), 5)
    total = min(size_score + urgency_score + trend_score, 25)

    return {
        "size": round(size_score, 1),
        "urgency": round(urgency_score, 1),
        "trend": round(trend_score, 1),
        "total": round(total, 1),
    }


def score_team(expertise: float, execution: float, network: float) -> dict:
    expertise_score = min(max(expertise, 0), 8)
    execution_score = min(max(execution, 0), 8)
    network_score = min(max(network, 0), 4)
    total = min(expertise_score + execution_score + network_score, 20)

    return {
        "expertise": round(expertise_score, 1),
        "execution": round(execution_score, 1),
        "network": round(network_score, 1),
        "total": round(total, 1),
    }


def score_product(mvp_time_days: float, complexity: float, dependencies: float) -> dict:
    mvp_score = 0
    if mvp_time_days <= 14:
        mvp_score = 7
    elif mvp_time_days <= 30:
        mvp_score = 6
    elif mvp_time_days <= 60:
        mvp_score = 4
    elif mvp_time_days <= 90:
        mvp_score = 2
    else:
        mvp_score = 1

    complexity_score = min(max(5 - complexity, 0), 5)
    dependency_score = min(max(3 - dependencies, 0), 3)
    total = min(mvp_score + complexity_score + dependency_score, 15)

    return {
        "mvp_time": round(mvp_score, 1),
        "complexity": round(complexity_score, 1),
        "dependency": round(dependency_score, 1),
        "total": round(total, 1),
    }


def score_capital(cost_to_mvp: float, time_to_revenue_months: float, burn_risk: float) -> dict:
    cost_score = 0
    if cost_to_mvp < 25_000:
        cost_score = 7
    elif cost_to_mvp < 50_000:
        cost_score = 6
    elif cost_to_mvp < 100_000:
        cost_score = 5
    elif cost_to_mvp < 200_000:
        cost_score = 3
    else:
        cost_score = 1

    revenue_score = 0
    if time_to_revenue_months <= 3:
        revenue_score = 5
    elif time_to_revenue_months <= 6:
        revenue_score = 4
    elif time_to_revenue_months <= 12:
        revenue_score = 3
    elif time_to_revenue_months <= 18:
        revenue_score = 1
    else:
        revenue_score = 0

    burn_score = min(max(3 - burn_risk, 0), 3)
    total = min(cost_score + revenue_score + burn_score, 15)

    return {
        "cost_mvp": round(cost_score, 1),
        "time_revenue": round(revenue_score, 1),
        "burn_traction": round(burn_score, 1),
        "total": round(total, 1),
    }


def score_fit(alignment: float, synergy: float) -> dict:
    alignment_score = min(max(alignment, 0), 10)
    synergy_score = min(max(synergy, 0), 5)
    total = min(alignment_score + synergy_score, 15)

    return {
        "alignment": round(alignment_score, 1),
        "synergy": round(synergy_score, 1),
        "total": round(total, 1),
    }


def score_distribution(channels: float, virality: float) -> dict:
    channels_score = min(max(channels, 0), 5)
    virality_score = min(max(virality, 0), 5)
    total = min(channels_score + virality_score, 10)

    return {
        "channels": round(channels_score, 1),
        "virality": round(virality_score, 1),
        "total": round(total, 1),
    }


def classify_tier(score: float) -> str:
    if score >= 85:
        return "TIER_1"
    elif score >= 70:
        return "TIER_2"
    return "REJECT"


def tier_label(tier: str) -> str:
    labels = {
        "TIER_1": "Tier 1 — Immediate Spinout",
        "TIER_2": "Tier 2 — Conditional / Refine in Week 1",
        "REJECT": "Reject — Incubate Later",
    }
    return labels.get(tier, tier)


# ---------------------------------------------------------------------------
# v2 — "The Brain" 100-pt scoring (Market 25 / Team 20 / Product 20 /
# Traction 15 / Capital 10 / Fit & Moat 10) + AI bonus layer (+/- 10).
#
# Each sub-input is 0..10 (slider scale). Weights map the slider score onto
# the category's max points. Keeping the public surface deterministic so the
# frontend can mirror the math for the live total.
# ---------------------------------------------------------------------------
SCORING_V2_WEIGHTS = {
    "market": {
        "max": 25,
        "factors": {
            "tam": {"max": 10, "label": "Market size (TAM)"},
            "growth": {"max": 8,  "label": "Growth & timing"},
            "urgency": {"max": 7, "label": "Pain / urgency"},
        },
    },
    "team": {
        "max": 20,
        "factors": {
            "expertise": {"max": 8, "label": "Domain expertise"},
            "execution": {"max": 7, "label": "Execution speed"},
            "network":   {"max": 5, "label": "Network leverage"},
        },
    },
    "product": {
        "max": 20,
        "factors": {
            "differentiation": {"max": 8, "label": "Differentiation / IP"},
            "feasibility":     {"max": 7, "label": "Technical feasibility"},
            "scalability":     {"max": 5, "label": "Scalability"},
        },
    },
    "traction": {
        "max": 15,
        "factors": {
            "users":    {"max": 6, "label": "User adoption"},
            "revenue":  {"max": 6, "label": "Revenue / pipeline"},
            "signals":  {"max": 3, "label": "Validation signals"},
        },
    },
    "capital": {
        "max": 10,
        "factors": {
            "burn_efficiency": {"max": 5, "label": "Burn efficiency"},
            "runway":          {"max": 5, "label": "Runway / unit econ."},
        },
    },
    "fit": {
        "max": 10,
        "factors": {
            "alignment": {"max": 5, "label": "Strategic alignment"},
            "moat":      {"max": 5, "label": "Defensibility / moat"},
        },
    },
}


def _weighted_factor(slider_value: float, factor_max: int) -> float:
    """Convert a 0..10 slider into 0..factor_max points."""
    v = max(0.0, min(10.0, float(slider_value or 0)))
    return round((v / 10.0) * factor_max, 2)


def _score_category(values: dict, category_key: str) -> dict:
    spec = SCORING_V2_WEIGHTS[category_key]
    breakdown = {}
    total = 0.0
    for factor_key, factor_spec in spec["factors"].items():
        raw = values.get(factor_key, 0)
        pts = _weighted_factor(raw, factor_spec["max"])
        breakdown[factor_key] = {
            "raw": round(float(raw or 0), 2),
            "points": pts,
            "max": factor_spec["max"],
            "label": factor_spec["label"],
        }
        total += pts
    total = round(min(total, spec["max"]), 2)
    return {"total": total, "max": spec["max"], "factors": breakdown}


def _recommendation(score: float) -> str:
    if score >= 85:
        return "Strong"
    if score >= 70:
        return "Promising"
    if score >= 55:
        return "Needs Work"
    return "High Risk"


def run_brain_score(payload: dict) -> dict:
    """
    Run the v2 100-pt scoring engine. `payload` must include nested category
    dicts (market/team/product/traction/capital/fit), each holding 0..10
    slider values for the factors defined in SCORING_V2_WEIGHTS, plus an
    optional `ai_adjustment` in -10..+10.
    """
    categories = {}
    raw_total = 0.0
    for key, spec in SCORING_V2_WEIGHTS.items():
        cat_values = payload.get(key, {}) or {}
        cat = _score_category(cat_values, key)
        categories[key] = cat
        raw_total += cat["total"]

    raw_total = round(raw_total, 2)
    ai_adjustment = max(-10.0, min(10.0, float(payload.get("ai_adjustment", 0) or 0)))
    final_total = round(max(0.0, min(100.0, raw_total + ai_adjustment)), 2)

    return {
        "total_score": final_total,
        "raw_score": raw_total,
        "ai_adjustment": ai_adjustment,
        "max_possible": 100,
        "recommendation": _recommendation(final_total),
        "tier": classify_tier(final_total),
        "tier_label": tier_label(classify_tier(final_total)),
        "category_breakdown": categories,
    }


def run_full_score(data: dict) -> dict:
    market = score_market(
        tam=data.get("tam", 0),
        urgency=data.get("market_urgency", 0),
        trend=data.get("market_trend", 0),
    )
    team = score_team(
        expertise=data.get("team_expertise", 0),
        execution=data.get("team_execution", 0),
        network=data.get("team_network", 0),
    )
    product = score_product(
        mvp_time_days=data.get("mvp_time_days", 90),
        complexity=data.get("product_complexity", 3),
        dependencies=data.get("product_dependencies", 2),
    )
    capital = score_capital(
        cost_to_mvp=data.get("cost_to_mvp", 100000),
        time_to_revenue_months=data.get("time_to_revenue_months", 12),
        burn_risk=data.get("burn_risk", 2),
    )
    fit = score_fit(
        alignment=data.get("fit_alignment", 0),
        synergy=data.get("fit_synergy", 0),
    )
    distribution = score_distribution(
        channels=data.get("distribution_channels", 0),
        virality=data.get("distribution_virality", 0),
    )

    total = (
        market["total"]
        + team["total"]
        + product["total"]
        + capital["total"]
        + fit["total"]
        + distribution["total"]
    )

    ai_adjustment = data.get("ai_adjustment", 0)
    total = min(max(total + ai_adjustment, 0), 100)
    tier = classify_tier(total)

    return {
        "total_score": round(total, 1),
        "tier": tier,
        "tier_label": tier_label(tier),
        "breakdown": {
            "market": market,
            "team": team,
            "product": product,
            "capital": capital,
            "fit": fit,
            "distribution": distribution,
        },
        "ai_adjustment": ai_adjustment,
        "max_possible": 100,
    }
