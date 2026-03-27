import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel, Field
from typing import Optional
from backend.app.database import get_session
from backend.app.models.entities import Project, ActivityLog
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
def ask_advisory(req: AdvisoryRequest, session: Session = Depends(get_session)):
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
            fallback_reason = f"AI unavailable: {type(e).__name__}"

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
def generate_financial_plan(req: FinancialPlanRequest, session: Session = Depends(get_session)):
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
def run_diligence(req: DiligenceRequest, session: Session = Depends(get_session)):
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
                "detail": "Low experience. Consider assigning a mentor or operating partner.",
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
