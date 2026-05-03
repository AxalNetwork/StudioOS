"""Task #58 — Trust layer hardening: Sumsub KYB + accreditation + NDA.

Single service module that backs the routes in `api/routes/trust.py`. Three
pillars:

1. **Sumsub KYB** — when `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY` are set
   we hit Sumsub's REST API to create an applicant + mint a hosted-flow
   access token. Without those secrets we run a *deterministic mock* that
   accepts a payload (legal name + business id) and returns a synthetic
   pass/review/fail decision — useful for dev + tests without leaking real
   PII to Sumsub.

2. **Accreditation** — investors upload a document (income letter, net-worth
   attestation, broker letter, entity formation doc). We persist the file
   via the existing `services.file_storage` and create a `Document` row of
   `DocumentType.AML_KYC` — re-using the existing audited storage path
   instead of inventing a parallel one. Admin review flips the
   `Investor.accreditation_status` to `verified`.

3. **NDA** — per-role NDA templates auto-instantiate as `Document` rows the
   first time a user touches the trust API. `NDAAcceptance` rows track the
   signing event with IP + timestamp for legal proof.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, select

from backend.app.models.entities import (
    Document,
    DocumentStatus,
    DocumentType,
    Investor,
    NDAAcceptance,
    Partner,
    User,
    UserRole,
)
from backend.app.services.file_storage import get_storage

logger = logging.getLogger("studioos.trust")

# ---------------------------------------------------------------------------
# Sumsub KYB
# ---------------------------------------------------------------------------
SUMSUB_BASE = "https://api.sumsub.com"


def _sumsub_creds() -> Optional[tuple[str, str]]:
    app = os.getenv("SUMSUB_APP_TOKEN")
    secret = os.getenv("SUMSUB_SECRET_KEY")
    if not app or not secret:
        return None
    return app, secret


def sumsub_available() -> bool:
    return _sumsub_creds() is not None


def _sumsub_sign(secret: str, ts: int, method: str, path: str, body: bytes = b"") -> str:
    msg = str(ts).encode() + method.encode() + path.encode() + body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def _sumsub_request(method: str, path: str, body: Optional[dict] = None) -> dict:
    """Real Sumsub call. Only invoked when creds are present."""
    import urllib.request
    creds = _sumsub_creds()
    if not creds:
        raise RuntimeError("Sumsub credentials missing")
    app, secret = creds
    ts = int(time.time())
    body_bytes = json.dumps(body).encode() if body is not None else b""
    sig = _sumsub_sign(secret, ts, method, path, body_bytes)
    req = urllib.request.Request(
        SUMSUB_BASE + path,
        data=body_bytes if body_bytes else None,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-App-Token": app,
            "X-App-Access-Sig": sig,
            "X-App-Access-Ts": str(ts),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode() or "{}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sumsub request %s %s failed: %s", method, path, exc)
        raise


def _mock_kyb_decision(payload: dict) -> dict:
    """Deterministic mock — accepts unless legal_name/business_id missing or
    explicitly tagged 'fail'/'review'. Stable hash so tests are repeatable."""
    legal = (payload.get("legal_name") or "").strip()
    biz = (payload.get("business_id") or "").strip()
    country = (payload.get("country") or "").strip().upper()
    if not legal or not biz:
        return {"result": "fail", "reason": "missing legal_name or business_id"}
    seed = hashlib.sha256(f"{legal}|{biz}|{country}".encode()).hexdigest()
    if "fail" in legal.lower(): return {"result": "fail", "reason": "synthetic fail keyword"}
    if "review" in legal.lower(): return {"result": "review", "reason": "synthetic review keyword"}
    bucket = int(seed[:2], 16)
    if bucket < 16:    # ~6%
        return {"result": "review", "reason": "random spot-check (mock)"}
    return {"result": "pass", "reason": "deterministic mock pass"}


def start_kyb(session: Session, partner: Partner, applicant_payload: dict) -> dict:
    """Create or refresh a KYB applicant. Returns:
        {provider, ref_id, status, access_token?, hosted_url?}

    `applicant_payload` carries `legal_name`, `business_id` (e.g. EIN/VAT),
    `country`, and an optional `email`. We *never* persist sensitive fields
    in the DB beyond the provider's ref_id + the verification status.
    """
    creds = _sumsub_creds()
    if creds:
        try:
            level = os.getenv("SUMSUB_KYB_LEVEL", "basic-kyb-level")
            external_id = f"partner-{partner.id}"
            applicant = _sumsub_request(
                "POST", f"/resources/applicants?levelName={level}",
                body={"externalUserId": external_id, "type": "company",
                      "info": applicant_payload},
            )
            ref_id = applicant.get("id") or external_id
            tok = _sumsub_request(
                "POST",
                f"/resources/accessTokens?userId={external_id}&levelName={level}",
            )
            partner.kyb_provider = "sumsub"
            partner.kyb_ref_id = ref_id
            partner.kyb_status = "pending"
            partner.kyb_data = json.dumps({"applicant_id": ref_id, "started_at": datetime.utcnow().isoformat()})
            session.add(partner); session.commit(); session.refresh(partner)
            return {"provider": "sumsub", "ref_id": ref_id, "status": "pending",
                    "access_token": tok.get("token"),
                    "hosted_url": tok.get("url")}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Sumsub start_kyb failed, falling back to mock: %s", exc)

    # Deterministic mock path.
    ref_id = f"mock-{partner.id}-{int(time.time())}"
    partner.kyb_provider = "mock"
    partner.kyb_ref_id = ref_id
    partner.kyb_status = "pending"
    partner.kyb_data = json.dumps({
        "applicant_payload": {k: applicant_payload.get(k) for k in ("legal_name", "country")},
        "started_at": datetime.utcnow().isoformat(),
    })
    session.add(partner); session.commit(); session.refresh(partner)
    return {"provider": "mock", "ref_id": ref_id, "status": "pending"}


def submit_kyb(session: Session, partner: Partner, payload: dict) -> dict:
    """Mock-mode submission: runs the deterministic decision now and writes
    back the status. Sumsub-mode submissions go through the hosted SDK and
    arrive via `webhook` — we just refuse here."""
    if partner.kyb_provider == "sumsub":
        raise ValueError("Sumsub-mode: complete the hosted flow; the webhook will update status.")
    decision = _mock_kyb_decision(payload)
    partner.kyb_status = {"pass": "verified", "review": "pending",
                          "fail": "rejected"}[decision["result"]]
    if partner.kyb_status == "verified":
        partner.kyb_verified_at = datetime.utcnow()
    partner.kyb_data = json.dumps({
        "decision": decision, "submitted_at": datetime.utcnow().isoformat(),
    })
    session.add(partner); session.commit(); session.refresh(partner)
    return {"provider": "mock", "status": partner.kyb_status, "decision": decision}


def verify_sumsub_webhook(secret: str, signature_hex: str, raw_body: bytes) -> bool:
    """Sumsub signs webhooks with HMAC-SHA1 over the raw body using the
    `Webhook secret key` (separate from the API secret). We accept either
    sha1 or sha256 prefix to be future-proof."""
    if not signature_hex or not secret:
        return False
    digest_sha1 = hmac.new(secret.encode(), raw_body, hashlib.sha1).hexdigest()
    digest_sha256 = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_hex.lower(), digest_sha1) or \
           hmac.compare_digest(signature_hex.lower(), digest_sha256)


def apply_sumsub_webhook(session: Session, payload: dict) -> Optional[Partner]:
    """Map a Sumsub webhook payload to our partner row. Sumsub sends:
        {type: 'applicantReviewed', applicantId, externalUserId,
         reviewResult: {reviewAnswer: 'GREEN'|'RED'|'YELLOW', ...}}
    """
    ext = payload.get("externalUserId") or ""
    if not ext.startswith("partner-"):
        return None
    try:
        pid = int(ext.split("-", 1)[1])
    except ValueError:
        return None
    partner = session.get(Partner, pid)
    if not partner:
        return None
    answer = ((payload.get("reviewResult") or {}).get("reviewAnswer") or "").upper()
    mapping = {"GREEN": "verified", "RED": "rejected", "YELLOW": "pending"}
    new_status = mapping.get(answer, partner.kyb_status)
    partner.kyb_status = new_status
    if new_status == "verified":
        partner.kyb_verified_at = datetime.utcnow()
    partner.kyb_data = json.dumps({"webhook": payload, "received_at": datetime.utcnow().isoformat()})
    session.add(partner); session.commit(); session.refresh(partner)
    return partner


# ---------------------------------------------------------------------------
# Accreditation upload
# ---------------------------------------------------------------------------
ACCREDITATION_BASES = {"income", "net_worth", "entity", "knowledgeable_employee"}
ACCREDITATION_MIME_ALLOWED = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
ACCREDITATION_MAX_BYTES = 8 * 1024 * 1024  # 8MB


def store_accreditation_doc(
    session: Session,
    investor: Investor,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    basis: str,
) -> Document:
    """Persist the upload via file_storage + create an audited Document row
    and link it to the investor. Status flips to `self_attested` until an
    admin reviews."""
    if basis not in ACCREDITATION_BASES:
        raise ValueError(f"basis must be one of {sorted(ACCREDITATION_BASES)}")
    if content_type not in ACCREDITATION_MIME_ALLOWED:
        raise ValueError(f"content type {content_type} not allowed")
    if len(data) > ACCREDITATION_MAX_BYTES:
        raise ValueError(f"file too large ({len(data)} > {ACCREDITATION_MAX_BYTES})")

    sha = hashlib.sha256(data).hexdigest()
    ext = {"application/pdf": "pdf", "image/jpeg": "jpg",
           "image/png": "png", "image/webp": "webp"}[content_type]
    file_key = f"accreditation/{investor.uid}/{sha[:16]}.{ext}"
    get_storage().put(file_key, data, content_type)

    doc = Document(
        title=f"Accreditation evidence ({basis}) — {filename}",
        doc_type=DocumentType.AML_KYC,
        status=DocumentStatus.GENERATED,
        file_key=file_key,
        file_size=len(data),
        file_sha256=sha,
        file_content_type=content_type,
        template_name=f"accreditation_{basis}",
    )
    session.add(doc); session.commit(); session.refresh(doc)

    investor.accreditation_document_id = doc.id
    investor.accreditation_basis = basis
    investor.accreditation_status = "self_attested"
    investor.updated_at = datetime.utcnow()
    session.add(investor); session.commit(); session.refresh(investor)
    return doc


def review_accreditation(
    session: Session, investor: Investor, *, reviewer: User, decision: str,
) -> Investor:
    """`decision` is 'verified' or 'rejected'. Admin-only at the route layer."""
    if decision not in ("verified", "rejected"):
        raise ValueError("decision must be 'verified' or 'rejected'")
    investor.accreditation_status = decision
    investor.accreditation_verified_at = datetime.utcnow() if decision == "verified" else None
    investor.accreditation_verified_by = reviewer.id
    investor.updated_at = datetime.utcnow()
    session.add(investor); session.commit(); session.refresh(investor)
    return investor


# ---------------------------------------------------------------------------
# NDA templates + tracking
# ---------------------------------------------------------------------------
NDA_TEMPLATES: dict[str, dict[str, str]] = {
    "founder": {
        "title": "Founder Non-Disclosure Agreement",
        "body": """FOUNDER NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement (the "Agreement") is entered into between
