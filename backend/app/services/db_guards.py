"""SQLAlchemy event listeners that seal the legacy data paths.

Audit #1 / Phase A1+A2: `lp_investors` and `entities(type='vc_fund')` are
deprecated. The canonical tables are `limited_partners` + `vc_funds`. The
startup migration in `backend/app/models/migrations.py:consolidate_capital_tables`
keeps any historical rows mirrored. To prevent accidental drift, we install
ORM event listeners that raise loudly on any new write to the deprecated rows.

Reads still work — the migration code reads `LPInvestor` and the
`type='vc_fund'` Entity rows during consolidation, and the legacy
`capital_calls.lp_investor_id` column is still used for backward-compatible
lookups. Only INSERT and UPDATE are blocked.

When a write is blocked, we additionally emit a one-time metric event into
`activity_logs` (action='deprecated_vc_fund_writes_blocked' or
'deprecated_lp_investors_writes_blocked') so the admin dashboard can surface
how often legacy callers are still in the wild.
"""
from __future__ import annotations

import logging

from sqlalchemy import event
from sqlalchemy.sql import Insert, Update

from backend.app.models.entities import Entity, EntityType, LPInvestor

logger = logging.getLogger(__name__)


def _emit_deprecation_metric(action: str, details: str) -> None:
    """Best-effort write of a metric row to activity_logs. Never raises —
    if the DB itself is wedged we don't want to mask the original
    deprecation error."""
    try:
        from sqlmodel import Session

        from backend.app.database import engine
        from backend.app.models.entities import ActivityLog

        with Session(engine) as s:
            s.add(ActivityLog(action=action, details=details, actor="db_guard"))
            s.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("deprecation metric emit failed (%s): %s", action, exc)


_DEPRECATED_LP_MSG = (
    "lp_investors is read-only — the canonical tables are `limited_partners` + "
    "`vc_funds`. Use the LimitedPartner / VCFund models instead. See "
    "backend/app/models/entities.py:LPInvestor docstring for context."
)

_DEPRECATED_VCFUND_MSG = (
    "Entity rows of type='vc_fund' are deprecated — the canonical container is "
    "the `vc_funds` table (VCFund model). Create a VCFund row instead."
)


def install_db_guards() -> None:
    """Register the event listeners. Idempotent — repeated calls are safe."""
    if getattr(install_db_guards, "_installed", False):
        return

    @event.listens_for(LPInvestor, "before_insert")
    def _block_lp_investor_insert(_mapper, _connection, _target):  # noqa: D401
        _emit_deprecation_metric(
            "deprecated_lp_investors_writes_blocked",
            "Blocked ORM insert into lp_investors (use LimitedPartner)",
        )
        raise RuntimeError(_DEPRECATED_LP_MSG)

    @event.listens_for(LPInvestor, "before_update")
    def _block_lp_investor_update(_mapper, _connection, _target):
        _emit_deprecation_metric(
            "deprecated_lp_investors_writes_blocked",
            "Blocked ORM update on lp_investors (use LimitedPartner)",
        )
        raise RuntimeError(_DEPRECATED_LP_MSG)

    @event.listens_for(Entity, "before_insert")
    def _block_vc_fund_entity_insert(_mapper, _connection, target):
        if getattr(target, "entity_type", None) in ("vc_fund", EntityType.VC_FUND):
            _emit_deprecation_metric(
                "deprecated_vc_fund_writes_blocked",
                f"Blocked entity insert with entity_type=vc_fund (name={getattr(target, 'name', '?')})",
            )
            raise RuntimeError(_DEPRECATED_VCFUND_MSG)

    @event.listens_for(Entity, "before_update")
    def _block_vc_fund_entity_update(_mapper, _connection, target):
        if getattr(target, "entity_type", None) in ("vc_fund", EntityType.VC_FUND):
            _emit_deprecation_metric(
                "deprecated_vc_fund_writes_blocked",
                f"Blocked entity update with entity_type=vc_fund (name={getattr(target, 'name', '?')})",
            )
            raise RuntimeError(_DEPRECATED_VCFUND_MSG)

    # Defense-in-depth: ORM mapper events ONLY fire on per-row session.add().
    # Any Core-level path — `session.execute(insert(LPInvestor)...)`,
    # `session.bulk_insert_mappings`, raw SQL — bypasses the listeners above.
    # Hook into the engine's `before_execute` to block those too.
    from backend.app.database import engine  # local import avoids cycles

    @event.listens_for(engine, "before_execute")
    def _block_legacy_core_writes(_conn, clauseelement, _multi, _params, _opts):
        if not isinstance(clauseelement, (Insert, Update)):
            return
        table = getattr(clauseelement, "table", None)
        table_name = getattr(table, "name", None) if table is not None else None
        if table_name == "lp_investors":
            _emit_deprecation_metric(
                "deprecated_lp_investors_writes_blocked",
                "Blocked Core-level write on lp_investors",
            )
            raise RuntimeError(_DEPRECATED_LP_MSG)
        # The `entities` table is shared with non-deprecated rows, so we only
        # catch the obvious smoking-gun pattern: a Core insert hardcoding
        # entity_type='vc_fund'. ORM-level guard handles the common case.
        if isinstance(clauseelement, Insert) and table_name == "entities":
            try:
                vals = clauseelement.compile().params  # type: ignore[attr-defined]
                if vals.get("entity_type") == "vc_fund":
                    _emit_deprecation_metric(
                        "deprecated_vc_fund_writes_blocked",
                        "Blocked Core-level entity insert with entity_type=vc_fund",
                    )
                    raise RuntimeError(_DEPRECATED_VCFUND_MSG)
            except RuntimeError:
                raise
            except Exception:
                # If we can't introspect, prefer fail-open here — the ORM
                # listener still covers session.add() callers.
                pass

    install_db_guards._installed = True  # type: ignore[attr-defined]
