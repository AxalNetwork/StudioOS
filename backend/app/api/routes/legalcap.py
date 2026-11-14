"""Dev-only legalcap shim.

Prod serves every `/api/legalcap/*` route from the Cloudflare Worker
(`cloudflare-worker/src/routes/legalcap.ts`). The dev FastAPI is never
deployed; it only needs to keep the error dashboard honest by answering the
canonical Worker path for the LP portal.

The frontend's own LP-portal call already targets `/api/capital/lp-portal`
(served by `capital.py`), but the error dashboard probes the Worker path
`/api/legalcap/capital/lp-portal`. This shim re-exposes the exact same
handler at that path so the probe gets a 200 instead of a 404. No new logic
lives here — `lp_portal` is imported verbatim from `capital.py`.
"""
from fastapi import APIRouter

from backend.app.api.routes.capital import lp_portal

router = APIRouter(prefix="/legalcap", tags=["Legal & Capital (dev shim)"])

# Reuse the exact capital.py handler (including its Depends signature) so the
# dev API matches the Worker's `/api/legalcap/capital/lp-portal` path.
router.add_api_route("/capital/lp-portal", lp_portal, methods=["GET"])
