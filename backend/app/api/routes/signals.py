"""Signals — FastAPI DEV-PARITY router for /api/signals.

Why this file exists: the standalone /signals page calls the /api/signals
endpoints. Production serves them from the Cloudflare Worker
(cloudflare-worker/src/routes/signals.ts — the canonical implementation);
the Replit dev backend never registered a matching router, so in dev the
page died on its very first request with 404 Not Found. This router closes
that gap with the SAME response shapes.

What this deliberately is NOT: an ingestion engine. The Worker's live
pipeline (services/signals/ingest.ts) fetches real evidence from free public
APIs and persists it in D1. Re-implementing that in Python would be a second
pipeline to keep honest, and the dev backend is Replit-only, never deployed
(CLAUDE.md fact #3). Instead this router serves a compact, clearly-labeled
example corpus:

  * every response carries ``data_state: "illustrative"``, the same flag the
    Worker uses before its first ingestion, and the UI renders the same
    "Illustrative examples" banner for it;
  * timestamps are FIXED — they age, they are never recomputed to look fresh;
  * ``last_refreshed_at`` is null — a refresh that never ran does not report
    a refresh time.

Endpoints (mirroring the Worker, static paths before /{signal_id}):
  GET  /api/signals            → {signals, total, cached, mode, data_state}
  GET  /api/signals/filters    → {facets, vocab}
  GET  /api/signals/kpis       → KPI strip payload
  GET  /api/signals/sources    → {sources, health}
  GET  /api/signals/meta       → type catalog + rank-weight explanation
  GET  /api/signals/{id}       → {signal, companies, sources}
  POST /api/signals/refresh    → admin-only; explains that dev has no pipeline
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.routes.auth import get_current_user
from backend.app.models.entities import User

router = APIRouter()

# ---------------------------------------------------------------------------
# Controlled vocabularies — mirrored from the Worker's types.ts. If you add a
# value there, add it here; the drift is cosmetic (dev-only) but confusing.
# ---------------------------------------------------------------------------

SIGNAL_TYPES = [
    {"value": "emerging_niche_demand", "label": "Emerging niche demand"},
    {"value": "geographic_expansion", "label": "Geographic expansion opportunity"},
    {"value": "underserved_segment", "label": "Underserved customer segment"},
    {"value": "regulatory_pressure", "label": "Regulation / compliance pressure"},
    {"value": "workflow_digitization", "label": "Workflow digitization opportunity"},
    {"value": "midcap_momentum", "label": "Mid-cap momentum in a sector"},
    {"value": "vertical_software", "label": "Vertical-specific software opportunity"},
    {"value": "category_creation", "label": "New category creation / fragmentation"},
    {"value": "consolidation_signal", "label": "Repeated acquisition / consolidation"},
]
MARKET_CAP_BANDS = ["nano", "micro", "small", "mid", "large", "mega"]
EMPLOYEE_BANDS = ["1-50", "51-200", "201-1k", "1k-5k", "5k-20k", "20k+"]
MATURITY_STAGES = ["emerging", "scaling", "established", "incumbent"]
CUSTOMER_TYPES = [
    "consumer", "smb", "mid_market", "enterprise",
    "financial_institution", "healthcare_provider", "government",
]
REGIONS = [
    "North America", "Latin America", "Europe", "MENA", "Sub-Saharan Africa",
    "South Asia", "Southeast Asia", "East Asia", "Oceania",
]
EVIDENCE_KINDS = [
    "fundamentals", "market_data", "news", "filing", "registry",
    "earnings", "hiring", "discussion", "developer",
]

SOURCES = [
    {"key": "sec_edgar", "name": "SEC EDGAR (full-text filings)", "kind": "filing",
     "tier": "free", "quality_weight": 0.95, "freshness_halflife_days": 120,
     "homepage": "https://www.sec.gov/edgar", "enabled": True,
     "notes": "Primary-source filing language. The Worker fetches this live; dev serves examples."},
    {"key": "federal_register", "name": "Federal Register (US rulemaking)", "kind": "filing",
     "tier": "free", "quality_weight": 0.9, "freshness_halflife_days": 120,
     "homepage": "https://www.federalregister.gov/developers/documentation/api/v1", "enabled": True,
     "notes": "Official US rulemaking documents via the free, keyless API."},
    {"key": "news_rss", "name": "News & sentiment (RSS aggregate)", "kind": "news",
     "tier": "free", "quality_weight": 0.5, "freshness_halflife_days": 14,
     "homepage": "https://news.google.com", "enabled": True,
     "notes": "Low weight so noisy headlines cannot dominate ranking."},
    {"key": "hn_discussion", "name": "Hacker News discussion", "kind": "discussion",
     "tier": "free", "quality_weight": 0.5, "freshness_halflife_days": 14,
     "homepage": "https://hn.algolia.com/api", "enabled": True,
     "notes": "Practitioner threads via the keyless Algolia HN Search API."},
    {"key": "stackexchange_questions", "name": "Stack Exchange question activity", "kind": "discussion",
     "tier": "free", "quality_weight": 0.55, "freshness_halflife_days": 30,
     "homepage": "https://api.stackexchange.com/docs", "enabled": True,
     "notes": "Question volume + accepted-answer gaps, keyless quota."},
    {"key": "github_activity", "name": "GitHub repository activity", "kind": "developer",
     "tier": "free", "quality_weight": 0.6, "freshness_halflife_days": 45,
     "homepage": "https://docs.github.com/en/rest/search", "enabled": True,
     "notes": "Ranked by recent pushes, never stars."},
    {"key": "hiring_signal", "name": "Public hiring / job-posting velocity", "kind": "hiring",
     "tier": "free", "quality_weight": 0.45, "freshness_halflife_days": 21,
     "homepage": "https://news.ycombinator.com/submitted?id=whoishiring", "enabled": True,
     "notes": "Hiring mentions in HN 'Who is hiring?' threads."},
]

# ---------------------------------------------------------------------------
# Example corpus. FIXED timestamps (they age honestly). Four theses chosen to
# exercise every UI surface: multiple regions, sectors, cap bands, customer
# types and all the evidence-kind chips.
# ---------------------------------------------------------------------------

_ANCHOR = "2026-08-01"


def _ev(kind: str, title: str, source_key: str, day: str, url: str = "",
        detail: str = "", weight: float = 0.5) -> Dict[str, Any]:
    return {
        "id": f"dev-{abs(hash((kind, title))) % 10**8}",
        "kind": kind, "title": title, "detail": detail or None,
        "source_key": source_key, "url": url or None,
        "weight": weight, "observed_at": f"{day}T00:00:00Z",
    }


DEV_SIGNALS: List[Dict[str, Any]] = [
    {
        "id": "dev-compliance-evidence",
        "type": "regulatory_pressure",
        "title": "Compliance evidence collection is landing on engineering teams",
        "thesis": "Audit and attestation work that used to sit with a compliance function is increasingly assigned to engineering, without tooling designed for it.",
        "why_now": "New reporting obligations name technical deliverables, and job specs have started listing evidence collection as an engineering responsibility.",
        "region": "North America", "country": "United States",
        "sector": "Technology", "industry": "Cybersecurity",
        "niche": "compliance evidence automation",
        "market_cap_band": "mid", "target_customers": ["enterprise", "mid_market"],
        "maturity_stage": "scaling", "related_companies": [],
        "evidence_items": [
            _ev("filing", "Example: rule text specifying machine-readable evidence and retention periods", "federal_register", "2026-07-28", weight=0.9),
            _ev("hiring", "Example: platform-engineering postings listing audit-evidence duties", "hiring_signal", "2026-07-25", weight=0.45),
            _ev("discussion", "Example: recurring practitioner threads on manual evidence gathering", "hn_discussion", "2026-07-30", weight=0.5),
            _ev("developer", "Example: rising activity on evidence-collection tooling repositories", "github_activity", "2026-07-20", weight=0.6),
        ],
        "founder_opportunity": "A narrow tool that turns what systems already emit into audit-ready artefacts — one framework, one stack — is enough to test this.",
        "advisor_note": "Regulatory-driven demand is budgeted demand. Watch for incumbent GRC vendors absorbing the need.",
        "build": {
            "headline": "Audit-evidence automation for platform teams",
            "wedge": "Automated evidence capture for one compliance framework",
            "icp": "Platform engineering lead at a 50–500 person company newly in scope",
            "gtm": "Bottom-up via the engineers who currently do this manually",
            "moat": "Evidence-graph coverage compounds per integration",
            "risks": "First-audit-cycle urgency can fade; incumbents ship adjacent features",
        },
        "market": {"growth_direction": "accelerating", "cap_band_spread": ["small", "mid"]},
        "confidence_score": 68, "freshness_score": 74,
        "source_attribution": ["federal_register", "hiring_signal", "hn_discussion", "github_activity"],
        "tags": ["compliance", "audit", "devtools"],
        "updated_at": f"{_ANCHOR}T00:00:00Z",
    },
    {
        "id": "dev-smb-credit",
        "type": "underserved_segment",
        "title": "SMB credit infrastructure in Latin America remains under-tooled",
        "thesis": "Digital banks proved LATAM SMB demand, but the credit-decisioning infrastructure underneath remains concentrated and legacy.",
        "why_now": "Public digital banks are re-accelerating SMB lending while SMBs still cite credit access as their top growth blocker.",
        "region": "Latin America", "country": "Brazil",
        "sector": "Financial Services", "industry": "Digital Banking",
        "niche": "SMB credit infrastructure",
        "market_cap_band": "large", "target_customers": ["smb", "financial_institution"],
        "maturity_stage": "scaling", "related_companies": [],
        "evidence_items": [
            _ev("filing", "Example: annual-report language on expanding SMB lending", "sec_edgar", "2026-06-20", weight=0.95),
            _ev("news", "Example: coverage of SMB credit access as a growth blocker", "news_rss", "2026-07-26", weight=0.5),
            _ev("hiring", "Example: risk & credit-model engineering roles at LATAM fintechs", "hiring_signal", "2026-07-22", weight=0.45),
        ],
        "founder_opportunity": "Credit-decisioning APIs for the banks and fintechs that cannot build in-house risk teams.",
        "advisor_note": "Strong filing-level corroboration; the wedge question is distribution, not demand.",
        "build": {
            "headline": "Credit-decisioning API for LATAM SMB lenders",
            "wedge": "Bureau-plus-open-finance underwriting for one lending vertical",
            "icp": "Head of credit at a mid-size Brazilian fintech",
            "gtm": "Land with one anchor lender; expand across products",
            "moat": "Repayment-outcome data network effects",
            "risks": "Incumbent bureaus moving down-market; rate environment",
        },
        "market": {"growth_direction": "steady", "cap_band_spread": ["mid", "large"]},
        "confidence_score": 61, "freshness_score": 58,
        "source_attribution": ["sec_edgar", "news_rss", "hiring_signal"],
        "tags": ["fintech", "credit", "latam"],
        "updated_at": f"{_ANCHOR}T00:00:00Z",
    },
    {
        "id": "dev-field-construction",
        "type": "vertical_software",
        "title": "Specialty-contractor field workflows are the next construction-software frontier",
        "thesis": "General-contractor platforms are saturating; the specialty trades running paper-and-phone field workflows are not.",
        "why_now": "Public construction-software vendors describe TAM expansion into specialty contractors while field-role hiring rises.",
        "region": "North America", "country": "United States",
        "sector": "Technology", "industry": "Construction Software",
        "niche": "specialty contractor field software",
        "market_cap_band": "mid", "target_customers": ["smb", "mid_market"],
        "maturity_stage": "established", "related_companies": [],
        "evidence_items": [
            _ev("filing", "Example: 10-K language on specialty-contractor TAM expansion", "sec_edgar", "2026-05-15", weight=0.95),
            _ev("hiring", "Example: field/mobile product roles in construction tech", "hiring_signal", "2026-07-18", weight=0.45),
            _ev("discussion", "Example: threads from trade contractors on scheduling pain", "hn_discussion", "2026-07-24", weight=0.5),
        ],
        "founder_opportunity": "Pick one trade (electrical, HVAC, roofing) and own its field workflow end-to-end.",
        "advisor_note": "Vertical depth beats horizontal breadth here; incumbents validated the spend.",
        "build": {
            "headline": "Field operations software for one specialty trade",
            "wedge": "Crew scheduling + materials tracking for a single trade",
            "icp": "Operations manager at a 20–200 person specialty contractor",
            "gtm": "Trade associations + supplier partnerships",
            "moat": "Trade-specific workflow depth incumbents will not rebuild",
            "risks": "GC platforms bundling down-market",
        },
        "market": {"growth_direction": "steady", "cap_band_spread": ["mid"]},
        "confidence_score": 55, "freshness_score": 49,
        "source_attribution": ["sec_edgar", "hiring_signal", "hn_discussion"],
        "tags": ["construction", "vertical-saas", "field-ops"],
        "updated_at": f"{_ANCHOR}T00:00:00Z",
    },
    {
        "id": "dev-cross-border-payroll",
        "type": "workflow_digitization",
        "title": "Cross-border contractor payroll is still stitched together by hand",
        "thesis": "Distributed teams normalised international contractors faster than the payout, tax-form and compliance workflow digitised.",
        "why_now": "Cross-border payment volume keeps growing while finance teams describe multi-tool manual reconciliation.",
        "region": "Europe", "country": "United Kingdom",
        "sector": "Financial Services", "industry": "Cross-border Payments",
        "niche": "contractor payroll compliance",
        "market_cap_band": "large", "target_customers": ["smb", "mid_market"],
        "maturity_stage": "scaling", "related_companies": [],
        "evidence_items": [
            _ev("news", "Example: coverage of contractor-payroll compliance complexity", "news_rss", "2026-07-27", weight=0.5),
            _ev("discussion", "Example: finance-ops threads on manual reconciliation", "stackexchange_questions", "2026-07-21", weight=0.55),
            _ev("hiring", "Example: payroll-operations roles at distributed-first companies", "hiring_signal", "2026-07-19", weight=0.45),
            _ev("developer", "Example: glue-script repositories for payout batching", "github_activity", "2026-07-10", weight=0.6),
        ],
        "founder_opportunity": "The reconciliation layer between payout rails and books — not another payout rail.",
        "advisor_note": "Crowded at the rail layer; the workflow/compliance layer above it is where the gap shows.",
        "build": {
            "headline": "Contractor payroll compliance for distributed teams",
            "wedge": "Tax-form + payout reconciliation for one corridor",
            "icp": "Finance lead at a 30–300 person distributed company",
            "gtm": "Accountant channel + payroll-community content",
            "moat": "Per-jurisdiction compliance logic compounds",
            "risks": "EOR platforms bundling; rail providers moving up-stack",
        },
        "market": {"growth_direction": "accelerating", "cap_band_spread": ["large"]},
        "confidence_score": 52, "freshness_score": 61,
        "source_attribution": ["news_rss", "stackexchange_questions", "hiring_signal", "github_activity"],
        "tags": ["payroll", "compliance", "remote-work"],
        "updated_at": f"{_ANCHOR}T00:00:00Z",
    },
]

_RANK_WEIGHTS = {
    "freshness": 0.16, "agreement": 0.16, "evidence_volume": 0.14,
    "customer_pain": 0.13, "practicality": 0.13, "cap_diversity": 0.12,
    "sector_repetition": 0.08, "geo_concentration": 0.08,
}


def _is_admin(user: User) -> bool:
    return str(getattr(user, "role", "") or "").lower() == "admin"


def _ranked(mode: str) -> List[Dict[str, Any]]:
    """Deterministic dev ranking: confidence for advisor, confidence+freshness
    for founder — a simplification of the Worker's eight-factor blend, which
    stays canonical."""
    rows = []
    for s in DEV_SIGNALS:
        r = dict(s)
        r["rank_score"] = (
            s["confidence_score"] if mode == "advisor"
            else round(0.6 * s["confidence_score"] + 0.4 * s["freshness_score"])
        )
        r["rank_breakdown"] = {k: round(v * 100) for k, v in _RANK_WEIGHTS.items()}
        rows.append(r)
    rows.sort(key=lambda r: -r["rank_score"])
    return rows


def _matches(s: Dict[str, Any], key: str, value: Optional[str]) -> bool:
    if not value:
        return True
    if key == "customer_type":
        return value.lower() in [c.lower() for c in s.get("target_customers", [])]
    if key == "q":
        hay = " ".join([
            s.get("title", ""), s.get("thesis", ""), s.get("niche", ""),
            s.get("sector", ""), s.get("industry") or "", " ".join(s.get("tags", [])),
        ]).lower()
        return value.lower() in hay
    if key == "niche":
        return value.lower() in str(s.get("niche", "")).lower()
    return str(s.get(key, "")).lower() == value.lower()


@router.get("/signals")
def list_signals(
    region: Optional[str] = None, country: Optional[str] = None,
    sector: Optional[str] = None, industry: Optional[str] = None,
    niche: Optional[str] = None, market_cap_band: Optional[str] = None,
    employee_band: Optional[str] = None, customer_type: Optional[str] = None,
    maturity_stage: Optional[str] = None, type: Optional[str] = None,
    q: Optional[str] = None, mode: str = "founder", limit: int = 50,
    user: User = Depends(get_current_user),
):
    _ = user
    mode = "advisor" if mode == "advisor" else "founder"
    rows = _ranked(mode)
    for key, value in [
        ("region", region), ("country", country), ("sector", sector),
        ("industry", industry), ("niche", niche), ("market_cap_band", market_cap_band),
        ("maturity_stage", maturity_stage), ("type", type),
        ("customer_type", customer_type), ("q", q),
    ]:
        rows = [s for s in rows if _matches(s, key, value)]
    _ = employee_band  # dev corpus carries no per-company employee bands
    limit = max(1, min(200, int(limit or 50)))
    return {
        "signals": rows[:limit],
        "total": len(rows),
        "cached": False,
        "mode": mode,
        "data_state": "illustrative",
    }


@router.get("/signals/filters")
def signal_filters(user: User = Depends(get_current_user)):
    _ = user
    facets: Dict[str, List[str]] = {
        "region": sorted({s["region"] for s in DEV_SIGNALS}),
        "country": sorted({s["country"] for s in DEV_SIGNALS}),
        "sector": sorted({s["sector"] for s in DEV_SIGNALS}),
        "industry": sorted({s["industry"] for s in DEV_SIGNALS if s.get("industry")}),
        "niche": sorted({s["niche"] for s in DEV_SIGNALS}),
        "market_cap_band": sorted({s["market_cap_band"] for s in DEV_SIGNALS}),
        "employee_band": [],
        "customer_type": sorted({c for s in DEV_SIGNALS for c in s["target_customers"]}),
        "maturity_stage": sorted({s["maturity_stage"] for s in DEV_SIGNALS if s.get("maturity_stage")}),
        "type": sorted({s["type"] for s in DEV_SIGNALS}),
    }
    return {
        "facets": facets,
        "vocab": {
            "signal_types": SIGNAL_TYPES,
            "market_cap_bands": MARKET_CAP_BANDS,
            "employee_bands": EMPLOYEE_BANDS,
            "maturity_stages": MATURITY_STAGES,
            "customer_types": CUSTOMER_TYPES,
            "regions": REGIONS,
            "evidence_kinds": EVIDENCE_KINDS,
        },
    }


@router.get("/signals/kpis")
def signal_kpis(mode: str = "founder", user: User = Depends(get_current_user)):
    _ = user
    rows = _ranked("advisor" if mode == "advisor" else "founder")
    regions: Dict[str, int] = {}
    sectors: Dict[str, int] = {}
    for s in rows:
        regions[s["region"]] = regions.get(s["region"], 0) + 1
        sectors[s["sector"]] = sectors.get(s["sector"], 0) + 1
    top = lambda m, k: [  # noqa: E731 — tiny local shaping helper
        {k: name, "count": n}
        for name, n in sorted(m.items(), key=lambda kv: -kv[1])[:4]
    ]
    return {
        "active_signals": len(rows),
        "top_regions": top(regions, "region"),
        "top_sectors": top(sectors, "sector"),
        "avg_confidence": round(sum(s["confidence_score"] for s in rows) / len(rows)) if rows else 0,
        "freshest_updated_at": max((s["updated_at"] for s in rows), default=None),
        # Honest: the dev backend has no ingestion pipeline, so no refresh has
        # ever run and none is pretended.
        "last_refreshed_at": None,
        "data_state": "illustrative",
    }


@router.get("/signals/sources")
def signal_sources(user: User = Depends(get_current_user)):
    _ = user
    return {"sources": SOURCES, "health": []}


@router.get("/signals/meta")
def signal_meta(user: User = Depends(get_current_user)):
    _ = user
    return {
        "signal_types": SIGNAL_TYPES,
        "rank_weights": _RANK_WEIGHTS,
        "evidence_kinds": EVIDENCE_KINDS,
        "principle": (
            "Ranking favours practical, buildable startup opportunities — not the "
            "largest companies or the noisiest headlines. Confidence rewards multiple "
            "independent, high-quality, recent sources agreeing."
        ),
    }


@router.post("/signals/refresh")
def refresh_signals(user: User = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    # No fake success: the dev backend has no ingestion pipeline, and claiming
    # a refresh ran would recreate the exact dishonesty the Worker fixed.
    return {
        "ok": True,
        "ran_at": None,
        "promoted": 0,
        "held": 0,
        "evidence_written": 0,
        "adapters": [],
        "note": (
            "The dev backend serves a labeled illustrative corpus and has no "
            "ingestion pipeline. Live ingestion runs on the production Worker "
            "(POST /api/signals/refresh there, or the nightly cron)."
        ),
    }


@router.get("/signals/{signal_id}")
def signal_detail(signal_id: str, mode: str = "founder", user: User = Depends(get_current_user)):
    _ = user
    rows = _ranked("advisor" if mode == "advisor" else "founder")
    target = next((s for s in rows if s["id"] == signal_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Signal not found")
    used = {e["source_key"] for e in target["evidence_items"]}
    return {
        "signal": target,
        "companies": [],
        "sources": [s for s in SOURCES if s["key"] in used],
        "data_state": "illustrative",
    }
