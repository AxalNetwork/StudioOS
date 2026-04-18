"""
Symmetric encryption helper for integration secrets.

Derives a Fernet key from JWT_SECRET via PBKDF2-HMAC-SHA256 so we don't need
to manage a separate secret. Safe for moderate-sensitivity values like API
keys and webhook secrets stored in Postgres.
"""
import base64
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_SALT = b"axal-studioos-integrations-v1"
_ITERATIONS = 200_000


def _fernet() -> Fernet:
    # Prefer a dedicated secret so rotating JWT_SECRET doesn't brick integration
    # credentials. Fall back to JWT_SECRET so existing deployments keep working.
    secret = os.environ.get("AXAL_ENCRYPTION_SECRET") or os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError(
            "AXAL_ENCRYPTION_SECRET (or JWT_SECRET) must be set to encrypt integration secrets"
        )
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=_ITERATIONS,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode("utf-8")))
    return Fernet(key)


def encrypt(plaintext: str | None) -> str | None:
    if not plaintext:
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str | None) -> str | None:
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def mask(plaintext: str | None) -> str | None:
    """Return a masked preview safe for API responses."""
    if not plaintext:
        return None
    if len(plaintext) <= 8:
        return "•" * len(plaintext)
    return plaintext[:4] + "•" * 8 + plaintext[-4:]
