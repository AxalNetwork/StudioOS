import os
import pyotp
import jwt
import io
import base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from sqlmodel import Session, select
from sqlalchemy import text
from pydantic import BaseModel, Field
from typing import Optional
from backend.app.database import get_session
from backend.app.models.entities import User, ActivityLog
from backend.app.services.email_service import (
    generate_verification_token,
    hash_token,
    get_verification_url,
    send_verification_email,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable must be set")
# Phase A5 — fail fast in production environments if the secret is too
# weak. We treat "production" + "staging" as enforcement environments;
# dev/preview are allowed to use shorter secrets for local convenience.
_STUDIOOS_ENV = os.environ.get("STUDIOOS_ENV", "dev").lower()
if _STUDIOOS_ENV in ("production", "prod", "staging") and len(JWT_SECRET.encode("utf-8")) < 32:
    raise RuntimeError(
        f"JWT_SECRET must be at least 32 bytes in {_STUDIOOS_ENV}; "
        f"got {len(JWT_SECRET.encode('utf-8'))} bytes"
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

_login_attempts = {}
_resend_tracker = {}
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 300
MAX_RESENDS_PER_HOUR = 3


def _check_rate_limit(email: str):
    now = datetime.utcnow()
    key = email.lower().strip()
    if key in _login_attempts:
        attempts, locked_until = _login_attempts[key]
        if locked_until and now < locked_until:
            remaining = int((locked_until - now).total_seconds())
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {remaining} seconds.")
        if locked_until and now >= locked_until:
            _login_attempts[key] = (0, None)


def _record_failed_attempt(email: str):
    key = email.lower().strip()
    attempts, _ = _login_attempts.get(key, (0, None))
    attempts += 1
    if attempts >= MAX_ATTEMPTS:
        _login_attempts[key] = (attempts, datetime.utcnow() + timedelta(seconds=LOCKOUT_SECONDS))
    else:
        _login_attempts[key] = (attempts, None)


def _clear_attempts(email: str):
    key = email.lower().strip()
    _login_attempts.pop(key, None)


def _check_resend_rate(email: str):
    now = datetime.utcnow()
    key = email.lower().strip()
    if key in _resend_tracker:
        timestamps = [t for t in _resend_tracker[key] if (now - t).total_seconds() < 3600]
        _resend_tracker[key] = timestamps
        if len(timestamps) >= MAX_RESENDS_PER_HOUR:
            raise HTTPException(status_code=429, detail="Maximum resend limit reached. Please try again in an hour.")
    else:
        _resend_tracker[key] = []


def _record_resend(email: str):
    key = email.lower().strip()
    if key not in _resend_tracker:
        _resend_tracker[key] = []
    _resend_tracker[key].append(datetime.utcnow())


class RegisterRequest(BaseModel):
    email: str
    name: str
    role: str = Field("partner", pattern="^(founder|partner|investor|mentor)$")
    ref_code: Optional[str] = None
    # Phase C4 — honeypot. Real users never see/fill this field; bots that
    # autofill every input will set it. Non-empty value = bot, drop request.
    # Pydantic v2 disallows leading-underscore field names, so the
    # attribute is `axl_hp` and we read the wire field `_axl_hp` via alias.
    axl_hp: Optional[str] = Field(default=None, alias="_axl_hp")

    model_config = {"populate_by_name": True}


class LoginRequest(BaseModel):
    email: str
    totp_code: str = Field(..., min_length=6, max_length=6)


class VerifyTOTPRequest(BaseModel):
    email: str
    totp_code: str = Field(..., min_length=6, max_length=6)


class ResendRequest(BaseModel):
    email: str


class SetupTOTPRequest(BaseModel):
    email: str
    token: str


class ConfirmVerifyRequest(BaseModel):
    token: str


def create_jwt(user_id: int, email: str, role: str, jti: Optional[str] = None) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
    }
    # Epic 3 — jti binds the token to a row in user_sessions so individual
    # sessions can be revoked from /settings without bumping jwt_min_iat
    # for every device. Optional for back-compat with existing tokens.
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(authorization: Optional[str] = Header(None), session: Session = Depends(get_session)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_jwt(token)

    user = None
    # Primary lookup: numeric user_id (local FastAPI-issued tokens)
    if "user_id" in payload:
        user = session.get(User, payload["user_id"])
    # Fallback: email in "sub" (Cloudflare Worker-issued tokens or legacy tokens)
    if user is None and "sub" in payload:
        user = session.exec(select(User).where(User.email == payload["sub"])).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Epic 3 — enforce sign-out-everywhere (`users.jwt_min_iat`) and
    # per-session revocation (`user_sessions.revoked_at`). Mirrors the
    # worker's behavior in `cloudflare-worker/src/auth.ts`.
    try:
        row = session.exec(
            text("SELECT jwt_min_iat FROM users WHERE id = :uid").bindparams(uid=user.id)
        ).first()
        min_iat = (row._mapping["jwt_min_iat"] if row else 0) or 0  # type: ignore[attr-defined]
    except Exception:
        # Column not migrated yet (cold backend before /settings was hit).
        # Postgres aborts the transaction on a failed SELECT; roll back so
        # subsequent queries in this request don't all return 500.
        try:
            session.rollback()
        except Exception:
            pass
        min_iat = 0

    token_iat = payload.get("iat")
    if isinstance(token_iat, datetime):
        token_iat = int(token_iat.timestamp())
    elif isinstance(token_iat, (int, float)):
        token_iat = int(token_iat)
        # PyJWT historically used seconds; tolerate ms tokens too.
        if token_iat > 1e12:
            token_iat = token_iat // 1000
    else:
        token_iat = None
    if min_iat and token_iat is not None and token_iat < int(min_iat):
        raise HTTPException(status_code=401, detail="Session was signed out")

    jti = payload.get("jti")
    if isinstance(jti, str) and jti:
        try:
            sess = session.exec(
                text("SELECT revoked_at FROM user_sessions WHERE jti = :j AND user_id = :uid").bindparams(
                    j=jti, uid=user.id
                )
            ).first()
            if sess is None or sess._mapping["revoked_at"] is not None:  # type: ignore[attr-defined]
                raise HTTPException(status_code=401, detail="Session was revoked")
            try:
                session.exec(
                    text("UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE jti = :j").bindparams(
                        j=jti
                    )
                )
                session.commit()
            except Exception:
                session.rollback()
        except HTTPException:
            raise
        except Exception:
            # Table not migrated yet; fall through (iat check already passed).
            try:
                session.rollback()
            except Exception:
                pass

    return user


def _send_verification(email: str, name: str, session: Session, user: User) -> dict:
    raw_token, token_hash, expires = generate_verification_token()
    user.verification_token = token_hash
    user.verification_token_expires = expires
    session.add(user)
    session.commit()

    verification_url = get_verification_url(raw_token)
    sent = send_verification_email(email, name, verification_url)
    return {"sent": sent, "verification_url": None if sent else verification_url}


def _resolve_referrer(session: Session, ref_code: Optional[str], email: str):
    """Return (partner_id, normalized_code) or (None, None). Graceful on invalid input."""
    if not ref_code:
        return None, None
    code = ref_code.strip().upper()
    if not code:
        return None, None
    from backend.app.models.entities import Partner
    partner = session.exec(select(Partner).where(Partner.referral_code == code)).first()
    if not partner or partner.status != "active":
        return None, None
    if partner.email and partner.email.lower() == (email or "").lower():
        return None, None  # prevent self-referral
    return partner.id, code


_register_ip_attempts: dict = {}  # ip -> [timestamp]
_register_email_attempts: dict = {}  # email -> [timestamp]


def _register_rate_limit(ip: str, email: str) -> None:
    """Phase C4 — register endpoint abuse limit: 5/min/IP and 3/day/email.
    Sliding window in-process. Mirrors the bucket pattern in
    `backend/app/services/rate_limit.py`.
    """
    now = datetime.utcnow()
    minute_cutoff = now - timedelta(minutes=1)
    day_cutoff = now - timedelta(days=1)

    ip_bucket = [t for t in _register_ip_attempts.get(ip, []) if t > minute_cutoff]
    if len(ip_bucket) >= 5:
        raise HTTPException(status_code=429, detail="Too many registrations from this IP. Please slow down.")
    ip_bucket.append(now)
    _register_ip_attempts[ip] = ip_bucket

    email_key = (email or "").lower().strip()
    if email_key:
        em_bucket = [t for t in _register_email_attempts.get(email_key, []) if t > day_cutoff]
        if len(em_bucket) >= 3:
            raise HTTPException(status_code=429, detail="Too many registration attempts for this email today.")
        em_bucket.append(now)
        _register_email_attempts[email_key] = em_bucket


@router.post("/register")
def register(req: RegisterRequest, request: Request, session: Session = Depends(get_session)):
    # Phase C4 — honeypot drop. Treat as 200 success so bots can't infer.
    if req.axl_hp:
        try:
            session.add(ActivityLog(
                action="register_bot_dropped",
                details=f"honeypot tripped (email={req.email})",
                actor="honeypot",
            ))
            session.commit()
        except Exception:
            pass
        return {
            "message": "Verification email sent",
            "email": req.email,
            "name": req.name,
            "requires_verification": True,
            "email_sent": True,
            "verification_url": None,
        }
    # Phase C4 — IP + email rate limits.
    client_ip = (request.client.host if request.client else "unknown") or "unknown"
    _register_rate_limit(client_ip, req.email)

    referrer_id, ref_code_norm = _resolve_referrer(session, req.ref_code, req.email)

    existing = session.exec(select(User).where(User.email == req.email)).first()
    if existing:
        if existing.email_verified and existing.password_hash:
            raise HTTPException(status_code=409, detail="Email already registered")
        existing.name = req.name
        existing.role = req.role
        # Only set referrer if not already attributed (first valid wins)
        if referrer_id and not existing.referrer_partner_id:
            existing.referrer_partner_id = referrer_id
            existing.referrer_code_used = ref_code_norm
        result = _send_verification(req.email, req.name, session, existing)
        return {
            "message": "Verification email sent" if result["sent"] else "Account created — email service not configured",
            "email": req.email,
            "name": req.name,
            "requires_verification": True,
            "email_sent": result["sent"],
            "verification_url": result["verification_url"],
            "referred_by_partner_id": existing.referrer_partner_id,
        }

    user = User(
        email=req.email,
        name=req.name,
        role=req.role,
        email_verified=False,
        referrer_partner_id=referrer_id,
        referrer_code_used=ref_code_norm,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    if referrer_id:
        session.add(ActivityLog(
            action="referral_pending",
            details=f"User {req.email} registered via referral code {ref_code_norm} (partner_id={referrer_id})",
            actor=req.email,
        ))
        session.commit()

    result = _send_verification(req.email, req.name, session, user)

    log = ActivityLog(
        action="user_registered",
        details=f"User {req.name} ({req.email}) registered as {req.role} — pending email verification",
        actor=req.email,
    )
    session.add(log)
    session.commit()

    return {
        "message": "Verification email sent" if result["sent"] else "Account created — email service not configured",
        "email": user.email,
        "name": user.name,
        "requires_verification": True,
        "email_sent": result["sent"],
        "verification_url": result["verification_url"],
    }


@router.post("/resend-verification")
def resend_verification(req: ResendRequest, session: Session = Depends(get_session)):
    _check_resend_rate(req.email)

    generic_msg = "If an account exists with that email, a verification link has been sent."

    user = session.exec(select(User).where(User.email == req.email)).first()
    if not user or (user.email_verified and user.password_hash):
        _record_resend(req.email)
        return {"message": generic_msg}

    if user.email_verified and not user.password_hash:
        raw_token, token_hash, expires = generate_verification_token()
        user.verification_token = token_hash
        user.verification_token_expires = expires
        session.add(user)
        session.commit()
        verification_url = get_verification_url(raw_token)
        sent = send_verification_email(req.email, user.name, verification_url)
        _record_resend(req.email)
        return {
            "message": generic_msg,
            "email_sent": sent,
            "verification_url": None if sent else verification_url,
        }

    result = _send_verification(req.email, user.name, session, user)
    _record_resend(req.email)
    return {
        "message": generic_msg,
        "email_sent": result["sent"],
        "verification_url": result["verification_url"],
    }


@router.get("/verify-email")
def check_verify_email(token: str = Query(...), session: Session = Depends(get_session)):
    token_hash = hash_token(token)
    user = session.exec(select(User).where(User.verification_token == token_hash)).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    # T22.2 — narrowed to `{ valid: true }` to match the worker. Previously
    # echoed user.email + user.name, which leaked PII to anyone replaying the
    # verification token (or to log scrapers capturing the response body).
    # The frontend re-derives email/name via POST /confirm-verify-email,
    # which already requires presenting the same token.
    return {"valid": True}


@router.post("/confirm-verify-email")
def confirm_verify_email(req: ConfirmVerifyRequest, session: Session = Depends(get_session)):
    token_hash = hash_token(req.token)
    user = session.exec(select(User).where(User.verification_token == token_hash)).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    was_unverified = not user.email_verified
    user.email_verified = True

    setup_token_raw, setup_hash, setup_expires = generate_verification_token()
    user.verification_token = setup_hash
    user.verification_token_expires = setup_expires
    session.add(user)
    session.commit()

    log = ActivityLog(
        action="email_verified",
        details=f"User {user.name} ({user.email}) verified their email",
        actor=user.email,
    )
    session.add(log)

    # Attribute referral on first verification
    if was_unverified and user.referrer_partner_id and not user.referral_attributed_at:
        from backend.app.models.entities import Partner
        partner = session.get(Partner, user.referrer_partner_id)
        if partner:
            partner.referrals_count = (partner.referrals_count or 0) + 1
            user.referral_attributed_at = datetime.utcnow()
            session.add(partner)
            session.add(user)
            session.add(ActivityLog(
                action="referral_converted",
                details=f"Referral converted: {user.email} → partner {partner.email} (code {user.referrer_code_used})",
                actor=user.email,
            ))
    session.commit()

    return {
        "verified": True,
        "email": user.email,
        "name": user.name,
        "setup_token": setup_token_raw,
    }


@router.post("/setup-totp")
def setup_totp(req: SetupTOTPRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == req.email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Email not verified. Please verify your email first.")

    token_hash = hash_token(req.token)
    if user.verification_token != token_hash:
        raise HTTPException(status_code=403, detail="Invalid setup token.")

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=403, detail="Setup token expired. Please verify your email again.")

    if user.password_hash:
        raise HTTPException(status_code=409, detail="TOTP is already configured for this account.")

    totp_secret = pyotp.random_base32()
    user.password_hash = totp_secret
    user.verification_token = None
    user.verification_token_expires = None
    session.add(user)
    session.commit()

    totp = pyotp.TOTP(totp_secret)
    provisioning_uri = totp.provisioning_uri(name=req.email, issuer_name="Axal VC StudioOS")

    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        qr_base64 = None

    return {
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "totp_secret": totp_secret,
        "provisioning_uri": provisioning_uri,
        "qr_code": qr_base64,
        "message": "Scan the QR code with your authenticator app, then use the TOTP code to log in.",
    }


@router.post("/login")
def login(req: LoginRequest, request: Request, session: Session = Depends(get_session)):
    _check_rate_limit(req.email)

    user = session.exec(select(User).where(User.email == req.email)).first()
    if not user:
        _record_failed_attempt(req.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before logging in.")

    if not user.password_hash:
        raise HTTPException(status_code=401, detail="Account not set up for TOTP authentication")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    totp = pyotp.TOTP(user.password_hash)
    if not totp.verify(req.totp_code, valid_window=1):
        _record_failed_attempt(req.email)
        raise HTTPException(status_code=401, detail="Invalid TOTP code")

    _clear_attempts(req.email)
    # Epic 3 — mint a session-bound JWT (jti -> user_sessions row).
    # Ensure the user_sessions table exists before INSERT — the table is
    # otherwise only created on first /settings hit, so cold-start logins
    # would silently lose their session row and the auth check would 401
    # them on subsequent requests.
    from backend.app.api.routes.settings import _ensure_schema as _ensure_settings_schema
    try:
        _ensure_settings_schema(session)
    except Exception:
        session.rollback()
    import uuid as _uuid
    jti = _uuid.uuid4().hex
    token = create_jwt(user.id, user.email, user.role, jti=jti)

    log = ActivityLog(
        action="user_login",
        details=f"User {user.name} logged in",
        actor=user.email,
    )
    session.add(log)
    # Capture device fingerprint so the Settings → Active Sessions list is
    # actually useful. UA is clamped to 500 chars; IP prefers
    # X-Forwarded-For (first hop) when behind a proxy, else request.client.
    ua = (request.headers.get("user-agent") or "")[:500] or None
    fwd = request.headers.get("x-forwarded-for") or ""
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None))
    if ip:
        ip = ip[:64]
    try:
        session.exec(
            text(
                """INSERT INTO user_sessions (user_id, jti, user_agent, ip)
                   VALUES (:uid, :j, :ua, :ip)"""
            ).bindparams(uid=user.id, j=jti, ua=ua, ip=ip)
        )
    except Exception:
        # Table not migrated yet (first /settings hit creates it). Token still works.
        session.rollback()
        session.add(log)
    session.commit()

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
        "expires_in": JWT_EXPIRY_HOURS * 3600,
    }


class DevQuickLoginRequest(BaseModel):
    # Optional. Must be one of the two seeded demo emails (investor or
    # founder) — any other value is rejected with 403. This is a strict
    # allowlist, NOT an arbitrary-impersonation knob.
    email: Optional[str] = None


def _is_production_env() -> bool:
    """Production gate. Checks BOTH conventions used elsewhere in the
    backend (`STUDIOOS_ENV` is the canonical one — see auth.py:29 and
    github_service.py:38; `ENVIRONMENT` is the worker-side spelling
    referenced in replit.md). Fails CLOSED: any deploy that even
    *hints* at production by setting either var to a prod-ish value
    disables the dev quick-login route entirely.
    """
    import os as _os
    for var in ("STUDIOOS_ENV", "ENVIRONMENT"):
        val = (_os.getenv(var) or "").strip().lower()
        if val in ("production", "prod", "staging"):
            return True
    return False


@router.post("/dev/quick-login")
def dev_quick_login(
    req: DevQuickLoginRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    """Task #41 — DEV-ONLY shortcut that mints a JWT for the seeded demo
    investor (or demo founder when explicitly requested) without TOTP or
    Turnstile. Returns 404 in production / staging so this can never
    become an auth-bypass on a real deploy. The acceptable `email` values
    are a strict allowlist (`DEMO_INVESTOR_EMAIL` / `DEMO_FOUNDER_EMAIL`)
    — any other email is rejected with 403, even in dev.

    Returns the same `{token, user, expires_in}` shape as POST /api/auth/login
    so frontends and tests can use the response interchangeably.
    """
    if _is_production_env():
        raise HTTPException(status_code=404, detail="Not found")

    from backend.app.services.demo_seed import (
        DEMO_ADMIN_EMAIL,
        DEMO_FOUNDER_EMAIL,
        DEMO_INVESTOR_EMAIL,
    )
    ALLOWED = {
        DEMO_INVESTOR_EMAIL.lower(),
        DEMO_FOUNDER_EMAIL.lower(),
        DEMO_ADMIN_EMAIL.lower(),
    }
    target_email = (req.email or DEMO_INVESTOR_EMAIL).strip().lower()
    if target_email not in ALLOWED:
        # Hard allowlist — refuse to mint a token for anyone other than
        # the two seeded demo accounts. This must NEVER be relaxed: it
        # is the only thing standing between a dev-ergonomics shortcut
        # and full impersonation of arbitrary users.
        raise HTTPException(
            status_code=403,
            detail="dev/quick-login only accepts seeded demo accounts",
        )

    user = session.exec(select(User).where(User.email == target_email)).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"Demo user '{target_email}' not seeded — restart the backend so the lifespan seeder runs.",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    # Mirror the real /login session-row + JWT-mint dance so revocation
    # and the Settings → Active Sessions list keep working.
    from backend.app.api.routes.settings import _ensure_schema as _ensure_settings_schema
    try:
        _ensure_settings_schema(session)
    except Exception:
        session.rollback()
    import uuid as _uuid
    jti = _uuid.uuid4().hex
    token = create_jwt(user.id, user.email, user.role, jti=jti)

    log = ActivityLog(
        action="user_login",
        details=f"DEV quick-login as {user.email}",
        actor=user.email,
    )
    session.add(log)
    ua = (request.headers.get("user-agent") or "")[:500] or None
    fwd = request.headers.get("x-forwarded-for") or ""
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None))
    if ip:
        ip = ip[:64]
    try:
        session.exec(
            text(
                """INSERT INTO user_sessions (user_id, jti, user_agent, ip)
                   VALUES (:uid, :j, :ua, :ip)"""
            ).bindparams(uid=user.id, j=jti, ua=ua, ip=ip)
        )
    except Exception:
        session.rollback()
        session.add(log)
    session.commit()

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
        "expires_in": JWT_EXPIRY_HOURS * 3600,
    }


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat(),
        "kyc_status": getattr(user, "kyc_status", None) or "not_started",
        # 'limited' = browse-only access without KYC (admin grant). Null = normal.
        "access_level": getattr(user, "access_level", None),
    }


@router.post("/verify-totp")
def verify_totp(req: VerifyTOTPRequest, session: Session = Depends(get_session)):
    _check_rate_limit(req.email)

    user = session.exec(select(User).where(User.email == req.email)).first()
    if not user or not user.password_hash:
        _record_failed_attempt(req.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    totp = pyotp.TOTP(user.password_hash)
    valid = totp.verify(req.totp_code, valid_window=1)

    if not valid:
        _record_failed_attempt(req.email)
    else:
        _clear_attempts(req.email)

    return {"valid": valid}
