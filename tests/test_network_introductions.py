"""Task #12 — Secure introductions & matching flow tests.

Six required scenarios, each verifying the core privacy invariant server-side:
contact details are NEVER revealed until both sides connect.

  1. on-platform recipient   — in-app request, hidden contact
  2. off-platform recipient  — branded invite + tokenized review link minted
  3. accepted                — mutual accept → connected → contact unlocked
  4. declined                — recipient declines → contact stays hidden
  5. email-privacy           — no email leaks anywhere pre-connection
  6. invitation-link/token   — view/accept via token, expiry + invalid handling

Runs against an isolated in-memory SQLite DB with dependency overrides — it
does NOT touch the real Postgres database or send real email.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from backend.app.api.deps import require_admin
from backend.app.api.routes import network_introductions as ni
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Founder,
    Investor,
    NetworkIntroduction,
    NetworkIntroMessage,
    User,
    UserRole,
)

# --- isolated test database -------------------------------------------------
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(
    engine,
    tables=[
        User.__table__,
        Investor.__table__,
        Founder.__table__,
        NetworkIntroduction.__table__,
        NetworkIntroMessage.__table__,
        ActivityLog.__table__,
    ],
)

_current = {"user": None}          # swapped between requests
_captured = {"review_url": None}   # last off-platform invite link


def _override_session():
    with Session(engine) as s:
        yield s


def _override_current_user():
    return _current["user"]


app = FastAPI()
app.include_router(ni.router, prefix="/api")
app.dependency_overrides[get_session] = _override_session
app.dependency_overrides[get_current_user] = _override_current_user
app.dependency_overrides[require_admin] = _override_current_user


@pytest.fixture(autouse=True)
def _capture_email(monkeypatch):
    """Capture the tokenized review link instead of sending email."""
    def fake(*, to_email, recipient_name, requester, message, review_url, **kw):
        _captured["review_url"] = review_url
        return (False, review_url)
    monkeypatch.setattr(ni.email_service, "send_network_intro_invite", fake)


client = TestClient(app)


# --- helpers ----------------------------------------------------------------
def _mk_user(role=UserRole.FOUNDER, **kw):
    with Session(engine) as s:
        u = User(email=kw.pop("email"), name=kw.pop("name"), role=role, **kw)
        s.add(u)
        s.commit()
        s.refresh(u)
        return u


def _mk_investor(**kw):
    with Session(engine) as s:
        inv = Investor(investor_type=kw.pop("investor_type", "vc"), **kw)
        s.add(inv)
        s.commit()
        s.refresh(inv)
        return inv


def _as(user):
    _current["user"] = user


def _token_from_url(url):
    return url.rstrip("/").rsplit("/", 1)[-1]


# ===========================================================================
# 1. On-platform recipient
# ===========================================================================
def test_on_platform_recipient_request():
    founder = _mk_user(email="f1@axal.vc", name="Fiona Founder")
    recipient = _mk_user(email="i1@axal.vc", name="Ingrid Investor", role=UserRole.INVESTOR)
    inv = _mk_investor(user_id=recipient.id, display_name="Ingrid Investor", company="Acme Capital")

    _as(founder)
    r = client.post("/api/network-introductions", json={"recipient_investor_id": inv.id, "message": "Hi!"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["off_platform"] is False
    assert body["status"] == "invited"
    # Initiator must NOT see recipient contact pre-connection.
    assert "contact" not in body
    assert body["contact_unlocked"] is False

    # Recipient sees it as an incoming request, contact still hidden.
    _as(recipient)
    rows = client.get("/api/network-introductions").json()
    assert len(rows) == 1
    assert rows[0]["direction"] == "incoming"
    assert "contact" not in rows[0]


# ===========================================================================
# 2. Off-platform recipient
# ===========================================================================
def test_off_platform_recipient_invite():
    admin = _mk_user(email="admin2@axal.vc", name="Admin", role=UserRole.ADMIN)
    founder = _mk_user(email="f2@axal.vc", name="Frank Founder")

    _as(admin)
    prof = client.post("/api/network-introductions/investor-profiles", json={
        "display_name": "Olivia Offplatform",
        "contact_email": "olivia@external.com",
        "company": "Bluebird Ventures",
    }).json()

    _as(founder)
    body = client.post("/api/network-introductions", json={
        "recipient_investor_id": prof["investor_id"], "message": "Would love to connect",
    }).json()
    assert body["off_platform"] is True
    assert body["status"] == "invited"
    assert "contact" not in body
    # A single-use tokenized review link was minted + "emailed".
    assert _captured["review_url"] and "/network-intro/" in _captured["review_url"]
    # The private contact_email is never echoed to targets/list either.
    _as(founder)
    targets = client.get("/api/network-introductions/targets").json()
    for t in targets:
        assert "contact_email" not in t


# ===========================================================================
# 3. Accepted → connected → contact unlocked
# ===========================================================================
def test_accepted_unlocks_contact():
    founder = _mk_user(email="f3@axal.vc", name="Fay Founder")
    recipient = _mk_user(email="i3@axal.vc", name="Ivan Investor", role=UserRole.INVESTOR)
    inv = _mk_investor(user_id=recipient.id, display_name="Ivan Investor")

    _as(founder)
    intro = client.post("/api/network-introductions", json={"recipient_investor_id": inv.id}).json()

    _as(recipient)
    accepted = client.post(f"/api/network-introductions/{intro['id']}/accept").json()
    assert accepted["status"] == "connected"
    assert accepted["contact_unlocked"] is True
    # Recipient now sees the initiator's email.
    assert accepted["contact"]["initiator_email"] == "f3@axal.vc"

    # Initiator now sees the recipient's email too.
    _as(founder)
    seen = client.get(f"/api/network-introductions/{intro['id']}").json()
    assert seen["status"] == "connected"
    assert seen["contact"]["recipient_email"] == "i3@axal.vc"


# ===========================================================================
# 4. Declined → contact stays hidden
# ===========================================================================
def test_declined_keeps_contact_hidden():
    founder = _mk_user(email="f4@axal.vc", name="Fred Founder")
    recipient = _mk_user(email="i4@axal.vc", name="Iris Investor", role=UserRole.INVESTOR)
    inv = _mk_investor(user_id=recipient.id, display_name="Iris Investor")

    _as(founder)
    intro = client.post("/api/network-introductions", json={"recipient_investor_id": inv.id}).json()

    _as(recipient)
    declined = client.post(f"/api/network-introductions/{intro['id']}/decline").json()
    assert declined["status"] == "declined"
    assert declined["contact_unlocked"] is False
    assert "contact" not in declined

    # Initiator sees declined, still no contact.
    _as(founder)
    seen = client.get(f"/api/network-introductions/{intro['id']}").json()
    assert seen["status"] == "declined"
    assert "contact" not in seen


# ===========================================================================
# 5. Email-privacy — no leaks anywhere pre-connection
# ===========================================================================
def test_email_privacy_pre_connection():
    founder = _mk_user(email="f5@axal.vc", name="Fern Founder")
    recipient = _mk_user(email="i5@axal.vc", name="Isaac Investor", role=UserRole.INVESTOR)
    inv = _mk_investor(user_id=recipient.id, display_name="Isaac Investor")

    _as(founder)
    intro = client.post("/api/network-introductions", json={"recipient_investor_id": inv.id}).json()

    # No email string appears anywhere in the initiator's serialized view.
    assert "i5@axal.vc" not in str(intro)

    # Recipient's view (marks viewed) must not carry the initiator's email.
    _as(recipient)
    view = client.get(f"/api/network-introductions/{intro['id']}").json()
    assert view["status"] == "viewed"
    assert "f5@axal.vc" not in str(view)
    assert "contact" not in view


# ===========================================================================
# 6. Invitation-link / token handling
# ===========================================================================
def test_invite_token_flow_and_expiry():
    admin = _mk_user(email="admin6@axal.vc", name="Admin6", role=UserRole.ADMIN)
    founder = _mk_user(email="f6@axal.vc", name="Fiona6")

    _as(admin)
    prof = client.post("/api/network-introductions/investor-profiles", json={
        "display_name": "Nate Newcomer", "contact_email": "nate@external.com",
    }).json()
    _as(founder)
    intro = client.post("/api/network-introductions", json={"recipient_investor_id": prof["investor_id"]}).json()
    token = _token_from_url(_captured["review_url"])

    # Public view — no auth, requester summary only, zero email exposure.
    _current["user"] = None
    pub = client.get(f"/api/network-introductions/invite/{token}").json()
    assert pub["requester"]["name"] == "Fiona6"
    assert "nate@external.com" not in str(pub)
    assert "f6@axal.vc" not in str(pub)
    assert pub["status"] == "viewed"

    # Accept via token → connected. Initiator can now see the contact email.
    accept = client.post(f"/api/network-introductions/invite/{token}/accept").json()
    assert accept["status"] == "connected"
    _as(founder)
    seen = client.get(f"/api/network-introductions/{intro['id']}").json()
    assert seen["contact"]["recipient_email"] == "nate@external.com"

    # Invalid token → 404.
    _current["user"] = None
    assert client.get("/api/network-introductions/invite/not-a-real-token").status_code == 404

    # Expired token → 400 and row flips to expired.
    _as(admin)
    prof2 = client.post("/api/network-introductions/investor-profiles", json={
        "display_name": "Ed Expired", "contact_email": "ed@external.com",
    }).json()
    _as(founder)
    intro2 = client.post("/api/network-introductions", json={"recipient_investor_id": prof2["investor_id"]}).json()
    token2 = _token_from_url(_captured["review_url"])
    # Force-expire the token.
    with Session(engine) as s:
        row = s.get(NetworkIntroduction, intro2["id"])
        row.invite_token_expires = datetime.utcnow() - timedelta(days=1)
        s.add(row)
        s.commit()
    _current["user"] = None
    assert client.get(f"/api/network-introductions/invite/{token2}").status_code == 400
    with Session(engine) as s:
        assert s.get(NetworkIntroduction, intro2["id"]).status == "expired"
