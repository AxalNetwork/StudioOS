"""Per-bucket sliding-window rate limiter for FastAPI.

Audit #8: mirrors the bucket layout used by the Cloudflare worker
(`cloudflare-worker/src/middleware/rateLimit.ts`):

    spinout    5 / hour   per user, only on POST/PUT/PATCH /api/legalcap/spinout/*
    ai        10 / minute per user, AI scoring/matching/advisory paths
    user      60 / minute per user, default per-user cap
    global  1000 / minute global burst protection

Storage is in-process. For a single-replica Replit deploy this is correct;
when StudioOS scales to multiple workers behind a load balancer, swap the
backing store for Redis (interface is intentionally narrow).

Fail-open: if the limiter ever raises internally we let the request through
rather than 503'ing the whole API. Sensitive operations have downstream RBAC.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Callable, Deque, Dict, Optional, Tuple

import jwt
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


_JWT_SECRET = os.environ.get("JWT_SECRET")  # main app guarantees this is set
_JWT_ALG = "HS256"


@dataclass(frozen=True)
class Bucket:
    name: str
    limit: int
    window_sec: int
    scope: str  # 'user' or 'global'
    test: Callable[[str, str], bool]


def _is_spinout(path: str, method: str) -> bool:
    return method != "GET" and path.startswith("/api/legalcap/spinout/")


def _is_ai(path: str, _method: str) -> bool:
    return (
        path.startswith("/api/scoring/")
        or path.startswith("/api/matches/")
        or path.startswith("/api/advisory/")
        or path.startswith("/api/profiling/")
        or path.startswith("/api/monitoring/anomalies")
    )


def _is_api(path: str, _method: str) -> bool:
    return path.startswith("/api/")


BUCKETS: Tuple[Bucket, ...] = (
    Bucket("spinout", 5, 3600, "user", _is_spinout),
    Bucket("ai", 10, 60, "user", _is_ai),
    Bucket("user", 60, 60, "user", _is_api),
    Bucket("global", 1000, 60, "global", _is_api),
)


# Paths the limiter never touches — health checks and the auth bootstrap.
EXEMPT_PREFIXES = (
    "/api/health",
    "/api/auth/login",          # has its own per-account brute-force throttle
    "/api/auth/register",
    "/api/auth/verify",
    "/api/auth/me",
    "/api/monitoring/metrics",
    "/api/monitoring/rate-limits",
)


def _is_exempt(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in EXEMPT_PREFIXES)


# In-process sliding-window state. Keys = (bucket_name, scope_id).
# Lock guards both the dict (defaultdict creation) and the deque trim/append
# pair, which is not atomic under the GIL across multiple bytecodes.
_STATE: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
_STATE_LOCK = threading.Lock()


def _identify(request: Request) -> Optional[int]:
    """Best-effort caller identity by decoding the JWT directly.

    Middleware runs BEFORE FastAPI's `Depends(get_current_user)` resolves, so
    we can't rely on `request.state`. Decode the bearer token ourselves;
    invalid/missing tokens degrade silently to anonymous (only the global
    bucket applies). DB lookup is intentionally skipped — we trust the JWT
    payload's `user_id` for rate-limit identity, even if the user is later
    rejected as inactive by the auth dependency.
    """
    if not _JWT_SECRET:
        return None
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return None
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
    except Exception:
        return None
    uid = payload.get("user_id")
    if isinstance(uid, int):
        return uid
    sub = payload.get("sub")
    # Worker-issued tokens use email as `sub`; hash it to a stable key bucket.
    if isinstance(sub, str) and sub:
        return hash(sub) & 0x7FFFFFFF
    return None


def _check(bucket: Bucket, scope_id: str, now: float) -> Tuple[bool, int]:
    """Returns (allowed, current_count). Trims expired entries first.

    Holds `_STATE_LOCK` for the trim+append critical section so concurrent
    requests can't race past the limit. Lock is process-wide; multi-worker
    deployments need Redis (see module docstring).
    """
    key = (bucket.name, scope_id)
    cutoff = now - bucket.window_sec
    with _STATE_LOCK:
        q = _STATE[key]
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= bucket.limit:
            return False, len(q)
        q.append(now)
        return True, len(q)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Apply per-bucket limits. Adds X-RateLimit-* headers on 429."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or _is_exempt(path):
            return await call_next(request)

        method = request.method
        try:
            user_id = _identify(request)
            now = time.time()

            for b in BUCKETS:
                if not b.test(path, method):
                    continue
                if b.scope == "user":
                    if user_id is None:
                        # Anonymous → skip per-user buckets; global still applies.
                        continue
                    scope_id = f"u:{user_id}"
                else:
                    scope_id = "g"

                allowed, count = _check(b, scope_id, now)
                if not allowed:
                    retry = b.window_sec
                    return JSONResponse(
                        status_code=429,
                        headers={
                            "Retry-After": str(retry),
                            "X-RateLimit-Bucket": b.name,
                            "X-RateLimit-Limit": str(b.limit),
                        },
                        content={
                            "detail": (
                                f"Rate limit exceeded for {b.name} bucket. "
                                f"Try again in {retry} seconds."
                            ),
                            "bucket": b.name,
                            "limit": b.limit,
                            "retry_after": retry,
                        },
                    )
        except Exception:
            # Fail-open — never let the limiter break the API.
            pass

        return await call_next(request)