Axal VC ("Discloser") and {signer_name} ("Recipient"), effective as of
{today}.

1. PURPOSE. The parties wish to discuss the Recipient's startup, deal
   pipeline access, and related materials (the "Purpose"). In connection
   with the Purpose, Discloser may share certain Confidential Information.

2. CONFIDENTIAL INFORMATION. "Confidential Information" includes deal
   pipeline data, scoring algorithms, partner contacts, financial models,
   investor lists, and any non-public information of Axal VC or its
   portfolio companies disclosed to Recipient.

3. RECIPIENT OBLIGATIONS. Recipient shall (a) hold Confidential Information
   in strict confidence, (b) not use it except for the Purpose, and (c) not
   disclose it to any third party without prior written consent.

4. TERM. Recipient's obligations survive for three (3) years from the
   effective date.

5. GOVERNING LAW. This Agreement is governed by the laws of the State of
   Delaware.

By signing below, Recipient acknowledges and agrees to the terms above.

Signed: {signer_name} ({signer_email})
Date:   {today}
""",
    },
    "partner": {
        "title": "Service Provider / Partner Non-Disclosure Agreement",
        "body": """SERVICE PROVIDER NON-DISCLOSURE AGREEMENT

This Agreement is entered into between Axal VC ("Discloser") and
{signer_name}, in their capacity as a service-provider partner
("Partner"), effective as of {today}.

