import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlmodel import Session, select
from pydantic import BaseModel, Field
from typing import Optional, List
from backend.app.database import get_session
from backend.app.models.entities import Project, ActivityLog, User, UserRole
from backend.app.api.routes.auth import get_current_user
from datetime import datetime

router = APIRouter(prefix="/advisory", tags=["AI Advisory"])


class AdvisoryRequest(BaseModel):
    question: str
    context: Optional[str] = None
    project_id: Optional[int] = None
    category: str = "general"


class FinancialPlanRequest(BaseModel):
    project_id: Optional[int] = None
    monthly_burn: float = Field(0, ge=0)
    current_cash: float = Field(0, ge=0)
    revenue_monthly: float = Field(0, ge=0)
    revenue_growth_pct: float = Field(0, ge=0, le=500)
    funding_needed: float = Field(0, ge=0)
    team_size: int = Field(1, ge=1, le=500)
    planned_hires: int = Field(0, ge=0, le=100)
    avg_salary: float = Field(80000, ge=0)


class DiligenceRequest(BaseModel):
    project_id: int


ADVISORY_TEMPLATES = {
    "gtm": "Based on the {sector} sector, consider: 1) Product-led growth targeting {audience}, 2) Partnership-driven distribution through complementary APIs, 3) Content marketing establishing thought leadership in {domain}.",
    "fundraising": "For a {stage} startup in {sector}: Target {raise_range} at {valuation_range}. Lead with traction metrics. Use SAFE notes for speed. Prioritize investors with {sector} portfolio companies.",
    "product": "Focus on: 1) Core value proposition validation (30 days), 2) Usage analytics implementation, 3) Feature prioritization via customer feedback loops, 4) Technical debt management before scaling.",
    "team": "Hiring priorities for {stage}: 1) Technical co-founder if missing, 2) First sales hire for B2B, 3) Product designer for B2C. Use equity-heavy compensation to preserve runway.",
    "general": "Key strategic considerations: 1) Validate product-market fit before scaling, 2) Build measurable growth loops, 3) Maintain 18-month runway minimum, 4) Focus on one channel until it works.",
}


@router.post("/ask")
def ask_advisory(req: AdvisoryRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = None
    if req.project_id:
        project = session.get(Project, req.project_id)

    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)

            system_prompt = """You are an AI venture advisor at Axal VC Studio. You help founders with strategy, 
go-to-market, fundraising, product development, and operational questions. 
Be direct, actionable, and data-driven. Reference venture best practices.
Keep responses concise but thorough (3-5 key points with brief explanations)."""

            context_parts = [f"Question: {req.question}"]
            if req.context:
                context_parts.append(f"Additional context: {req.context}")
            if project:
                context_parts.append(f"Startup: {project.name}, Sector: {project.sector}, Stage: {project.stage}")
                if project.problem_statement:
                    context_parts.append(f"Problem: {project.problem_statement}")
                if project.solution:
                    context_parts.append(f"Solution: {project.solution}")

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "\n".join(context_parts)},
                ],
                temperature=0.7,
                max_tokens=1000,
            )

            advice = response.choices[0].message.content.strip()

            log = ActivityLog(
                project_id=req.project_id,
                action="ai_advisory_query",
                details=f"Category: {req.category} | Q: {req.question[:100]}",
                actor="ai_advisor",
            )
            session.add(log)
            session.commit()

            return {
                "ai_generated": True,
                "category": req.category,
                "advice": advice,
                "project_name": project.name if project else None,
            }

        except Exception as e:
            log = ActivityLog(
                project_id=req.project_id,
                action="ai_advisory_query",
                details=f"Category: {req.category} | Q: {req.question[:100]} (AI fallback: {type(e).__name__})",
                actor="ai_advisor",
            )
            session.add(log)
            session.commit()

    sector = project.sector if project else "technology"
    stage = project.stage if project else "early-stage"

    template = ADVISORY_TEMPLATES.get(req.category, ADVISORY_TEMPLATES["general"])
    advice = template.format(
        sector=sector,
        stage=stage,
        audience="early adopters",
        domain=sector,
        raise_range="$500K-$2M",
        valuation_range="$5M-$15M pre-money",
    )

    log = ActivityLog(
        project_id=req.project_id,
        action="ai_advisory_query",
        details=f"Category: {req.category} | Q: {req.question[:100]} (template fallback)",
        actor="ai_advisor",
    )
    session.add(log)
    session.commit()

    return {
        "ai_generated": False,
        "fallback_reason": "OpenAI API key not configured" if not openai_key else "AI service unavailable",
        "category": req.category,
        "advice": advice,
        "project_name": project.name if project else None,
    }


