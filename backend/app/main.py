import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlmodel import Session
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
    investor_signals as _investor_signals,
    legal,
    liquidity,
    market_intel,
    matches,
    monitoring,
    partners,
    partnernet,
    personas,
    pipeline_votes,
    private_data,
    projects,
    scoring,
    tickets,
    users,
)
from backend.app.api.routes.auth import get_current_user
from backend.app.database import init_db
from backend.app.services.db_guards import install_db_guards
from backend.app.services.rate_limit import RateLimitMiddleware

logger = logging.getLogger("studioos")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # T0 — Loud startup banner so nobody confuses this with production.
    logger.warning(
        "=" * 72 + "\n"
        "  StudioOS FastAPI — REPLIT-DEV-ONLY backend\n"
        "  Production API is the Cloudflare Worker at https://axal.vc\n"
        "  This process is NEVER deployed. See CLAUDE.md for architecture.\n"
        + "=" * 72
    )
    logger.info("StudioOS starting up — initializing database")
    # Phase 0.2 — capture the main asyncio event loop so sync route handlers
    # (tickets/deals/capital) can schedule WS broadcasts via the notification
    # publisher without resorting to per-call asyncio.run(), which is unsafe
    # to call from a worker thread that already has a different loop policy.
    try:
        import asyncio as _asyncio
        from backend.app.services import notify as _notify
        _notify.MAIN_LOOP = _asyncio.get_running_loop()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("StudioOS: failed to capture main loop for notify: %s", _exc)
    init_db()
    # Audit #1: seal legacy write paths to lp_investors and entities(type=vc_fund).
    install_db_guards()
    logger.info("StudioOS db guards: legacy write paths sealed")
    try:
        from backend.app.models.migrations import (
            consolidate_capital_tables,
            ensure_brand_landing_columns,
            ensure_growth_track_columns,
            ensure_project_revenue_proof_columns,
            ensure_project_product_demo_columns,
            ensure_project_incorporation_meta_column,
            ensure_project_uof_meta_column,
            ensure_project_market_sizing_columns,
            ensure_lifecycle_columns,
            ensure_document_file_columns,
            ensure_user_access_level_column,
            ensure_ticket_github_columns,
            ensure_score_anti_cheat_columns,
            ensure_investor_role_split,
            ensure_marketplace_columns,
            ensure_service_catalogue_columns,
            ensure_partner_directory_columns,
            ensure_references_table,
            ensure_founder_risk_profiles_table,
            ensure_cap_table_scenarios_table,
            ensure_advisor_profiles_tables,
            ensure_trust_layer_columns,
            ensure_advisor_tables,
            ensure_calendar_tables,
            ensure_market_intel_tables,
            ensure_matching_tables,
            ensure_task54_tables,
            ensure_task46_tables,
            ensure_cofounder_tables,
            ensure_project_membership_tables,
            ensure_portfolio_health_tables,
            ensure_watchlist_decision_tables,
            ensure_push_subscriptions_table,
            ensure_section_83b_tracker_table,
            ensure_compliance_events_table,
            ensure_compliance_reminder_runs_table,
            ensure_wellbeing_tables,
            ensure_user_handle_column,
            ensure_network_introductions_tables,
            ensure_intro_network_tables,
            ensure_organizations_table,
            ensure_deal_flow_tables,
            ensure_orders_tables,
            ensure_spinout_lab_tables,
            ensure_exploring_role_enum,
        )
        ensure_brand_landing_columns()
        logger.info("StudioOS migrations: brand landing columns ensured")
        ensure_growth_track_columns()
        logger.info("StudioOS migrations: growth track columns ensured")
        ensure_project_revenue_proof_columns()
        logger.info("StudioOS migrations: project revenue-proof columns ensured")
        ensure_project_product_demo_columns()
        logger.info("StudioOS migrations: project product-demo columns ensured")
        ensure_project_uof_meta_column()
        ensure_project_incorporation_meta_column()
        logger.info("StudioOS migrations: project use-of-funds meta column ensured")
        ensure_project_market_sizing_columns()
        logger.info("StudioOS migrations: project market-sizing (som) column ensured")
        ensure_lifecycle_columns()
        logger.info("StudioOS migrations: project lifecycle columns ensured")
        ensure_document_file_columns()
        logger.info("StudioOS migrations: document file columns ensured")
        ensure_user_access_level_column()
        logger.info("StudioOS migrations: user.access_level column ensured")
        # Task — GitHub ticket sync: mirror issue number/url onto tickets.
        ensure_ticket_github_columns()
        logger.info("StudioOS migrations: ticket github columns ensured")
        # Epic 5 — anti-cheat columns on score_snapshots (HMAC, sandbox flag,
        # admin review state, 7-day cooldown).
        ensure_score_anti_cheat_columns()
        logger.info("StudioOS migrations: score anti-cheat columns ensured")
        consolidate_capital_tables()
        logger.info("StudioOS migrations: capital tables consolidated")
        # Phase 0.1 — partner→investor split. Must run AFTER LimitedPartner
        # consolidation so the promotion query sees a complete LP table.
        ensure_investor_role_split()
        logger.info("StudioOS migrations: investor role split applied")
        ensure_marketplace_columns()
        # Task #53 — public directory slug + featured slot columns.
        # Must run before service-catalogue migrations so `partners.slug`
        # exists when downstream queries join on it.
        ensure_partner_directory_columns()
        logger.info("StudioOS migrations: marketplace columns ensured")
        ensure_service_catalogue_columns()
        logger.info("StudioOS migrations: service catalogue + engagement lifecycle ensured")
        # Task #43 — reference check workflow tables.
        ensure_references_table()
        logger.info("StudioOS migrations: references table ensured")
        # Task #41 — founder risk profiles.
        ensure_founder_risk_profiles_table()
        logger.info("StudioOS migrations: founder_risk_profiles table ensured")
        # Task #27 — cap-table simulator scenarios.
        ensure_cap_table_scenarios_table()
        logger.info("StudioOS migrations: cap_table_scenarios table ensured")
        # Task #75 — Advisory Suite advisor directory (directory mirror only).
        ensure_advisor_profiles_tables()
        logger.info("StudioOS migrations: advisor_profiles tables ensured")
        # Task #58 — trust layer hardening.
        ensure_trust_layer_columns()
        logger.info("StudioOS migrations: trust layer columns ensured")
        # Task #35 — advisor matching + office hours.
        ensure_advisor_tables()
        logger.info("StudioOS migrations: advisor tables ensured")
        # Task #56 — unified calendar layer.
        ensure_calendar_tables()
        logger.info("StudioOS migrations: calendar tables ensured")
        # Task #35 — Market Intelligence dev parity (watchlist + per-user flags).
        ensure_market_intel_tables()
        logger.info("StudioOS migrations: market intel tables ensured")
        # Task #36 — AI Matching Engine dev parity (preferences + referral funnel).
        ensure_matching_tables()
        logger.info("StudioOS migrations: matching tables ensured")
        # Task #54 — partner office hours + co-marketing pitches + attribution.
        ensure_task54_tables()
        logger.info("StudioOS migrations: task #54 tables ensured")
        # Task #46 — reserve allocation + waterfall simulator tables.
        ensure_task46_tables()
        logger.info("StudioOS migrations: task #46 tables ensured")
        # Task #38 — co-founder matching tables.
        ensure_cofounder_tables()
        logger.info("StudioOS migrations: cofounder tables ensured")
        # Task #1 — Spin-Out teams collaboration (project membership layer).
        ensure_project_membership_tables()
        logger.info("StudioOS migrations: project membership tables ensured")
        # Task #31 — 83(b) tracker idempotency unique index.
        ensure_section_83b_tracker_table()
        logger.info("StudioOS migrations: section_83b_trackers unique index ensured")
        # Task #44 — portfolio health snapshots.
        ensure_portfolio_health_tables()
        logger.info("StudioOS migrations: portfolio health tables ensured")
        # Task #49 — watchlist + decision journal tables.
        ensure_watchlist_decision_tables()
        logger.info("StudioOS migrations: watchlist + decision journal tables ensured")
        # Task #57 — web push subscriptions table.
        ensure_push_subscriptions_table()
        logger.info("StudioOS migrations: push subscriptions table ensured")
        # Task #32 — compliance calendar events table + daily-run lease.
        ensure_compliance_events_table()
        ensure_compliance_reminder_runs_table()
        logger.info("StudioOS migrations: compliance_events table ensured")
        # Task #40 — founder wellbeing pulse + resource directory.
        ensure_wellbeing_tables()
        logger.info("StudioOS migrations: wellbeing tables ensured")
        # Task #12 — secure introductions & matching flow tables.
        ensure_network_introductions_tables()
        logger.info("StudioOS migrations: network introductions tables ensured")
        # Credits-based Introductions propositions dev parity (worker-only in prod).
        ensure_intro_network_tables()
        logger.info("StudioOS migrations: intro network (propositions/credits) tables ensured")
        # Task #16 — Organizations directory (real VC funds / deep-tech investors).
        ensure_organizations_table()
        ensure_deal_flow_tables()
        logger.info("StudioOS migrations: deal-flow tables ensured")
        # Task #8 — commerce cart/checkout tables + users.stripe_customer_id.
        ensure_orders_tables()
        logger.info("StudioOS migrations: orders/commerce tables ensured")
        # Task #9 parity — userrole enum must include EXPLORING before the
        # demo seeder tries to create demo-exploring@axal.test.
        ensure_exploring_role_enum()
        logger.info("StudioOS migrations: exploring role enum ensured")
        ensure_spinout_lab_tables()
        logger.info("StudioOS migrations: spinout lab tables ensured")
        logger.info("StudioOS migrations: organizations table ensured")
        from backend.app.services.organizations_import import bootstrap_organizations
        bootstrap_organizations()
        logger.info("StudioOS seed: organizations directory bootstrapped")
        # Task #55 — public profile handle column + backfill.
        ensure_user_handle_column()
        logger.info("StudioOS migrations: user.handle column ensured")
        # Task #41 — demo investor + founder + project + deal so the
        # dev quick-login button and the Trust Center e2e flow have a
        # real deal to drive. Idempotent; refuses to seed when
        # ENVIRONMENT=production. Also creates the dev-only
        # `dev_pairwise_ndas` table backing the local /trust/intro stub.
        from backend.app.services.demo_seed import (
            ensure_dev_pairwise_ndas_table,
            seed_demo_investor_and_founder,
        )
        ensure_dev_pairwise_ndas_table()
        seed_demo_investor_and_founder()
        logger.info("StudioOS demo seed: demo investor + founder ready")
    except Exception as exc:  # noqa: BLE001
        # Migrations are best-effort: a failure here must not prevent the API
        # from booting (e.g. fresh DB, missing legacy tables).
        logger.warning("StudioOS migrations: skipped: %s", exc)
    # Task #52 — start the in-process weekly insights digest loop. Wakes
    # hourly, fires once per ISO week (de-duped via insight_digests.week_start).
    digest_stop = asyncio.Event()
    digest_task = None
    try:
        from backend.app.api.routes.insights import weekly_digest_loop as _wdl
        digest_task = asyncio.create_task(_wdl(digest_stop))
    except Exception as exc:  # noqa: BLE001
        logger.warning("StudioOS: failed to start insights digest loop: %s", exc)
    # Task #44 — portfolio health daily sweep loop.
    health_stop = asyncio.Event()
    health_task = None
    try:
        from backend.app.services.portfolio_health import daily_health_loop as _dhl
        health_task = asyncio.create_task(_dhl(health_stop))
    except Exception as exc:  # noqa: BLE001
        logger.warning("StudioOS: failed to start portfolio health loop: %s", exc)
    # Task #32 — compliance calendar daily reminder loop.
    compliance_stop = asyncio.Event()
    compliance_task = None
    try:
        from backend.app.services.compliance_reminders import reminder_loop as _crl
        compliance_task = asyncio.create_task(_crl(compliance_stop))
    except Exception as exc:  # noqa: BLE001
        logger.warning("StudioOS: failed to start compliance reminder loop: %s", exc)
    logger.info("StudioOS ready")
    yield
    logger.info("StudioOS shutting down")
    if digest_task:
        digest_stop.set()
        try:
            await asyncio.wait_for(digest_task, timeout=5)
        except Exception:  # noqa: BLE001
            digest_task.cancel()
    if health_task:
        health_stop.set()
        try:
            await asyncio.wait_for(health_task, timeout=5)
        except Exception:  # noqa: BLE001
            health_task.cancel()
    if compliance_task:
        compliance_stop.set()
        try:
            await asyncio.wait_for(compliance_task, timeout=5)
        except Exception:  # noqa: BLE001
            compliance_task.cancel()


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
# Per-bucket rate limits (audit #8) — mirrors the worker bucket layout.
# ---------------------------------------------------------------------------
app.add_middleware(RateLimitMiddleware)


