"""PII handling helpers.

Two main patterns:
  * `mask_*()` — produce a redacted display string from a sensitive value.
    These are pure functions and safe to call on every render.
  * `is_privileged_viewer()` / `can_see_full_pii()` — predicates the route
    layer uses to decide whether a given viewer should see the *masked* or
    *full* form of a sensitive field.

Design rules:
  * Wire-compat: we never **drop** an existing field from a response. We
    replace its value with a masked form. That way the frontend keeps
    rendering, but a non-privileged viewer cannot reconstruct the PII.
  * Admins (`UserRole.ADMIN`) always see full PII.
  * The PII subject themselves (the user whose data it is) always sees their
    own full PII.
  * Everyone else gets the masked form.
"""

from __future__ import annotations

from typing import Optional

from backend.app.models.entities import User, UserRole


# ---------------------------------------------------------------------------
# Mask primitives
# ---------------------------------------------------------------------------
def mask_email(email: Optional[str]) -> Optional[str]:
    """`alice@example.com` -> `a****@example.com`.

    Returns the input unchanged if it doesn't look like an email."""
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    if not local:
        return f"****@{domain}"
    if len(local) == 1:
        return f"{local}****@{domain}"
    return f"{local[0]}{'*' * max(3, len(local) - 1)}@{domain}"


def mask_phone(phone: Optional[str]) -> Optional[str]:
    """`+1 415 555 0123` -> `+••••••0123` (last 4 visible)."""
    if not phone:
        return phone
    digits = [c for c in phone if c.isdigit()]
    if len(digits) <= 4:
        return "*" * len(digits)
    last4 = "".join(digits[-4:])
    return f"••••••{last4}"


def mask_name(name: Optional[str]) -> Optional[str]:
    """`Alice Wonderland` -> `A. W.` — keep initials only."""
    if not name:
        return name
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return name
    return " ".join(f"{p[0].upper()}." for p in parts)


# ---------------------------------------------------------------------------
# Viewer privilege
# ---------------------------------------------------------------------------
def is_privileged_viewer(viewer: Optional[User]) -> bool:
    """True iff the viewer should see *all* PII unconditionally (admin)."""
    return bool(viewer and viewer.role == UserRole.ADMIN)


def can_see_full_pii(viewer: Optional[User], *, subject_user_id: Optional[int] = None,
                      subject_founder_id: Optional[int] = None,
                      subject_partner_id: Optional[int] = None) -> bool:
    """Decide if `viewer` may see the full PII of the subject identified by
    one of the optional ids. Admins always pass. Otherwise, the subject
    matches when any provided id matches the viewer's own linked record."""
    if viewer is None:
        return False
    if viewer.role == UserRole.ADMIN:
        return True
    if subject_user_id is not None and viewer.id == subject_user_id:
        return True
    if subject_founder_id is not None and viewer.founder_id == subject_founder_id:
        return True
    if subject_partner_id is not None and viewer.partner_id == subject_partner_id:
        return True
    return False


# ---------------------------------------------------------------------------
# Field-allowlist DTOs (drop, never spread)
# ---------------------------------------------------------------------------
# Fields that MUST NEVER appear in any user-facing JSON response, regardless
# of the viewer. Use as a hard guard when serialising raw model_dump() output.
USER_ALWAYS_REDACT = {
    "password_hash",
    "verification_token",
    "verification_token_expires",
}


def serialize_user_safe(u: User, viewer: Optional[User], *, include_admin_only: bool = False) -> dict:
    """Serialise a `User` row, dropping always-secret fields and masking PII
    for non-privileged viewers. `include_admin_only=True` keeps admin-only
    fields like `admin_notes` (use only inside admin routes)."""
    data = u.model_dump()
    for k in USER_ALWAYS_REDACT:
        data.pop(k, None)
    privileged = can_see_full_pii(viewer, subject_user_id=u.id)
    if not privileged:
        data["email"] = mask_email(u.email)
        data.pop("admin_notes", None)
        data.pop("last_active_at", None)
    elif not include_admin_only:
        data.pop("admin_notes", None)
    return data
