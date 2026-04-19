from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import User, UserRole, Founder, Partner
from backend.app.schemas.scoring import UserCreate
from backend.app.api.routes.auth import get_current_user
from backend.app.services.pii import (
    serialize_user_safe,
    mask_email,
    can_see_full_pii,
    is_privileged_viewer,
)

router = APIRouter(prefix="/users", tags=["Users"])


def require_admin(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/")
def list_users(role: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(User).order_by(User.created_at.desc())
    if role:
        stmt = stmt.where(User.role == role)
    users = session.exec(stmt).all()
    # Strip secrets (password_hash, verification_token*) and mask email for
    # non-privileged viewers. Admins see full PII.
    return [serialize_user_safe(u, user) for u in users]


@router.post("/")
def create_user(data: UserCreate, session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="User with this email already exists")

    user = User(
        email=data.email,
        name=data.name,
        role=data.role if data.role in ["founder", "partner"] else "partner",
        founder_id=data.founder_id,
        partner_id=data.partner_id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    # Creator (admin) sees the full freshly-created user.
    return serialize_user_safe(user, admin, include_admin_only=True)


@router.get("/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    result = serialize_user_safe(target, user)

    if target.founder_id:
        founder = session.get(Founder, target.founder_id)
        if founder:
            f = founder.model_dump()
            # A viewer sees the full founder record only if they're an admin or
            # *that founder themselves* — checked against founder_id, not the
            # outer User.id, so a founder viewing their own profile via
            # /users/{user_id} still sees their own real email.
            if not can_see_full_pii(user, subject_founder_id=founder.id):
                f["email"] = mask_email(f.get("email"))
            result["founder"] = f

    if target.partner_id:
        partner = session.get(Partner, target.partner_id)
        if partner:
            p = partner.model_dump()
            if not can_see_full_pii(user, subject_partner_id=partner.id):
                p["email"] = mask_email(p.get("email"))
            result["partner"] = p

    return result
