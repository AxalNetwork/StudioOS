"""Phase C2 — CSP violation collector.

The hardened Content-Security-Policy header in `backend/app/main.py` includes
a `report-uri /api/csp-report` directive. Browsers POST a JSON document
(media type `application/csp-report` or `application/reports+json`)
describing each violation. We persist them as `ActivityLog` rows with
action='csp_violation' so they show up in the existing
`/api/monitoring/errors` query without needing a new table.

Endpoint is intentionally:
  * Unauthenticated — browsers cannot attach our session cookie / Bearer.
  * Cheap — payload is parsed best-effort and stored as text; never raises.
  * Always 204 — anything else triggers retries by the browser.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlmodel import Session

from backend.app.database import engine
from backend.app.models.entities import ActivityLog

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Security"])

# Per-IP rate limit so a misbehaving page can't flood the log table.
_csp_ip_bucket: dict = {}
_CSP_MAX_PER_MIN = 30


def _ip_allowed(ip: str) -> bool:
    now = datetime.utcnow()
    cutoff = now - timedelta(minutes=1)
    bucket = [t for t in _csp_ip_bucket.get(ip, []) if t > cutoff]
    if len(bucket) >= _CSP_MAX_PER_MIN:
        return False
    bucket.append(now)
    _csp_ip_bucket[ip] = bucket
    return True


@router.post("/csp-report", status_code=204)
async def csp_report(request: Request) -> Response:
    ip = (request.client.host if request.client else "unknown") or "unknown"
    if not _ip_allowed(ip):
        return Response(status_code=204)

    try:
        body = await request.body()
        payload = json.loads(body or b"{}") if body else {}
    except Exception:
        payload = {"_raw": "unparseable"}

    # Browsers wrap the actual report under "csp-report" or send a
    # Reports-API list — flatten either shape.
    report = payload.get("csp-report") if isinstance(payload, dict) else None
    if isinstance(payload, list) and payload:
        report = payload[0].get("body") or payload[0]
    if report is None:
        report = payload

    summary = {
        "blocked_uri": (report or {}).get("blocked-uri") or (report or {}).get("blockedURL"),
        "violated_directive": (report or {}).get("violated-directive") or (report or {}).get("effectiveDirective"),
        "document_uri": (report or {}).get("document-uri") or (report or {}).get("documentURL"),
        "source_file": (report or {}).get("source-file") or (report or {}).get("sourceFile"),
        "line_number": (report or {}).get("line-number") or (report or {}).get("lineNumber"),
        "ip": ip,
    }

    try:
        with Session(engine) as s:
            s.add(ActivityLog(
                action="csp_violation",
                details=json.dumps(summary)[:2000],
                actor=ip,
            ))
            s.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("csp-report persist failed: %s", exc)

    return Response(status_code=204)
