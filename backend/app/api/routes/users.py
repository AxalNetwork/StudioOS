from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import User, UserRole, Founder, Partner
from backend.app.schemas.scoring import UserCreate
from backend.app.api.routes.auth import get_current_user

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
    return [{k: v for k, v in u.model_dump().items() if k != "password_hash"} for u in users]


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
    return {k: v for k, v in user.model_dump().items() if k != "password_hash"}


@router.get("/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    result = {k: v for k, v in target.model_dump().items() if k != "password_hash"}

    if target.founder_id:
        founder = session.get(Founder, target.founder_id)
        if founder:
            result["founder"] = founder.model_dump()

    if target.partner_id:
        partner = session.get(Partner, target.partner_id)
        if partner:
            result["partner"] = partner.model_dump()

    return result
