"""
Python producer for the StudioOS Cloudflare Queue (`studioos-job-queue`).

The FastAPI backend can't use Worker bindings, so we POST messages to the
Cloudflare Queues REST API. The message body shape mirrors the TypeScript
producer in `cloudflare-worker/src/services/queue.ts` so the in-Worker
consumer can dispatch jobs from either side identically.

Configuration (env vars, already present as Replit secrets):
    CLOUDFLARE_ACCOUNT_ID  — Cloudflare account UUID
    CLOUDFLARE_API_TOKEN   — token with `Queues:Edit` permission
    USE_CF_QUEUE           — "true" enables the CF queue path; anything else
                             returns a no-op result and the caller should
                             fall back to its existing in-process path.

The queue name is hard-coded to `studioos-job-queue` to match wrangler.toml.
DLQ routing is configured on the queue itself; producers don't need to know
about it.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

QUEUE_NAME = "studioos-job-queue"
_API_BASE = "https://api.cloudflare.com/client/v4"


@dataclass
class EnqueueResult:
    transport: str          # "cf_queue" or "skipped"
    ok: bool
    idempotency_key: str
    error: Optional[str] = None


def _enabled() -> bool:
    return (
        os.getenv("USE_CF_QUEUE", "").lower() == "true"
        and bool(os.getenv("CLOUDFLARE_ACCOUNT_ID"))
        and bool(os.getenv("CLOUDFLARE_API_TOKEN"))
    )


async def enqueue(
    job_type: str,
    payload: dict[str, Any],
    *,
    delay_seconds: Optional[int] = None,
    idempotency_key: Optional[str] = None,
) -> EnqueueResult:
    """Send a single job to the Cloudflare Queue.

    Args:
        job_type: One of the JobType values (must match TS dispatcher).
        payload: JSON-serializable job payload.
        delay_seconds: Optional per-message delivery delay.
        idempotency_key: Optional caller-provided dedupe key. If omitted
            we generate a UUID. The TS consumer skips messages whose key
            it has already processed within 24h.

    Note: per-message retry count is intentionally NOT exposed — CF Queues
    retry policy is set in `wrangler.toml` and applies uniformly. Returns
    an EnqueueResult; callers should inspect `.ok`.
    """
    key = idempotency_key or str(uuid.uuid4())

    if not _enabled():
        return EnqueueResult(transport="skipped", ok=False, idempotency_key=key,
                             error="USE_CF_QUEUE disabled or credentials missing")

    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    url = f"{_API_BASE}/accounts/{account_id}/queues/{QUEUE_NAME}/messages"

    body: dict[str, Any] = {
        "body": json.dumps({
            "job_type": job_type,
            "payload": payload or {},
            "idempotency_key": key,
        }),
        "content_type": "json",
    }
    if delay_seconds is not None:
        body["delay_seconds"] = int(delay_seconds)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
        if r.status_code >= 300:
            logger.error("cf_queue enqueue failed: %s %s", r.status_code, r.text[:300])
            return EnqueueResult(transport="cf_queue", ok=False, idempotency_key=key,
                                 error=f"http {r.status_code}: {r.text[:200]}")
        return EnqueueResult(transport="cf_queue", ok=True, idempotency_key=key)
    except Exception as e:  # noqa: BLE001
        logger.exception("cf_queue enqueue exception")
        return EnqueueResult(transport="cf_queue", ok=False, idempotency_key=key, error=str(e))
