"""Off-platform introduction claiming.

Extracted from the `network_introductions` router so the auth / registration
flow can adopt off-platform intros without creating a cyclic import
(`auth` → `network_introductions` → `auth`). This module depends only on the
data models and the DB session — never on the API routers.
"""
from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, select

from backend.app.models.entities import Investor, NetworkIntroduction, User


def claim_offplatform_introductions(session: Session, user: User) -> int:
    """Link any off-platform introductions addressed to this user's email to
    their new account, and adopt the matching admin-created Investor profile.

    Called from the registration flow. Returns the number of intros claimed.
    Safe / idempotent — matches on lowercased email, skips already-linked rows.
    """
    if not user or not user.email:
        return 0
    email_lc = user.email.strip().lower()
    rows = session.exec(
        select(NetworkIntroduction).where(
            NetworkIntroduction.recipient_user_id.is_(None)  # type: ignore[union-attr]
        )
    ).all()
    claimed = 0
    for intro in rows:
        if not intro.recipient_email:
            continue
        if intro.recipient_email.strip().lower() != email_lc:
            continue
        intro.recipient_user_id = user.id
        intro.off_platform = False
        intro.updated_at = datetime.utcnow()
        # Adopt the off-platform Investor profile if it isn't linked yet.
        if intro.recipient_investor_id:
            inv = session.get(Investor, intro.recipient_investor_id)
            if inv and inv.user_id is None:
                inv.user_id = user.id
                inv.updated_at = datetime.utcnow()
                session.add(inv)
                if user.investor_id is None:
                    user.investor_id = inv.id
                    session.add(user)
        session.add(intro)
        claimed += 1
    if claimed:
        session.commit()
    return claimed
