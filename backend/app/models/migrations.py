"""Idempotent data migrations run at startup.

These migrations exist to consolidate logically-duplicated tables that
accumulated in earlier iterations of StudioOS. They are designed to be safe
to run on every boot — each step checks whether work has already been done.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict

from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import (
    CapitalCall,
    Entity,
    LPInvestor,
    LimitedPartner,
    VCFund,
)

logger = logging.getLogger(__name__)


def _ensure_entities_vc_fund_check(session: Session) -> None:
    """Phase A1: add a CHECK constraint on `entities.type` forbidding
    'vc_fund' going forward. Idempotent — constraint name is fixed.

    Existing rows are NOT touched — the constraint validates new INSERT/UPDATE
    only. Postgres `NOT VALID` is used so the migration succeeds even when
    legacy `vc_fund` rows still exist (they'll be migrated by the consolidate
    step). The runtime guard in `db_guards.py` is the belt; this is the
    suspenders.
    """
    try:
        session.exec(
            text(
                "ALTER TABLE entities "
                "ADD CONSTRAINT chk_entities_no_vc_fund "
                "CHECK (entity_type <> 'vc_fund') NOT VALID"
            )
        )
        session.commit()
    except Exception:  # noqa: BLE001 — constraint already exists
        session.rollback()


def _try_apply_capital_call_not_null(session: Session) -> None:
    """Phase A3: enforce NOT NULL on capital_calls.limited_partner_id ONCE
    every existing row has been backfilled. Safe to call on every boot —
    if any row is still NULL we leave the column nullable."""
    try:
        result = session.exec(
            text("SELECT COUNT(*) FROM capital_calls WHERE limited_partner_id IS NULL")
        )
        unbacked = result.scalar() if hasattr(result, "scalar") else next(iter(result), 0)
        if unbacked and int(unbacked) > 0:
            return  # backfill not complete; defer
        session.exec(text("ALTER TABLE capital_calls ALTER COLUMN limited_partner_id SET NOT NULL"))
        session.commit()
        logger.info("Phase A3: capital_calls.limited_partner_id is now NOT NULL")
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        logger.warning("Phase A3: NOT NULL on limited_partner_id deferred: %s", exc)


def _ensure_capital_call_columns(session: Session) -> None:
    """Add `limited_partner_id` to `capital_calls`, relax `lp_investor_id`
    NOT NULL, and add a UNIQUE (fund_id, email) constraint to limited_partners
    for race-safety on concurrent backfills."""
    session.exec(
        text(
            "ALTER TABLE capital_calls "
            "ADD COLUMN IF NOT EXISTS limited_partner_id INTEGER "
            "REFERENCES limited_partners(id)"
        )
    )
    # Older schema had NOT NULL on lp_investor_id; we now allow NULL so new
    # rows can be written via limited_partner_id only.
    try:
        session.exec(text("ALTER TABLE capital_calls ALTER COLUMN lp_investor_id DROP NOT NULL"))
    except Exception:  # noqa: BLE001 — already nullable, or column absent
        pass
    # Race-safe uniqueness: each (fund, email) pair is one LP. Postgres
    # supports CREATE UNIQUE INDEX IF NOT EXISTS, which is idempotent.
    try:
        session.exec(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_limited_partners_fund_email "
                "ON limited_partners(fund_id, email)"
            )
        )
    except Exception:  # noqa: BLE001
        # If duplicate rows already exist this will fail; the migration's
        # email-keyed lookup prevents new duplicates regardless.
        pass
    session.commit()


def ensure_growth_track_columns() -> None:
    """Add `track_type` to `projects` and `deals` for the Growth & Expansion
    track. Idempotent — safe to run on every boot. Existing rows default to
    'spin_out' so behavior is unchanged for the original Spin-Out flow."""
    with Session(engine) as session:
        for tbl in ("projects", "deals"):
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS "
                    f"track_type VARCHAR DEFAULT 'spin_out' NOT NULL"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_growth_track_columns: %s ALTER failed: %s", tbl, exc)
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"CREATE INDEX IF NOT EXISTS ix_{tbl}_track_type "
                    f"ON {tbl}(track_type)"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_growth_track_columns: %s INDEX failed: %s", tbl, exc)
        session.commit()


def ensure_project_revenue_proof_columns() -> None:
    """Task #2 — add structured revenue-proof columns to `projects` for the
    Spin-Out Demo Day Validation slide. Idempotent (uses
    `ADD COLUMN IF NOT EXISTS`)."""
    with Session(engine) as session:
        for col, ddl in (
            ("mrr", "DOUBLE PRECISION"),
            ("paying_customers", "INTEGER"),
            ("first_payment_date", "VARCHAR"),
            ("paid_pilot_status", "VARCHAR"),
        ):
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col} {ddl}"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_project_revenue_proof_columns: %s ALTER failed: %s", col, exc)
        session.commit()


def ensure_project_product_demo_columns() -> None:
    """Task #31 — add product-demo source columns to `projects` for the
    Spin-Out Demo Day "Product demo" slide. Idempotent (uses
    `ADD COLUMN IF NOT EXISTS`). Mirrors the Worker D1 migration so the dev
    FastAPI backend persists the same fields."""
    with Session(engine) as session:
        for col in (
            "product_demo_video_url",
            "product_demo_live_url",
            "product_demo_caption",
            "product_demo_screenshot_url",
            # Task #66 — startup website URL (mirrors Worker D1 migration 131).
            "website",
        ):
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col} VARCHAR"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_project_product_demo_columns: %s ALTER failed: %s", col, exc)
        session.commit()


def ensure_user_access_level_column() -> None:
    """Idempotently add `users.access_level` for the limited-access feature.

    `'limited'` lets a user past the KYC gate to browse the platform but
    forbids signing legal agreements (enforced in routes/legal.py). Any
    other value (including NULL) means the normal flow applies.
    """
    with Session(engine) as session:
        try:
            session.exec(text("ALTER TABLE users ADD COLUMN access_level VARCHAR"))
            session.commit()
        except Exception as exc:  # column already exists / other DBs
            session.rollback()
            logger.debug("ensure_user_access_level_column: ALTER skipped: %s", exc)


def ensure_score_anti_cheat_columns() -> None:
    """Epic 5 — add anti-cheat columns to `score_snapshots`. Idempotent.

    Mirrors `cloudflare-worker/sql/score_anti_cheat.sql` so the dev FastAPI
    backend can persist signed snapshots in lockstep with the production
    Worker. Each ALTER uses `ADD COLUMN IF NOT EXISTS` so re-running on
    boot is a no-op once applied.
    """
    cols = (
        ("is_sandbox", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("integrity_hash", "VARCHAR"),
        ("integrity_version", "VARCHAR DEFAULT 'v1' NOT NULL"),
        ("inputs_json", "TEXT"),
        ("anomaly_flags", "TEXT"),
        ("admin_review_status", "VARCHAR DEFAULT 'auto_approved' NOT NULL"),
        ("admin_review_notes", "TEXT"),
        ("admin_reviewed_by", "INTEGER"),
        ("admin_reviewed_at", "TIMESTAMP"),
        ("locked_until", "TIMESTAMP"),
    )
    indexes = (
        ("ix_score_snapshots_is_sandbox", "is_sandbox"),
        ("ix_score_snapshots_integrity_hash", "integrity_hash"),
        ("ix_score_snapshots_admin_review_status", "admin_review_status"),
        ("ix_score_snapshots_locked_until", "locked_until"),
    )
    with Session(engine) as session:
        for col, ddl in cols:
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS {col} {ddl}"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_score_anti_cheat_columns: %s ALTER failed: %s", col, exc)
        for name, expr in indexes:
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"CREATE INDEX IF NOT EXISTS {name} ON score_snapshots({expr})"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_score_anti_cheat_columns: %s INDEX failed: %s", name, exc)
        session.commit()


def ensure_document_file_columns() -> None:
    """Add file-storage columns to `documents`. Idempotent.

    Older rows continue to have `content` populated; the download endpoint
    migrates them into object storage on first access and clears `content`."""
    with Session(engine) as session:
        for col, ddl in (
            ("file_key", "VARCHAR"),
            ("file_size", "INTEGER"),
            ("file_sha256", "VARCHAR"),
            ("file_content_type", "VARCHAR"),
            # Signature legal-proof column — see Document.signed_ip.
            ("signed_ip", "VARCHAR"),
        ):
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE documents ADD COLUMN IF NOT EXISTS {col} {ddl}"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_document_file_columns: %s ALTER failed: %s", col, exc)
        try:
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_documents_file_key ON documents(file_key)"
            ))
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_document_file_columns: index failed: %s", exc)
        session.commit()


def consolidate_capital_tables() -> None:
    """Merge legacy `lp_investors` + `entities(type=vc_fund)` into the canonical
    `vc_funds` + `limited_partners` tables.

    Steps (all idempotent):
      1. Ensure `capital_calls.limited_partner_id` column exists.
      2. For each legacy `lp_investors` row:
         a. Resolve / create the matching `vc_funds` row by name (default
            "Axal Fund I" if `fund_name` is null).
         b. Resolve / create a matching `limited_partners` row keyed on
            (email, fund_id), copying commitment & called capital.
      3. For each legacy `entities` row of type 'vc_fund', ensure a
         matching `vc_funds` row exists.
      4. Recompute `vc_funds.lp_count`, `total_commitment`, `deployed_capital`.
      5. Backfill `capital_calls.limited_partner_id` from the legacy
         `lp_investor_id` mapping for any unbacked rows.
    """
    with Session(engine) as session:
        _ensure_capital_call_columns(session)
        _ensure_entities_vc_fund_check(session)

        legacy_investors = session.exec(select(LPInvestor)).all()
        legacy_fund_entities = session.exec(
            select(Entity).where(Entity.entity_type == "vc_fund")
        ).all()

        if not legacy_investors and not legacy_fund_entities:
            # Nothing to migrate. Still recompute fund totals defensively
            # and apply the Phase A3 NOT NULL promotion if eligible.
            _recompute_fund_totals(session)
            _try_apply_capital_call_not_null(session)
            return

        fund_by_name: Dict[str, VCFund] = {
            f.name: f for f in session.exec(select(VCFund)).all()
        }

        def _get_or_create_fund(name: str, jurisdiction: str | None = None) -> VCFund:
            existing = fund_by_name.get(name)
            if existing:
                return existing
            fund = VCFund(
                name=name,
                jurisdiction=jurisdiction,
                status="active",
            )
            session.add(fund)
            session.commit()
            session.refresh(fund)
            fund_by_name[name] = fund
            return fund

        # Step 3: backfill funds from `entities` rows of type vc_fund
        for ent in legacy_fund_entities:
            _get_or_create_fund(ent.name, ent.jurisdiction)

        # Step 2: backfill LPs
        lp_id_map: Dict[int, int] = {}
        for legacy in legacy_investors:
            fund_name = legacy.fund_name or "Axal Fund I"
            fund = _get_or_create_fund(fund_name)

            existing_lp = session.exec(
                select(LimitedPartner).where(
                    LimitedPartner.email == legacy.email,
                    LimitedPartner.fund_id == fund.id,
                )
            ).first()

            if not existing_lp:
                existing_lp = LimitedPartner(
                    fund_id=fund.id,
                    name=legacy.name,
                    email=legacy.email,
                    commitment_amount=legacy.committed_capital or 0,
                    invested_amount=legacy.called_capital or 0,
                    status=legacy.status or "active",
                    created_at=legacy.created_at,
                )
                session.add(existing_lp)
                session.commit()
                session.refresh(existing_lp)
                logger.info(
                    "consolidate_capital: migrated lp_investor #%s -> limited_partner #%s (fund=%s)",
                    legacy.id, existing_lp.id, fund.name,
                )

            lp_id_map[legacy.id] = existing_lp.id

        # Step 5: backfill capital_calls.limited_partner_id
        unbacked = session.exec(
            select(CapitalCall).where(CapitalCall.limited_partner_id.is_(None))
        ).all()
        for cc in unbacked:
            if cc.lp_investor_id and cc.lp_investor_id in lp_id_map:
                cc.limited_partner_id = lp_id_map[cc.lp_investor_id]
                session.add(cc)
        session.commit()

        # Step 4: refresh fund aggregates
        _recompute_fund_totals(session)

        # Step 6 (Phase A3): once every capital_calls row has a
        # limited_partner_id, promote the column to NOT NULL.
        _try_apply_capital_call_not_null(session)


def ensure_investor_role_split() -> None:
    """Phase 0.1 — partner → partner + investor role split.

    Idempotent. Steps:
      1. Add `users.investor_id` column if missing.
      2. Create `investors` table if missing.
      3. Promote any user currently `role='partner'` who has a row in
         `limited_partners` (matched on user_id OR email) to `role='investor'`,
         creating an `investors` row of type 'lp' for them.

    Service-provider partners with no LP record stay as `partner`.
    """
    # Step 0 — extend the Postgres `userrole` enum with the new label.
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so we
    # acquire an AUTOCOMMIT connection separately. SQLite (tests) silently
    # skips this branch — its `role` column is plain TEXT.
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            # PG enum labels for userrole are uppercase (ADMIN/FOUNDER/PARTNER);
            # match the existing convention.
            conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'INVESTOR'"))
    except Exception as exc:
        # Non-PG dialects (sqlite) raise — that's fine, the role column is TEXT.
        logger.debug("ensure_investor_role_split: enum extend skipped: %s", exc)

    is_pg = engine.dialect.name.startswith("postgres")
    # Dialect-portable helpers (architect feedback: don't silently skip on sqlite).
    role_cast = "role::text" if is_pg else "role"
    u_role_cast = "u.role::text" if is_pg else "u.role"
    uuid_expr = "gen_random_uuid()::text" if is_pg else "lower(hex(randomblob(16)))"

    with Session(engine) as session:
        # Step 1 — investors table FIRST (the FK in step 2 references it).
        # The SQLModel metadata in `init_db()` should already create it on a
        # fresh DB, but this keeps existing dev/preview DBs in sync without a
        # manual migration.
        try:
            session.exec(text(
                """
                CREATE TABLE IF NOT EXISTS investors (
                    id BIGSERIAL PRIMARY KEY,
                    uid TEXT UNIQUE NOT NULL,
                    user_id INTEGER REFERENCES users(id),
                    investor_type TEXT NOT NULL DEFAULT 'angel',
                    accreditation_status TEXT NOT NULL DEFAULT 'unverified',
                    check_size_min DOUBLE PRECISION,
                    check_size_max DOUBLE PRECISION,
                    sector_focus TEXT,
                    stage_focus TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            ))
            session.commit()
            session.exec(text("CREATE INDEX IF NOT EXISTS idx_investors_user ON investors(user_id)"))
            session.commit()
            session.exec(text("CREATE INDEX IF NOT EXISTS idx_investors_type ON investors(investor_type)"))
            session.commit()
        except Exception as exc:
            session.rollback()
            logger.warning("ensure_investor_role_split: investors table create failed: %s", exc)

        # Step 2 — users.investor_id FK (depends on investors existing).
        # PG supports ADD COLUMN IF NOT EXISTS; SQLite does not — probe via
        # PRAGMA and fall back to a plain ADD COLUMN there (architect fix).
        try:
            if is_pg:
                session.exec(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS investor_id INTEGER REFERENCES investors(id)"
                ))
                session.commit()
            else:
                cols = session.exec(text("PRAGMA table_info(users)")).all()
                names = {(r[1] if isinstance(r, tuple) else r.name) for r in cols}
                if "investor_id" not in names:
                    # SQLite can't add a REFERENCES constraint via ALTER, but
                    # the column itself is what the ORM needs.
                    session.exec(text("ALTER TABLE users ADD COLUMN investor_id INTEGER"))
                    session.commit()
        except Exception as exc:
            session.rollback()
            logger.warning("ensure_investor_role_split: users.investor_id add failed: %s", exc)

        # Step 3a — sweep: any user already at role='INVESTOR' but missing an
        # investors row / investor_id link gets backfilled. This makes the
        # promotion + investor-row + investor_id chain idempotent across
        # reruns even if a previous boot died between the role flip and the
        # row insert (architect feedback: don't gate on the just-promoted set).
        try:
            session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates code-defined dialect SQL exprs / int-coerced ids; data values are bound, dev-only FastAPI not exposed to user input
                f"""
                INSERT INTO investors (uid, user_id, investor_type, accreditation_status, created_at, updated_at)
                SELECT {uuid_expr}, u.id, 'lp', 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM users u
                WHERE upper({u_role_cast}) = 'INVESTOR'
                  AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.user_id = u.id)
                """
            ))
            session.commit()
            session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates code-defined dialect SQL exprs / int-coerced ids; data values are bound, dev-only FastAPI not exposed to user input
                f"""
                UPDATE users SET investor_id = (
                    SELECT i.id FROM investors i WHERE i.user_id = users.id LIMIT 1
                )
                WHERE upper({role_cast}) = 'INVESTOR' AND investor_id IS NULL
                """
            ))
            session.commit()
        except Exception as exc:
            session.rollback()
            logger.warning("ensure_investor_role_split: backfill sweep failed: %s", exc)

        # Step 3b — promote partner users with an LP record to investor role.
        # Match by user_id first (canonical), fall back to email.
        # PG enum values are uppercase; cast to text on both sides so the
        # comparison stays dialect-agnostic (sqlite stores raw TEXT).
        try:
            if is_pg:
                promoted = session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates code-defined dialect SQL exprs / int-coerced ids; data values are bound, dev-only FastAPI not exposed to user input
                    f"""
                    WITH lp_users AS (
                        SELECT DISTINCT u.id AS user_id
                        FROM users u
                        JOIN limited_partners lp
                          ON lp.user_id = u.id OR lower(lp.email) = lower(u.email)
                        WHERE upper({u_role_cast}) = 'PARTNER'
                    )
                    UPDATE users SET role = 'INVESTOR'
                    WHERE id IN (SELECT user_id FROM lp_users)
                    RETURNING id
                    """
                )).all()
            else:
                # SQLite: no RETURNING in older versions; do select-then-update.
                rows = session.exec(text(
                    """
                    SELECT DISTINCT u.id AS user_id
                    FROM users u
                    JOIN limited_partners lp
                      ON lp.user_id = u.id OR lower(lp.email) = lower(u.email)
                    WHERE upper(u.role) = 'PARTNER'
                    """
                )).all()
                ids = [r[0] if isinstance(r, tuple) else r.user_id for r in rows]
                if ids:
                    session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates code-defined dialect SQL exprs / int-coerced ids; data values are bound, dev-only FastAPI not exposed to user input
                        f"UPDATE users SET role = 'INVESTOR' WHERE id IN ({','.join(str(int(i)) for i in ids)})"
                    ))
                promoted = [(i,) for i in ids]
            session.commit()
            if promoted:
                logger.info(
                    "ensure_investor_role_split: promoted %d partner users to investor",
                    len(promoted),
                )
                # Step 3b — create matching `investors` rows of type 'lp'
                # so the new role has a profile to point at. Skip users that
                # already have one.
                for row in promoted:
                    uid = row[0] if isinstance(row, tuple) else row.id
                    try:
                        session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates code-defined dialect SQL exprs / int-coerced ids; data values are bound, dev-only FastAPI not exposed to user input
                            f"""
                            INSERT INTO investors (uid, user_id, investor_type, accreditation_status, created_at, updated_at)
                            SELECT {uuid_expr}, :uid, 'lp', 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                            WHERE NOT EXISTS (SELECT 1 FROM investors WHERE user_id = :uid)
                            """
                        ), {"uid": uid})
                        session.commit()
                        # Backfill users.investor_id
                        session.exec(text(
                            "UPDATE users SET investor_id = (SELECT id FROM investors WHERE user_id = :uid LIMIT 1) "
                            "WHERE id = :uid AND investor_id IS NULL"
                        ), {"uid": uid})
                        session.commit()
                    except Exception:
                        session.rollback()
        except Exception as exc:
            session.rollback()
            logger.warning("ensure_investor_role_split: promote step skipped: %s", exc)


