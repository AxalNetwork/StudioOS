"""Pluggable file storage for contract files (and any other private blobs).

Backends:
  - **LocalStorage** (default): writes to a directory on disk. Safe for dev,
    Replit volumes, and any environment without object storage configured.
  - **R2Storage**: Cloudflare R2 (S3-compatible). Activated automatically when
    all of `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and
    `R2_SECRET_ACCESS_KEY` are present in the environment.

Design notes:
  - Bucket is treated as private. We never publish bucket URLs directly.
  - Downloads always go through the API: either the auth-gated proxy route
    (`GET /admin/contracts/{uid}/download`) which streams bytes after
    authorising the caller, or a short-lived HMAC token URL minted via
    `mint_signed_token()` and validated by `verify_signed_token()`.
  - Each stored object is keyed `contracts/{doc_uid}/{sha256[:16]}.{ext}` so
    re-uploads of identical content collide on the same key (free dedupe) and
    a per-document prefix makes ACL / GDPR deletion trivial.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------
class StoredObject:
    __slots__ = ("file_key", "size", "sha256", "content_type")

    def __init__(self, file_key: str, size: int, sha256: str, content_type: str):
        self.file_key = file_key
        self.size = size
        self.sha256 = sha256
        self.content_type = content_type

    def as_dict(self) -> dict:
        return {
            "file_key": self.file_key,
            "size": self.size,
            "sha256": self.sha256,
            "content_type": self.content_type,
        }


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ext_for(content_type: str) -> str:
    return {
        "text/html": "html",
        "text/plain": "txt",
        "application/pdf": "pdf",
        "application/json": "json",
    }.get((content_type or "").lower(), "bin")


def _build_contract_key(doc_uid: str, content_type: str, sha256: str) -> str:
    return f"contracts/{doc_uid}/{sha256[:16]}.{_ext_for(content_type)}"


# ---------------------------------------------------------------------------
# Local backend (default)
# ---------------------------------------------------------------------------
class LocalStorage:
    """Filesystem-backed storage. Root defaults to `data/file_storage/`."""

    def __init__(self, root: Optional[str] = None):
        self.root = Path(root or os.environ.get("FILE_STORAGE_ROOT", "data/file_storage")).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Refuse traversal: normalise then verify the resolved path is strictly
        # *inside* the root via `relative_to` (string-prefix checks are
        # bypassable by sibling dirs like `<root>_evil/...`).
        if not isinstance(key, str) or not key or "\x00" in key:
            raise ValueError("Invalid storage key")
        p = (self.root / key).resolve()
        try:
            p.relative_to(self.root)
        except ValueError as exc:
            raise ValueError(f"Refusing path outside root: {key}") from exc
        return p

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).exists()
        except ValueError:
            return False

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        # Sidecar metadata so we can recover content_type on read.
        path.with_suffix(path.suffix + ".meta.json").write_text(
            json.dumps({"content_type": content_type, "size": len(data)})
        )
        return StoredObject(key, len(data), _sha256_hex(data), content_type)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def head(self, key: str) -> Optional[dict]:
        path = self._path(key)
        if not path.exists():
            return None
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
            except Exception:  # noqa: BLE001
                meta = {}
        return {"size": path.stat().st_size, "content_type": meta.get("content_type")}

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        if meta_path.exists():
            meta_path.unlink()

    @property
    def backend(self) -> str:
        return "local"


# ---------------------------------------------------------------------------
# Cloudflare R2 backend (S3-compatible) using SigV4 over httpx
# ---------------------------------------------------------------------------
class R2Storage:
    """S3-compatible R2 storage using SigV4-signed httpx calls.

    No boto3 dependency required. The bucket is treated as private — bytes
    only flow through our auth-gated proxy or a short-lived HMAC token URL.
    """

    def __init__(self, account_id: str, bucket: str, access_key_id: str, secret_access_key: str):
        self.account_id = account_id
        self.bucket = bucket
        self.access_key = access_key_id
        self.secret_key = secret_access_key
        self.endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
        self.region = "auto"

    # -- SigV4 helpers --------------------------------------------------------
    @staticmethod
    def _hex(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def _sign(self, method: str, key: str, payload: bytes, content_type: Optional[str] = None) -> dict:
        """Return signed request kwargs for httpx."""
        canonical_uri = "/" + urllib.parse.quote(f"{self.bucket}/{key}", safe="/")
        url = self.endpoint + canonical_uri
        now = datetime.utcnow()
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = self._hex(payload)
        host = f"{self.account_id}.r2.cloudflarestorage.com"
        headers = {
            "host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type and method == "PUT":
            headers["content-type"] = content_type

        sorted_headers = sorted(headers.items())
        canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted_headers)
        signed_headers = ";".join(k for k, _ in sorted_headers)
        canonical_request = f"{method}\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

        scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        string_to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{self._hex(canonical_request.encode())}"

        def hmac_sha256(key_: bytes, msg: str) -> bytes:
            return hmac.new(key_, msg.encode(), hashlib.sha256).digest()

        k_date = hmac_sha256(("AWS4" + self.secret_key).encode(), date_stamp)
        k_region = hmac_sha256(k_date, self.region)
        k_service = hmac_sha256(k_region, "s3")
        k_signing = hmac_sha256(k_service, "aws4_request")
        signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

        headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        return {"url": url, "headers": headers}

    # -- Operations ----------------------------------------------------------
    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        req = self._sign("PUT", key, data, content_type=content_type)
        with httpx.Client(timeout=30) as client:
            r = client.put(req["url"], headers=req["headers"], content=data)
        if r.status_code >= 300:
            raise RuntimeError(f"R2 PUT failed ({r.status_code}): {r.text[:200]}")
        return StoredObject(key, len(data), _sha256_hex(data), content_type)

    def get(self, key: str) -> bytes:
        req = self._sign("GET", key, b"")
        with httpx.Client(timeout=30) as client:
            r = client.get(req["url"], headers=req["headers"])
        if r.status_code >= 300:
            raise RuntimeError(f"R2 GET failed ({r.status_code}): {r.text[:200]}")
        return r.content

    def head(self, key: str) -> Optional[dict]:
        req = self._sign("HEAD", key, b"")
        with httpx.Client(timeout=30) as client:
            r = client.head(req["url"], headers=req["headers"])
        if r.status_code == 404:
            return None
        if r.status_code >= 300:
            raise RuntimeError(f"R2 HEAD failed ({r.status_code})")
        return {
            "size": int(r.headers.get("content-length", 0)),
            "content_type": r.headers.get("content-type"),
        }

    def delete(self, key: str) -> None:
        req = self._sign("DELETE", key, b"")
        with httpx.Client(timeout=30) as client:
            client.delete(req["url"], headers=req["headers"])

    def exists(self, key: str) -> bool:
        try:
            return self.head(key) is not None
        except Exception:  # noqa: BLE001
            return False

    @property
    def backend(self) -> str:
        return "r2"


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
_storage: Optional[object] = None


def get_storage():
    """Returns the active storage backend. Lazily initialised."""
    global _storage
    if _storage is not None:
        return _storage
    account = os.environ.get("R2_ACCOUNT_ID")
    bucket = os.environ.get("R2_BUCKET")
    ak = os.environ.get("R2_ACCESS_KEY_ID")
    sk = os.environ.get("R2_SECRET_ACCESS_KEY")
    if account and bucket and ak and sk:
        _storage = R2Storage(account, bucket, ak, sk)
        logger.info("file_storage: using R2 backend (bucket=%s)", bucket)
    else:
        _storage = LocalStorage()
        logger.info("file_storage: using local backend (root=%s)", _storage.root)
    return _storage


def store_contract_bytes(doc_uid: str, data: bytes, content_type: str) -> StoredObject:
    """Convenience: build a key + write a contract blob in one call."""
    sha256 = _sha256_hex(data)
    key = _build_contract_key(doc_uid, content_type, sha256)
    obj = get_storage().put(key, data, content_type)
    # Ensure sha256 in the returned object matches what we used for the key
    obj.sha256 = sha256
    return obj


# ---------------------------------------------------------------------------
# Short-lived signed proxy tokens (no AWS presigning needed)
# ---------------------------------------------------------------------------
def _signing_secret() -> bytes:
    secret = os.environ.get("FILE_TOKEN_SECRET") or os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("FILE_TOKEN_SECRET (or JWT_SECRET) must be set")
    return secret.encode()


def mint_signed_token(file_key: str, *, ttl_seconds: int = 300, actor: Optional[str] = None) -> str:
    """Issue a short-lived bearer token granting read access to one file_key.

    Tokens are stateless: they encode `{key, exp, actor}` and are HMAC-signed
    with `FILE_TOKEN_SECRET` (falls back to `JWT_SECRET`). Verification is a
    constant-time comparison.
    """
    payload = {"k": file_key, "exp": int(time.time()) + max(1, ttl_seconds)}
    if actor:
        payload["a"] = actor
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=")
    sig = base64.urlsafe_b64encode(
        hmac.new(_signing_secret(), body, hashlib.sha256).digest()
    ).rstrip(b"=")
    return f"{body.decode()}.{sig.decode()}"


def verify_signed_token(token: str) -> dict:
    """Returns the payload dict on success; raises ValueError on failure."""
    try:
        body_b64, sig_b64 = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("Malformed token") from exc

    expected = base64.urlsafe_b64encode(
        hmac.new(_signing_secret(), body_b64.encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    if not hmac.compare_digest(expected, sig_b64):
        raise ValueError("Bad signature")

    pad = "=" * (-len(body_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(body_b64 + pad))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("Token expired")
    if "k" not in payload:
        raise ValueError("Token missing key")
    return payload
