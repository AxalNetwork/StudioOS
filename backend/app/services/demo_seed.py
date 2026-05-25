"""Task #41 — idempotent seed for the dev FastAPI demo investor + founder.

Creates (only when missing) a demo investor account, a paired demo founder
+ project + deal, so that:

  1. The dev login page's "Sign in as demo investor" quick-login button
     has a real account to sign into.
  2. The Trust Center / LockedFounderCard end-to-end flow has a deal with
     a resolvable `founder_user_id` to expand and request an intro from.

Demo investor credentials (DEV ONLY — these accounts never exist in the
production Cloudflare Worker DB, which is a completely separate D1):

  email           : demo-investor@axal.test
  password (TOTP) : a fixed pyotp-compatible base32 secret. The dev
                    `/api/auth/dev/quick-login` endpoint bypasses TOTP
                    entirely; the secret only exists so the regular
                    `/api/auth/login` flow ALSO works for manual testing.

This module is intentionally side-effect-free at import time. The lifespan
hook in `backend/app/main.py` calls `seed_demo_investor_and_founder()` once
at startup, AFTER all `ensure_*` schema migrations have run.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import (
    Deal,
    DealStatus,
    Founder,
    Project,
    ProjectStatus,
    User,
    UserRole,
)

logger = logging.getLogger("studioos.demo_seed")

# Stable, well-known credentials for the demo investor. The TOTP secret is
# a deterministic base32 string — `pyotp.TOTP(DEMO_INVESTOR_TOTP_SECRET)`
# yields valid 6-digit codes anyone (or Playwright) can compute on the fly.
DEMO_INVESTOR_EMAIL = "demo-investor@axal.test"
DEMO_INVESTOR_NAME = "Demo Investor"
DEMO_INVESTOR_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"  # 32-char base32  # nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- RFC 6238 well-known test vector, intentionally public so Playwright e2e suite can compute valid TOTP codes

DEMO_FOUNDER_EMAIL = "demo-founder@axal.test"
DEMO_FOUNDER_NAME = "Demo Founder"

DEMO_PROJECT_NAME = "Demo Trust Center Co."
DEMO_PROJECT_SECTOR = "AI"
DEMO_PROJECT_STAGE = "seed"
DEMO_PROJECT_DESC = (
    "Sample project used by the dev demo-investor quick-login so manual "
    "testers and the Playwright e2e suite can drive the LockedFounderCard "
    "→ Request intro → Intro pending — sign NDA flow on /deals."
)


def is_production() -> bool:
    """Defensive gate. The FastAPI process is dev-only by contract (see
    `replit.md`), but we still refuse to seed if EITHER `STUDIOOS_ENV`
    (the canonical backend convention — auth.py:29, github_service.py:38)
    OR `ENVIRONMENT` (the worker-side spelling) hints at production /
    staging, so a misconfigured deploy can't accidentally create
    well-known demo creds in a real DB. Fails CLOSED."""
    for var in ("STUDIOOS_ENV", "ENVIRONMENT"):
        val = (os.getenv(var) or "").strip().lower()
        if val in ("production", "prod", "staging"):
            return True
    return False


def seed_demo_investor_and_founder() -> None:
    """Create the demo investor + founder + project + deal if missing.

    Safe to call repeatedly: every step is guarded by an existence check.
    Failures are logged and swallowed — the dev backend must boot even if
    the seed step trips on a partially-migrated schema.
    """
    if is_production():
        logger.info("demo_seed: ENVIRONMENT=production — skipping demo seed")
        return

    try:
        with Session(engine) as session:
            investor = _ensure_user(
                session,
                email=DEMO_INVESTOR_EMAIL,
                name=DEMO_INVESTOR_NAME,
                role=UserRole.INVESTOR,
            )
            founder_user = _ensure_user(
                session,
                email=DEMO_FOUNDER_EMAIL,
                name=DEMO_FOUNDER_NAME,
                role=UserRole.FOUNDER,
            )
            founder_row = _ensure_founder_row(session, founder_user)
            project = _ensure_project(session, founder_row)
            _ensure_deal(session, project)
            session.commit()
            logger.info(
                "demo_seed: ready (investor_user_id=%s, founder_user_id=%s, project_id=%s)",
                investor.id, founder_user.id, project.id,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("demo_seed: skipped due to error: %s", exc)


def _ensure_user(session: Session, *, email: str, name: str, role: UserRole) -> User:
    user = session.exec(select(User).where(User.email == email)).first()
    if user:
        # Self-heal a few fields so an older partial seed still works:
        # email_verified must be True (login enforces it) and the TOTP
        # secret must match (`password_hash` doubles as the pyotp secret
        # in this dev backend — see auth.py:552).
        changed = False
        if not user.email_verified:
            user.email_verified = True
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if role == UserRole.INVESTOR and user.password_hash != DEMO_INVESTOR_TOTP_SECRET:
            user.password_hash = DEMO_INVESTOR_TOTP_SECRET
            changed = True
        if changed:
            session.add(user)
        return user

    user = User(
        email=email,
        name=name,
        role=role,
        email_verified=True,
        is_active=True,
        password_hash=DEMO_INVESTOR_TOTP_SECRET if role == UserRole.INVESTOR else None,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _ensure_founder_row(session: Session, founder_user: User) -> Founder:
    founder = session.exec(select(Founder).where(Founder.email == founder_user.email)).first()
    if not founder:
        founder = Founder(name=founder_user.name, email=founder_user.email)
        session.add(founder)
        session.commit()
        session.refresh(founder)
    if founder_user.founder_id != founder.id:
        founder_user.founder_id = founder.id
        session.add(founder_user)
        session.commit()
    return founder


def _ensure_project(session: Session, founder: Founder) -> Project:
    project = session.exec(
        select(Project).where(Project.name == DEMO_PROJECT_NAME)
    ).first()
    if project:
        if project.founder_id != founder.id:
            project.founder_id = founder.id
            session.add(project)
            session.commit()
        return project
    project = Project(
        name=DEMO_PROJECT_NAME,
        description=DEMO_PROJECT_DESC,
        sector=DEMO_PROJECT_SECTOR,
        stage=DEMO_PROJECT_STAGE,
        status=ProjectStatus.INTAKE,
        founder_id=founder.id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def _ensure_deal(session: Session, project: Project) -> Deal:
    deal = session.exec(select(Deal).where(Deal.project_id == project.id)).first()
    if deal:
        return deal
    deal = Deal(
        project_id=project.id,
        status=DealStatus.SCORED,
        notes="Demo deal seeded by backend/app/services/demo_seed.py (Task #41)",
    )
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal


def ensure_dev_pairwise_ndas_table() -> None:
    """Create the dev-only `dev_pairwise_ndas` table used by the dev stub
    of `/api/trust/intro/{request,status}`.

    The production Worker has a full `pairwise_ndas` table backed by a
    real 3-way envelope creation flow (`cloudflare-worker/src/services/
    trustEnvelope.ts`). The dev backend only needs to track "has the
    investor clicked Request intro for this founder?" so the
    LockedFounderCard's status check returns `pending` and the card
    flips to "Intro pending — sign NDA". A real NDA signing flow in dev
    is out of scope.
    """
    try:
        with Session(engine) as session:
            session.exec(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS dev_pairwise_ndas (
                        founder_user_id INTEGER NOT NULL,
                        investor_user_id INTEGER NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        envelope_uuid TEXT,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (founder_user_id, investor_user_id)
                    )
                    """
                )
            )
            session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("demo_seed: dev_pairwise_ndas ensure failed: %s", exc)
