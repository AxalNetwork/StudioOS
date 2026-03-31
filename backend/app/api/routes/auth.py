import os
import pyotp
import jwt
import io
import base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlmodel import Session, select
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

JWT_SECRET = os.environ.get("JWT_SECRET", "studioos-jwt-secret-key-change-in-prod")
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
    role: str = Field("partner", pattern="^(founder|partner|lp)$")


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


def create_jwt(user_id: int, email: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
    }
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
    user = session.get(User, payload["user_id"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def _send_verification(email: str, name: str, session: Session, user: User):
    raw_token, token_hash, expires = generate_verification_token()
    user.verification_token = token_hash
    user.verification_token_expires = expires
    session.add(user)
    session.commit()

    verification_url = get_verification_url(raw_token)
    sent = send_verification_email(email, name, verification_url)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again.")


@router.post("/register")
def register(req: RegisterRequest, session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.email == req.email)).first()
    if existing:
        if existing.email_verified and existing.password_hash:
            raise HTTPException(status_code=409, detail="Email already registered")
        existing.name = req.name
        existing.role = req.role
        _send_verification(req.email, req.name, session, existing)
        return {
            "message": "Verification email sent",
            "email": req.email,
            "name": req.name,
            "requires_verification": True,
        }

    user = User(
        email=req.email,
        name=req.name,
        role=req.role,
        email_verified=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    _send_verification(req.email, req.name, session, user)

    log = ActivityLog(
        action="user_registered",
        details=f"User {req.name} ({req.email}) registered as {req.role} — pending email verification",
        actor=req.email,
    )
    session.add(log)
    session.commit()

    return {
        "message": "Verification email sent",
        "email": user.email,
        "name": user.name,
        "requires_verification": True,
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
        send_verification_email(req.email, user.name, verification_url)
        _record_resend(req.email)
        return {"message": generic_msg}

    _send_verification(req.email, user.name, session, user)
    _record_resend(req.email)
    return {"message": generic_msg}


@router.get("/verify-email")
def check_verify_email(token: str = Query(...), session: Session = Depends(get_session)):
    token_hash = hash_token(token)
    user = session.exec(select(User).where(User.verification_token == token_hash)).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    return {
        "valid": True,
        "email": user.email,
        "name": user.name,
    }


@router.post("/confirm-verify-email")
def confirm_verify_email(req: ConfirmVerifyRequest, session: Session = Depends(get_session)):
    token_hash = hash_token(req.token)
    user = session.exec(select(User).where(User.verification_token == token_hash)).first()

    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

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
def login(req: LoginRequest, session: Session = Depends(get_session)):
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
    token = create_jwt(user.id, user.email, user.role)

    log = ActivityLog(
        action="user_login",
        details=f"User {user.name} logged in",
        actor=user.email,
    )
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
