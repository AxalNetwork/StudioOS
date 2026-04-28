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
