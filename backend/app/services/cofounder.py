"""Task #38 — Co-founder matching service.

Mutual-interest reveal pattern + auto-NDA on first connect:

  1. Founder creates a `CofounderProfile` (skills, sector, commitment,
     location, equity expectations, bio, looking_for).
  2. Anyone with a profile browses the directory. Cards are returned
     **redacted** (handle = `cofounder-<uid[:8]>`, no email/linkedin) plus
     the structured fields above.
  3. User A clicks "I'm interested" on B → `CofounderInterest(A→B)`.
  4. If `CofounderInterest(B→A)` already exists (and isn't withdrawn),
     mutual interest is detected → `CofounderConnection(A,B)` is created
     in `pending_nda` status, and two NDA Documents are minted (one per
     side; each user signs as the legal Recipient).
  5. After both signatures land, `connection.status` flips to `active`
     and identity (name + email) is exposed via the connections endpoint.

We deliberately keep the NDA flow per-connection (not per-role like the
existing Trust Layer NDA) because the legal counterparty is the *other
founder*, not Axal. A separate `cofounder` template lives in
`services/trust.NDA_TEMPLATES` and is rendered with each side's name.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.models.entities import (
    CofounderConnection,
    CofounderInterest,
    CofounderProfile,
    Document,
    DocumentStatus,
    DocumentType,
    User,
)

logger = logging.getLogger("studioos.cofounder")

# Legal text — kept here (not in trust.NDA_TEMPLATES) because the
# counterparty interpolation is bilateral (`{counterparty_name}`), unlike
# the platform-Recipient pattern in trust.py.
COFOUNDER_NDA_TITLE = "Co-founder Mutual Non-Disclosure Agreement"
COFOUNDER_NDA_BODY = """CO-FOUNDER MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into
between {signer_name} ("Recipient") and {counterparty_name}
("Discloser"), each a "Party", effective as of {today}.

1. PURPOSE. The Parties wish to evaluate a potential co-founder
   relationship and the formation of a startup (the "Purpose"). In
   connection with the Purpose, each Party may disclose Confidential
   Information to the other.

2. CONFIDENTIAL INFORMATION. "Confidential Information" includes any
   non-public business plan, product idea, customer list, technical
   approach, source code sketch, financial model, fundraising plan,
   personal contact, or other materials disclosed by one Party to the
   other in connection with the Purpose.

3. RECIPIENT OBLIGATIONS. Recipient shall (a) hold the Discloser's
   Confidential Information in strict confidence, (b) not use it for any
   purpose other than the Purpose, (c) not disclose it to any third
   party without the Discloser's prior written consent, and (d) protect
   it with at least the same degree of care it uses for its own
   confidential information of similar sensitivity.

4. EXCLUSIONS. The obligations in Section 3 do not apply to information
   that (a) was lawfully known by Recipient prior to disclosure, (b)
   becomes publicly available through no breach of this Agreement, (c)
   is independently developed by Recipient without use of Discloser's
   Confidential Information, or (d) is required to be disclosed by law,
   provided Recipient gives Discloser prompt notice where permitted.

5. NO LICENCE; NO PARTNERSHIP. Nothing in this Agreement grants either
   Party any right or licence to the other Party's Confidential
   Information except as expressly set out herein. This Agreement does
   not create a partnership, joint venture, employment, or agency
   relationship.

6. TERM. Each Party's obligations of confidentiality survive for two
   (2) years from the effective date.

7. RETURN OR DESTRUCTION. Upon written request, Recipient shall
   promptly destroy or return all Confidential Information received
   from the other Party, except for one archival copy retained for legal
   compliance.

8. GOVERNING LAW. This Agreement is governed by the laws of the State
   of Delaware, without regard to its conflict-of-laws principles.

By signing below, Recipient acknowledges and agrees to the terms above.

