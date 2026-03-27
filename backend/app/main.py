import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.app.database import init_db
from backend.app.api.routes import scoring, projects, legal, partners, capital, tickets, deals, users, market_intel, advisory, activity, auth

app = FastAPI(
    title="Axal VC — StudioOS",
    description="The 30-Day Spin-Out Engine API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scoring.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(legal.router, prefix="/api")
app.include_router(partners.router, prefix="/api")
app.include_router(capital.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")
app.include_router(deals.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(market_intel.router, prefix="/api")
app.include_router(advisory.router, prefix="/api")
app.include_router(activity.router, prefix="/api")
app.include_router(auth.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "StudioOS v1.0", "tagline": "The 30-Day Spin-Out Engine"}


@app.get("/api/dashboard/stats")
def dashboard_stats():
    from sqlmodel import Session, select, func
    from backend.app.database import engine
    from backend.app.models.entities import Project, ScoreSnapshot, Partner, LPInvestor, Ticket, Document, Deal, User

    with Session(engine) as session:
        total_projects = session.exec(select(func.count(Project.id))).first() or 0
        active_projects = session.exec(
            select(func.count(Project.id)).where(Project.status.in_(["tier_1", "tier_2", "spinout", "active"]))
        ).first() or 0
        pending_scoring = session.exec(
            select(func.count(Project.id)).where(Project.status.in_(["intake", "scoring"]))
        ).first() or 0
        total_partners = session.exec(select(func.count(Partner.id))).first() or 0
        total_investors = session.exec(select(func.count(LPInvestor.id))).first() or 0
        open_tickets = session.exec(
            select(func.count(Ticket.id)).where(Ticket.status.in_(["open", "in_progress"]))
        ).first() or 0
        total_documents = session.exec(select(func.count(Document.id))).first() or 0

        avg_score = session.exec(select(func.avg(ScoreSnapshot.total_score))).first()

        total_deals = session.exec(select(func.count(Deal.id))).first() or 0
        active_deals = session.exec(
            select(func.count(Deal.id)).where(Deal.status.in_(["applied", "scored", "active"]))
        ).first() or 0
        total_users = session.exec(select(func.count(User.id))).first() or 0

    return {
        "total_projects": total_projects,
        "active_projects": active_projects,
        "pending_scoring": pending_scoring,
        "total_partners": total_partners,
        "total_investors": total_investors,
        "open_tickets": open_tickets,
        "total_documents": total_documents,
        "avg_score": round(avg_score, 1) if avg_score else None,
        "total_deals": total_deals,
        "active_deals": active_deals,
        "total_users": total_users,
    }


STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