def _recompute_fund_totals(session: Session) -> None:
    funds = session.exec(select(VCFund)).all()
    for fund in funds:
        lps = session.exec(
            select(LimitedPartner).where(LimitedPartner.fund_id == fund.id)
        ).all()
        fund.total_commitment = sum(lp.commitment_amount or 0 for lp in lps)
        fund.deployed_capital = sum(lp.invested_amount or 0 for lp in lps)
        fund.lp_count = len(lps)
        fund.updated_at = datetime.utcnow()
        session.add(fund)
    session.commit()


def ensure_marketplace_columns() -> None:
    """Task #36 — Service provider marketplace.

    Idempotently adds the marketplace fields to the legacy `partners` table
    (headline / bio / categories / pricing / KYB / capacity / listed) and
    creates supporting tables for reviews, inquiries, and threaded messages.
    Safe to run on every boot.
    """
    cols = (
        ("headline", "VARCHAR"),
        ("bio", "TEXT"),
        ("categories_json", "TEXT DEFAULT '[]' NOT NULL"),
        ("sectors_json", "TEXT DEFAULT '[]' NOT NULL"),
        ("pricing_tier", "VARCHAR"),
        ("hourly_rate_min", "DOUBLE PRECISION"),
        ("hourly_rate_max", "DOUBLE PRECISION"),
        ("capacity_status", "VARCHAR DEFAULT 'available' NOT NULL"),
        ("response_time_hours", "INTEGER"),
        ("kyb_status", "VARCHAR DEFAULT 'unverified' NOT NULL"),
        ("kyb_verified_at", "TIMESTAMP"),
        ("website", "VARCHAR"),
        ("listed", "BOOLEAN DEFAULT FALSE NOT NULL"),
    )
    indexes = (
        ("ix_partners_capacity_status", "capacity_status"),
        ("ix_partners_kyb_status", "kyb_status"),
        ("ix_partners_listed", "listed"),
    )
    with Session(engine) as session:
        for col, ddl in cols:
            try:
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_marketplace_columns: %s ALTER failed: %s", col, exc)
        for name, expr in indexes:
            try:
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON partners({expr})"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_marketplace_columns: %s INDEX failed: %s", name, exc)
        session.commit()


