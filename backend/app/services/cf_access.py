"""Cloudflare Access (Zero Trust) JWT verification — Security Item #6.

This is the *outer perimeter* defence. It runs in addition to the existing
application JWT auth (`require_admin`, `get_current_user`, …), never as a
replacement. The principle: even if an attacker steals a long-lived app
JWT, they still need to come through Cloudflare Access (with their
corporate identity, MFA, device posture, IP allowlist, etc.) to *reach*
the backoffice routers.

How it fits in the request path:

    User browser
        ↓
    Cloudflare → Access policy enforced (SSO + MFA + posture)
        ↓        injects header: Cf-Access-Jwt-Assertion
    Cloudflare Worker (passthrough)
        ↓
    FastAPI:  require_cf_access (THIS module — verifies CF JWT)
        ↓
    FastAPI:  require_admin       (verifies our own app JWT)
        ↓
    Route handler

------------------------------------------------------------------
Configuration (env vars):

    CF_ACCESS_TEAM_DOMAIN   e.g. "axal.cloudflareaccess.com"
    CF_ACCESS_AUD           the Application Audience (AUD) tag from the
                            CF dashboard
    CF_ACCESS_ALLOWED_EMAILS
                            optional comma-separated allowlist; when set,
                            the JWT's `email` claim must be in the list
                            (defence in depth on top of the CF policy)

Behaviour by config state:
  * **Both unset** → middleware no-ops with a one-shot warning log
    (the local-dev path; preserves developer ergonomics).
  * **Both set**   → perimeter is active; missing/invalid header → 403.
  * **Exactly one set** → fail loud: returns HTTP 500 on every protected
    request and logs an error. Silently falling back to no-op in this
    state would let a deploy mistake (forgetting to set the second var)
    silently disable the perimeter in production.

------------------------------------------------------------------
Why this design:
* Opt-in: dev/local boots without any CF config and the dependency
  becomes a no-op — preserves developer ergonomics.
* JWKS is cached by `PyJWKClient` so we don't hit CF on every request.
* We surface a small `cf_access_status()` helper so the Admin → Status
  page can show whether the perimeter is active.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

import jwt
from fastapi import HTTPException, Request, status
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# Module-level "we already warned about disabled state" flag. Without this
# we'd spam the logs on every request when CF Access isn't configured.
_warned_disabled = False


def _env(name: str) -> Optional[str]:
    v = os.environ.get(name, "").strip()
    return v or None


def _config() -> dict:
    """Read the current CF Access configuration from env. Re-read on every
    call so tests / hot-reload pick up changes without a restart."""
    team = _env("CF_ACCESS_TEAM_DOMAIN")
    aud = _env("CF_ACCESS_AUD")
    allow = _env("CF_ACCESS_ALLOWED_EMAILS")
    return {
        "team_domain": team,
        "aud": aud,
        "allowed_emails": (
            {e.strip().lower() for e in allow.split(",") if e.strip()}
            if allow else None
        ),
        "issuer": f"https://{team}" if team else None,
        "jwks_url": f"https://{team}/cdn-cgi/access/certs" if team else None,
    }


def is_enabled() -> bool:
    cfg = _config()
    return bool(cfg["team_domain"] and cfg["aud"])


def cf_access_status() -> dict:
    """Small introspection helper for Admin → Status / health probes."""
    cfg = _config()
    return {
        "enabled": is_enabled(),
        "team_domain": cfg["team_domain"],
        # Never echo the AUD tag itself — it's a secret-ish identifier.
        "aud_configured": bool(cfg["aud"]),
        "email_allowlist_size": (
            len(cfg["allowed_emails"]) if cfg["allowed_emails"] else 0
        ),
    }


@lru_cache(maxsize=4)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    """Cache one client per JWKS URL. PyJWKClient caches signing keys
    internally with a short TTL, so we don't pay the network cost per
    request."""
    return PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)


def verify_cf_access_jwt(request: Request) -> Optional[dict]:
    """Verify the `Cf-Access-Jwt-Assertion` header on `request`.

    Returns the decoded claims dict on success, or `None` if the
    middleware is disabled (no env config). Raises `HTTPException(403)`
    if Access is enabled but the assertion is missing/invalid/disallowed.
    Raises `HTTPException(500)` if the env config is partial (one of
    the two required vars is set but not the other) — fail-loud beats a
    silent perimeter bypass in production.
    """
    cfg = _config()
    team, aud = cfg["team_domain"], cfg["aud"]

    # Fail loud on partial config. A common deploy mistake is setting just
    # one of the two vars — without this guard the dependency would silently
    # no-op and the perimeter would be off in production.
    if bool(team) != bool(aud):
        logger.error(
            "Cloudflare Access partial config: "
            "CF_ACCESS_TEAM_DOMAIN set=%s, CF_ACCESS_AUD set=%s. "
            "Both must be set to enable the perimeter, or neither to disable it.",
            bool(team), bool(aud),
        )
        raise HTTPException(
            status_code=500,
            detail="Cloudflare Access is misconfigured (partial environment)",
        )

    if not team or not aud:
        global _warned_disabled
        if not _warned_disabled:
            logger.warning(
                "Cloudflare Access verification is DISABLED "
                "(CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not set). "
                "Backoffice routes rely on application auth only. "
                "Set both env vars to activate the perimeter."
            )
            _warned_disabled = True
        return None

    # API-server policy: header only. We deliberately do NOT fall back to
    # the `CF_Authorization` cookie (which CF also sets for browser
    # navigation) — accepting it would let a stolen cookie bypass the
    # perimeter on direct API calls. The CF proxy always injects the
    # header on every request it forwards, so requiring it is correct.
    assertion = request.headers.get("cf-access-jwt-assertion")
    if not assertion:
        # Fail closed: if the operator turned the perimeter on, every
        # request must come through Cloudflare (which adds the header).
        # A direct hit to the origin without the header is a bypass attempt.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cloudflare Access required for this route",
        )

    try:
        signing_key = _jwks_client(cfg["jwks_url"]).get_signing_key_from_jwt(assertion)
        claims = jwt.decode(
            assertion,
            signing_key.key,
            algorithms=["RS256"],
            audience=cfg["aud"],
            issuer=cfg["issuer"],
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=403, detail="Cloudflare Access token expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=403, detail="Cloudflare Access AUD mismatch")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=403, detail="Cloudflare Access issuer mismatch")
    except Exception as exc:  # noqa: BLE001
        logger.warning("CF Access JWT validation failed: %s", exc)
        raise HTTPException(status_code=403, detail="Invalid Cloudflare Access token")

    # Optional defence-in-depth: enforce an extra app-level email allowlist
    # even if the CF Access policy is misconfigured to allow more identities.
    if cfg["allowed_emails"]:
        email = (claims.get("email") or "").lower()
        if email not in cfg["allowed_emails"]:
            logger.warning(
                "CF Access email not in allowlist: %r", email or "<no-email>"
            )
            raise HTTPException(
                status_code=403,
                detail="Email not permitted by application allowlist",
            )

    return claims


def require_cf_access(request: Request) -> Optional[dict]:
    """FastAPI dependency wrapper. Use as `dependencies=[Depends(require_cf_access)]`
    on a router so that every route inside it must clear the perimeter
    before the per-route auth (`require_admin`) runs."""
    return verify_cf_access_jwt(request)