@router.post("/financial-plan")
def generate_financial_plan(req: FinancialPlanRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = None
    if req.project_id:
        project = session.get(Project, req.project_id)

    monthly_burn = req.monthly_burn or (req.team_size * req.avg_salary / 12) + 5000
    total_monthly_cost = monthly_burn + (req.planned_hires * req.avg_salary / 12)

    net_burn = total_monthly_cost - req.revenue_monthly
    runway_months = req.current_cash / net_burn if net_burn > 0 else 999

    projections = []
    cash = req.current_cash
    rev = req.revenue_monthly
    for month in range(1, 19):
        rev = rev * (1 + req.revenue_growth_pct / 100) if rev > 0 else 0
        if month > 3 and req.planned_hires > 0:
            hire_cost = (req.planned_hires * req.avg_salary / 12) * min(month / 6, 1.0)
        else:
            hire_cost = 0
        expenses = monthly_burn + hire_cost
        cash = cash + rev - expenses
        projections.append({
            "month": month,
            "revenue": round(rev, 2),
            "expenses": round(expenses, 2),
            "net": round(rev - expenses, 2),
            "cash_balance": round(cash, 2),
        })

    breakeven_month = None
    for p in projections:
        if p["net"] >= 0:
            breakeven_month = p["month"]
            break

    plan = {
        "summary": {
            "monthly_burn": round(monthly_burn, 2),
            "total_monthly_cost": round(total_monthly_cost, 2),
            "net_monthly_burn": round(net_burn, 2),
            "runway_months": round(runway_months, 1),
            "runway_status": "Healthy" if runway_months > 12 else ("Warning" if runway_months > 6 else "Critical"),
            "breakeven_month": breakeven_month,
        },
        "projections": projections,
        "recommendations": [],
        "project_name": project.name if project else None,
    }

    if runway_months < 6:
        plan["recommendations"].append("URGENT: Runway under 6 months. Begin fundraising immediately or cut burn by 30%+.")
    elif runway_months < 12:
        plan["recommendations"].append("Start fundraising within 2-3 months to maintain 6+ month runway buffer.")

    if req.revenue_monthly == 0:
        plan["recommendations"].append("Prioritize first revenue within 90 days. Even small revenue validates PMF.")

    if req.team_size > 3 and req.revenue_monthly < monthly_burn * 0.2:
        plan["recommendations"].append("Team size may be ahead of revenue. Consider deferring new hires until revenue covers 30%+ of burn.")

    if req.funding_needed > 0:
        plan["recommendations"].append(f"Target raise of ${req.funding_needed:,.0f} should cover {req.funding_needed / net_burn:.0f} months at current burn." if net_burn > 0 else "Current financials are cash-flow positive.")

    if req.project_id:
        log = ActivityLog(
            project_id=req.project_id,
            action="financial_plan_generated",
            details=f"Runway: {runway_months:.1f}mo, Burn: ${net_burn:,.0f}/mo",
            actor="financial_planner",
        )
        session.add(log)
        session.commit()

    return plan


@router.post("/diligence")
def run_diligence(req: DiligenceRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, req.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from backend.app.models.entities import ScoreSnapshot, Document, Founder

    scores = session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == req.project_id)
        .order_by(ScoreSnapshot.created_at.desc())
    ).all()

    docs = session.exec(
        select(Document)
        .where(Document.project_id == req.project_id)
    ).all()

    founder = session.get(Founder, project.founder_id) if project.founder_id else None

    checks = []
    overall_status = "pass"

    if scores:
        latest = scores[0]
        checks.append({
            "category": "Scoring",
            "item": "Startup Score",
            "status": "pass" if latest.total_score >= 70 else "fail",
            "detail": f"Score: {latest.total_score}/100 ({latest.tier})",
        })
    else:
        checks.append({
            "category": "Scoring",
            "item": "Startup Score",
            "status": "missing",
            "detail": "No score on file. Run scoring engine first.",
        })
        overall_status = "incomplete"

    has_bylaws = any(d.doc_type == "bylaws" for d in docs)
    has_equity = any(d.doc_type == "equity_split" for d in docs)
    has_ip = any(d.doc_type == "ip_license" for d in docs)
    has_safe = any(d.doc_type == "safe" for d in docs)

    checks.append({
        "category": "Legal",
        "item": "Corporate Bylaws",
        "status": "pass" if has_bylaws else "missing",
        "detail": "Bylaws on file" if has_bylaws else "Missing — generate via Legal module.",
    })
    checks.append({
        "category": "Legal",
        "item": "Equity Split Agreement",
        "status": "pass" if has_equity else "missing",
        "detail": "Equity agreement on file" if has_equity else "Missing — required before funding.",
    })
    checks.append({
        "category": "Legal",
        "item": "IP License Agreement",
        "status": "pass" if has_ip else "warning",
        "detail": "IP license on file" if has_ip else "Recommended for spinout.",
    })
    checks.append({
        "category": "Legal",
        "item": "SAFE Agreement",
        "status": "pass" if has_safe else "info",
        "detail": "SAFE on file" if has_safe else "Generate when ready for investment.",
    })

    if project.entity_id:
        checks.append({
            "category": "Legal",
            "item": "Incorporation",
            "status": "pass",
            "detail": "Entity incorporated.",
        })
    else:
        checks.append({
            "category": "Legal",
            "item": "Incorporation",
            "status": "missing",
            "detail": "Not yet incorporated. Required for spinout.",
        })
        overall_status = "incomplete"

    if founder:
        checks.append({
            "category": "Team",
            "item": "Founder Profile",
            "status": "pass",
            "detail": f"{founder.name} — {founder.domain_expertise or 'N/A'}, {founder.experience_years}yr exp.",
        })
        if founder.experience_years < 2:
            checks.append({
                "category": "Team",
                "item": "Founder Experience",
                "status": "warning",
                "detail": "Low experience. Consider assigning an advisor or operating partner.",
            })
    else:
        checks.append({
            "category": "Team",
            "item": "Founder Profile",
            "status": "missing",
            "detail": "No founder on record.",
        })
        overall_status = "incomplete"

    if project.tam and project.tam > 100_000_000:
        checks.append({
            "category": "Financial",
            "item": "Market Size",
            "status": "pass",
            "detail": f"TAM: ${project.tam:,.0f} — sufficient for venture-scale returns.",
        })
    elif project.tam:
        checks.append({
            "category": "Financial",
            "item": "Market Size",
            "status": "warning",
            "detail": f"TAM: ${project.tam:,.0f} — may be small for VC-scale returns.",
        })
    else:
        checks.append({
            "category": "Financial",
            "item": "Market Size",
            "status": "missing",
            "detail": "TAM not specified.",
        })

    if project.cost_to_mvp and project.cost_to_mvp < 200_000:
        checks.append({
            "category": "Financial",
            "item": "Capital Efficiency",
            "status": "pass",
            "detail": f"Cost to MVP: ${project.cost_to_mvp:,.0f} — capital efficient.",
        })
    elif project.cost_to_mvp:
        checks.append({
            "category": "Financial",
            "item": "Capital Efficiency",
            "status": "warning",
            "detail": f"Cost to MVP: ${project.cost_to_mvp:,.0f} — higher than studio target.",
        })

    missing_count = sum(1 for c in checks if c["status"] == "missing")
    warning_count = sum(1 for c in checks if c["status"] == "warning")
    pass_count = sum(1 for c in checks if c["status"] == "pass")

    if missing_count > 2:
        overall_status = "incomplete"
    elif warning_count > 2:
        overall_status = "conditional"

    log = ActivityLog(
        project_id=req.project_id,
        action="diligence_check",
        details=f"Result: {overall_status} | Pass: {pass_count}, Warning: {warning_count}, Missing: {missing_count}",
        actor="diligence_engine",
    )
    session.add(log)
    session.commit()

    return {
        "project_id": req.project_id,
        "project_name": project.name,
        "overall_status": overall_status,
        "summary": {
            "pass": pass_count,
            "warning": warning_count,
            "missing": missing_count,
            "total": len(checks),
        },
        "checks": checks,
        "recommendation": (
            "Ready for spinout" if overall_status == "pass"
            else "Address missing items before proceeding" if overall_status == "incomplete"
            else "Conditional — review warnings before final decision"
        ),
        "generated_at": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Task #75 — Advisory Suite advisor directory (dev mirror, DIRECTORY ONLY).
# Founder-scoped CRUD over advisor_profiles / advisor_startups. The promote /
# waitlist half lives in the Worker Contacts hub (no dev FastAPI counterpart),
# so it is intentionally not mirrored. Non-owned ids return 404, never 403.
# ---------------------------------------------------------------------------

# Kept in lockstep with services/advisorProfilesSchema.ts::TRUSTED_ADVISOR_SOURCES.
TRUSTED_ADVISOR_SOURCES = {"brand-landing", "referral", "staff-rec"}


class AdvisorUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    sectors: Optional[List[str]] = None
    expertise: Optional[List[str]] = None
    linkedin_url: Optional[str] = None
    hourly_rate: Optional[float] = None


class AdvisorAssignments(BaseModel):
    project_ids: List[int] = []


def _advisor_email_visible(source) -> bool:
    return bool(source) and source in TRUSTED_ADVISOR_SOURCES


def _json_list(raw) -> list:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except Exception:  # noqa: BLE001
        return []


def _iso(v):
    if v is None:
        return None
    return v.isoformat() if isinstance(v, datetime) else str(v)


def _shape_advisor(m, assignments) -> dict:
    visible = _advisor_email_visible(m["source"])
    return {
        "id": m["id"],
        "founder_id": m["founder_id"],
        "name": m["name"],
        "email": m["email"] if visible else None,
        "email_hidden": bool(m["email"]) and not visible,
        "bio": m["bio"],
        "sectors": _json_list(m["sectors_json"]),
        "expertise": _json_list(m["expertise_json"]),
        "linkedin_url": m["linkedin_url"],
        "hourly_rate": m["hourly_rate"],
        "source": m["source"],
        "status": m["status"] or "active",
        "assignments": assignments,
        "created_at": _iso(m["created_at"]),
        "updated_at": _iso(m["updated_at"]),
    }


def _load_owned_advisor(session: Session, advisor_id: int, user: User):
    row = session.exec(
        text("SELECT * FROM advisor_profiles WHERE id = :id").bindparams(id=advisor_id)
    ).first()
    if row is None:
        return None
    m = row._mapping
    if user.role == UserRole.ADMIN:
        return m
    if user.founder_id and int(m["founder_id"]) == int(user.founder_id):
        return m
    return None


def _load_assignments(session: Session, profile_id: int) -> list:
    rows = session.exec(
        text(
            "SELECT a.project_id AS project_id, p.name AS name "
            "FROM advisor_startups a LEFT JOIN projects p ON p.id = a.project_id "
            "WHERE a.advisor_profile_id = :pid"
        ).bindparams(pid=profile_id)
    ).all()
    return [{"project_id": r._mapping["project_id"], "name": r._mapping["name"]} for r in rows]


def _owned_project_ids(session: Session, user: User):
    """Owned project ids, or None for admin (= all)."""
    if user.role == UserRole.ADMIN:
        return None
    if not user.founder_id:
        return []
    rows = session.exec(
        text("SELECT id FROM projects WHERE founder_id = :fid").bindparams(fid=user.founder_id)
    ).all()
    return [r._mapping["id"] for r in rows]


@router.get("/advisors")
def list_advisors(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    if user.role == UserRole.ADMIN:
        rows = session.exec(
            text("SELECT * FROM advisor_profiles ORDER BY status ASC, updated_at DESC LIMIT 500")
        ).all()
    else:
        if not user.founder_id:
            return {"items": []}
        rows = session.exec(
            text(
                "SELECT * FROM advisor_profiles WHERE founder_id = :fid "
                "ORDER BY status ASC, updated_at DESC LIMIT 500"
            ).bindparams(fid=user.founder_id)
        ).all()
    items = [_shape_advisor(r._mapping, _load_assignments(session, r._mapping["id"])) for r in rows]
    return {"items": items}


@router.put("/advisors/{advisor_id}")
def update_advisor(
    advisor_id: int,
    payload: AdvisorUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _load_owned_advisor(session, advisor_id, user)
    if m is None:
        raise HTTPException(status_code=404, detail="Not found")
    provided = payload.model_fields_set

    name = payload.name if "name" in provided else m["name"]
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    bio = payload.bio if "bio" in provided else m["bio"]
    linkedin = payload.linkedin_url if "linkedin_url" in provided else m["linkedin_url"]

    def _norm(items):
        return json.dumps([str(x).strip() for x in (items or []) if str(x).strip()][:40])

    sectors = _norm(payload.sectors) if "sectors" in provided else m["sectors_json"]
    expertise = _norm(payload.expertise) if "expertise" in provided else m["expertise_json"]

    hourly = m["hourly_rate"]
    if "hourly_rate" in provided:
        hourly = payload.hourly_rate
        if hourly is not None and hourly < 0:
            hourly = m["hourly_rate"]

    session.exec(
        text(
            "UPDATE advisor_profiles SET name=:n, bio=:b, linkedin_url=:l, "
            "sectors_json=:s, expertise_json=:e, hourly_rate=:h, updated_at=:u WHERE id=:id"
        ).bindparams(
            n=name.strip(), b=bio, l=linkedin, s=sectors, e=expertise,
            h=hourly, u=datetime.utcnow(), id=advisor_id,
        )
    )
    session.commit()
    fresh = session.exec(
        text("SELECT * FROM advisor_profiles WHERE id = :id").bindparams(id=advisor_id)
    ).first()
    return _shape_advisor(fresh._mapping, _load_assignments(session, advisor_id))


@router.put("/advisors/{advisor_id}/assignments")
def set_advisor_assignments(
    advisor_id: int,
    payload: AdvisorAssignments,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _load_owned_advisor(session, advisor_id, user)
    if m is None:
        raise HTTPException(status_code=404, detail="Not found")
    requested = list({int(x) for x in payload.project_ids})

    owned = _owned_project_ids(session, user)
    if owned is not None:
        owned_set = set(owned)
        for pid in requested:
            if pid not in owned_set:
                raise HTTPException(status_code=403, detail="One or more startups are not yours to assign.")

    existing = session.exec(
        text("SELECT project_id FROM advisor_startups WHERE advisor_profile_id = :pid").bindparams(pid=advisor_id)
    ).all()
    have = {r._mapping["project_id"] for r in existing}
    to_add = [p for p in requested if p not in have]
    to_remove = [p for p in have if p not in requested]

    for pid in to_add:
        session.exec(
            text(
                "INSERT INTO advisor_startups (advisor_profile_id, project_id, created_at) "
                "VALUES (:a, :p, :c) ON CONFLICT (advisor_profile_id, project_id) DO NOTHING"
            ).bindparams(a=advisor_id, p=pid, c=datetime.utcnow())
        )
    for pid in to_remove:
        session.exec(
            text("DELETE FROM advisor_startups WHERE advisor_profile_id = :a AND project_id = :p").bindparams(
                a=advisor_id, p=pid
            )
        )
    session.exec(
        text("UPDATE advisor_profiles SET updated_at = :u WHERE id = :id").bindparams(u=datetime.utcnow(), id=advisor_id)
    )
    session.commit()
    fresh = session.exec(
        text("SELECT * FROM advisor_profiles WHERE id = :id").bindparams(id=advisor_id)
    ).first()
    return _shape_advisor(fresh._mapping, _load_assignments(session, advisor_id))


def _set_advisor_status(advisor_id: int, status_value: str, session: Session, user: User):
    m = _load_owned_advisor(session, advisor_id, user)
    if m is None:
        raise HTTPException(status_code=404, detail="Not found")
    session.exec(
        text("UPDATE advisor_profiles SET status = :st, updated_at = :u WHERE id = :id").bindparams(
            st=status_value, u=datetime.utcnow(), id=advisor_id
        )
    )
    session.commit()
    fresh = session.exec(
        text("SELECT * FROM advisor_profiles WHERE id = :id").bindparams(id=advisor_id)
    ).first()
    return _shape_advisor(fresh._mapping, _load_assignments(session, advisor_id))


@router.post("/advisors/{advisor_id}/archive")
def archive_advisor(
    advisor_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return _set_advisor_status(advisor_id, "archived", session, user)


@router.post("/advisors/{advisor_id}/restore")
def restore_advisor(
    advisor_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return _set_advisor_status(advisor_id, "active", session, user)
