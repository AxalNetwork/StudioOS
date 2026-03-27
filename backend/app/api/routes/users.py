from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import User, Founder, Partner
from backend.app.schemas.scoring import UserCreate
import hashlib

router = APIRouter(prefix="/users", tags=["Users"])


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


@router.get("/")
def list_users(role: str = None, session: Session = Depends(get_session)):
    stmt = select(User).order_by(User.created_at.desc())
    if role:
        stmt = stmt.where(User.role == role)
    users = session.exec(stmt).all()
    return [{k: v for k, v in u.model_dump().items() if k != "password_hash"} for u in users]


@router.post("/")
def create_user(data: UserCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="User with this email already exists")

    user = User(
        email=data.email,
        name=data.name,
        role=data.role,
        password_hash=hash_password(data.password) if data.password else None,
        founder_id=data.founder_id,
        partner_id=data.partner_id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return {k: v for k, v in user.model_dump().items() if k != "password_hash"}


@router.get("/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = {k: v for k, v in user.model_dump().items() if k != "password_hash"}

    if user.founder_id:
        founder = session.get(Founder, user.founder_id)
        if founder:
            result["founder"] = founder.model_dump()

    if user.partner_id:
        partner = session.get(Partner, user.partner_id)
        if partner:
            result["partner"] = partner.model_dump()

    return result


@router.post("/login")
def login(email: str, password: str, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.password_hash:
        raise HTTPException(status_code=401, detail="Account not configured for password login")
    if user.password_hash != hash_password(password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
    }