def ensure_partner_directory_columns() -> None:
    """Task #53 — Public partner directory + ranking.

    Idempotently:
      * adds `slug`, `featured`, `featured_until`, `featured_tier` to `partners`
      * backfills `slug` for existing rows from `name` + uid suffix so the
        column can serve as a stable public identifier in /partners/{slug}
      * creates supporting indexes
    """
    import re as _re

    cols = (
        ("slug", "VARCHAR"),
        ("featured", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("featured_until", "TIMESTAMP"),
        ("featured_tier", "VARCHAR"),
    )
    indexes = (
        ("ix_partners_slug", "slug"),
        ("ix_partners_featured", "featured"),
    )

    def _slugify(s: str) -> str:
        s = (s or "").lower().strip()
        s = _re.sub(r"[^a-z0-9]+", "-", s)
        s = _re.sub(r"-+", "-", s).strip("-")
        return s or "partner"

    with Session(engine) as session:
        for col, ddl in cols:
            try:
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_partner_directory_columns: partners.%s ALTER failed: %s", col, exc)
        session.commit()

        # Backfill slugs for rows missing one.
        try:
            rows = session.exec(text(
                "SELECT id, name, uid FROM partners WHERE slug IS NULL OR slug = ''"
            )).all()
            taken = set()
            existing = session.exec(text("SELECT slug FROM partners WHERE slug IS NOT NULL")).all()
            for r in existing:
                taken.add(r._mapping["slug"])  # type: ignore[attr-defined]
            for r in rows:
                m = r._mapping  # type: ignore[attr-defined]
                base = _slugify(m["name"])
                suffix = (m["uid"] or "")[:6]
                slug = f"{base}-{suffix}" if suffix else base
                # If collision (paranoid — uid suffix is already unique), append id.
                while slug in taken:
                    slug = f"{slug}-{m['id']}"
                taken.add(slug)
                session.exec(text(
                    "UPDATE partners SET slug = :slug WHERE id = :id"
                ).bindparams(slug=slug, id=m["id"]))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_partner_directory_columns: slug backfill failed: %s", exc)
            session.rollback()

        # Add UNIQUE constraint on slug after backfill (savepoint — already-exists is fine).
        try:
            with session.begin_nested():
                session.exec(text(
                    "ALTER TABLE partners ADD CONSTRAINT uq_partners_slug UNIQUE (slug)"
                ))
        except Exception:  # noqa: BLE001
            pass

        for name, expr in indexes:
            try:
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON partners({expr})"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_partner_directory_columns: %s INDEX failed: %s", name, exc)
        session.commit()


