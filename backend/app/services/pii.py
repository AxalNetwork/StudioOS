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

Epic 11 — `scrub_text()` is the catch-all helper for free-text strings
headed into a persistent log row (ActivityLog.details, error_logs.message,
system_metrics.labels). Use it in the call site that produces the log row
so the raw value never lands on disk in the first place.
"""

from __future__ import annotations

import re
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
# Free-text scrub (Epic 11)
# ---------------------------------------------------------------------------
# These regexes target the categories that show up most often in our log
# tables (activity_logs.details, error_logs.message). Each pattern is
# deliberately conservative — false positives are cheap (a dropped placeholder
# in a debug log) but false negatives leak PII into a row that's eventually
# surfaced to admins / exported to support tickets.

# RFC-5322 lite — good enough to catch real-looking emails in free text.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# IPv4 — four dotted octets. We don't bother validating each octet's range
# because even a 999.999.999.999-shaped number is something we'd rather not
# log verbatim. IPv6 is matched separately, more loosely, to catch the
# common `2001:db8::1` / fully-expanded forms without the (very gnarly)
# strict RFC-4291 grammar.
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# IPv6 — we accept some false positives (e.g. an "ab::cd" appearing in a
# hex dump) so that the common `::` zero-compression form (2001:db8::1,
# fe80::1, ::1) is caught alongside the fully-expanded form. Pattern:
#   * one or more groups of 1–4 hex chars separated by colons, OR
#   * the same with a `::` somewhere in the middle (compression).
_IPV6_RE = re.compile(
    r"(?<![A-Fa-f0-9:])"
    r"(?:"
    r"(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}"   # full / right-trimmed
    r"|"
    r"(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}"  # one `::` compression
    r"|"
    r"::[A-Fa-f0-9]{1,4}"                            # leading `::`
    r")"
    r"(?![A-Fa-f0-9:])"
)

# JWT shape — three URL-safe-base64 segments separated by dots. The middle
# claim segment is usually 100+ chars, so we anchor on >= 20 chars per
# segment to avoid clobbering ordinary dotted identifiers like `foo.bar.baz`.
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b")

# `Bearer <token>` / `bearer <token>` — strip the entire pair so the
# downstream reader can't accidentally surface the residual token by
# stripping the `Bearer` prefix in their own UI.
_BEARER_RE = re.compile(r"\b[Bb]earer\s+[A-Za-z0-9._\-]+", re.IGNORECASE)

# `password=<value>` / `password: <value>` / `pwd=<value>` — common log
# accidents. We grab everything up to the next whitespace or quote.
_PASSWORD_RE = re.compile(
    r"(?i)\b(?:password|pwd|secret|api[_-]?key|token)\s*[:=]\s*[\"']?[^\s\"'&]+",
)


def scrub_text(value: Optional[str]) -> Optional[str]:
    """Replace PII / credential patterns in a free-text string with stable
    redaction tokens.

    Returns the input unchanged when it's None / empty so callers can chain
    `scrub_text(maybe_str) or default` without extra None-handling.

    Replacement tokens are deliberately distinct so admin reviewers reading
    a log row can tell *what* was redacted at a glance:

        ``[REDACTED:EMAIL]``    — an email address
        ``[REDACTED:IP]``       — an IPv4 or IPv6 address
        ``[REDACTED:JWT]``      — a JSON Web Token
        ``[REDACTED:BEARER]``   — a `Bearer <token>` header value
        ``[REDACTED:CREDENTIAL]`` — a password / api key / secret pair

    Order matters: scrub credentials and JWTs *before* emails so a
    `Bearer eyJ...@signing.email` style token doesn't leave the email half
    behind.
    """
    if not value:
        return value
    text = value
    # Highest-specificity patterns first so they consume their input before
    # the broader ones fire.
    text = _PASSWORD_RE.sub("[REDACTED:CREDENTIAL]", text)
    text = _BEARER_RE.sub("[REDACTED:BEARER]", text)
    text = _JWT_RE.sub("[REDACTED:JWT]", text)
    text = _EMAIL_RE.sub("[REDACTED:EMAIL]", text)
    text = _IPV4_RE.sub("[REDACTED:IP]", text)
    text = _IPV6_RE.sub("[REDACTED:IP]", text)
    return text


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
