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
                session.exec(text(
                    f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS "
                    f"track_type VARCHAR DEFAULT 'spin_out' NOT NULL"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_growth_track_columns: %s ALTER failed: %s", tbl, exc)
            try:
                session.exec(text(
                    f"CREATE INDEX IF NOT EXISTS ix_{tbl}_track_type "
                    f"ON {tbl}(track_type)"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_growth_track_columns: %s INDEX failed: %s", tbl, exc)
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
                session.exec(text(
                    f"ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS {col} {ddl}"
                ))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_score_anti_cheat_columns: %s ALTER failed: %s", col, exc)
        for name, expr in indexes:
            try:
                session.exec(text(
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
                session.exec(text(
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
            session.exec(text(
                f"""
                INSERT INTO investors (uid, user_id, investor_type, accreditation_status)
                SELECT {uuid_expr}, u.id, 'lp', 'verified'
                FROM users u
                WHERE upper({u_role_cast}) = 'INVESTOR'
                  AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.user_id = u.id)
                """
            ))
            session.commit()
            session.exec(text(
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
                promoted = session.exec(text(
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
                    session.exec(text(
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
                        session.exec(text(
                            f"""
                            INSERT INTO investors (uid, user_id, investor_type, accreditation_status)
                            SELECT {uuid_expr}, :uid, 'lp', 'verified'
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
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_marketplace_columns: %s ALTER failed: %s", col, exc)
        for name, expr in indexes:
            try:
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON partners({expr})"))
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
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))
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
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON partners({expr})"))
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
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))
                session.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_trust_layer_columns: partners.%s: %s", col, exc)
                session.rollback()
        for col, ddl in investor_cols:
            try:
                session.exec(text(f"ALTER TABLE investors ADD COLUMN IF NOT EXISTS {col} {ddl}"))
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


def ensure_mentor_tables() -> None:
    """Task #35 — Mentor matching + office hours. Idempotent.

    Creates four tables (``mentors``, ``office_hours_slots``,
    ``mentor_bookings``, ``mentor_reviews``) and adds ``users.mentor_id``.
    All DDL is wrapped in IF NOT EXISTS so we can safely run on every boot.
    Also extends the Postgres ``userrole`` enum to include ``MENTOR`` so
    new mentor-role users can be inserted.
    """
    with Session(engine) as session:
        # Extend the userrole enum first. Postgres requires ``ALTER TYPE
        # ... ADD VALUE`` to run outside any open transaction, so use an
        # AUTOCOMMIT connection here. SQLite (local dev) doesn't have an
        # enum at all and silently no-ops on the exception path.
        try:
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                conn.exec_driver_sql("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'MENTOR'")
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: ALTER TYPE userrole: %s", exc)

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS mentors (
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
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_mentors_listed ON mentors(listed)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_mentors_status ON mentors(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: mentors: %s", exc)
            session.rollback()

        try:
            session.exec(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_id INTEGER REFERENCES mentors(id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: users.mentor_id: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS office_hours_slots (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    mentor_id INTEGER NOT NULL REFERENCES mentors(id),
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
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_mentor ON office_hours_slots(mentor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_start ON office_hours_slots(start_at)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_slots_status ON office_hours_slots(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: office_hours_slots: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS mentor_bookings (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    slot_id INTEGER NOT NULL REFERENCES office_hours_slots(id),
                    mentor_id INTEGER NOT NULL REFERENCES mentors(id),
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
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_slot ON mentor_bookings(slot_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_mentor ON mentor_bookings(mentor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_requester ON mentor_bookings(requester_user_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_bookings_status ON mentor_bookings(status)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: mentor_bookings: %s", exc)
            session.rollback()

        try:
            session.exec(text("""
                CREATE TABLE IF NOT EXISTS mentor_reviews (
                    id SERIAL PRIMARY KEY,
                    uid VARCHAR NOT NULL UNIQUE,
                    booking_id INTEGER NOT NULL REFERENCES mentor_bookings(id),
                    mentor_id INTEGER NOT NULL REFERENCES mentors(id),
                    reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
                    reviewer_role VARCHAR NOT NULL,
                    rating INTEGER NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    UNIQUE(booking_id, reviewer_role)
                )
            """))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_reviews_mentor ON mentor_reviews(mentor_id)"))
            session.exec(text("CREATE INDEX IF NOT EXISTS ix_reviews_booking ON mentor_reviews(booking_id)"))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_mentor_tables: mentor_reviews: %s", exc)
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
            session.exec(text(ddl))
            session.exec(text(
                "CREATE INDEX IF NOT EXISTS ix_cap_table_scenarios_owner "
                "ON cap_table_scenarios(owner_user_id)"
            ))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_cap_table_scenarios_table failed: %s", exc)
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
            session.exec(text(ddl))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_founder_risk_profiles_table: CREATE failed: %s", exc)
            session.rollback()
        for name, expr in indexes:
            try:
                session.exec(text(
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
            session.exec(text(ddl))
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_references_table: CREATE failed: %s", exc)
            session.rollback()
        for name, expr in indexes:
            try:
                session.exec(text(
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
                session.exec(text(f"ALTER TABLE partners ADD COLUMN IF NOT EXISTS {col} {ddl}"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: partners.%s ALTER failed: %s", col, exc)

        # 3) Engagement lifecycle / Stripe columns
        for col, ddl in engagement_cols:
            try:
                session.exec(text(f"ALTER TABLE engagements ADD COLUMN IF NOT EXISTS {col} {ddl}"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: engagements.%s ALTER failed: %s", col, exc)

        # 4) Relax NOT NULL on quote_id / need_id (offering-sourced rows
        #    have neither). Safe to run repeatedly — DROP NOT NULL is a
        #    no-op once the column is already nullable.
        for col in ("quote_id", "need_id"):
            try:
                session.exec(text(f"ALTER TABLE engagements ALTER COLUMN {col} DROP NOT NULL"))
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
                session.exec(text(f"CREATE INDEX IF NOT EXISTS {name} ON {tbl}({expr})"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ensure_service_catalogue_columns: %s INDEX failed: %s", name, exc)

        session.commit()


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
