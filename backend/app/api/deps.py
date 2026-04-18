"""Shared FastAPI dependencies for authentication and RBAC."""
from typing import Iterable

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


require_admin_or_partner = require_role("partner")
