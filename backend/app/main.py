import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.api.routes import (
    activity,
    admin,
    advisory,
    auth,
    capital,
    deals,
    funds,
    integrations,
    legal,
    liquidity,
    market_intel,
    monitoring,
    partners,
    partnernet,
    pipeline_votes,
    private_data,
    projects,
    scoring,
    tickets,
    users,
)
from backend.app.api.routes.auth import get_current_user
from backend.app.database import init_db

logger = logging.getLogger("studioos")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("StudioOS starting up — initializing database")
    init_db()
    try:
        from backend.app.models.migrations import consolidate_capital_tables
        consolidate_capital_tables()
        logger.info("StudioOS migrations: capital tables consolidated")
    except Exception as exc:  # noqa: BLE001
        # Migrations are best-effort: a failure here must not prevent the API
        # from booting (e.g. fresh DB, missing legacy tables).
        logger.warning("StudioOS migrations: consolidate_capital_tables skipped: %s", exc)
    logger.info("StudioOS ready")
    yield
    logger.info("StudioOS shutting down")


app = FastAPI(
    title="Axal StudioOS",
    description="The 30-Day Spin-Out Engine API",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
JEKYLL_ORIGIN = os.environ.get("JEKYLL_ORIGIN", "")
REPLIT_DOMAIN = os.environ.get("REPLIT_DEV_DOMAIN", "")
EXTRA_ORIGINS = [o.strip() for o in JEKYLL_ORIGIN.split(",") if o.strip()] if JEKYLL_ORIGIN else []
REPLIT_DEPLOY_DOMAIN = os.environ.get("REPL_SLUG", "") + "-" + os.environ.get("REPL_OWNER", "") + ".replit.app"

CORS_ORIGINS = [
    "https://axal.vc",
    "https://www.axal.vc",
    "https://studio-os-vjstele.replit.app",
    "http://localhost:5000",
    "http://localhost:5173",
] + EXTRA_ORIGINS

if REPLIT_DOMAIN:
    CORS_ORIGINS.append(f"https://{REPLIT_DOMAIN}")
if REPLIT_DEPLOY_DOMAIN and REPLIT_DEPLOY_DOMAIN != "-.replit.app":
    CORS_ORIGINS.append(f"https://{REPLIT_DEPLOY_DOMAIN}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Trusted hosts (defense-in-depth against Host-header attacks)
# Permissive by default — Replit's proxy strips/sets Host on its way in.
# ---------------------------------------------------------------------------
ALLOWED_HOSTS = [
    "axal.vc",
    "www.axal.vc",
    "*.replit.dev",
    "*.replit.app",
    "*.repl.co",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "testserver",
]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


# ---------------------------------------------------------------------------
# Security headers + lightweight observability
# ---------------------------------------------------------------------------
@app.middleware("http")
async def security_and_observability(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
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
app.include_router(admin.router, prefix="/api")
app.include_router(private_data.router, prefix="/api")
app.include_router(monitoring.router, prefix="/api")
app.include_router(funds.router, prefix="/api")
app.include_router(liquidity.router, prefix="/api")
app.include_router(partnernet.router, prefix="/api")
app.include_router(pipeline_votes.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
from backend.app.api.routes import email as email_routes  # noqa: E402
app.include_router(email_routes.router, prefix="/api")
app.include_router(email_routes.unsubscribe_router, prefix="/api")


# ---------------------------------------------------------------------------
# Global exception handlers — structured JSON errors
# ---------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "ok": False,
            "error": {
                "code": exc.status_code,
                "type": "http_error",
                "message": exc.detail if isinstance(exc.detail, str) else "HTTP error",
                "path": request.url.path,
            },
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "error": {
                "code": 422,
                "type": "validation_error",
                "message": "Request validation failed",
                "details": exc.errors(),
                "path": request.url.path,
            },
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error": {
                "code": 500,
                "type": "internal_error",
                "message": "Internal server error",
                "path": request.url.path,
            },
        },
    )


# ---------------------------------------------------------------------------
# Health + dashboard stats
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "app": "StudioOS v1.0", "tagline": "The 30-Day Spin-Out Engine"}


@app.get("/api/dashboard/stats")
def dashboard_stats(user=Depends(get_current_user)):
    from sqlmodel import Session, func, select

    from backend.app.database import engine
    from backend.app.models.entities import (
        Deal,
        Document,
        LimitedPartner,
        Partner,
        Project,
        ScoreSnapshot,
        Ticket,
        User,
    )

    with Session(engine) as session:
        total_projects = session.exec(select(func.count(Project.id))).first() or 0
        active_projects = session.exec(
            select(func.count(Project.id)).where(Project.status.in_(["tier_1", "tier_2", "spinout", "active"]))
        ).first() or 0
        pending_scoring = session.exec(
            select(func.count(Project.id)).where(Project.status.in_(["intake", "scoring"]))
        ).first() or 0
        total_partners = session.exec(select(func.count(Partner.id))).first() or 0
        total_investors = session.exec(select(func.count(LimitedPartner.id))).first() or 0
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


# ---------------------------------------------------------------------------
# Static SPA fallback (last so /api routes win)
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
