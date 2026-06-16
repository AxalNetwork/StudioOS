import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from sqlalchemy import text

logger = logging.getLogger("studioos.projects")
from backend.app.database import get_session
from backend.app.models.entities import Project, Founder, ScoreSnapshot, Deal, ActivityLog, User, Interview
from backend.app.services.pain_groups import compute_pain_bars
from backend.app.schemas.scoring import ProjectCreate, ProjectUpdate, FounderSubmitRequest
from backend.app.services.scoring import run_full_score
from backend.app.services.score_integrity import assert_no_reserved_fields
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_admin, is_privileged, ensure_founder_access
from backend.app.models.entities import UserRole
from datetime import datetime, timedelta

router = APIRouter(prefix="/projects", tags=["Projects"])


def _ensure_can_edit(user: User, project: Project) -> None:
    ensure_founder_access(user, project.founder_id)


def _spinout_deck_payload(project: Project, session: Session) -> dict:
    """Dev-only deterministic mirror of the Worker's Spin-Out deck assembler.

    Prod assembles this in the Cloudflare Worker
    (services/decks/spinoutDeckData.ts) by remapping the live Lab data. The dev
    FastAPI backend is a *partial* mirror, so we return a deterministic, fully
    populated payload (keyed to the project name) so the browser-side
    buildDeck() can render and download the .pptx in the Replit preview. We
    always report a couple of gaps + draft=True so the gaps panel and the
    DRAFT filename are exercisable in dev. Never deployed.
    """
    name = (project.name or "Company").strip() or "Company"
    upper = name.upper()
    tagline = (getattr(project, "tagline", None) or "").strip()
    thesis = tagline or "Real-time risk scoring for private-market lenders."
    sector = (getattr(project, "sector", None) or "Fintech / AI").strip() or "Fintech / AI"
    program_day = 16
    lab_status = f"Day {program_day} / 28"

    # Task #29 — problem.pains from the founder's REAL grouped discovery pains
    # (honest empty state, never the BASEPOINT sample). When there is no real
    # data we mirror the Worker mapper's neutral FALLBACK placeholders + gap.
    DASH = "\u2014"
    pain_bars = compute_pain_bars(session, project.id)
    interview_total = len(
        list(session.exec(select(Interview.id).where(Interview.project_id == project.id)))
    )
    if pain_bars:
        problem_pains = pain_bars
        problem_framing = (
            f"Synthesized from {interview_total} discovery "
            f"interview{'s' if interview_total != 1 else ''} with target customers."
        )
    else:
        problem_pains = [
            ["Primary pain", 50, DASH],
            ["Secondary pain", 38, DASH],
            ["Tertiary pain", 26, DASH],
        ]
        problem_framing = "Log discovery interviews to surface your top customer pains."

    data = {
        "brand": {"lab": "AXAL VC · SPIN-OUT LAB", "footerRight": f"{upper} · CONFIDENTIAL", "network": "Axal VC"},
        "cover": {
            "company": upper,
            "eyebrowRight": f"DEMO DAY · {lab_status}",
            "thesis": thesis,
            "signalLabel": "VALIDATION SIGNAL · 30-DAY SPRINT",
            "signalCaption": "Cumulative discovery interviews",
            "signalX": ["D0", "D5", "D10", "D15", "D20", "D25", "D30"],
            "signalY": [4, 9, 14, 18, 22, 25, 28],
            "meta": [["SECTOR", sector], ["STAGE", "Pre-seed"], ["FOUNDER", "—"], ["LAB STATUS", lab_status]],
        },
        "problem": {
            "eyebrow": "Problem", "idx": "02",
            "title": "The pains that surface in every customer conversation.",
            "framing": problem_framing,
            "quote": "We re-underwrite on data that's already three weeks old. By then the borrower has moved.",
            "quoteAttr": "Head of Credit · mid-market lender",
            "barsLabel": "PAIN FREQUENCY ACROSS INTERVIEWS",
            "pains": problem_pains,
        },
        "validation": {
            "eyebrow": "Validation", "idx": "03",
            "title": "Empirical signal from the discovery sprint.",
            "cards": [
                ["28", "Interviews completed"],
                ["21", "Distinct pains"],
                ["7.8", "Mean solution-fit"],
                ["5", "Design-partner LOIs"],
            ],
            "funnelLabel": "DISCOVERY FUNNEL · INTERVIEWS \u2192 SOLUTION-FIT",
            "stages": [["Interviewed", 28], ["Pain confirmed", 21], ["Solution-fit \u2265 4/5", 14]],
            "conversion": ["50%", "rated solution-fit \u2265 4 / 5"],
        },
        "market": {
            "eyebrow": "Market", "idx": "04",
            "title": "A serviceable market, sized bottom-up.",
            "rings": [
                ["TAM", "$14B", "Total addressable"],
                ["SAM", "$3.2B", "Serviceable available"],
                ["SOM", "$180M", "Serviceable obtainable"],
            ],
            "whyNowLabel": "WHY NOW",
            "why": [
                ["Private credit has scaled fast.", "AUM has roughly doubled since 2020, outpacing the tooling underwriters rely on."],
                ["Data infra is in, risk tooling isn't.", "Lenders warehouse loan data but still score risk on manual, periodic reviews."],
                ["Monitoring pressure is rising.", "LPs and regulators expect continuous, auditable risk reporting."],
            ],
            "assumptions": "Sizing methodology and assumptions: see the Market Intel module.",
        },
        "solution": {
            "eyebrow": "Solution", "idx": "05",
            "title": "From raw inputs to a live, actionable output.",
            "steps": [
                ["ingest", "Ingest", "Connect loan tapes, bank feeds, and filings in minutes."],
                ["score", "Score", "Generate a real-time risk score with explainable drivers."],
                ["monitor", "Monitor", "Continuously watch every borrower, not just at review."],
                ["act", "Act", "Trigger alerts and repricing the moment risk moves."],
            ],
            "outcomeLabel": "TARGET OUTCOMES",
            "outcomes": [["Faster", "decisions"], ["Continuous", "monitoring"], ["Earlier", "signals"]],
        },
        "roadmap": {
            "eyebrow": "Roadmap", "idx": "06",
            "title": "Now, next, later \u2014 on a 30-day operating clock.",
            "days": ["Day 0", "Day 30", "Day 60", "Day 90"],
            "currentDay": 1,
            "phases": [
                ["NOW", "Day 0 \u2013 30", [
                    ["done", "28 discovery interviews completed"],
                    ["active", "5 design partners signed"],
                ]],
                ["NEXT", "Day 31 \u2013 60", [
                    ["pending", "Live pilot with 3 design partners"],
                    ["pending", "Scoring API v1 in production"],
                ]],
                ["LATER", "Day 61 \u2013 90", [
                    ["pending", "First paid contracts signed"],
                    ["pending", "Seed round opened"],
                ]],
            ],
        },
        "team": {
            "eyebrow": "Team & Network", "idx": "07",
            "title": "A founder backed by an operating network.",
            "founder": {"initials": "—", "name": "Founder", "role": "Founder & CEO",
                        "bio": "[draft — add your founder profile in the Team module]"},
            "advisorsLabel": "ADVISORS & MENTORS",
            "advisors": [["DK", "Daniel Kerr", "Former CRO"], ["RP", "Rina Patel", "Fintech GTM"]],
            "centerName": name,
            "nodes": [
                [9.35, 2.50, "Axal VC", "studio + capital"],
                [11.85, 4.15, "Capital network", "investor intros"],
                [9.35, 5.80, "Design partners", "pilot pipeline"],
                [6.85, 4.15, "Advisor bench", "operating help"],
            ],
        },
        "captable": {
            "eyebrow": "Cap table & incorporation", "idx": "08",
            "title": "Entity-ready: clean cap table and founder setup.",
            "checklistLabel": "FOUNDER & ENTITY SETUP",
            "items": [
                ["Entity incorporated", "done"],
                ["Cap table recorded", "done"],
                ["Founder equity issued", "done"],
                ["Brand kit ready", "active"],
                ["Pitch deck ready", "active"],
                ["Data room ready", "pending"],
            ],
            "donutLabel": "CAP TABLE · FULLY DILUTED",
            "centerBig": "100%", "centerSmall": "fully diluted",
            "segments": [["Founders", 80], ["Option pool", 15], ["Reserved", 5]],
        },
        "ask": {
            "eyebrow": "The ask", "idx": "09",
            "title": "Raising a pre-seed round to reach revenue.",
            "kpis": [["$750K", "Target raise"], ["SAFE", "Instrument"], ["18 mo", "Runway"], ["Pre-seed", "Stage"]],
            "useLabel": "USE OF FUNDS",
            "funds": [
                ["Engineering & product", 45],
                ["Go-to-market", 25],
                ["Data & infrastructure", 20],
                ["Operations & legal", 10],
            ],
            "milestone": ["Gets us to:", "[draft — add your next funding milestone in the Capital module]"],
        },
        "deal": {
            "eyebrow": "Deal readiness", "idx": "10",
            "title": "Data room open. Ready to move.",
            "diligenceLabel": "DILIGENCE PACKAGE",
            "ready": [
                ["Data room", "Pending"],
                ["Financial model", "On request"],
                ["Cap table & legal docs", "Included"],
                ["Customer references", "On request"],
                ["NDA", "Not required"],
            ],
            "nextLabel": "NEXT STEPS",
            "steps": [
                ["1", "30-minute intro call"],
                ["2", "Data room access granted same day"],
                ["3", "SAFE \u2014 target close in weeks"],
            ],
            "closingLine": "Open to diligence and intros this week.",
            "contact": f"hello@{name.lower().replace(' ', '')}.xyz   ·   axal.vc",
        },
    }

    notes = {
        "cover": "COVER. Focal: thesis statement; area chart is the data hero (cumulative discovery interviews over the sprint).\nAUTO: company, thesis, sector/stage/founder, lab-day counter, validation-signal series.\nMANUAL: final thesis wording.",
        "problem": "PROBLEM. Message: a few high-frequency, evidenced pains, ranked.\nAUTO: pain themes, frequency %, interview counts, pull quote.\nMANUAL: choose which quote to surface; trim labels.",
        "validation": "VALIDATION. Message: measurable signal from the sprint.\nAUTO: scorecard values, funnel stage counts, conversion rate.\nMANUAL: confirm funnel stages (outreach / LOIs) where not tracked.",
        "market": "MARKET. Message: credible bottom-up serviceable market.\nAUTO: TAM/SAM/SOM figures, why-now lines.\nMANUAL: sizing assumptions + citation basis.",
        "solution": "SOLUTION. Message: data \u2192 live score, four steps.\nAUTO: step copy from capabilities.\nMANUAL: confirm target outcome metrics vs. latest pilot.",
        "roadmap": "ROADMAP. Message: operating plan on the 30-day cadence.\nAUTO: Now/Next/Later from OKRs + status flags.\nMANUAL: none if tracker is current.",
        "team": "TEAM & NETWORK. Message: founder inside a structured operating network.\nAUTO: founder profile, advisor/mentor roster, network nodes.\nMANUAL: advisor consent; swap initials for headshots.",
        "captable": "CAP TABLE & INCORPORATION. Message: legal + equity setup is investor-ready.\nAUTO: readiness checklist statuses, cap-table splits.\nMANUAL: none if module current.",
        "ask": "THE ASK. Message: specific raise tied to a milestone.\nAUTO: raise, runway, allocations, milestone.\nMANUAL: confirm instrument/cap + close with counsel.",
        "deal": "DEAL READINESS. Message: diligence-ready now, frictionless next step.\nAUTO: document statuses, contact.\nMANUAL: confirm live data-room link.",
    }

    gaps = [
        "Team: add your founder profile in the Cofounder/Team module.",
        "The ask: add your next funding milestone in the Capital module.",
    ]
    if not pain_bars:
        gaps.append("Problem: cluster discovery pains in the Customer Discovery module.")

    def _flatten(data: dict) -> dict:
        """Task #55 — mirror of the Worker's flattenSpinoutDeckData()."""
        out = {}
        forbidden = {"__proto__", "prototype", "constructor"}
        sections = {"brand", "cover", "problem", "validation", "market", "solution", "roadmap", "team", "captable", "ask", "deal"}
        dash = "\u2014"
        def has(v):
            return isinstance(v, str) and v.strip() and v.strip() != dash
        def walk(prefix, value):
            if value is None:
                return
            if isinstance(value, str):
                if has(value):
                    out[prefix] = value
                return
            if isinstance(value, (list, tuple)):
                out[f"{prefix}_json"] = json.dumps(value)
                return
            if isinstance(value, dict):
                for k, v in value.items():
                    if k in forbidden:
                        continue
                    walk(f"{prefix}.{k}", v)
                return
            # primitives
            out[prefix] = str(value)
        for section, section_data in data.items():
            if section not in sections or section in forbidden:
                continue
            if section_data is None:
                continue
            walk(section, section_data)
        return out

    return {"data": data, "notes": notes, "gaps": gaps, "draft": True, "program_day": program_day, "fields": _flatten(data)}


