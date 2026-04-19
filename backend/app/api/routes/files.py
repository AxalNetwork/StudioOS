"""Public file proxy gated by short-lived HMAC tokens.

Tokens are minted by the admin (`POST /admin/contracts/{uid}/download-url`).
The token IS the auth — there is no implicit user context — so it must be
short-lived and scoped to a single `file_key`.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.app.services.file_storage import (
    get_storage,
    verify_signed_token,
)

router = APIRouter(tags=["Files"])


@router.get("/files/contracts/{token}")
def download_contract_by_token(token: str):
    try:
        payload = verify_signed_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired link: {exc}")

    file_key = payload["k"]
    if not file_key.startswith("contracts/"):
        raise HTTPException(status_code=403, detail="Token not valid for this resource")

    try:
        data = get_storage().get(file_key)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="File not found")

    # SECURITY: contract bodies can contain user-supplied HTML. We never serve
    # them inline as text/html from an authenticated origin — that would be a
    # stored-XSS sink for anyone who opens a share link. Force a download with
    # an opaque content type. PDFs are safe to inline, but we still attach.
    filename = file_key.rsplit("/", 1)[-1]
    ct = "application/pdf" if file_key.endswith(".pdf") else "application/octet-stream"
    return Response(
        content=data,
        media_type=ct,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
