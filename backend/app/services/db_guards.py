"""SQLAlchemy event listeners that seal the legacy data paths.

Audit #1: `lp_investors` and `entities(type='vc_fund')` are deprecated. The
canonical tables are `limited_partners` + `vc_funds`. The startup migration in
`backend/app/models/migrations.py:consolidate_capital_tables` keeps any
historical rows mirrored. To prevent accidental drift, we install ORM event
listeners that raise loudly on any new write to the deprecated rows.

Reads still work — the migration code reads `LPInvestor` and the
`type='vc_fund'` Entity rows during consolidation, and the legacy
`capital_calls.lp_investor_id` column is still used for backward-compatible
lookups. Only INSERT and UPDATE are blocked.
"""
from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.sql import Insert, Update

from backend.app.models.entities import Entity, EntityType, LPInvestor


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
        raise RuntimeError(_DEPRECATED_LP_MSG)

    @event.listens_for(LPInvestor, "before_update")
    def _block_lp_investor_update(_mapper, _connection, _target):
        raise RuntimeError(_DEPRECATED_LP_MSG)

    @event.listens_for(Entity, "before_insert")
    def _block_vc_fund_entity_insert(_mapper, _connection, target):
        if getattr(target, "entity_type", None) in ("vc_fund", EntityType.VC_FUND):
            raise RuntimeError(_DEPRECATED_VCFUND_MSG)

    @event.listens_for(Entity, "before_update")
    def _block_vc_fund_entity_update(_mapper, _connection, target):
        if getattr(target, "entity_type", None) in ("vc_fund", EntityType.VC_FUND):
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
            raise RuntimeError(_DEPRECATED_LP_MSG)
        # The `entities` table is shared with non-deprecated rows, so we only
        # catch the obvious smoking-gun pattern: a Core insert hardcoding
        # entity_type='vc_fund'. ORM-level guard handles the common case.
        if isinstance(clauseelement, Insert) and table_name == "entities":
            try:
                vals = clauseelement.compile().params  # type: ignore[attr-defined]
                if vals.get("entity_type") == "vc_fund":
                    raise RuntimeError(_DEPRECATED_VCFUND_MSG)
            except RuntimeError:
                raise
            except Exception:
                # If we can't introspect, prefer fail-open here — the ORM
                # listener still covers session.add() callers.
                pass

    install_db_guards._installed = True  # type: ignore[attr-defined]