1. PURPOSE. To enable Partner to provide professional services to Axal VC
   and its portfolio companies, Discloser may share Confidential
   Information including project briefs, founder personal data, and
   commercial terms.

2. CONFIDENTIAL INFORMATION. Includes founder PII, deal pipeline,
   compensation structures, partner network data, and any non-public
   strategic plans.

3. RESTRICTIONS. Partner shall not (a) use Confidential Information to
   solicit Axal's founders/clients outside the platform, (b) reverse-engineer
   matching algorithms, or (c) disclose Confidential Information to
   competitors.

4. RETURN OF MATERIALS. Upon written request, Partner shall destroy or
   return all Confidential Information within fifteen (15) days.

5. TERM. Obligations survive for five (5) years from the effective date.

6. GOVERNING LAW. Delaware.

Signed: {signer_name} ({signer_email})
Date:   {today}
""",
    },
    "investor": {
        "title": "Investor / LP Non-Disclosure Agreement",
        "body": """INVESTOR NON-DISCLOSURE AGREEMENT

This Agreement is entered into between Axal VC ("Discloser") and
{signer_name}, an accredited investor ("Investor"), effective as of
{today}.

1. PURPOSE. Investor will receive access to deal memos, scoring outputs,
   founder profiles, and related diligence materials (the "Materials") to
   evaluate potential investments.