def ensure_trust_layer_columns() -> None:
    """Task #58 — Trust layer hardening. Idempotent.

    Adds:
      - partners: kyb_provider / kyb_ref_id / kyb_data
      - investors: accreditation_document_id / accreditation_basis
                   / accreditation_verified_at / accreditation_verified_by
      - new table: nda_acceptances
    """
    partner_cols = [
        ("kyb_provider", "VARCHAR"),
        ("kyb_ref_id", "VARCHAR"),
        ("kyb_data", "TEXT"),
    ]
    investor_cols = [
        ("accreditation_document_id", "INTEGER"),
        ("accreditation_basis", "VARCHAR"),
        ("accreditation_verified_at", "TIMESTAMP"),
        ("accreditation_verified_by", "INTEGER"),
    ]
    with Session(engine) as session:
        for col, ddl in partner_cols:
            try:
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_trust_layer_columns: partners.%s: %s", col, exc)
                session.rollback()
        for col, ddl in investor_cols:
            try:
                session.exec(text(f"ALTER TABLE investors ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_trust_layer_columns: investors.%s: %s", col, exc)
                session.rollback()
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS nda_acceptances (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    role VARCHAR NOT NULL,
                    document_id INTEGER REFERENCES documents(id),
                    status VARCHAR DEFAULT 'pending' NOT NULL,
                    signed_at TIMESTAMP,
                    signed_ip VARCHAR,
                    signed_name VARCHAR,
                    revoked_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    UNIQUE(user_id, role)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_nda_acceptances_user ON nda_acceptances(user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_nda_acceptances_role ON nda_acceptances(role)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_nda_acceptances_status ON nda_acceptances(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_trust_layer_columns: nda_acceptances: %s", exc)
            session.rollback()


def ensure_advisor_tables() -> None:
    """Task #35 — Advisor matching + office hours. Idempotent.

    Creates four tables (``advisors``, ``office_hours_slots``,
    ``advisor_bookings``, ``advisor_reviews``) and adds ``users.advisor_id``.
    All DDL is wrapped in IF NOT EXISTS so we can safely run on every boot.
    Also extends the Postgres ``userrole`` enum to include ``ADVISOR`` so
    new advisor-role users can be inserted.
    """
    with Session(engine) as session:
        # Extend the userrole enum first. Postgres requires ``ALTER TYPE
        # ... ADD VALUE`` to run outside any open transaction, so use an
        # AUTOCOMMIT connection here. SQLite (local dev) doesn't have an
        # enum at all and silently no-ops on the exception path.
        try:
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                conn.exec_driver_sql("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'ADVISOR'")
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: ALTER TYPE userrole: %s", exc)

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS advisors (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    name VARCHAR NOT NULL,
                    email VARCHAR NOT NULL UNIQUE,
                    headline VARCHAR,
                    bio TEXT,
                    specialties_json TEXT DEFAULT '[]' NOT NULL,
                    sectors_json TEXT DEFAULT '[]' NOT NULL,
                    timezone VARCHAR,
                    capacity_per_week INTEGER DEFAULT 4 NOT NULL,
                    hourly_rate DOUBLE PRECISION DEFAULT 0 NOT NULL,
                    currency VARCHAR DEFAULT 'USD' NOT NULL,
                    accepting_bookings BOOLEAN DEFAULT TRUE NOT NULL,
                    listed BOOLEAN DEFAULT TRUE NOT NULL,
                    rating_avg DOUBLE PRECISION,
                    rating_count INTEGER DEFAULT 0 NOT NULL,
                    calcom_username VARCHAR,
                    calcom_event_type_id INTEGER,
                    status VARCHAR DEFAULT 'active' NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_advisors_listed ON advisors(listed)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_advisors_status ON advisors(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: advisors: %s", exc)
            session.rollback()

        try:
            session.exec(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS advisor_id INTEGER REFERENCES advisors(id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: users.advisor_id: %s", exc)
            session.rollback()

        # Task #74 — office_hours_slots is a pre-existing shared table (its
        # name did not change in the mentor→advisor rename), so CREATE TABLE
        # IF NOT EXISTS is a no-op on an existing dev DB and its legacy
        # mentor_id column never becomes advisor_id. Idempotent RENAME: on a
        # fresh DB (no table/column yet) it fails and is swallowed; on an
        # existing DB it converts the column in place. Dev DB is disposable.
        try:
            session.exec(text(
                "ALTER TABLE office_hours_slots RENAME COLUMN mentor_id TO advisor_id"
            ))
            session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS office_hours_slots (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    advisor_id INTEGER NOT NULL REFERENCES advisors(id),
                    start_at TIMESTAMP NOT NULL,
                    duration_min INTEGER DEFAULT 30 NOT NULL,
                    capacity INTEGER DEFAULT 1 NOT NULL,
                    location_kind VARCHAR DEFAULT 'video' NOT NULL,
                    location_uri VARCHAR,
                    notes TEXT,
                    status VARCHAR DEFAULT 'open' NOT NULL,
                    calcom_event_id VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_advisor ON office_hours_slots(advisor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_start ON office_hours_slots(start_at)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_status ON office_hours_slots(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: office_hours_slots: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS advisor_bookings (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    slot_id INTEGER NOT NULL REFERENCES office_hours_slots(id),
                    advisor_id INTEGER NOT NULL REFERENCES advisors(id),
                    requester_user_id INTEGER NOT NULL REFERENCES users(id),
                    project_id INTEGER REFERENCES projects(id),
                    topic VARCHAR NOT NULL,
                    questions TEXT,
                    scheduled_start TIMESTAMP NOT NULL,
                    scheduled_end TIMESTAMP NOT NULL,
                    status VARCHAR DEFAULT 'requested' NOT NULL,
                    cancelled_by_user_id INTEGER REFERENCES users(id),
                    cancel_reason VARCHAR,
                    confirmed_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    cancelled_at TIMESTAMP,
                    meeting_uri VARCHAR,
                    calcom_booking_id VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_slot ON advisor_bookings(slot_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_advisor ON advisor_bookings(advisor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_requester ON advisor_bookings(requester_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_status ON advisor_bookings(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: advisor_bookings: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS advisor_reviews (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    booking_id INTEGER NOT NULL REFERENCES advisor_bookings(id),
                    advisor_id INTEGER NOT NULL REFERENCES advisors(id),
                    reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
                    reviewer_role VARCHAR NOT NULL,
                    rating INTEGER NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    UNIQUE(booking_id, reviewer_role)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_reviews_advisor ON advisor_reviews(advisor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_reviews_booking ON advisor_reviews(booking_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_tables: advisor_reviews: %s", exc)
            session.rollback()


def ensure_cap_table_scenarios_table() -> None:
    """Task #27 — Cap-table simulator scenarios. Idempotent."""
    ddl = """
    CREATE TABLE IF NOT EXISTS cap_table_scenarios (
        id SERIAL PRIMARY KEY,
        uid VARCHAR NOT NULL UNIQUE,
        owner_user_id INTEGER NOT NULL REFERENCES users(id),
        project_id INTEGER REFERENCES projects(id),
        name VARCHAR NOT NULL,
        inputs_json TEXT NOT NULL,
        result_json TEXT,
        computed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
    """
    with Session(engine) as session:
        try:
            session.exec(text(ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_cap_table_scenarios_owner "
                "ON cap_table_scenarios(owner_user_id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_cap_table_scenarios_table failed: %s", exc)
            session.rollback()


def ensure_advisor_profiles_tables() -> None:
    """Task #75 — Advisory Suite advisor directory (founder-scoped).

    Dev mirror of Worker migration 138 + services/advisorProfilesSchema.ts.
    DIRECTORY ONLY: the promote/waitlist half lives in the Worker Contacts hub,
    which has no dev FastAPI counterpart, so it is intentionally not mirrored
    here. Idempotent CREATE TABLE IF NOT EXISTS.
    """
    profiles_ddl = """
    CREATE TABLE IF NOT EXISTS advisor_profiles (
        id SERIAL PRIMARY KEY,
        founder_id INTEGER NOT NULL REFERENCES founders(id),
        name VARCHAR NOT NULL,
        email VARCHAR,
        bio TEXT,
        sectors_json TEXT NOT NULL DEFAULT '[]',
        expertise_json TEXT NOT NULL DEFAULT '[]',
        linkedin_url VARCHAR,
        hourly_rate DOUBLE PRECISION,
        source VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'active',
        source_contact_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
    """
    startups_ddl = """
    CREATE TABLE IF NOT EXISTS advisor_startups (
        id SERIAL PRIMARY KEY,
        advisor_profile_id INTEGER NOT NULL REFERENCES advisor_profiles(id),
        project_id INTEGER NOT NULL REFERENCES projects(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE (advisor_profile_id, project_id)
    )
    """
    with Session(engine) as session:
        try:
            session.exec(text(profiles_ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- static schema DDL, no user input, dev-only FastAPI
            session.exec(text(startups_ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- static schema DDL, no user input, dev-only FastAPI
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_advisor_profiles_founder "
                "ON advisor_profiles(founder_id, status)"
            ))
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_advisor_startups_profile "
                "ON advisor_startups(advisor_profile_id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_advisor_profiles_tables failed: %s", exc)
            session.rollback()


def ensure_founder_risk_profiles_table() -> None:
    """Task #41 — Founder risk profile.

    One row per founder; populated from PitchBook (or synthetic fallback).
    Idempotent CREATE TABLE IF NOT EXISTS + indexes.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS founder_risk_profiles (
        id SERIAL PRIMARY KEY,
        founder_id INTEGER NOT NULL UNIQUE REFERENCES founders(id),
        prior_roles_json TEXT,
        exits_count INTEGER DEFAULT 0 NOT NULL,
        failures_count INTEGER DEFAULT 0 NOT NULL,
        domain_expertise_years INTEGER DEFAULT 0 NOT NULL,
        domain_tags_json TEXT,
        notable_signals_json TEXT,
        raw_payload_json TEXT,
        source_provider VARCHAR,
        source_integration_uid VARCHAR,
        pulled_at TIMESTAMP,
        risk_score DOUBLE PRECISION,
        risk_band VARCHAR,
        score_breakdown_json TEXT,
        computed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
    """
    indexes = (
        ("ix_founder_risk_profiles_founder", "founder_id"),
        ("ix_founder_risk_profiles_band",    "risk_band"),
    )
    with Session(engine) as session:
        try:
            session.exec(text(ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_founder_risk_profiles_table: CREATE failed: %s", exc)
            session.rollback()
        for name, expr in indexes:
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
                    f"CREATE INDEX IF NOT EXISTS {name} ON founder_risk_profiles({expr})"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_founder_risk_profiles_table: %s INDEX failed: %s", name, exc)
        session.commit()


def ensure_references_table() -> None:
    """Task #43 — Reference check workflow.

    Idempotently creates the `references` table that backs scheduled
    reference calls, consent capture, recording uploads, Whisper
    transcription, and Llama / OpenAI summarisation.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS "references" (
        id SERIAL PRIMARY KEY,
        uid VARCHAR UNIQUE NOT NULL,
        deal_id INTEGER NOT NULL REFERENCES deals(id),
        reference_name VARCHAR NOT NULL,
        reference_email VARCHAR,
        reference_role VARCHAR,
        relationship VARCHAR,
        scheduled_at TIMESTAMP,
        consent_given BOOLEAN DEFAULT FALSE NOT NULL,
        consent_given_at TIMESTAMP,
        consent_text TEXT,
        consent_captured_by INTEGER REFERENCES users(id),
        recording_file_key VARCHAR,
        recording_size_bytes INTEGER,
        recording_content_type VARCHAR,
        recording_uploaded_at TIMESTAMP,
        transcript TEXT,
        transcribed_at TIMESTAMP,
        summary_json TEXT,
        summarized_at TIMESTAMP,
        status VARCHAR DEFAULT 'scheduled' NOT NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
    """
    indexes = (
        ("ix_references_uid",     "uid"),
        ("ix_references_deal_id", "deal_id"),
        ("ix_references_status",  "status"),
        ("ix_references_consent", "consent_given"),
    )
    with Session(engine) as session:
        try:
            session.exec(text(ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_references_table: CREATE failed: %s", exc)
            session.rollback()
        for name, expr in indexes:
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
                    f'CREATE INDEX IF NOT EXISTS {name} ON "references"({expr})'
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_references_table: %s INDEX failed: %s", name, exc)
        session.commit()


def ensure_service_catalogue_columns() -> None:
    """Task #51 — Service catalogue + engagement lifecycle.

    Idempotently:
      * adds Stripe Connect onboarding columns to `partners`
      * adds lifecycle / Stripe / SLA columns to `engagements`
      * relaxes `engagements.quote_id` and `engagements.need_id` NOT NULL
        (offering-sourced engagements have neither)
      * remaps legacy `engagements.status = 'active'` → `'accepted'`
      * creates `service_offerings` and `engagement_reviews` tables via
        SQLModel.metadata (no-op when tables already exist)

    Safe on every boot.
    """
    from backend.app.models.entities import (  # local import — avoid cycle at module load
        ServiceOffering,
        EngagementReview,
    )

    partner_cols = (
        ("stripe_account_id", "VARCHAR"),
        ("stripe_charges_enabled", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("stripe_payouts_enabled", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("stripe_onboarded_at", "TIMESTAMP"),
    )
    engagement_cols = (
        ("service_offering_id", "INTEGER"),
        ("currency", "VARCHAR DEFAULT 'usd' NOT NULL"),
        ("sla_days", "INTEGER"),
        ("accepted_at", "TIMESTAMP"),
        ("started_at", "TIMESTAMP"),
        ("delivered_at", "TIMESTAMP"),
        ("reviewed_at", "TIMESTAMP"),
        ("invoiced_at", "TIMESTAMP"),
        ("cancelled_at", "TIMESTAMP"),
        ("delivery_notes", "TEXT"),
        ("cancel_reason", "TEXT"),
        ("stripe_invoice_id", "VARCHAR"),
        ("stripe_invoice_url", "VARCHAR"),
        ("stripe_payment_status", "VARCHAR"),
        ("amount_cents", "INTEGER"),
        ("invoice_simulated", "BOOLEAN DEFAULT FALSE NOT NULL"),
    )
    indexes = (
        ("ix_partners_stripe_account_id", "partners", "stripe_account_id"),
        ("ix_engagements_service_offering_id", "engagements", "service_offering_id"),
    )
    with Session(engine) as session:
        # 1) Create new tables if they don't exist (covers fresh DB and
        #    incremental adds — SQLModel skips existing tables).
        try:
            ServiceOffering.metadata.create_all(
                engine, tables=[ServiceOffering.__table__, EngagementReview.__table__]
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_service_catalogue_columns: create_all failed: %s", exc)

        # 2) Partner Stripe columns
        for col, ddl in partner_cols:
            try:
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: partners.%s ALTER failed: %s", col, exc)

        # 3) Engagement lifecycle / Stripe columns
        for col, ddl in engagement_cols:
            try:
                session.exec(text(f"ALTER TABLE engagements ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: engagements.%s ALTER failed: %s", col, exc)

        # 4) Relax NOT NULL on quote_id / need_id (offering-sourced rows
        #    have neither). Safe to run repeatedly — DROP NOT NULL is a
        #    no-op once the column is already nullable.
        for col in ("quote_id", "need_id"):
            try:
                session.exec(text(f"ALTER TABLE engagements ALTER COLUMN {col} DROP NOT NULL"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
            except Exception:  # noqa: BLE001
                pass

        # 5) Optional FK from engagements.service_offering_id → service_offerings.id.
        #    Commit prior DDL first so a failed FK ADD (e.g. constraint
        #    already exists on Postgres) doesn't roll back the column
        #    additions above. The FK ALTER runs in its own savepoint.
        session.commit()
        try:
            with session.begin_nested():
                session.exec(text(
                    "ALTER TABLE engagements "
                    "ADD CONSTRAINT fk_engagements_service_offering "
                    "FOREIGN KEY (service_offering_id) REFERENCES service_offerings(id)"
                ))
        except Exception:  # noqa: BLE001 — already exists; savepoint rolled back
            pass

        # 6) Remap legacy status='active' → 'accepted'.
        try:
            session.exec(text(
                "UPDATE engagements SET status = 'accepted' WHERE status = 'active'"
            ))
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_service_catalogue_columns: status remap failed: %s", exc)

        # 7) Indexes
        for name, tbl, expr in indexes:
            try:
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON {tbl}({expr})"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: %s INDEX failed: %s", name, exc)

        session.commit()


def ensure_market_intel_tables() -> None:
    """Task #35 — dev parity for the Market Intelligence surfaces.

    The production Worker stores per-user sector watchlists in
    ``market_intel_watchlist`` and two per-user flags on ``users``
    (``mi_digest_paused_until`` for the digest-pause window and
    ``mi_contribution_optout`` for the advisor-contribution opt-out).
    Dev FastAPI mirrors that schema so the Watchlist tab and the Settings
    contribution toggle persist across requests. Idempotent; Postgres DDL.
    """
    with Session(engine) as session:
        try:
            session.exec(text(
                """
                CREATE TABLE IF NOT EXISTS market_intel_watchlist (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sector VARCHAR NOT NULL,
                    geo VARCHAR NOT NULL DEFAULT 'global',
                    cadence VARCHAR NOT NULL DEFAULT 'weekly',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_mi_watchlist_user_sector_geo UNIQUE (user_id, sector, geo)
                )
                """
            ))
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_mi_watchlist_user ON market_intel_watchlist(user_id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_market_intel_tables: watchlist table failed: %s", exc)
            session.rollback()

        for col, ddl in (
            ("mi_digest_paused_until", "VARCHAR"),
            ("mi_contribution_optout", "INTEGER NOT NULL DEFAULT 0"),
        ):
            try:
                session.exec(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static literals from local lists, dev-only FastAPI not exposed to user input
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_market_intel_tables: users.%s failed: %s", col, exc)
                session.rollback()


def ensure_matching_tables() -> None:
    """Task #36 — dev parity for the AI Matching Engine (``/matches``).

    The production Worker (``cloudflare-worker/src/routes/matches.ts``) stores
    per-investor preferences in ``user_preferences`` and reads the referral
    funnel from ``referrals`` + ``commissions``. Dev FastAPI has none of these,
    so the Matching page 404s. We mirror the minimal schema the ported
    endpoints query. Idempotent; Postgres DDL.

    Note: the Worker also persists an LLM score cache (``match_scores``). The
    dev backend has no Cloudflare Workers AI, so the ported endpoints score
    rule-based and fresh on every request — no cache table is needed.
    """
    statements = (
        """
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            investment_focus TEXT,
            preferred_stages TEXT,
            preferred_roles TEXT,
            min_check_cents INTEGER,
            max_check_cents INTEGER,
            risk_tolerance VARCHAR,
            bio TEXT,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
        # `referrals` + `commissions` mirror the prod referral funnel the
        # /matches/referral-scores endpoint reads. Dev has no referral feature
        # that writes to them, so they stay empty (the tab shows its empty
        # state) — but the endpoint runs a real query instead of a stub.
        """
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            referred_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            converted_at TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_referrals_referrer ON referrals(referrer_id)",
        """
        CREATE TABLE IF NOT EXISTS commissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_id VARCHAR,
            amount_cents INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
    )
    with Session(engine) as session:
        for ddl in statements:
            try:
                session.exec(text(ddl))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_matching_tables: statement failed: %s", exc)
                session.rollback()


def ensure_calendar_tables() -> None:
    """Task #56 — Unified calendar layer. Idempotent.

    Creates ``ic_meetings``, ``ic_meeting_attendees``, ``founder_checkins``,
    ``google_oauth_tokens`` and ``calendar_sync_records``. All DDL is
    IF NOT EXISTS so it runs safely on every boot.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS ic_meetings (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    title VARCHAR NOT NULL,
                    agenda TEXT,
                    start_at TIMESTAMP NOT NULL,
                    duration_min INTEGER DEFAULT 60 NOT NULL,
                    deal_id INTEGER REFERENCES deals(id),
                    organizer_user_id INTEGER NOT NULL REFERENCES users(id),
                    location_kind VARCHAR DEFAULT 'video' NOT NULL,
                    location_uri VARCHAR,
                    status VARCHAR DEFAULT 'scheduled' NOT NULL,
                    cancelled_at TIMESTAMP,
                    cancel_reason VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_ic_meetings_start ON ic_meetings(start_at)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_ic_meetings_deal ON ic_meetings(deal_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_ic_meetings_status ON ic_meetings(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_calendar_tables: ic_meetings: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS ic_meeting_attendees (
                    id SERIAL PRIMARY KEY,
                    meeting_id INTEGER NOT NULL REFERENCES ic_meetings(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    rsvp VARCHAR DEFAULT 'invited' NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_ic_attendees_meeting_user UNIQUE (meeting_id, user_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_ic_attendees_meeting ON ic_meeting_attendees(meeting_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_ic_attendees_user ON ic_meeting_attendees(user_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_calendar_tables: ic_meeting_attendees: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS founder_checkins (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    founder_user_id INTEGER NOT NULL REFERENCES users(id),
                    counterpart_user_id INTEGER REFERENCES users(id),
                    project_id INTEGER REFERENCES projects(id),
                    title VARCHAR NOT NULL,
                    notes TEXT,
                    start_at TIMESTAMP NOT NULL,
                    duration_min INTEGER DEFAULT 30 NOT NULL,
                    location_kind VARCHAR DEFAULT 'video' NOT NULL,
                    location_uri VARCHAR,
                    status VARCHAR DEFAULT 'scheduled' NOT NULL,
                    cancelled_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_checkins_founder ON founder_checkins(founder_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_checkins_counterpart ON founder_checkins(counterpart_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_checkins_start ON founder_checkins(start_at)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_calendar_tables: founder_checkins: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS google_oauth_tokens (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    refresh_token TEXT NOT NULL,
                    scope VARCHAR DEFAULT '' NOT NULL,
                    google_email VARCHAR,
                    last_synced_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_calendar_tables: google_oauth_tokens: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS calendar_sync_records (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    source_kind VARCHAR NOT NULL,
                    source_id INTEGER NOT NULL,
                    google_event_id VARCHAR NOT NULL,
                    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_cal_sync_user_source UNIQUE (user_id, source_kind, source_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cal_sync_user ON calendar_sync_records(user_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_calendar_tables: calendar_sync_records: %s", exc)
            session.rollback()


def ensure_watchlist_decision_tables() -> None:
    """Task #49 — Watchlist + decision journal. Idempotent."""
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS watchlist_items (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    external_name VARCHAR,
                    external_url VARCHAR,
                    sector VARCHAR,
                    stage VARCHAR,
                    thesis TEXT,
                    conviction VARCHAR DEFAULT 'medium' NOT NULL,
                    source VARCHAR,
                    tags_json TEXT DEFAULT '[]' NOT NULL,
                    status VARCHAR DEFAULT 'watching' NOT NULL,
                    converted_deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
                    converted_at TIMESTAMP,
                    passed_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_watchlist_owner_project UNIQUE (owner_user_id, project_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_watchlist_owner ON watchlist_items(owner_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_watchlist_status ON watchlist_items(status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_watchlist_project ON watchlist_items(project_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_watchlist_decision_tables: watchlist_items: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS decision_journal_entries (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    watchlist_item_id INTEGER REFERENCES watchlist_items(id) ON DELETE SET NULL,
                    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
                    decision VARCHAR DEFAULT 'defer' NOT NULL,
                    conviction INTEGER DEFAULT 3 NOT NULL,
                    thesis TEXT NOT NULL,
                    key_risks TEXT,
                    expected_outcome TEXT,
                    expected_multiple DOUBLE PRECISION,
                    expected_timeline_months INTEGER,
                    tags_json TEXT DEFAULT '[]' NOT NULL,
                    decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    outcome_status VARCHAR DEFAULT 'pending' NOT NULL,
                    outcome_notes TEXT,
                    outcome_actual_multiple DOUBLE PRECISION,
                    outcome_recorded_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_journal_owner ON decision_journal_entries(owner_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_journal_project ON decision_journal_entries(project_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_journal_decision ON decision_journal_entries(decision)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_journal_outcome ON decision_journal_entries(outcome_status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_journal_decided_at ON decision_journal_entries(decided_at)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_watchlist_decision_tables: decision_journal_entries: %s", exc)
            session.rollback()


def ensure_push_subscriptions_table() -> None:
    """Task #57 — Web Push (VAPID) subscriptions. Idempotent.

    One row per (user, browser endpoint). The browser's PushManager
    returns a stable URL endpoint (FCM / Mozilla / Apple) that we use as
    the natural unique key. Stored as JSON to keep schema stable across
    spec revisions (keys, expirationTime, etc.).
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    endpoint TEXT NOT NULL,
                    subscription_json TEXT NOT NULL,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_push_user_endpoint UNIQUE (user_id, endpoint)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_push_user ON push_subscriptions(user_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_push_subscriptions_table: %s", exc)
            session.rollback()


def ensure_section_83b_tracker_table() -> None:
    """Task #31 — 83(b) trackers. Idempotent.

    Enforces a unique constraint on ``(project_id, user_id, grant_date)``
    so concurrent POSTs to ``/api/legal/83b/trackers`` cannot create
    duplicate trackers (architect review for Task #31).
    """
    with Session(engine) as session:
        try:
            session.exec(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_section_83b_project_user_grant "
                "ON section_83b_trackers(project_id, user_id, grant_date)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_section_83b_tracker_table: %s", exc)
            session.rollback()


def ensure_compliance_events_table() -> None:
    """Task #32 — compliance calendar.

    Creates ``compliance_events`` for jurisdiction-specific recurring
    deadlines (annual report, franchise tax, registered agent renewal,
    board meetings) seeded from the incorporation wizard. Idempotent.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS compliance_events (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
                    jurisdiction VARCHAR NOT NULL,
                    event_type VARCHAR NOT NULL,
                    title VARCHAR NOT NULL,
                    description TEXT,
                    due_date DATE NOT NULL,
                    completion_status VARCHAR DEFAULT 'pending' NOT NULL,
                    completed_at TIMESTAMP,
                    completed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    recurrence VARCHAR DEFAULT 'annual' NOT NULL,
                    source VARCHAR DEFAULT 'auto' NOT NULL,
                    reminders_sent_json TEXT DEFAULT '[]' NOT NULL,
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_compliance_events_project ON compliance_events(project_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_compliance_events_due ON compliance_events(due_date)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_compliance_events_status ON compliance_events(completion_status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_compliance_events_type ON compliance_events(event_type)"))
            # Idempotency for auto-seeded events: a given (project, event_type,
            # due_date) tuple should never be inserted twice by the seeder.
            session.exec(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_event_seed "
                "ON compliance_events(project_id, event_type, due_date)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_compliance_events_table: %s", exc)
            session.rollback()


def ensure_wellbeing_tables() -> None:
    """Task #40 — Founder wellbeing pulse + resource directory.

    All answer columns hold Fernet ciphertext (see
    ``services.crypto_box``). Per-row data is founder-private; admins
    only ever see anonymized aggregates over decrypted values.
    Idempotent.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS wellbeing_checkins (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR(64) UNIQUE NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    week_anchor DATE NOT NULL,
                    stress_enc TEXT NOT NULL,
                    sleep_enc TEXT NOT NULL,
                    support_enc TEXT NOT NULL,
                    decisions_enc TEXT NOT NULL,
                    energy_enc TEXT NOT NULL,
                    notes_enc TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_wellbeing_user_week UNIQUE (user_id, week_anchor)
                )
            """))
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_wellbeing_user "
                "ON wellbeing_checkins (user_id)"
            ))
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_wellbeing_created "
                "ON wellbeing_checkins (created_at)"
            ))
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS wellbeing_resources (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR(64) UNIQUE NOT NULL,
                    category VARCHAR(64) NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    url TEXT,
                    region VARCHAR(32),
                    is_24_7 BOOLEAN DEFAULT FALSE NOT NULL,
                    is_free BOOLEAN DEFAULT FALSE NOT NULL,
                    sort_order INTEGER DEFAULT 100 NOT NULL,
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_wellbeing_tables: %s", exc)
            session.rollback()


def ensure_compliance_reminder_runs_table() -> None:
    """Task #32 — daily lease for the compliance reminder loop.

    Replaces the /tmp anchor file: a single-row-per-UTC-day primary
    key + ``INSERT ... ON CONFLICT DO NOTHING`` gives an atomic,
    multi-worker-safe ``claim today`` semantics. The architect flagged
    the /tmp anchor as not lock-safe across workers / restarts.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS compliance_reminder_runs (
                    run_date DATE PRIMARY KEY,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    pinged INTEGER DEFAULT 0 NOT NULL,
                    scanned INTEGER DEFAULT 0 NOT NULL
                )
            """))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_compliance_reminder_runs_table: %s", exc)
            session.rollback()


def ensure_portfolio_health_tables() -> None:
    """Task #44 — Portfolio health score + predictive failure. Idempotent."""
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS portfolio_health_snapshots (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    score DOUBLE PRECISION DEFAULT 0 NOT NULL,
                    badge VARCHAR DEFAULT 'yellow' NOT NULL,
                    intervention BOOLEAN DEFAULT FALSE NOT NULL,
                    runway_months DOUBLE PRECISION,
                    growth_velocity DOUBLE PRECISION,
                    churn_delta DOUBLE PRECISION,
                    sentiment_delta DOUBLE PRECISION,
                    components_json TEXT DEFAULT '{}' NOT NULL,
                    reasons_json TEXT DEFAULT '[]' NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_portfolio_health_day UNIQUE (project_id, snapshot_date)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_portfolio_health_project ON portfolio_health_snapshots(project_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_portfolio_health_date ON portfolio_health_snapshots(snapshot_date)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_portfolio_health_badge ON portfolio_health_snapshots(badge)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_portfolio_health_intervention ON portfolio_health_snapshots(intervention)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_portfolio_health_tables: %s", exc)
            session.rollback()


def ensure_cofounder_tables() -> None:
    """Task #38 — Co-founder matching. Idempotent.

    Creates ``cofounder_profiles``, ``cofounder_interests`` and
    ``cofounder_connections``. Each block is wrapped in its own
    try/except/rollback so a failure on one table doesn't poison the
    rest of the migration sweep.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS cofounder_profiles (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    skills_json TEXT DEFAULT '[]' NOT NULL,
                    sectors_json TEXT DEFAULT '[]' NOT NULL,
                    commitment VARCHAR DEFAULT 'full_time' NOT NULL,
                    location_city VARCHAR,
                    location_country VARCHAR,
                    remote_ok BOOLEAN DEFAULT TRUE NOT NULL,
                    equity_expectation_min DOUBLE PRECISION,
                    equity_expectation_max DOUBLE PRECISION,
                    bio TEXT,
                    looking_for VARCHAR,
                    listed BOOLEAN DEFAULT TRUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_profiles_listed ON cofounder_profiles(listed)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_cofounder_tables: cofounder_profiles: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS cofounder_interests (
                    id SERIAL PRIMARY KEY,
                    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    message VARCHAR,
                    status VARCHAR DEFAULT 'sent' NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_cofounder_interest_pair UNIQUE (from_user_id, to_user_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_interest_from ON cofounder_interests(from_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_interest_to ON cofounder_interests(to_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_interest_status ON cofounder_interests(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_cofounder_tables: cofounder_interests: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS cofounder_connections (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    user_a_id INTEGER NOT NULL REFERENCES users(id),
                    user_b_id INTEGER NOT NULL REFERENCES users(id),
                    nda_doc_a_id INTEGER REFERENCES documents(id),
                    nda_doc_b_id INTEGER REFERENCES documents(id),
                    nda_signed_at_a TIMESTAMP,
                    nda_signed_at_b TIMESTAMP,
                    nda_signed_ip_a VARCHAR,
                    nda_signed_ip_b VARCHAR,
                    nda_signed_name_a VARCHAR,
                    nda_signed_name_b VARCHAR,
                    status VARCHAR DEFAULT 'pending_nda' NOT NULL,
                    closed_at TIMESTAMP,
                    closed_reason VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_cofounder_conn_pair UNIQUE (user_a_id, user_b_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_conn_a ON cofounder_connections(user_a_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_conn_b ON cofounder_connections(user_b_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cofounder_conn_status ON cofounder_connections(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_cofounder_tables: cofounder_connections: %s", exc)
            session.rollback()


def ensure_project_membership_tables() -> None:
    """Task #1 (Spin-Out Teams Collaboration) — project membership layer.

    Additive layer (never ALTERs ``projects``) so a Spin-Out project can be
    built by a TEAM: co-founders (read+edit) and advisors (read + advisory).
    Mirrors the D1 migration ``119_project_membership.sql`` in Postgres dialect.
    Idempotent; each block has its own try/except/rollback.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS project_members (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role VARCHAR NOT NULL DEFAULT 'cofounder',
                    status VARCHAR NOT NULL DEFAULT 'accepted',
                    source VARCHAR,
                    invitation_id INTEGER,
                    cofounder_connection_id INTEGER,
                    added_by_user_id INTEGER,
                    accepted_at TIMESTAMP,
                    removed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_project_members_pair UNIQUE (project_id, user_id)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_project_members_user ON project_members(user_id, status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_project_members_project ON project_members(project_id, status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_project_membership_tables: project_members: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS project_member_invitations (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    role VARCHAR NOT NULL DEFAULT 'cofounder',
                    status VARCHAR NOT NULL DEFAULT 'pending',
                    source VARCHAR,
                    invitee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    invitee_email VARCHAR,
                    token_hash VARCHAR,
                    cofounder_connection_id INTEGER,
                    invited_by_user_id INTEGER,
                    accepted_by_user_id INTEGER,
                    expires_at TIMESTAMP,
                    accepted_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_pmi_token ON project_member_invitations(token_hash)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pmi_project ON project_member_invitations(project_id, status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pmi_invitee_user ON project_member_invitations(invitee_user_id, status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pmi_invitee_email ON project_member_invitations(invitee_email, status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_project_membership_tables: project_member_invitations: %s", exc)
            session.rollback()


def ensure_user_handle_column() -> None:
    """Task #55 — Public profile pages.

    Adds a unique, lowercase ``handle`` column to ``users`` so a stable
    public URL exists at ``/u/<handle>``. The handle is opaque (cannot
    be derived back to the email) but human-friendly: a slug of the
    user's name plus a 6-char uid suffix to guarantee uniqueness.

    Backfill strategy: any pre-existing user with NULL handle is
    assigned ``slug(name)-<uid[:6]>``. If two users would collide on
    that key (extremely unlikely given the uid suffix) we fall back to
    a fresh 6-hex random suffix and retry.

    Idempotent — safe to run on every boot.
    """
    import re
    import secrets

    def _slug(name: str) -> str:
        s = re.sub(r"[^a-z0-9]+", "-", (name or "user").lower()).strip("-")
        return (s or "user")[:40]

    with Session(engine) as session:
        try:
            session.exec(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(64)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_user_handle_column add: %s", exc)
            session.rollback()
            return
        try:
            rows = session.exec(text(
                "SELECT id, name, uid FROM users WHERE handle IS NULL OR handle = ''"
            )).all()
            for r in rows:
                m = r._mapping  # type: ignore[attr-defined]
                base = _slug(m["name"]) or "user"
                suffix = (m["uid"] or "")[:6] or secrets.token_hex(3)
                candidate = f"{base}-{suffix}"
                # Resolve rare collisions deterministically.
                for _ in range(5):
                    exists = session.exec(text(
                        "SELECT 1 FROM users WHERE LOWER(handle) = LOWER(:h) LIMIT 1"
                    ).bindparams(h=candidate)).first()
                    if not exists:
                        break
                    candidate = f"{base}-{secrets.token_hex(3)}"
                try:
                    session.exec(text(
                        "UPDATE users SET handle = :h WHERE id = :i"
                    ).bindparams(h=candidate, i=m["id"]))
                    session.commit()
                except Exception:
                    session.rollback()
            # Unique index after backfill so the migration never blocks
            # on a duplicate from a prior partial run.
            session.exec(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_handle_lower "
                "ON users (LOWER(handle))"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_user_handle_column backfill: %s", exc)
            session.rollback()


def ensure_task54_tables() -> None:
    """Task #54 — Partner office hours + co-marketing pitch + attribution.

    Idempotent. Creates four tables:
      * partner_office_hour_slots
      * partner_bookings
      * comarketing_pitches
      * comarketing_attributions
    All DDL wraps IF NOT EXISTS so it can run on every boot.
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS partner_office_hour_slots (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    partner_id INTEGER NOT NULL REFERENCES partners(id),
                    title VARCHAR,
                    start_at TIMESTAMP NOT NULL,
                    duration_min INTEGER DEFAULT 30 NOT NULL,
                    capacity INTEGER DEFAULT 1 NOT NULL,
                    location_kind VARCHAR DEFAULT 'video' NOT NULL,
                    location_uri VARCHAR,
                    notes TEXT,
                    status VARCHAR DEFAULT 'open' NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pohs_partner ON partner_office_hour_slots(partner_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pohs_start ON partner_office_hour_slots(start_at)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pohs_status ON partner_office_hour_slots(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task54_tables: partner_office_hour_slots: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS partner_bookings (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    slot_id INTEGER NOT NULL REFERENCES partner_office_hour_slots(id),
                    partner_id INTEGER NOT NULL REFERENCES partners(id),
                    requester_user_id INTEGER NOT NULL REFERENCES users(id),
                    project_id INTEGER REFERENCES projects(id),
                    topic VARCHAR NOT NULL,
                    questions TEXT,
                    scheduled_start TIMESTAMP NOT NULL,
                    scheduled_end TIMESTAMP NOT NULL,
                    status VARCHAR DEFAULT 'requested' NOT NULL,
                    cancelled_by_user_id INTEGER REFERENCES users(id),
                    cancel_reason VARCHAR,
                    confirmed_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    cancelled_at TIMESTAMP,
                    meeting_uri VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pbk_slot ON partner_bookings(slot_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pbk_partner ON partner_bookings(partner_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pbk_requester ON partner_bookings(requester_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_pbk_status ON partner_bookings(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task54_tables: partner_bookings: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS comarketing_pitches (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    partner_id INTEGER NOT NULL REFERENCES partners(id),
                    submitter_user_id INTEGER NOT NULL REFERENCES users(id),
                    title VARCHAR NOT NULL,
                    summary TEXT NOT NULL,
                    asset_type VARCHAR DEFAULT 'webinar' NOT NULL,
                    proposed_date TIMESTAMP,
                    target_audience VARCHAR,
                    distribution_channels VARCHAR,
                    co_branding_notes TEXT,
                    asset_url VARCHAR,
                    status VARCHAR DEFAULT 'proposed' NOT NULL,
                    review_notes TEXT,
                    reviewed_by_user_id INTEGER REFERENCES users(id),
                    reviewed_at TIMESTAMP,
                    published_at TIMESTAMP,
                    published_url VARCHAR,
                    attribution_code VARCHAR UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cmp_partner ON comarketing_pitches(partner_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cmp_status ON comarketing_pitches(status)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cmp_asset ON comarketing_pitches(asset_type)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cmp_attr ON comarketing_pitches(attribution_code)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task54_tables: comarketing_pitches: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS comarketing_attributions (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    pitch_id INTEGER NOT NULL REFERENCES comarketing_pitches(id),
                    partner_id INTEGER NOT NULL REFERENCES partners(id),
                    event_kind VARCHAR DEFAULT 'visit' NOT NULL,
                    user_id INTEGER REFERENCES users(id),
                    project_id INTEGER REFERENCES projects(id),
                    lead_email VARCHAR,
                    referrer VARCHAR,
                    landing_path VARCHAR,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cma_pitch ON comarketing_attributions(pitch_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cma_partner ON comarketing_attributions(partner_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cma_kind ON comarketing_attributions(event_kind)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cma_user ON comarketing_attributions(user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_cma_created ON comarketing_attributions(created_at)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task54_tables: comarketing_attributions: %s", exc)
            session.rollback()


def ensure_task46_tables() -> None:
    """Task #46 — Reserve allocation + waterfall simulator.

    Idempotent. Creates two tables:
      * fund_reserve_allocations — per-(fund, project) follow-on $ plan
      * fund_scenarios — saved reserves/waterfall scenarios (cached results)
    """
    with Session(engine) as session:
        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS fund_reserve_allocations (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
                    project_id INTEGER NOT NULL REFERENCES projects(id),
                    reserve_amount DOUBLE PRECISION DEFAULT 0 NOT NULL,
                    initial_check DOUBLE PRECISION DEFAULT 0 NOT NULL,
                    next_round_label VARCHAR,
                    target_ownership_pct DOUBLE PRECISION,
                    confidence VARCHAR DEFAULT 'medium' NOT NULL,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_fra_fund ON fund_reserve_allocations(fund_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_fra_project ON fund_reserve_allocations(project_id)"))
            # One reserve plan per (fund, project) — bulk PUT relies on this for upsert semantics.
            session.exec(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS ux_fra_fund_project
                ON fund_reserve_allocations(fund_id, project_id)
            """))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task46_tables: fund_reserve_allocations: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS fund_scenarios (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
                    kind VARCHAR NOT NULL,
                    name VARCHAR NOT NULL,
                    description TEXT,
                    inputs_json TEXT DEFAULT '{}' NOT NULL,
                    result_json TEXT DEFAULT '{}' NOT NULL,
                    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_fsc_fund ON fund_scenarios(fund_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_fsc_kind ON fund_scenarios(kind)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_fsc_created ON fund_scenarios(created_at)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_task46_tables: fund_scenarios: %s", exc)
            session.rollback()


def ensure_brand_landing_columns() -> None:
    """Task #4 / #5 — Waitlist audience segmentation + preview token + landing templates.

    Idempotent. Adds audience columns to landing_pages and waitlist_signups,
    plus preview_token, template, hero_media_url, product_screenshot_url
    and indexes. Postgres supports ADD COLUMN IF NOT EXISTS.
    """
    with Session(engine) as session:
        cols = [
            ("landing_pages", "preview_token", "TEXT"),
            ("landing_pages", "audience_customer_headline", "TEXT"),
            ("landing_pages", "audience_customer_body", "TEXT"),
            ("landing_pages", "audience_customer_cta", "TEXT"),
            ("landing_pages", "audience_partner_headline", "TEXT"),
            ("landing_pages", "audience_partner_body", "TEXT"),
            ("landing_pages", "audience_partner_cta", "TEXT"),
            ("landing_pages", "audience_investor_headline", "TEXT"),
            ("landing_pages", "audience_investor_body", "TEXT"),
            ("landing_pages", "audience_investor_cta", "TEXT"),
            ("landing_pages", "audience_advisor_headline", "TEXT"),
            ("landing_pages", "audience_advisor_body", "TEXT"),
            ("landing_pages", "audience_advisor_cta", "TEXT"),
            ("landing_pages", "audience_mentor_headline", "TEXT"),
            ("landing_pages", "audience_mentor_body", "TEXT"),
            ("landing_pages", "audience_mentor_cta", "TEXT"),
            ("landing_pages", "audience_cofounder_headline", "TEXT"),
            ("landing_pages", "audience_cofounder_body", "TEXT"),
            ("landing_pages", "audience_cofounder_cta", "TEXT"),
            ("landing_pages", "template", "TEXT"),
            ("landing_pages", "hero_media_url", "TEXT"),
            ("landing_pages", "product_screenshot_url", "TEXT"),
            # Audience-first flow — primary page audience (full 6-value
            # taxonomy), goal, and catalog template id. Distinct from the
            # narrow waitlist audience below.
            ("landing_pages", "audience", "TEXT"),
            ("landing_pages", "goal", "TEXT"),
            ("landing_pages", "template_kit", "TEXT"),
            ("waitlist_signups", "audience", "TEXT"),
        ]
        for table, col, ddl in cols:
            try:
                session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_brand_landing_columns: %s.%s: %s", table, col, exc)
        indexes = [
            ("idx_landing_preview_token", "landing_pages(preview_token)"),
            ("idx_waitlist_audience", "waitlist_signups(project_id, audience)"),
        ]
        for name, expr in indexes:
            try:
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON {expr}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_brand_landing_columns: index %s: %s", name, exc)
        session.commit()
