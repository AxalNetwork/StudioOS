"""Settings-owned schema bootstrap (dev FastAPI only).

Extracted from the `settings` router so the auth flow (`login`,
`dev_quick_login`) can make sure `user_sessions` exists before it inserts a
session row, without a cyclic import (`auth` → `settings` → `auth`). Like
`network_intro_claim`, this module depends only on the DB session — never on
the API routers.
"""
from __future__ import annotations

from sqlmodel import Session, text

_USER_COLUMNS = [
    ("bio", "TEXT"),
    ("headline", "TEXT"),
    ("headshot_local_path", "TEXT"),
    ("jurisdictions", "TEXT"),
    ("socials", "TEXT"),
    ("notification_prefs", "TEXT"),
    ("privacy_prefs", "TEXT"),
    ("role_prefs", "TEXT"),
    ("jwt_min_iat", "BIGINT DEFAULT 0"),
    ("deletion_requested_at", "TIMESTAMP"),
    ("totp_recovery_codes", "TEXT"),
    # Task #66 — structured, public-facing career background (JSON text) +
    # a website URL. Mirrors the worker's profileExpansion.ts columns.
    ("experience", "TEXT"),
    ("education", "TEXT"),
    ("certifications", "TEXT"),
    ("website", "TEXT"),
    # Task #67 — LinkedIn profile photo URL captured at OAuth callback, used by
    # the "Import from LinkedIn" flow (account source). Mirrors the worker.
    ("linkedin_picture_url", "TEXT"),
]

# A dict entry, not a `global` flag, as in settings.py (D476): CodeQL's
# unused-global check does not follow a flag written on one call and read
# on the next. Same run-once behaviour.
_schema_once = {"settings": False}


def ensure_settings_schema(session: Session) -> None:
    """Idempotent ALTER / CREATE — Postgres in dev. Each statement is its own
    transaction so a single failure (e.g. column already exists) doesn't
    poison the rest, and we cache the success flag to keep request latency
    low after first boot."""
    if _schema_once["settings"]:
        return
    for col, kind in _USER_COLUMNS:
        try:
            session.exec(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {kind}"))
            session.commit()
        except Exception:
            session.rollback()
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS email_change_requests (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    old_email TEXT NOT NULL,
                    new_email TEXT NOT NULL,
                    confirm_token_hash TEXT NOT NULL UNIQUE,
                    revoke_token_hash TEXT NOT NULL UNIQUE,
                    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confirm_expires_at TIMESTAMP NOT NULL,
                    revoke_expires_at TIMESTAMP NOT NULL,
                    confirmed_at TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    try:
        session.exec(text("CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_change_requests(user_id)"))
        session.commit()
    except Exception:
        session.rollback()
    # user_sessions
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id BIGSERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    jti TEXT NOT NULL UNIQUE,
                    user_agent TEXT,
                    ip TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_us_user ON user_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_us_jti ON user_sessions(jti)",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    # founder_invites
    try:
        session.exec(
            text(
                """
                CREATE TABLE IF NOT EXISTS founder_invites (
                    id BIGSERIAL PRIMARY KEY,
                    project_id INTEGER,
                    inviter_user_id INTEGER NOT NULL,
                    invitee_email TEXT NOT NULL,
                    invitee_name TEXT,
                    role TEXT NOT NULL DEFAULT 'co-founder',
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    accepted_at TIMESTAMP,
                    revoked_at TIMESTAMP
                )
                """
            )
        )
        session.commit()
    except Exception:
        session.rollback()
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_fi_inviter ON founder_invites(inviter_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_fi_project ON founder_invites(project_id)",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
        except Exception:
            session.rollback()
    _schema_once["settings"] = True
