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

from backend.app.models.entities import User
from backend.app.services.access_policy import (
    can_view_signed_ip,
    can_view_signer_email,
)
from backend.app.services.pii import mask_email


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

    # Rule 2a: strip admin-only legal-proof evidence (signed_ip) for
    # every non-admin viewer. Delegated to access_policy so the rule
    # lives in one place.
    if not can_view_signed_ip(viewer):
        for k in _ADMIN_ONLY_SIGNATURE_FIELDS:
            data.pop(k, None)

    # Rule 2b: mask signer email unless the viewer is admin / signer /
    # document owner.
    signed_by = data.get("signed_by")
    if signed_by and not can_view_signer_email(
        viewer,
        signer_email=str(signed_by),
        owner_user_id=owner_user_id,
        owner_founder_id=owner_founder_id,
    ):
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
