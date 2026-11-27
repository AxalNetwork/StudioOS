"""Task #38 — DEV-ONLY skills shim.

The production Cloudflare Worker hosts ``/api/skills/*`` (taxonomy, self
ratings, peer endorsements, blended aggregates) backed by D1
(``cloudflare-worker/src/routes/skills.ts``). The dev FastAPI backend has
no skills tables, so the Skills Profile page used to 404 ("Error: Not
found") in the local preview.

This is a dev-only parity shim: it serves the taxonomy and keeps each
user's self-ratings in-process so the page loads, renders, and round-trips
a save within a dev session. It deliberately does NOT implement peer
endorsements/blending (returns empty aggregates) — the dev backend never
deploys (replit.md, CLAUDE.md), so this can never serve prod traffic.
Response shapes mirror the Worker so the API↔Worker drift checker matches
them to the ``/api/skills`` mount.

The taxonomy literal below MIRRORS THE CANONICAL SEED —
``cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql`` —
verbatim: the same 8 radar categories (display_order 1..8) and the same
128 skills (16 per category, display_order 1..16), with identical slugs,
labels and descriptions, and the canonical 5-rung seniority ladder from
``cloudflare-worker/src/services/skillsTaxonomySchema.ts``. It used to be
a hand-written 4-category / 13-skill placeholder, which made dev show a
4-axis radar while production showed 8. D1 stays the source of truth: when
the seed changes, re-transcribe it here — do not edit this copy on its own.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends

from backend.app.api.routes.auth import get_current_user
from backend.app.models.entities import User

router = APIRouter(prefix="/skills", tags=["Skills"])

# Canonical ladder — skillsTaxonomySchema.ts::SENIORITY_LEVELS.
_SENIORITY = ["aware", "working", "proficient", "advanced", "expert"]

# (category_slug, label, is_radar_axis, [(skill_slug, label, description)])
# Transcribed from 090_seed_skills_values_taxonomy.sql — all 8 categories are
# radar axes (is_radar_axis=1); order below matches the seed's display_order.
_CATEGORY_DEFS = [
    ("product", "Product", True, [
        ("product_discovery", "Product Discovery",
         "Identifying and validating problems worth solving."),
        ("product_roadmapping", "Roadmapping & Prioritization",
         "Sequencing work against goals and constraints."),
        ("product_user_research", "User Research",
         "Generative and evaluative research with users."),
        ("product_requirements", "Requirements & PRDs",
         "Translating intent into clear specs and acceptance criteria."),
        ("product_analytics", "Product Analytics",
         "Instrumentation, funnels, and metric-driven decisions."),
        ("product_experimentation", "A/B Testing & Experimentation",
         "Designing and reading controlled experiments."),
        ("product_ux_strategy", "UX Strategy",
         "Shaping end-to-end product experience and flows."),
        ("product_growth", "Growth Product",
         "Activation, retention, and monetization loops."),
        ("product_pricing_packaging", "Pricing & Packaging",
         "Designing tiers, packaging, and willingness-to-pay."),
        ("product_management_b2b", "B2B Product Management",
         "Managing products sold to and used by businesses."),
        ("product_management_b2c", "B2C Product Management",
         "Managing high-volume consumer products."),
        ("product_platform", "Platform / API Product",
         "Owning platform, API, and developer-facing surfaces."),
        ("product_data", "Data Product Management",
         "Productizing data assets and pipelines."),
        ("product_ai", "AI / ML Product Management",
         "Shaping ML-powered features and their UX."),
        ("product_marketplace", "Marketplace Product",
         "Balancing supply and demand in two-sided products."),
        ("product_ops", "Product Operations",
         "Process, tooling, and rituals that keep product teams effective."),
    ]),
    ("engineering", "Engineering", True, [
        ("eng_frontend", "Frontend Engineering",
         "Building responsive, accessible web UIs."),
        ("eng_backend", "Backend Engineering",
         "Designing services, APIs, and business logic."),
        ("eng_fullstack", "Full-Stack Engineering",
         "Owning features end to end across the stack."),
        ("eng_mobile", "Mobile Engineering",
         "Native and cross-platform mobile app development."),
        ("eng_devops", "DevOps & CI/CD",
         "Build pipelines, automation, and release engineering."),
        ("eng_cloud_infra", "Cloud Infrastructure",
         "Provisioning and operating cloud infrastructure."),
        ("eng_data_engineering", "Data Engineering",
         "Pipelines, warehouses, and data platform work."),
        ("eng_ml", "Machine Learning Engineering",
         "Training, serving, and operating ML models."),
        ("eng_security", "Security Engineering",
         "Application and infrastructure security."),
        ("eng_databases", "Databases & Data Modeling",
         "Schema design, query tuning, and storage choices."),
        ("eng_distributed_systems", "Distributed Systems",
         "Designing scalable, fault-tolerant systems."),
        ("eng_qa_automation", "QA & Test Automation",
         "Test strategy and automated quality gates."),
        ("eng_architecture", "Software Architecture",
         "High-level system design and technical tradeoffs."),
        ("eng_embedded", "Embedded / Firmware",
         "Software for hardware and constrained devices."),
        ("eng_site_reliability", "Site Reliability Engineering",
         "Reliability, observability, and incident response."),
        ("eng_api_design", "API Design",
         "Designing clean, durable, well-documented APIs."),
    ]),
    ("design", "Design", True, [
        ("design_product", "Product Design",
         "End-to-end design of product features and flows."),
        ("design_ui", "UI Design",
         "Crafting clear, polished interface layers."),
        ("design_ux_research", "UX Research",
         "Studying users to inform design decisions."),
        ("design_interaction", "Interaction Design",
         "Designing behavior, states, and micro-interactions."),
        ("design_visual", "Visual Design",
         "Typography, color, layout, and visual hierarchy."),
        ("design_brand_identity", "Brand Identity Design",
         "Logos, identity systems, and brand expression."),
        ("design_motion", "Motion Design",
         "Animation and motion to support usability and delight."),
        ("design_prototyping", "Prototyping",
         "Building interactive prototypes to test ideas."),
        ("design_design_systems", "Design Systems",
         "Reusable components, tokens, and design governance."),
        ("design_information_arch", "Information Architecture",
         "Structuring content, navigation, and taxonomy."),
        ("design_accessibility", "Accessibility (a11y)",
         "Designing for inclusive, accessible experiences."),
        ("design_service", "Service Design",
         "Designing across touchpoints and back-stage processes."),
        ("design_3d", "3D & Spatial Design",
         "3D, AR/VR, and spatial interface design."),
        ("design_content", "Content Design / UX Writing",
         "Words, voice, and content within the product."),
        ("design_graphic", "Graphic Design",
         "Marketing, print, and graphic asset creation."),
        ("design_illustration", "Illustration",
         "Custom illustration and visual storytelling."),
    ]),
    ("gtm_sales", "GTM / Sales", True, [
        ("gtm_sales_strategy", "Sales Strategy",
         "Designing the overall sales motion and model."),
        ("gtm_outbound", "Outbound / Prospecting",
         "Sourcing and qualifying new opportunities."),
        ("gtm_inbound", "Inbound Sales",
         "Converting inbound interest into pipeline."),
        ("gtm_enterprise_sales", "Enterprise / Field Sales",
         "Complex, multi-stakeholder enterprise deals."),
        ("gtm_smb_sales", "SMB Sales",
         "High-velocity sales to small and mid-market."),
        ("gtm_sales_ops", "Sales Operations",
         "Process, tooling, and forecasting for sales."),
        ("gtm_account_management", "Account Management",
         "Growing and retaining existing accounts."),
        ("gtm_customer_success", "Customer Success",
         "Driving adoption, value, and renewals."),
        ("gtm_partnerships", "Channel & Partnerships",
         "Reselling, alliances, and channel sales."),
        ("gtm_revenue_ops", "Revenue Operations",
         "Aligning sales, marketing, and CS systems."),
        ("gtm_negotiation", "Deal Negotiation",
         "Structuring and closing commercial terms."),
        ("gtm_sales_enablement", "Sales Enablement",
         "Equipping reps with content, training, and tools."),
        ("gtm_pipeline_mgmt", "Pipeline Management",
         "Managing and forecasting deal pipeline."),
        ("gtm_solutions_eng", "Solutions / Sales Engineering",
         "Technical pre-sales and solution scoping."),
        ("gtm_market_entry", "Go-to-Market Strategy",
         "Planning launches and new-market entry."),
        ("gtm_plg", "Product-Led Growth",
         "Self-serve, product-driven acquisition motions."),
    ]),
    ("marketing_brand", "Marketing / Brand", True, [
        ("mkt_brand_strategy", "Brand Strategy",
         "Positioning, narrative, and brand architecture."),
        ("mkt_content", "Content Marketing",
         "Editorial, blogs, and content-led demand."),
        ("mkt_seo", "SEO",
         "Organic search strategy and optimization."),
        ("mkt_sem", "SEM / Paid Search",
         "Paid search acquisition and bidding."),
        ("mkt_paid_social", "Paid Social",
         "Paid acquisition on social platforms."),
        ("mkt_lifecycle", "Lifecycle / Email",
         "Email, CRM, and lifecycle automation."),
        ("mkt_demand_gen", "Demand Generation",
         "Multi-channel pipeline and demand programs."),
        ("mkt_product_marketing", "Product Marketing",
         "Messaging, launches, and competitive positioning."),
        ("mkt_pr_comms", "PR & Communications",
         "Press, analyst relations, and corporate comms."),
        ("mkt_social_media", "Social Media",
         "Organic social presence and engagement."),
        ("mkt_community", "Community Marketing",
         "Building and nurturing communities."),
        ("mkt_growth_marketing", "Growth Marketing",
         "Experiment-driven acquisition and retention."),
        ("mkt_analytics", "Marketing Analytics",
         "Attribution, reporting, and channel ROI."),
        ("mkt_events", "Events & Field",
         "Conferences, webinars, and field marketing."),
        ("mkt_influencer", "Influencer Marketing",
         "Creator and influencer partnerships."),
        ("mkt_copywriting", "Copywriting",
         "Persuasive marketing and conversion copy."),
    ]),
    ("finance_ops", "Finance / Ops", True, [
        ("finops_financial_modeling", "Financial Modeling",
         "Building forecasts and operating models."),
        ("finops_accounting", "Accounting",
         "Bookkeeping, close, and financial statements."),
        ("finops_fpna", "FP&A",
         "Planning, budgeting, and variance analysis."),
        ("finops_fundraising_fin", "Fundraising Finance",
         "Diligence-ready financials and data rooms."),
        ("finops_treasury", "Treasury & Cash",
         "Cash management, runway, and banking."),
        ("finops_tax", "Tax",
         "Corporate tax planning and filings."),
        ("finops_payroll", "Payroll & Benefits",
         "Payroll, equity admin, and benefits."),
        ("finops_people_ops", "People Ops / HR",
         "Hiring ops, performance, and culture systems."),
        ("finops_audit_controls", "Internal Controls & Audit",
         "Controls, audit readiness, and risk management."),
        ("finops_business_ops", "Business Operations",
         "Cross-functional ops and special projects."),
        ("finops_supply_chain", "Supply Chain & Logistics",
         "Sourcing, inventory, and fulfillment."),
        ("finops_procurement", "Procurement",
         "Vendor selection, contracts, and spend."),
        ("finops_metrics_reporting", "Metrics & Reporting",
         "KPI dashboards and board reporting."),
        ("finops_unit_economics", "Unit Economics",
         "CAC, LTV, margins, and contribution analysis."),
        ("finops_strategic_finance", "Strategic Finance",
         "Scenario planning and capital allocation."),
        ("finops_office_admin", "Office & Admin Ops",
         "Facilities, admin, and operational logistics."),
    ]),
    ("legal_compliance", "Legal / Compliance", True, [
        ("legal_corporate", "Corporate / Entity Formation",
         "Incorporation, governance, and entity structure."),
        ("legal_contracts", "Commercial Contracts",
         "Drafting and negotiating commercial agreements."),
        ("legal_ip", "Intellectual Property",
         "Patents, trademarks, and IP strategy."),
        ("legal_employment", "Employment Law",
         "Hiring, equity, and employment compliance."),
        ("legal_privacy", "Privacy & Data Protection",
         "GDPR, CCPA, and data-protection compliance."),
        ("legal_securities", "Securities Law",
         "Fundraising, equity, and securities compliance."),
        ("legal_regulatory", "Regulatory Affairs",
         "Sector-specific regulatory strategy."),
        ("legal_compliance_program", "Compliance Programs",
         "Building and running compliance programs."),
        ("legal_data_governance", "Data Governance",
         "Data policy, retention, and stewardship."),
        ("legal_litigation", "Litigation & Disputes",
         "Managing disputes and litigation risk."),
        ("legal_ma", "M&A / Transactions",
         "Legal work for mergers and acquisitions."),
        ("legal_licensing", "Licensing & Permits",
         "Business licensing and permitting."),
        ("legal_tax_law", "Tax Law",
         "Tax structuring and legal tax matters."),
        ("legal_aml_kyc", "AML / KYC",
         "Anti-money-laundering and KYC compliance."),
        ("legal_open_source", "Open-Source Licensing",
         "OSS license compliance and policy."),
        ("legal_terms_policy", "Terms & Policy Drafting",
         "Drafting ToS, privacy, and user policies."),
    ]),
    ("capital_network", "Capital / Network", True, [
        ("cap_fundraising", "Fundraising / Pitching",
         "Raising rounds and pitching investors."),
        ("cap_investor_relations", "Investor Relations",
         "Managing investor updates and relationships."),
        ("cap_venture_capital", "Venture Capital",
         "VC investing, sourcing, and diligence."),
        ("cap_angel_investing", "Angel Investing",
         "Early-stage angel investing and syndicates."),
        ("cap_corporate_dev", "Corporate Development",
         "Inorganic growth, M&A sourcing, and deals."),
        ("cap_debt_financing", "Debt & Venture Debt",
         "Debt facilities and venture-debt structuring."),
        ("cap_grants_nondilutive", "Grants & Non-Dilutive",
         "Grants, credits, and non-dilutive funding."),
        ("cap_cap_table", "Cap Table Management",
         "Equity, ownership, and cap-table hygiene."),
        ("cap_board_governance", "Board & Governance",
         "Board management and corporate governance."),
        ("cap_talent_network", "Talent Sourcing & Recruiting",
         "Sourcing and recruiting key hires."),
        ("cap_advisor_network", "Advisor & Mentor Network",
         "Building and leveraging advisors and mentors."),
        ("cap_bd_partnerships", "BD Partnerships",
         "Strategic business-development partnerships."),
        ("cap_ecosystem", "Ecosystem Building",
         "Building community and ecosystem presence."),
        ("cap_press_relations", "Press & Media Relations",
         "Cultivating press and media relationships."),
        ("cap_lp_relations", "LP Relations",
         "Limited-partner relationships and reporting."),
        ("cap_strategic_alliances", "Strategic Alliances",
         "High-leverage strategic alliances."),
    ]),
]


def _build_taxonomy() -> tuple[list[dict], set[int]]:
    categories: list[dict] = []
    valid_ids: set[int] = set()
    next_id = 1
    for c_order, (slug, label, is_axis, skills) in enumerate(_CATEGORY_DEFS):
        skill_payload = []
        for s_order, (s_slug, s_label, s_desc) in enumerate(skills):
            skill_payload.append({
                "id": next_id,
                "slug": s_slug,
                "label": s_label,
                "description": s_desc,
                "seniority_levels": _SENIORITY,
                "display_order": s_order,
            })
            valid_ids.add(next_id)
            next_id += 1
        categories.append({
            "slug": slug,
            "label": label,
            "description": None,
            "is_radar_axis": is_axis,
            "radar_weight": 1,
            "display_order": c_order,
            "skills": skill_payload,
        })
    return categories, valid_ids


_TAXONOMY, _VALID_SKILL_IDS = _build_taxonomy()
_TAXONOMY_ETAG = f'W/"sktax-dev-{len(_VALID_SKILL_IDS)}"'

# In-process self-ratings: user_id -> {skill_id -> rating dict}. A module
# dict is fine for a single-worker dev server; it resets on --reload but
# survives a page reload within a dev session.
_RATINGS: dict[int, dict[int, dict]] = {}


def _clamp_level(raw: Any) -> int:
    try:
        n = int(round(float(raw)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(5, n))


def _norm_years(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        y = float(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(60.0, y))


def _norm_evidence(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""  # sentinel: invalid (caller turns into 400)
    return s[:500]


def _ratings_list(user_id: int) -> list[dict]:
    rows = _RATINGS.get(user_id, {})
    return [
        {
            "skill_id": sid,
            "self_level": r.get("self_level", 0),
            "evidence_url": r.get("evidence_url") or None,
            "years": r.get("years"),
            "updated_at": r.get("updated_at"),
        }
        for sid, r in sorted(rows.items())
    ]


@router.get("/taxonomy")
def get_taxonomy(user: User = Depends(get_current_user)):
    return {"categories": _TAXONOMY, "etag": _TAXONOMY_ETAG}


@router.get("/me")
def get_my_skills(user: User = Depends(get_current_user)):
    return {"ratings": _ratings_list(user.id)}


@router.put("/me")
def put_my_skills(payload: dict, user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    ratings = (payload or {}).get("ratings")
    if not isinstance(ratings, list):
        raise HTTPException(status_code=400, detail="Expected { ratings: [...] }.")
    if len(ratings) > 500:
        raise HTTPException(status_code=400, detail="Too many ratings in one request.")
    store = _RATINGS.setdefault(user.id, {})
    now = datetime.utcnow().isoformat()
    for raw in ratings:
        try:
            skill_id = int(raw.get("skill_id"))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=400, detail=f"Unknown skill_id: {raw}")
        if skill_id not in _VALID_SKILL_IDS:
            raise HTTPException(status_code=400, detail=f"Unknown skill_id: {skill_id}")
        level = _clamp_level(raw.get("self_level"))
        if level <= 0:
            store.pop(skill_id, None)
            continue
        evidence = None
        if raw.get("evidence_url") not in (None, ""):
            evidence = _norm_evidence(raw.get("evidence_url"))
            if evidence == "":
                raise HTTPException(status_code=400, detail="Evidence link must start with http:// or https://")
        store[skill_id] = {
            "self_level": level,
            "evidence_url": evidence,
            "years": _norm_years(raw.get("years")),
            "updated_at": now,
        }
    return {"ratings": _ratings_list(user.id)}


@router.get("/me/aggregate")
def get_my_aggregate(user: User = Depends(get_current_user)):
    # Dev has no peer endorsements, so the blended score is just the self
    # rating with empty peer signal — enough for the page to render.
    skills = [
        {
            "skill_id": r["skill_id"],
            "self_level": r["self_level"],
            "peer_avg": 0,
            "peer_count": 0,
            "blended": r["self_level"],
        }
        for r in _ratings_list(user.id)
    ]
    return {"user_id": user.id, "skills": skills}


@router.post("/endorsements")
def post_endorsement(payload: dict, user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    body = payload or {}
    try:
        endorsee_id = int(body.get("endorsee_id"))
        skill_id = int(body.get("skill_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="endorsee_id and skill_id are required.")
    if skill_id not in _VALID_SKILL_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown skill_id: {skill_id}")
    if endorsee_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot endorse yourself.")
    level = _clamp_level(body.get("level"))
    if level < 1:
        raise HTTPException(status_code=400, detail="Endorsement level must be between 1 and 5.")
    note = None
    if body.get("note"):
        note = str(body["note"]).strip()[:1000]
    return {
        "endorsement": {
            "endorser_id": user.id,
            "endorsee_id": endorsee_id,
            "skill_id": skill_id,
            "level": level,
            "note": note,
            "updated_at": datetime.utcnow().isoformat(),
        }
    }


@router.get("/users/{user_id}/aggregate")
def get_user_aggregate(user_id: int, user: User = Depends(get_current_user)):
    # Dev stub: only the caller's own ratings are known in-process; for any
    # other user we return an empty (but valid) aggregate.
    if user_id == user.id:
        return get_my_aggregate(user)
    return {"user_id": user_id, "skills": []}