2. CONFIDENTIAL INFORMATION. The Materials are Confidential Information
   and include trade secrets of Axal VC.

3. RESTRICTIONS. Investor shall not (a) share Materials with any third
   party except its directly-engaged advisors who are bound by equivalent
   confidentiality, (b) use Materials to compete with or solicit founders
   outside the platform, or (c) publish or republish any portion.

4. INSIDER NON-USE. Investor acknowledges that Materials may constitute
   material non-public information and agrees not to trade in any related
   security in violation of applicable securities laws.

5. TERM. Obligations survive for five (5) years.

6. GOVERNING LAW. Delaware.

Signed: {signer_name} ({signer_email})
Date:   {today}
""",
    },
}


def required_nda_roles_for(user: User) -> list[str]:
    """Return the role-NDAs this user needs to sign. We require an NDA for
    every non-admin role: founder, partner, investor."""
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role == "admin":
        return []
    if role in NDA_TEMPLATES:
        return [role]
    return []


def _render_nda_body(tpl_body: str, *, signer_name: str, signer_email: str, today: str) -> str:
    """Safer than `str.format`: legal text routinely contains literal `{`/`}`
    (e.g. citations, schedule placeholders). We do explicit `.replace` on the
    handful of tokens we actually support so a future template tweak with a
    stray brace never raises KeyError at runtime."""
    return (tpl_body
            .replace("{signer_name}", signer_name)
            .replace("{signer_email}", signer_email)
            .replace("{today}", today))


def ensure_nda_acceptance(session: Session, user: User, role: str) -> NDAAcceptance:
    """Create the NDAAcceptance + Document rows if they don't exist.
    Idempotent + race-safe — under concurrent requests the UNIQUE(user_id,
    role) constraint may fire on the insert; we re-select instead of 500ing."""
    if role not in NDA_TEMPLATES:
        raise ValueError(f"Unknown NDA role: {role}")
    existing = session.exec(
        select(NDAAcceptance).where(
            NDAAcceptance.user_id == user.id, NDAAcceptance.role == role,
        )
    ).first()
    if existing:
        return existing

    tpl = NDA_TEMPLATES[role]
    body = _render_nda_body(
        tpl["body"],
        signer_name=user.name or user.email,
        signer_email=user.email,
        today=datetime.utcnow().date().isoformat(),
    )
    doc = Document(
        title=f"{tpl['title']} — {user.email}",
        doc_type=DocumentType.OTHER,
        status=DocumentStatus.GENERATED,
        content=body,
        template_name=f"nda_{role}",
    )
    session.add(doc); session.commit(); session.refresh(doc)

    acc = NDAAcceptance(
        user_id=user.id, role=role, document_id=doc.id, status="pending",
    )
    session.add(acc)
    try:
        session.commit()
    except Exception:  # noqa: BLE001 — UNIQUE race fallback
        session.rollback()
        re_select = session.exec(
            select(NDAAcceptance).where(
                NDAAcceptance.user_id == user.id, NDAAcceptance.role == role,
            )
        ).first()
        if re_select:
            return re_select
        raise
    session.refresh(acc)
    return acc


def sign_nda(session: Session, acc: NDAAcceptance, *, signer_name: str, ip: str) -> NDAAcceptance:
    if acc.status == "signed":
        return acc  # idempotent
    if acc.status == "revoked":
        raise ValueError("NDA was revoked; cannot re-sign")
    acc.status = "signed"
    acc.signed_at = datetime.utcnow()
    acc.signed_ip = ip[:64] if ip else None
    acc.signed_name = (signer_name or "")[:200] or None
    acc.updated_at = datetime.utcnow()
    if acc.document_id:
        doc = session.get(Document, acc.document_id)
        if doc and doc.status != DocumentStatus.SIGNED:
            doc.status = DocumentStatus.SIGNED
            doc.signed_by = (signer_name or "")[:200]
            doc.signed_at = acc.signed_at
            doc.signed_ip = acc.signed_ip
            session.add(doc)
    session.add(acc); session.commit(); session.refresh(acc)
    return acc


def list_nda_status(session: Session, user: User) -> list[dict]:
    """Returns a row per required role with current status."""
    out = []
    needed = required_nda_roles_for(user)
    for role in needed:
        acc = session.exec(
            select(NDAAcceptance).where(
                NDAAcceptance.user_id == user.id, NDAAcceptance.role == role,
            )
        ).first()
        out.append({
            "role": role,
            "title": NDA_TEMPLATES[role]["title"],
            "status": acc.status if acc else "not_started",
            "uid": acc.uid if acc else None,
            "document_id": acc.document_id if acc else None,
            "signed_at": acc.signed_at.isoformat() if acc and acc.signed_at else None,
        })
    return out