# ---------------------------------------------------------------------------
# Security headers + lightweight observability
# ---------------------------------------------------------------------------
# Epic 11 — CSP is now nonce-based. Each request gets a fresh 128-bit nonce
# generated below; route handlers that emit HTML can read it via
# `request.state.csp_nonce` and stamp it onto any inline `<script>` tag
# they need to ship. The header advertises the nonce so the browser knows
# which inline scripts are allowed. `'strict-dynamic'` lets a nonce'd
# loader script bring in additional scripts without each one needing its
# own nonce — modern OWASP-recommended pattern.
import secrets


@app.middleware("http")
async def security_and_observability(request: Request, call_next):
    # 16 random bytes -> 22-char URL-safe base64 (no padding). Issued
    # before the route runs so handlers can read it.
    nonce = secrets.token_urlsafe(16)
    request.state.csp_nonce = nonce

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    # Mirror the production Worker's canonical `no-referrer` (NICE-SEC-01) so the
    # dev surface matches prod — this FastAPI process is dev-only but serves the
    # same authenticated app/API shape, where IDs/query-params must never leak.
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # T0 — Architecture truth. This FastAPI process is Replit-dev-only and is
    # NEVER deployed to production. Production lives on the Cloudflare Worker
    # at axal.vc (see CLAUDE.md). The header below makes that visible to any
    # client/dev tool / curl debugger so we never confuse a dev response with
    # production behaviour.
    response.headers.setdefault("X-Backend-Mode", "replit-dev-only")
    response.headers.setdefault("X-Canonical-Backend", "cloudflare-worker:axal.vc")
    # Content Security Policy — Zero Trust posture. Tight default-src,
    # nonce-required for inline JS, frames denied. Vite/React inline styles
    # are needed for component libraries, hence 'unsafe-inline' for
    # style-src only. NOTE: Vite's dev HMR client requires 'unsafe-eval'
    # in script-src — but the FastAPI process never serves the Vite HMR
    # client (Vite runs on its own port 5000). When the React bundle is
    # built and served from FastAPI in prod, no eval is needed, so
    # 'unsafe-eval' is intentionally excluded.
    # Phase C3 — tighter CSP. connect-src is restricted to known origins
    # (worker, GitHub, OpenAI). report-uri points at our /api/csp-report
    # collector (Phase C2) so violations land in error_logs.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self' https://axal.vc; "
        f"script-src 'self' 'nonce-{nonce}' 'strict-dynamic'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' https://*.workers.dev https://api.github.com https://api.openai.com; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'; "
        "report-uri /api/csp-report",
    )
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(scoring.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
# Task #1 — Spin-Out teams collaboration: member + invitation routes (shares
# the /api/projects prefix with the projects router above).
from backend.app.api.routes import project_members as _project_members  # noqa: E402
app.include_router(_project_members.router, prefix="/api")
app.include_router(legal.router, prefix="/api")
app.include_router(partners.router, prefix="/api")
app.include_router(capital.router, prefix="/api")
# Dev-only shim: re-expose the LP portal at the canonical Worker path
# (`/api/legalcap/capital/lp-portal`) so the error dashboard doesn't 404.
from backend.app.api.routes import legalcap as _legalcap  # noqa: E402
app.include_router(_legalcap.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")
app.include_router(deals.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(market_intel.router, prefix="/api")
app.include_router(matches.router, prefix="/api")
app.include_router(_investor_signals.router, prefix="/api")
app.include_router(advisory.router, prefix="/api")
app.include_router(activity.router, prefix="/api")
app.include_router(auth.router, prefix="/api")

from backend.app.api.routes import csp_report as _csp_report  # noqa: E402
from backend.app.api.routes import spinout_lab as _spinout_lab  # noqa: E402
app.include_router(_csp_report.router, prefix="/api")
app.include_router(_spinout_lab.router, prefix="/api")
# --- Backoffice routers (Security Item #6: Cloudflare Zero Trust perimeter)
# Every router below is admin/internal and gets an extra perimeter check via
# `require_cf_access`. When CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are unset
# (e.g. local dev) the dependency is a no-op, so nothing breaks. In prod,
# the Cloudflare Access policy in front of these routes adds SSO + MFA +
# device-posture enforcement *before* the request even reaches our app
# auth (`require_admin`).
from backend.app.services.cf_access import require_cf_access
from fastapi import Depends as _Depends  # noqa: E402
_BACKOFFICE_DEPS = [_Depends(require_cf_access)]

app.include_router(admin.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
app.include_router(private_data.router, prefix="/api")
app.include_router(monitoring.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
from backend.app.api.routes import monitoring_analytics as _monitoring_analytics
app.include_router(_monitoring_analytics.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
from backend.app.api.routes import infra as _infra
app.include_router(_infra.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
from backend.app.api.routes import admin_contracts as _admin_contracts
app.include_router(_admin_contracts.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
from backend.app.api.routes import admin_github as _admin_github
app.include_router(_admin_github.router, prefix="/api", dependencies=_BACKOFFICE_DEPS)
# Public, signature-verified GitHub webhook (no auth perimeter).
app.include_router(_admin_github.webhook_router, prefix="/api")
from backend.app.api.routes import company as _company
app.include_router(_company.router, prefix="/api")
from backend.app.api.routes import files as _files
app.include_router(_files.router, prefix="/api")
from backend.app.api.routes import references as _references
app.include_router(_references.router, prefix="/api")
from backend.app.api.routes import founder_risk as _founder_risk
app.include_router(_founder_risk.router, prefix="/api")
from backend.app.api.routes import captable as _captable
app.include_router(_captable.router, prefix="/api")
from backend.app.api.routes import trust as _trust
app.include_router(_trust.router, prefix="/api")
from backend.app.api.routes import advisors as _advisors
app.include_router(_advisors.router, prefix="/api")
from backend.app.api.routes import calendar as _calendar
app.include_router(_calendar.router, prefix="/api")
from backend.app.api.routes import compliance as _compliance
app.include_router(_compliance.router, prefix="/api")
from backend.app.api.routes import wellbeing as _wellbeing
app.include_router(_wellbeing.router, prefix="/api")
# Task #55 — public profile pages (/api/public/u/<handle>, unauthenticated).
from backend.app.api.routes import public_profiles as _public_profiles
app.include_router(_public_profiles.router, prefix="/api")
from backend.app.api.routes import cofounder as _cofounder
app.include_router(_cofounder.router, prefix="/api")
from backend.app.api.routes import portfolio_health as _portfolio_health
app.include_router(_portfolio_health.router, prefix="/api")
from backend.app.api.routes import watchlist as _watchlist
app.include_router(_watchlist.router, prefix="/api")
# Task #66 — follow graph for people + startups (/api/follows).
from backend.app.api.routes import follows as _follows
app.include_router(_follows.router, prefix="/api")
app.include_router(funds.router, prefix="/api")
app.include_router(liquidity.router, prefix="/api")
app.include_router(partnernet.router, prefix="/api")
app.include_router(pipeline_votes.router, prefix="/api")
from backend.app.api.routes import search as _search  # noqa: E402
app.include_router(_search.router, prefix="/api")
from backend.app.api.routes import onboarding as _onboarding  # noqa: E402
app.include_router(_onboarding.router, prefix="/api")
# Task #16 — Organizations directory (Network > Organizations) read API.
from backend.app.api.routes import organizations as _organizations  # noqa: E402
app.include_router(_organizations.router, prefix="/api")
from backend.app.api.routes import profiling as _profiling  # noqa: E402
app.include_router(_profiling.router, prefix="/api")
from backend.app.api.routes import kyc as _kyc  # noqa: E402
app.include_router(_kyc.router, prefix="/api")
from backend.app.database import get_session  # noqa: E402
from backend.app.api.routes import brand as _brand  # noqa: E402
app.include_router(_brand.router, prefix="/api")
# Task #38 — dev-only parity shims (Skills profile + Payouts/network).
from backend.app.api.routes import skills as _skills  # noqa: E402
app.include_router(_skills.router, prefix="/api")
# Task #12 — secure introductions & matching flow (distinct namespace from the
# credits-based /api/introductions worker system).
from backend.app.api.routes import network_introductions as _network_intros  # noqa: E402
app.include_router(_network_intros.router, prefix="/api")
from backend.app.api.routes import introductions as _introductions  # noqa: E402
app.include_router(_introductions.router, prefix="/api")
from backend.app.api.routes import network as _network  # noqa: E402
app.include_router(_network.router, prefix="/api")
# Task #8 — redesigned Products page: catalog, payments, cart orders, webhook.
from backend.app.api.routes import commerce as _commerce  # noqa: E402
app.include_router(_commerce.router, prefix="/api")

# --- Public landing page HTML (Task #4 parity) ----------------------------
# The dev backend serves HTML directly for /landing/:slug and
# /landing/preview/:token so the preview URL works in local dev.
@app.get("/landing/{slug}", response_class=HTMLResponse)
def _landing_html(slug: str, request: Request, session: Session = Depends(get_session)):
    """Public HTML render for a published landing page."""
    from backend.app.api.routes.brand import _ensure_schema, _render_landing_html
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE slug = :slug AND published = TRUE"
    ), params={"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    nonce = getattr(request.state, "csp_nonce", "")
    return _render_landing_html(row, noindex=False, csp_nonce=nonce)

@app.get("/landing/preview/{token}", response_class=HTMLResponse)
def _landing_preview(token: str, request: Request, session: Session = Depends(get_session)):
    """Public HTML render for an unpublished draft via preview token."""
    from backend.app.api.routes.brand import _ensure_schema, _render_landing_html
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE preview_token = :token"
    ), params={"token": token}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    nonce = getattr(request.state, "csp_nonce", "")
    return _render_landing_html(row, noindex=True, csp_nonce=nonce)

# Task #2 — branded multi-page site URLs (/p/{startup}/{page}); /p/{startup}
# renders the site's home page. Mirrors the Worker's renderSitePage.
def _render_site_page(site_slug: str, page_slug, request: Request, session: Session):
    from backend.app.api.routes.brand import _ensure_schema, _render_landing_html
    _ensure_schema(session)
    site = session.exec(text(
        "SELECT project_id FROM brand_sites WHERE slug = :slug"
    ), params={"slug": site_slug}).mappings().first()
    if not site:
        raise HTTPException(status_code=404, detail="not found")
    if page_slug:
        row = session.exec(text(
            "SELECT * FROM landing_pages WHERE project_id = :pid AND page_slug = :ps AND published = TRUE"
        ), params={"pid": site["project_id"], "ps": page_slug}).mappings().first()
    else:
        # Site root: prefer the "home" page, else the oldest published page.
        row = session.exec(text(
            "SELECT * FROM landing_pages WHERE project_id = :pid AND published = TRUE "
            "ORDER BY CASE WHEN page_slug = 'home' THEN 0 ELSE 1 END, id LIMIT 1"
        ), params={"pid": site["project_id"]}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    try:
        session.exec(text(
            "UPDATE landing_pages SET views_count = COALESCE(views_count,0)+1 WHERE id = :id"
        ), params={"id": row["id"]})
        session.commit()
    except Exception:
        session.rollback()
    nonce = getattr(request.state, "csp_nonce", "")
    return _render_landing_html(row, noindex=False, csp_nonce=nonce)

@app.get("/p/{site_slug}/{page_slug}", response_class=HTMLResponse)
def _site_page_html(site_slug: str, page_slug: str, request: Request, session: Session = Depends(get_session)):
    return _render_site_page(site_slug, page_slug, request, session)

@app.get("/p/{site_slug}", response_class=HTMLResponse)
def _site_home_html(site_slug: str, request: Request, session: Session = Depends(get_session)):
    return _render_site_page(site_slug, None, request, session)

from backend.app.api.routes import decks as _decks  # noqa: E402
app.include_router(_decks.router, prefix="/api")
app.include_router(personas.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
from backend.app.api.routes import email as email_routes  # noqa: E402
app.include_router(email_routes.router, prefix="/api")
app.include_router(email_routes.unsubscribe_router, prefix="/api")
from backend.app.api.routes import settings as settings_routes  # noqa: E402
app.include_router(settings_routes.router, prefix="/api")
from backend.app.api.routes import notifications as notifications_routes  # noqa: E402
app.include_router(notifications_routes.router, prefix="/api")
# Task #57 — web push subscription management.
from backend.app.api.routes import push as _push_routes  # noqa: E402
app.include_router(_push_routes.router, prefix="/api")
from backend.app.api.routes import financials as financials_routes  # noqa: E402
app.include_router(financials_routes.router, prefix="/api")
from backend.app.api.routes import progress as progress_routes  # noqa: E402
app.include_router(progress_routes.router, prefix="/api")
from backend.app.api.routes import marketplace as marketplace_routes  # noqa: E402
app.include_router(marketplace_routes.router, prefix="/api")
from backend.app.api.routes import needs as needs_routes  # noqa: E402
app.include_router(needs_routes.router, prefix="/api")
app.include_router(needs_routes.quote_router, prefix="/api")
app.include_router(needs_routes.engagement_router, prefix="/api")
from backend.app.api.routes import services as services_routes  # noqa: E402
app.include_router(services_routes.router, prefix="/api")
from backend.app.api.routes import insights as insights_routes  # noqa: E402
app.include_router(insights_routes.router, prefix="/api")
# Task #54 — partner office hours + co-marketing pitch/approval/attribution.
from backend.app.api.routes import partner_office_hours as _partner_office_hours  # noqa: E402
app.include_router(_partner_office_hours.router, prefix="/api")
from backend.app.api.routes import comarketing as _comarketing  # noqa: E402
app.include_router(_comarketing.router, prefix="/api")

from backend.app.api.routes import fund_simulator as _fund_sim  # noqa: E402
app.include_router(_fund_sim.router, prefix="/api")


# ---------------------------------------------------------------------------
# Global exception handlers — structured JSON errors
# ---------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # Preserve structured detail dicts (e.g. ERR_DISTRIBUTION_NOT_IMPLEMENTED).
    # If detail is a dict, surface it under `error.details` and try to lift
    # `code`/`message` for client convenience.
    error_obj: dict = {
        "code": exc.status_code,
        "type": "http_error",
        "path": request.url.path,
    }
    if isinstance(exc.detail, str):
        error_obj["message"] = exc.detail
    elif isinstance(exc.detail, dict):
        error_obj["message"] = exc.detail.get("message", "HTTP error")
        if "code" in exc.detail:
            error_obj["error_code"] = exc.detail["code"]
        error_obj["details"] = exc.detail
    else:
        error_obj["message"] = "HTTP error"
        error_obj["details"] = exc.detail
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": error_obj})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Phase A4: surface a stable structured error code when fund_id is
    # missing on cross-fund payloads, so callers can branch on it.
    structured_code: str | None = None
    path = request.url.path
    if "/funds/distributions/execute" in path:
        for err in exc.errors():
            if "fund_id" in tuple(err.get("loc", ())) and err.get("type") in ("missing", "value_error.missing"):
                structured_code = "ERR_DISTRIBUTION_FUND_ID_REQUIRED"
                break
    # exc.errors() can contain non-JSON-serializable values (bytes from
    # JSONDecodeError ctx, Exception instances, etc.). Run through
    # jsonable_encoder so the response handler doesn't 500.
    from fastapi.encoders import jsonable_encoder
    body = {
        "ok": False,
        "error": {
            "code": 422,
            "type": "validation_error",
            "message": "Request validation failed",
            "details": jsonable_encoder(exc.errors(), custom_encoder={bytes: lambda b: b.decode("utf-8", "replace")}),
            "path": path,
        },
    }
    if structured_code:
        body["error"]["error_code"] = structured_code
    return JSONResponse(status_code=422, content=body)


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


@app.get("/api/dashboard")
def dashboard(request: Request, user=Depends(get_current_user)):
    """Dev mirror of the Worker's GET /api/dashboard (cloudflare-worker/src/routes/dashboard.ts).

    The SPA's Dashboard page (api.ln() -> GET /api/dashboard) expects a fixed
    payload shape. The Worker aggregates commissions / syndicates / referral
    chains, but those tables are not seeded in the dev FastAPI DB, so we return
    the same SHAPE with fail-soft empty/zero defaults and only query `projects`
    for the proprietary deal-flow list. Never deployed.
    """
    from datetime import datetime, timedelta

    from sqlmodel import Session, select

    from backend.app.database import engine
    from backend.app.models.entities import Project

    # ?days window (default 30, clamp 1..365) — sizes the zero-filled series.
    try:
        days = int(request.query_params.get("days", "30"))
    except (TypeError, ValueError):
        days = 30
    days = max(1, min(days, 365))

    role_raw = user.role.value if hasattr(user.role, "value") else str(user.role)
    role = str(role_raw).split(".")[-1].lower()
    is_admin = role == "admin"
    is_investor = role == "investor"
    is_partner = role == "partner" or is_investor
    is_founder = role == "founder"

    deals: list[dict] = []
    with Session(engine) as session:
        rows = session.exec(select(Project).order_by(Project.created_at.desc())).all()
        for p in rows:
            status = getattr(p.status, "value", None) or str(p.status)
            if status in ("rejected", "archived"):
                continue
            if is_founder and user.founder_id is not None and p.founder_id != user.founder_id:
                continue
            deals.append({
                "id": p.id,
                "name": p.name,
                "sector": p.sector,
                "stage": getattr(p.stage, "value", None) or str(p.stage),
                "status": status,
                "score": getattr(p, "score", None),
                "ai_decision": getattr(p, "ai_decision", None),
                "created_at": p.created_at.isoformat() if getattr(p, "created_at", None) else None,
            })
            if len(deals) >= 12:
                break

    today = datetime.utcnow().date()
    series = [
        {"day": (today - timedelta(days=i)).isoformat(), "cents": 0}
        for i in range(days - 1, -1, -1)
    ]

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": role,
            "kyc_status": getattr(user, "kyc_status", None),
            "assistant_enabled": 0,
        },
        "quick_stats": {
            "month_earnings_cents": 0,
            "lifetime_earnings_cents": 0,
            "compound_earnings_cents": 0,
            "pending_payouts_cents": 0,
            "active_syndicates": 0,
            "my_syndicates": 0,
            "ai_score_avg": None,
            "network_reach": 0,
            "marketplace_available": 0,
        },
        "proprietary_deal_flow": deals,
        "ai_scored_opportunities": [],
        "syndication_tools": {
            "open_syndicates": [],
            "my_memberships": [],
            "ai_recommendations": [],
        },
        "performance_analytics": {
            "earnings_series_30d": series,
            "window_days": days,
            "chain_counts": {"L1": 0, "L2": 0, "L3": 0},
            "network_reach": 0,
            "top_referrers": [],
            "recent_commissions": [],
        },
        "operator_workspace": {"assigned_tasks": []},
        "notifications": [],
        "role_view": (
            "admin" if is_admin
            else "investor" if is_investor
            else "partner" if is_partner
            else "founder" if is_founder
            else "member"
        ),
        "cached": False,
        "generated_at": datetime.utcnow().isoformat(),
    }


@app.post("/api/dashboard/refresh-scores")
def dashboard_refresh_scores(user=Depends(get_current_user)):
    """Dev mirror of the Worker's POST /api/dashboard/refresh-scores. No cache in
    dev, so this is a no-op that returns the same ack shape the SPA expects."""
    return {"ok": True, "message": "Cache cleared. Next fetch will re-aggregate."}


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
