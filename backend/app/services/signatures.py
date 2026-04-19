"""Signature handling policy + sanitisers.

Why this module exists
----------------------
Document signatures are a high-sensitivity surface:

  * The signer's identity (email) is PII that must follow the same masking
    rules as the rest of the platform — only admins and the signer
    themselves should see the un-masked email.
  * Legal-proof metadata (currently the originating IP) is *only* useful
    to admins for dispute resolution. It must never leak to founders,
    partners, or the public.
  * We deliberately *do not* store typed-name strings, drawn-signature
    images, or any other "signature payload" beyond what's required to
    prove that a particular authenticated user clicked the sign button.
    Data minimisation: less stored = less to leak.

Anything that returns a `Document` (or a dict serialisation of one) to a
non-admin caller MUST go through `redact_signature_for_viewer()`.
"""

from __future__ import annotations

from typing import Any, Optional

from backend.app.models.entities import User, UserRole
from backend.app.services.pii import can_see_full_pii, mask_email


# Fields that are admin-only legal proof. They must be stripped from every
# non-admin DTO regardless of ownership.
_ADMIN_ONLY_SIGNATURE_FIELDS = ("signed_ip",)


def redact_signature_for_viewer(
    data: dict[str, Any],
    *,
    viewer: Optional[User],
    owner_user_id: Optional[int] = None,
    owner_founder_id: Optional[int] = None,
) -> dict[str, Any]:
    """Mutate `data` in place (and return it) to strip / mask signature
    fields based on `viewer`'s privilege.

    Rules:
      * Admin-only proof fields (`signed_ip`, …) are always stripped for
        non-admin viewers.
      * `signed_by` (email) is masked unless the viewer is the signer
        themselves, the document owner (matched via `owner_user_id` or
        `owner_founder_id`), or an admin. Partners are *not* automatically
        privileged here — they would need to match `owner_partner_id`
        explicitly via the underlying `can_see_full_pii` predicate.
      * `signed_at` (a timestamp) stays — knowing *when* a contract was
        signed is not sensitive once the viewer is already authorised to
        see the contract.
    """
    if not isinstance(data, dict):
        return data

    privileged = can_see_full_pii(
        viewer,
        subject_user_id=owner_user_id,
        subject_founder_id=owner_founder_id,
    )

    # Strip admin-only legal-proof evidence for everyone except admins.
    # `can_see_full_pii(..., subject_user_id=None)` returns True only for
    # admins, so we use a strict admin gate here.
    is_admin = bool(viewer and viewer.role == UserRole.ADMIN)
    if not is_admin:
        for k in _ADMIN_ONLY_SIGNATURE_FIELDS:
            if k in data:
                data.pop(k, None)

    # Mask signer email for non-privileged viewers who aren't the signer.
    signed_by = data.get("signed_by")
    if signed_by:
        viewer_email = getattr(viewer, "email", None)
        is_self_signer = bool(viewer_email and viewer_email.lower() == str(signed_by).lower())
        if not (privileged or is_self_signer):
            data["signed_by"] = mask_email(signed_by)

    return data


def derive_signer_email(
    *,
    actor: User,
    requested_on_behalf_of: Optional[str],
    actor_is_privileged: bool,
) -> str:
    """Resolve the legal signer for a sign request.

    Default: the authenticated user signs as themselves. Only privileged
    actors (admin / partner) may set `on_behalf_of` to record a signature
    attributed to a different party — and even then we still log the *real*
    actor in the audit trail (`signed_via`), so the chain of custody is
    preserved."""
    if requested_on_behalf_of and requested_on_behalf_of.strip():
        if not actor_is_privileged:
            # Quietly ignore the override for non-privileged callers — they
            # always sign as themselves regardless of what they request.
            return actor.email
        return requested_on_behalf_of.strip()
    return actor.email