Signed: {signer_name} ({signer_email})
Date:   {today}
"""

# Suggested skill / sector vocab returned to the UI for typeahead. Free-
# form values are still allowed at write time.
SUGGESTED_SKILLS = [
    "engineering", "product", "design", "data", "ai_ml", "research",
    "sales", "marketing", "growth", "ops", "finance", "legal",
    "hardware", "biotech", "community", "fundraising",
]
SUGGESTED_SECTORS = [
    "fintech", "saas", "marketplace", "consumer", "ai", "developer_tools",
    "health", "biotech", "climate", "deeptech", "edtech", "gaming",
    "logistics", "real_estate", "media",
]
ALLOWED_COMMITMENT = {"full_time", "part_time", "exploring"}


# ---------------------------------------------------------------------------
# JSON helpers — keep entities free of orm-side codecs.
# ---------------------------------------------------------------------------
def _loads(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def _dumps(items: Optional[list[str]]) -> str:
    if not items:
        return "[]"
    cleaned = [str(s).strip() for s in items if str(s).strip()]
    return json.dumps(cleaned[:32])  # hard cap so a buggy client can't blow up


# ---------------------------------------------------------------------------
# Profile CRUD
# ---------------------------------------------------------------------------
def get_my_profile(session: Session, user: User) -> Optional[CofounderProfile]:
    return session.exec(
        select(CofounderProfile).where(CofounderProfile.user_id == user.id)
    ).first()


def upsert_profile(session: Session, user: User, payload: dict) -> CofounderProfile:
    """Create or update the caller's cofounder profile.

    Raises `ValueError` for invalid input (commitment, equity bounds).
    """
    commitment = (payload.get("commitment") or "full_time").strip().lower()
    if commitment not in ALLOWED_COMMITMENT:
        raise ValueError(f"commitment must be one of {sorted(ALLOWED_COMMITMENT)}")

    eq_min = payload.get("equity_expectation_min")
    eq_max = payload.get("equity_expectation_max")
    for label, val in (("equity_expectation_min", eq_min), ("equity_expectation_max", eq_max)):
        if val is not None and not (0 <= float(val) <= 100):
            raise ValueError(f"{label} must be a percent in [0, 100]")
    if eq_min is not None and eq_max is not None and float(eq_min) > float(eq_max):
        raise ValueError("equity_expectation_min cannot exceed equity_expectation_max")

    p = get_my_profile(session, user)
    if p is None:
        p = CofounderProfile(user_id=user.id)
        session.add(p)

    p.skills_json = _dumps(payload.get("skills"))
    p.sectors_json = _dumps(payload.get("sectors"))
    p.commitment = commitment
    p.location_city = (payload.get("location_city") or None) or None
    p.location_country = (payload.get("location_country") or None) or None
    p.remote_ok = bool(payload.get("remote_ok", True))
    p.equity_expectation_min = float(eq_min) if eq_min is not None else None
    p.equity_expectation_max = float(eq_max) if eq_max is not None else None
    p.bio = (payload.get("bio") or None)
    p.looking_for = (payload.get("looking_for") or None)
    if "listed" in payload:
        p.listed = bool(payload["listed"])
    p.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(p)
    return p


def serialize_profile_public(p: CofounderProfile, *, user_uid: Optional[str] = None) -> dict:
    """Browse-card view: no identity, no foreign keys, just the structured
    fields a candidate uses to decide whether to express interest.

    `user_uid` (the *User*'s opaque uid, NOT the profile's) is the handle
    the API accepts on `POST /interest` — it's an opaque UUID so it
    doesn't leak identity, but the frontend needs it to address the
    target user. We resolve it lazily so callers without a user
    context (e.g. counterparty profile snapshots inside connection
    serialisation) can omit it."""
    return {
        "uid": p.uid,
        "user_uid": user_uid,
        "handle": f"cofounder-{p.uid[:8]}",
        "skills": _loads(p.skills_json),
        "sectors": _loads(p.sectors_json),
        "commitment": p.commitment,
        "location_city": p.location_city,
        "location_country": p.location_country,
        "remote_ok": p.remote_ok,
        "equity_expectation_min": p.equity_expectation_min,
        "equity_expectation_max": p.equity_expectation_max,
        "bio": p.bio,
        "looking_for": p.looking_for,
        "listed": p.listed,
    }


def serialize_profile_self(p: CofounderProfile, *, user_uid: Optional[str] = None) -> dict:
    """Owner view — adds owner-only fields (listed flag is editable)."""
    out = serialize_profile_public(p, user_uid=user_uid)
    out["created_at"] = p.created_at.isoformat() if p.created_at else None
    out["updated_at"] = p.updated_at.isoformat() if p.updated_at else None
    return out


# ---------------------------------------------------------------------------
# Browse + scoring
# ---------------------------------------------------------------------------
def _score_match(viewer: CofounderProfile, candidate: CofounderProfile) -> tuple[int, list[str]]:
    """Symmetric overlap scoring. Higher = better fit.

    Skills: complementary skills (in viewer's `looking_for_skills` if we
    ever add that — for now overlap counts) + 5 each, max 25.
    Sectors: shared sector +15 each, max 30.
    Commitment match: same commitment +20.
    Location: same city +15, same country +5, both remote_ok +5.
    Equity overlap: ranges overlap +10.
    """
    score = 0
    why: list[str] = []

    v_skills = set(_loads(viewer.skills_json))
    c_skills = set(_loads(candidate.skills_json))
    # Reward complementary skills (set difference) more than identical
    # skills — co-founders typically want coverage, not duplication.
    complementary = c_skills - v_skills
    if complementary:
        bonus = min(25, 5 * len(complementary))
        score += bonus
        why.append(f"complementary skills: {', '.join(sorted(complementary))[:80]}")

    v_sectors = set(_loads(viewer.sectors_json))
    c_sectors = set(_loads(candidate.sectors_json))
    shared = v_sectors & c_sectors
    if shared:
        bonus = min(30, 15 * len(shared))
        score += bonus
        why.append(f"sector overlap: {', '.join(sorted(shared))}")

    if viewer.commitment == candidate.commitment:
        score += 20
        why.append(f"same commitment ({viewer.commitment})")

    if viewer.location_city and candidate.location_city and \
            viewer.location_city.strip().lower() == candidate.location_city.strip().lower():
        score += 15
        why.append(f"same city ({viewer.location_city})")
    elif viewer.location_country and candidate.location_country and \
            viewer.location_country.strip().lower() == candidate.location_country.strip().lower():
        score += 5
        why.append(f"same country ({viewer.location_country})")
    if viewer.remote_ok and candidate.remote_ok:
        score += 5
        why.append("both open to remote")

    v_lo, v_hi = viewer.equity_expectation_min, viewer.equity_expectation_max
    c_lo, c_hi = candidate.equity_expectation_min, candidate.equity_expectation_max
    if all(x is not None for x in (v_lo, v_hi, c_lo, c_hi)):
        # Overlap iff max(min) <= min(max).
        if max(v_lo, c_lo) <= min(v_hi, c_hi):
            score += 10
            why.append("equity expectations overlap")

    return score, why


def browse(session: Session, viewer: User, *,
           q: Optional[str] = None,
           skill: Optional[str] = None,
           sector: Optional[str] = None,
           commitment: Optional[str] = None,
           remote_only: bool = False,
           limit: int = 50) -> list[dict]:
    """Return ranked, redacted candidate cards. Caller's own profile is
    excluded. Closed connections are excluded from the feed."""
    viewer_profile = get_my_profile(session, viewer)
    if viewer_profile is None:
        # Caller hasn't opted in — let the route surface the right error.
        raise PermissionError("viewer_has_no_profile")

    # Push as many filters as we can into SQL (commitment, remote_only)
    # so the in-memory step only handles the JSON-encoded list/text fields
    # that need parsing. Bounded by `limit*4` to cap worst-case scan when
    # filters are loose.
    stmt = select(CofounderProfile).where(
        CofounderProfile.listed == True,  # noqa: E712
        CofounderProfile.user_id != viewer.id,
    )
    if commitment:
        stmt = stmt.where(CofounderProfile.commitment == commitment)
    if remote_only:
        stmt = stmt.where(CofounderProfile.remote_ok == True)  # noqa: E712
    rows = session.exec(stmt.limit(max(limit * 4, 200))).all()

    # Pull every interest the viewer has emitted/received so we can stamp
    # each card with the right state in one pass.
    sent = {
        i.to_user_id: i for i in session.exec(
            select(CofounderInterest).where(
                CofounderInterest.from_user_id == viewer.id,
                CofounderInterest.status == "sent",
            )
        ).all()
    }
    received = {
        i.from_user_id: i for i in session.exec(
            select(CofounderInterest).where(
                CofounderInterest.to_user_id == viewer.id,
                CofounderInterest.status == "sent",
            )
        ).all()
    }
    # Closed connections are hidden from browse.
    closed_user_ids = set()
    for c in session.exec(
        select(CofounderConnection).where(
            CofounderConnection.status == "closed",
            (CofounderConnection.user_a_id == viewer.id) |
            (CofounderConnection.user_b_id == viewer.id),
        )
    ).all():
        other = c.user_b_id if c.user_a_id == viewer.id else c.user_a_id
        closed_user_ids.add(other)

    # Pre-resolve User.uid for every row in one query so we can stamp it
    # on each card (frontend uses it to call POST /interest).
    user_ids = [p.user_id for p in rows]
    user_uid_by_id: dict[int, str] = {}
    if user_ids:
        for u in session.exec(select(User.id, User.uid).where(User.id.in_(user_ids))).all():
            uid_val = u[1] if isinstance(u, tuple) else u.uid
            uid_id = u[0] if isinstance(u, tuple) else u.id
            user_uid_by_id[uid_id] = uid_val

    out: list[tuple[int, list[str], CofounderProfile]] = []
    for p in rows:
        if p.user_id in closed_user_ids:
            continue
        c_skills = _loads(p.skills_json)
        c_sectors = _loads(p.sectors_json)
        if skill and skill.lower() not in [s.lower() for s in c_skills]:
            continue
        if sector and sector.lower() not in [s.lower() for s in c_sectors]:
            continue
        if q:
            blob = " ".join([
                p.bio or "", p.looking_for or "",
                " ".join(c_skills), " ".join(c_sectors),
                p.location_city or "", p.location_country or "",
            ]).lower()
            if q.lower() not in blob:
                continue
        score, why = _score_match(viewer_profile, p)
        out.append((score, why, p))

    out.sort(key=lambda t: (-t[0], t[2].id or 0))
    cards: list[dict] = []
    for score, why, p in out[:limit]:
        card = serialize_profile_public(p, user_uid=user_uid_by_id.get(p.user_id))
        card["match_score"] = score
        card["match_reasons"] = why
        # Per-card relationship state — mutual_interest=True means the
        # candidate has already pinged us, so accepting our interest will
        # immediately create a connection.
        card["interest_sent"] = p.user_id in sent
        card["interest_received"] = p.user_id in received
        card["mutual_interest"] = card["interest_sent"] and card["interest_received"]
        cards.append(card)
    return cards


# ---------------------------------------------------------------------------
# Interest + connection
# ---------------------------------------------------------------------------
def _ordered_pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def get_connection(session: Session, user_a: int, user_b: int) -> Optional[CofounderConnection]:
    lo, hi = _ordered_pair(user_a, user_b)
    return session.exec(
        select(CofounderConnection).where(
            CofounderConnection.user_a_id == lo,
            CofounderConnection.user_b_id == hi,
        )
    ).first()


def express_interest(session: Session, viewer: User, *,
                     target_user_id: int,
                     message: Optional[str] = None) -> dict:
    """Record a directed interest signal. If the inverse signal already
    exists (and is `sent`), mutual interest is detected and a
    `CofounderConnection` + two NDA Documents are minted atomically.

    Returns ``{"interest_id", "mutual": bool, "connection_uid": Optional[str]}``.
    """
    if viewer.id == target_user_id:
        raise ValueError("cannot_self_interest")
    target_user = session.get(User, target_user_id)
    if not target_user or not target_user.is_active:
        raise ValueError("target_not_found")
    if not get_my_profile(session, viewer):
        raise PermissionError("viewer_has_no_profile")
    target_profile = session.exec(
        select(CofounderProfile).where(CofounderProfile.user_id == target_user_id)
    ).first()
    if not target_profile or not target_profile.listed:
        raise ValueError("target_not_listed")

    # Closed connections block re-engagement.
    existing_conn = get_connection(session, viewer.id, target_user_id)
    if existing_conn and existing_conn.status == "closed":
        raise ValueError("connection_closed")

    # Idempotent on (from, to) thanks to UNIQUE constraint. Re-express
    # after withdrawal flips status back to 'sent'.
    interest = session.exec(
        select(CofounderInterest).where(
            CofounderInterest.from_user_id == viewer.id,
            CofounderInterest.to_user_id == target_user_id,
        )
    ).first()
    if interest is None:
        interest = CofounderInterest(
            from_user_id=viewer.id, to_user_id=target_user_id,
            message=(message or None), status="sent",
        )
        session.add(interest)
        try:
            session.commit()
        except IntegrityError:
            # Someone else inserted under the same race. Re-select.
            session.rollback()
            interest = session.exec(
                select(CofounderInterest).where(
                    CofounderInterest.from_user_id == viewer.id,
                    CofounderInterest.to_user_id == target_user_id,
                )
            ).first()
            assert interest is not None
        session.refresh(interest)
    else:
        interest.status = "sent"
        if message and not interest.message:
            interest.message = message
        interest.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(interest)

    # Detect mutual interest.
    inverse = session.exec(
        select(CofounderInterest).where(
            CofounderInterest.from_user_id == target_user_id,
            CofounderInterest.to_user_id == viewer.id,
            CofounderInterest.status == "sent",
        )
    ).first()
    mutual = inverse is not None
    connection_uid: Optional[str] = None
    if mutual:
        conn = _ensure_connection_with_ndas(session, viewer, target_user)
        connection_uid = conn.uid

    return {
        "interest_id": interest.id,
        "mutual": mutual,
        "connection_uid": connection_uid,
    }


def withdraw_interest(session: Session, viewer: User, target_user_id: int) -> bool:
    """Set the directed interest to `withdrawn`. Existing connections are
    NOT touched (use `close_connection` for that — separate user action so
    one accidental click doesn't tear down a signed NDA pair)."""
    interest = session.exec(
        select(CofounderInterest).where(
            CofounderInterest.from_user_id == viewer.id,
            CofounderInterest.to_user_id == target_user_id,
        )
    ).first()
    if not interest or interest.status == "withdrawn":
        return False
    interest.status = "withdrawn"
    interest.updated_at = datetime.utcnow()
    session.commit()
    return True


def _render_cofounder_nda(*, signer: User, counterparty: User) -> str:
    return (COFOUNDER_NDA_BODY
            .replace("{signer_name}", signer.name or signer.email)
            .replace("{signer_email}", signer.email)
            .replace("{counterparty_name}", counterparty.name or counterparty.email)
            .replace("{today}", datetime.utcnow().date().isoformat()))


def _ensure_connection_with_ndas(session: Session, user_x: User, user_y: User) -> CofounderConnection:
    """Idempotent — returns the existing connection if one already exists.
    Otherwise inserts the connection + two NDA Documents in a single
    transaction so we never end up with a connection lacking NDAs."""
    lo, hi = _ordered_pair(user_x.id, user_y.id)
    user_a = session.get(User, lo)
    user_b = session.get(User, hi)

    conn = session.exec(
        select(CofounderConnection).where(
            CofounderConnection.user_a_id == lo,
            CofounderConnection.user_b_id == hi,
        )
    ).first()
    if conn:
        return conn

    # Mint two NDA documents — A signs as Recipient (B is Discloser) and
    # vice-versa.
    doc_a = Document(
        title=f"{COFOUNDER_NDA_TITLE} — {user_a.email}",
        doc_type=DocumentType.OTHER,
        status=DocumentStatus.GENERATED,
        content=_render_cofounder_nda(signer=user_a, counterparty=user_b),
        template_name="nda_cofounder",
    )
    doc_b = Document(
        title=f"{COFOUNDER_NDA_TITLE} — {user_b.email}",
        doc_type=DocumentType.OTHER,
        status=DocumentStatus.GENERATED,
        content=_render_cofounder_nda(signer=user_b, counterparty=user_a),
        template_name="nda_cofounder",
    )
    session.add(doc_a); session.add(doc_b); session.flush()

    conn = CofounderConnection(
        user_a_id=lo, user_b_id=hi,
        nda_doc_a_id=doc_a.id, nda_doc_b_id=doc_b.id,
        status="pending_nda",
    )
    session.add(conn)
    try:
        session.commit()
    except IntegrityError:
        # Someone else inserted under the same race. Drop the dupe docs
        # and return the row that survived.
        session.rollback()
        conn = session.exec(
            select(CofounderConnection).where(
                CofounderConnection.user_a_id == lo,
                CofounderConnection.user_b_id == hi,
            )
        ).first()
        assert conn is not None
        # Best-effort cleanup of the orphaned docs we just inserted in
        # the failed transaction (Postgres rolled them back already).
        return conn
    session.refresh(conn)
    return conn


def list_connections(session: Session, user: User) -> list[dict]:
    rows = session.exec(
        select(CofounderConnection).where(
            (CofounderConnection.user_a_id == user.id) |
            (CofounderConnection.user_b_id == user.id)
        )
    ).all()
    out: list[dict] = []
    for c in rows:
        out.append(serialize_connection_for(session, c, user))
    out.sort(key=lambda d: d["created_at"] or "", reverse=True)
    return out


def serialize_connection_for(session: Session, c: CofounderConnection, user: User) -> dict:
    """Identity (name + email) is exposed only when status == 'active'.

    For `pending_nda`, we still expose the name/email so each side knows
    who they're signing the NDA *with* — concealing identity at this
    point would be self-defeating since the NDA itself names the
    counterparty. Only browse cards stay anonymous.
    """
    is_a = (c.user_a_id == user.id)
    other_id = c.user_b_id if is_a else c.user_a_id
    other = session.get(User, other_id)
    other_profile = session.exec(
        select(CofounderProfile).where(CofounderProfile.user_id == other_id)
    ).first()
    other_user_uid = other.uid if other else None
    my_signed = c.nda_signed_at_a if is_a else c.nda_signed_at_b
    their_signed = c.nda_signed_at_b if is_a else c.nda_signed_at_a
    my_doc_id = c.nda_doc_a_id if is_a else c.nda_doc_b_id

    return {
        "uid": c.uid,
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "i_signed_at": my_signed.isoformat() if my_signed else None,
        "they_signed_at": their_signed.isoformat() if their_signed else None,
        "my_nda_document_id": my_doc_id,
        "counterparty": {
            "user_id": other_id,
            "name": other.name if other else None,
            "email": other.email if other else None,
            "profile": serialize_profile_public(other_profile, user_uid=other_user_uid) if other_profile else None,
        },
    }


def get_my_nda_for_connection(session: Session, c: CofounderConnection, user: User) -> Optional[Document]:
    is_a = (c.user_a_id == user.id)
    doc_id = c.nda_doc_a_id if is_a else c.nda_doc_b_id
    if not doc_id:
        return None
    return session.get(Document, doc_id)


def sign_connection_nda(session: Session, c: CofounderConnection, user: User, *,
                        signer_name: str, ip: str) -> CofounderConnection:
    """Record one side's signature. When *both* sides have signed, flip
    status to `active`. Idempotent on re-sign.

    Raises `PermissionError` if the user isn't a member of the connection
    or `ValueError` if the connection is closed.
    """
    if c.status == "closed":
        raise ValueError("connection_closed")
    if user.id not in (c.user_a_id, c.user_b_id):
        raise PermissionError("not_a_party")

    is_a = (c.user_a_id == user.id)
    already = c.nda_signed_at_a if is_a else c.nda_signed_at_b
    if already:
        return c  # idempotent

    now = datetime.utcnow()
    name_clip = (signer_name or "")[:200] or None
    ip_clip = (ip or "")[:64] or None
    doc_id = c.nda_doc_a_id if is_a else c.nda_doc_b_id

    if is_a:
        c.nda_signed_at_a = now
        c.nda_signed_name_a = name_clip
        c.nda_signed_ip_a = ip_clip
    else:
        c.nda_signed_at_b = now
        c.nda_signed_name_b = name_clip
        c.nda_signed_ip_b = ip_clip
    c.updated_at = now

    if c.nda_signed_at_a and c.nda_signed_at_b:
        c.status = "active"

    if doc_id:
        doc = session.get(Document, doc_id)
        if doc and doc.status != DocumentStatus.SIGNED:
            doc.status = DocumentStatus.SIGNED
            doc.signed_by = user.email
            doc.signed_at = now
            doc.signed_ip = ip_clip
            doc.updated_at = now
            session.add(doc)

    session.add(c); session.commit(); session.refresh(c)
    return c


def close_connection(session: Session, c: CofounderConnection, user: User, *,
                     reason: Optional[str] = None) -> CofounderConnection:
    if user.id not in (c.user_a_id, c.user_b_id):
        raise PermissionError("not_a_party")
    if c.status == "closed":
        return c
    c.status = "closed"
    c.closed_at = datetime.utcnow()
    c.closed_reason = (reason or None)
    c.updated_at = datetime.utcnow()
    session.add(c); session.commit(); session.refresh(c)
    return c