@router.post("/{project_id}/spinout-deck")
def spinout_deck(
    project_id: int,
    preview: int = 0,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Task #41 — dev mirror of the Worker's POST /api/projects/:id/spinout-deck.

    Returns the assembled Spin-Out deck DATA + NOTES + gaps[] so the browser
    can build/download the .pptx in the Replit preview. Prod runs the real
    remap in the Worker; this dev route is a deterministic partial mirror.

    `?preview=1` returns only the gaps[] + draft + program_day so the deck page
    can show the pre-flight readiness checklist before the founder exports.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_founder_access(user, project.founder_id)
    payload = _spinout_deck_payload(project, session)
    if preview == 1:
        return {
            "gaps": payload["gaps"],
            "draft": payload["draft"],
            "program_day": payload["program_day"],
        }
    return payload


@router.get("/")
def list_projects(status: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Project).order_by(Project.created_at.desc())
    # IDOR guard: founders may only see their own projects.
    if not is_privileged(user):
        if not user.founder_id:
            return []
        stmt = stmt.where(Project.founder_id == user.founder_id)
    if status:
        stmt = stmt.where(Project.status == status)
    return session.exec(stmt).all()


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # IDOR guard: founders may only read their own project.
    ensure_founder_access(user, project.founder_id)
    founder = session.get(Founder, project.founder_id) if project.founder_id else None
    # Task #41 — surface the founder's *user* id so the LockedFounderCard
    # on the investor-side /deals view can resolve the NDA pair. Mirrors
    # the worker's `LEFT JOIN users u ON u.founder_id = p.founder_id` in
    # cloudflare-worker/src/routes/projects.ts:24.
    founder_user_id = None
    if project.founder_id:
        row = session.exec(
            text("SELECT id FROM users WHERE founder_id = :fid LIMIT 1").bindparams(
                fid=project.founder_id
            )
        ).first()
        if row:
            founder_user_id = row[0] if isinstance(row, tuple) else row._mapping["id"]
    return {
        **project.model_dump(),
        "founder": founder.model_dump() if founder else None,
        "founder_user_id": founder_user_id,
    }


@router.post("/")
def create_project(data: ProjectCreate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    founder_id = None
    if data.founder_email:
        stmt = select(Founder).where(Founder.email == data.founder_email)
        founder = session.exec(stmt).first()
        if not founder:
            founder = Founder(
                name=data.founder_name or "Unknown",
                email=data.founder_email,
            )
            session.add(founder)
            session.commit()
            session.refresh(founder)
        founder_id = founder.id

    project = Project(
        name=data.name,
        description=data.description,
        sector=data.sector,
        stage=data.stage,
        founder_id=founder_id,
        problem_statement=data.problem_statement,
        solution=data.solution,
        why_now=data.why_now,
        tam=data.tam,
        sam=data.sam,
        cost_to_mvp=data.cost_to_mvp,
        funding_needed=data.funding_needed,
        use_of_funds=data.use_of_funds,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    deal = Deal(project_id=project.id, status="applied")
    session.add(deal)

    log = ActivityLog(
        project_id=project.id,
        action="project_created",
        details=f"Project '{project.name}' submitted",
    )
    session.add(log)
    session.commit()

    return project


@router.post("/submit")
async def founder_submit_startup(
    request: Request,
    data: FounderSubmitRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Epic 5: reject server-derived fields (score, tier, integrity_hash, ...)
    # BEFORE any DB writes. We check the raw body — Pydantic would silently
    # drop the extras and a malicious founder could otherwise have a project
    # row created as a side effect of a "rejected" request.
    try:
        raw = await request.json()
        if isinstance(raw, dict):
            assert_no_reserved_fields(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e), "code": "reserved_field"})
    except Exception:
        # body wasn't JSON-parseable — Pydantic will surface a 422 below.
        pass

    stmt = select(Founder).where(Founder.email == data.founder_email)
    founder = session.exec(stmt).first()
    if not founder:
        founder = Founder(
            name=data.founder_name,
            email=data.founder_email,
        )
        session.add(founder)
        session.commit()
        session.refresh(founder)

    project = Project(
        name=data.name,
        description=data.description,
        sector=data.sector,
        stage="idea",
        founder_id=founder.id,
        problem_statement=data.problem_statement,
        solution=data.solution,
        why_now=data.why_now,
        tam=data.tam,
        sam=data.sam,
        cost_to_mvp=data.cost_to_mvp,
        funding_needed=data.funding_needed,
        use_of_funds=data.use_of_funds,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    score_data = {
        "tam": data.tam or 0,
        "market_urgency": data.market_urgency,
        "market_trend": data.market_trend,
        "team_expertise": data.team_expertise,
        "team_execution": data.team_execution,
        "team_network": data.team_network,
        "mvp_time_days": data.mvp_time_days,
        "product_complexity": data.product_complexity,
        "product_dependencies": data.product_dependencies,
        "cost_to_mvp": data.cost_to_mvp or 100000,
        "time_to_revenue_months": data.time_to_revenue_months,
        "burn_risk": data.burn_risk,
        "fit_alignment": data.fit_alignment,
        "fit_synergy": data.fit_synergy,
        "distribution_channels": data.distribution_channels,
        "distribution_virality": data.distribution_virality,
    }

    result = run_full_score(score_data)

    # Epic 5 anti-cheat parity with the Worker `/submit` and `/scoring/score`
    # paths: sign + flag the intake snapshot before it can drive a tier
    # promotion. Anomaly detection MUST run BEFORE the snapshot is added
    # to the session so the latest-snapshot lookup doesn't self-compare.
    from backend.app.services.score_integrity import (
        sign_score, detect_anomalies, INTEGRITY_VERSION,
    )
    intake_flags = detect_anomalies(
        session,
        project_id=project.id,
        new_total=result["total_score"],
        new_inputs=score_data,
        is_sandbox=False,
    )
    intake_review = "flagged" if intake_flags else "auto_approved"
    locked_until = datetime.utcnow() + timedelta(days=7)

    snapshot = ScoreSnapshot(
        project_id=project.id,
        total_score=result["total_score"],
        tier=result["tier"],
        market_size=result["breakdown"]["market"]["size"],
        market_urgency=result["breakdown"]["market"]["urgency"],
        market_trend=result["breakdown"]["market"]["trend"],
        market_total=result["breakdown"]["market"]["total"],
        team_expertise=result["breakdown"]["team"]["expertise"],
        team_execution=result["breakdown"]["team"]["execution"],
        team_network=result["breakdown"]["team"]["network"],
        team_total=result["breakdown"]["team"]["total"],
        product_mvp_time=result["breakdown"]["product"]["mvp_time"],
        product_complexity=result["breakdown"]["product"]["complexity"],
        product_dependency=result["breakdown"]["product"]["dependency"],
        product_total=result["breakdown"]["product"]["total"],
        capital_cost_mvp=result["breakdown"]["capital"]["cost_mvp"],
        capital_time_revenue=result["breakdown"]["capital"]["time_revenue"],
        capital_burn_traction=result["breakdown"]["capital"]["burn_traction"],
        capital_total=result["breakdown"]["capital"]["total"],
        fit_alignment=result["breakdown"]["fit"]["alignment"],
        fit_synergy=result["breakdown"]["fit"]["synergy"],
        fit_total=result["breakdown"]["fit"]["total"],
        distribution_channels=result["breakdown"]["distribution"]["channels"],
        distribution_virality=result["breakdown"]["distribution"]["virality"],
        distribution_total=result["breakdown"]["distribution"]["total"],
        ai_adjustment=0,
        scored_by="auto",
        is_sandbox=False,
        integrity_version=INTEGRITY_VERSION,
        inputs_json=json.dumps(score_data),
        anomaly_flags=json.dumps(intake_flags) if intake_flags else None,
        admin_review_status=intake_review,
        locked_until=locked_until,
    )
    session.add(snapshot)
    # Flush so created_at is populated by the DB; the canonical message
    # MUST hash the row's persisted timestamp or verify_score will reject
    # the snapshot on the very next read (round-trip identity must hold).
    session.flush()
    session.refresh(snapshot)
    digest, _ts_iso = sign_score(project.id, result["total_score"], snapshot.created_at)
    snapshot.integrity_hash = digest
    session.add(snapshot)

    # Flagged intake holds the project at "scoring" until admin signs off in
    # MonitoringPage — same LP guarantee as the Worker path. Auto-approved
    # runs follow the existing tier promotion rules.
    if intake_review == "flagged":
        project.status = "scoring"
        deal_status = "applied"
    elif result["total_score"] >= 85:
        project.status = "tier_1"
        project.stage = "build"
        deal_status = "active"
    elif result["total_score"] >= 70:
        project.status = "tier_2"
        deal_status = "scored"
    else:
        project.status = "rejected"
        deal_status = "rejected"

    project.updated_at = datetime.utcnow()
    session.add(project)

    deal = Deal(project_id=project.id, status=deal_status)
    session.add(deal)

    log = ActivityLog(
        project_id=project.id,
        action="auto_scored",
        details=(
            f"Score: {result['total_score']}, Tier: {result['tier']}, "
            f"Status: {project.status}, Review: {intake_review}"
        ),
        actor="system",
    )
    session.add(log)

    if intake_flags:
        session.add(ActivityLog(
            project_id=project.id,
            action="score_anomaly",
            details=json.dumps({
                "snapshot_id": None,  # filled post-flush below
                "flags": intake_flags,
                "status": intake_review,
            }),
            actor="system",
        ))

    session.commit()
    session.refresh(project)
    session.refresh(snapshot)

    return {
        "project": project,
        "score": result,
        "auto_decision": {
            "status": project.status,
            "stage": project.stage,
            "tier": result["tier"],
            "tier_label": result["tier_label"],
        },
    }


@router.put("/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    _ensure_can_edit(user, project)

    update_data = data.model_dump(exclude_unset=True)
    # Founders may not change status, stage, or playbook week — only privileged roles.
    if not is_privileged(user):
        for protected in ("status", "stage", "playbook_week"):
            update_data.pop(protected, None)
    for key, val in update_data.items():
        setattr(project, key, val)
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        dialect = session.bind.dialect.name if session.bind else ""
        if dialect == "postgresql":
            rows = session.execute(text(
                """
                SELECT tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND ccu.table_name = 'projects'
                  AND ccu.column_name = 'id'
                """
            )).all()
            for table, col in rows:
                session.execute(
                    text(f'DELETE FROM "{table}" WHERE "{col}" = :pid'),
                    {"pid": project_id},
                )
        session.delete(project)
        session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        session.rollback()
        logger.exception("delete_project failed for id=%s: %s", project_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {exc}")
    return {"ok": True}


@router.post("/{project_id}/advance-week")
def advance_playbook_week(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not is_privileged(user):
        raise HTTPException(status_code=403, detail="Only admin/partner can advance playbook week")

    order = ["week_1", "week_2", "week_3", "week_4", "complete"]
    current_idx = order.index(project.playbook_week) if project.playbook_week in order else 0
    if current_idx < len(order) - 1:
        project.playbook_week = order[current_idx + 1]
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
        session.refresh(project)
    return project
