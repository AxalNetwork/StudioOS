"""Shared FastAPI dependencies for authentication and RBAC."""

from fastapi import Depends, HTTPException

from backend.app.api.routes.auth import get_current_user
from backend.app.models.entities import User, UserRole


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_role(*roles: str):
    """Factory: only users whose role is in `roles` (or admin) may pass."""
    allowed = {r.lower() for r in roles}

    def _dep(user: User = Depends(get_current_user)) -> User:
        role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
        if role_value == "admin":
            return user
        if role_value.lower() not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: requires one of roles {sorted(allowed)}",
            )
        return user

    return _dep


# Backwards-compatible alias retained so existing imports keep working.
# Phase 0.1 split: investor users (migrated from "partner") also pass.
require_admin_or_partner = require_role("partner", "investor")
require_admin_or_investor = require_role("investor")
require_admin_or_partner_or_investor = require_role("partner", "investor")


def is_privileged(user: User) -> bool:
    """Admin / partner / investor roles bypass per-row ownership checks.

    Phase 0.1: investor inherits the legacy "partner = privileged" semantics
    so we don't break in-flight read paths during the role split. New code
    should call the role-specific helpers in `services.access_policy` instead
    (`can_view_lp_data`, `can_view_partner_demand`).
    """
    return user.role in (UserRole.ADMIN, UserRole.PARTNER, UserRole.INVESTOR)


def can_access_founder_resource(user: User, owner_founder_id: int | None) -> bool:
    """IDOR guard: True iff the user may read/touch a row owned by `owner_founder_id`."""
    if is_privileged(user):
        return True
    if owner_founder_id is None:
        return False
    return bool(user.founder_id) and user.founder_id == owner_founder_id


def ensure_founder_access(user: User, owner_founder_id: int | None) -> None:
    if not can_access_founder_resource(user, owner_founder_id):
        raise HTTPException(status_code=403, detail="Forbidden: you do not own this resource")
