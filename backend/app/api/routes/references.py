"""Task #43 — Reference check workflow.

Standardise reference calls so they're recorded, transcribed, summarised,
and tagged. Surfaced in the deal record. **Admin / investor only** — the
founder being referenced never sees these.

Flow:
  1. POST /references            → schedule call (with explicit consent capture)
  2. POST /references/{id}/recording  → upload audio (consent gate enforced)
  3. POST /references/{id}/transcribe → Whisper (or deterministic fallback)
  4. POST /references/{id}/summarize  → Llama / OpenAI (red flags + tags)
  5. GET  /references?deal_id=    → list for a deal
  6. GET  /references/{id}        → full record
"""
from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field as PydField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog, Deal, Reference, User, UserRole,
)
from backend.app.services.file_storage import get_storage, mint_signed_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/references", tags=["Reference Checks"])


# --- Authorization ----------------------------------------------------------
def _ensure_admin_or_investor(user: User) -> None:
    """Reference checks are visible to admin + investor only. Founders and
    partners must not see them — they may concern people they know."""
    if user.role not in (UserRole.ADMIN, UserRole.INVESTOR):
        raise HTTPException(status_code=403, detail="Admin or investor only")


# --- Defaults ---------------------------------------------------------------
DEFAULT_CONSENT_TEXT = (
    "I consent to this reference call being recorded, transcribed, and "
    "shared in summarised form with the Axal investment team for the "
    "purpose of evaluating this opportunity. I understand the recording "
    "will be retained securely and may be deleted on request."
)
ALLOWED_AUDIO_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a",
    "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/flac",
}
MAX_RECORDING_BYTES = 50 * 1024 * 1024  # 50 MB


# --- Schemas ----------------------------------------------------------------
class ReferenceCreate(BaseModel):
    deal_id: int
    reference_name: str = PydField(min_length=1, max_length=200)
    reference_email: Optional[str] = None
    reference_role: Optional[str] = None
    relationship: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    consent_given: bool = False
    consent_text: Optional[str] = None
    notes: Optional[str] = None


class ReferenceUpdate(BaseModel):
    reference_email: Optional[str] = None
    reference_role: Optional[str] = None
    relationship: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class ConsentIn(BaseModel):
    consent_given: bool
    consent_text: Optional[str] = None


# --- DTO --------------------------------------------------------------------
def _to_dto(r: Reference, *, include_transcript: bool = False) -> dict:
    summary = None
    if r.summary_json:
        try:
            summary = json.loads(r.summary_json)
        except Exception:  # noqa: BLE001
            summary = None
    out: dict = {
        "id": r.id,
        "uid": r.uid,
        "deal_id": r.deal_id,
        "reference_name": r.reference_name,
        "reference_email": r.reference_email,
        "reference_role": r.reference_role,
        "relationship": r.relationship,
        "scheduled_at": r.scheduled_at.isoformat() if r.scheduled_at else None,
        "consent_given": r.consent_given,
        "consent_given_at": r.consent_given_at.isoformat() if r.consent_given_at else None,
        "consent_text": r.consent_text,
        "has_recording": bool(r.recording_file_key),
        "recording_size_bytes": r.recording_size_bytes,
        "recording_content_type": r.recording_content_type,
        "recording_uploaded_at": r.recording_uploaded_at.isoformat() if r.recording_uploaded_at else None,
        "has_transcript": bool(r.transcript),
        "transcribed_at": r.transcribed_at.isoformat() if r.transcribed_at else None,
        "summary": summary,
        "summarized_at": r.summarized_at.isoformat() if r.summarized_at else None,
        "status": r.status,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }
    if include_transcript:
        out["transcript"] = r.transcript
    return out


def _audit(session: Session, user: User, action: str, ref: Reference, extra: str = "") -> None:
    session.add(ActivityLog(
        action=f"reference_{action}",
        details=(f"deal={ref.deal_id} reference={ref.reference_name} {extra}").strip(),
        actor=user.email,
        user_id=user.id,
    ))
    session.commit()


# --- Routes -----------------------------------------------------------------
@router.post("")
def create_reference(
    data: ReferenceCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    if not session.get(Deal, data.deal_id):
        raise HTTPException(status_code=404, detail="Deal not found")

    now = datetime.utcnow()
    ref = Reference(
        deal_id=data.deal_id,
        reference_name=data.reference_name.strip(),
        reference_email=data.reference_email,
        reference_role=data.reference_role,
        relationship=data.relationship,
        scheduled_at=data.scheduled_at,
        consent_given=bool(data.consent_given),
        consent_given_at=now if data.consent_given else None,
        consent_text=(data.consent_text or DEFAULT_CONSENT_TEXT) if data.consent_given else None,
        consent_captured_by=user.id if data.consent_given else None,
        notes=data.notes,
        status="scheduled",
        created_by=user.id,
    )
    session.add(ref)
    session.commit()
    session.refresh(ref)
    _audit(session, user, "scheduled", ref, "(consent=%s)" % ref.consent_given)
    return _to_dto(ref)


@router.get("")
def list_references(
    deal_id: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    stmt = select(Reference).order_by(Reference.created_at.desc())
    if deal_id is not None:
        stmt = stmt.where(Reference.deal_id == deal_id)
    rows = session.exec(stmt).all()
    return [_to_dto(r) for r in rows]


@router.get("/{ref_id}")
def get_reference(
    ref_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    # Full transcript only on the detail endpoint to keep list payloads small.
    return _to_dto(ref, include_transcript=True)


@router.patch("/{ref_id}")
def update_reference(
    ref_id: int,
    data: ReferenceUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(ref, k, v)
    ref.updated_at = datetime.utcnow()
    session.add(ref); session.commit(); session.refresh(ref)
    return _to_dto(ref)


@router.post("/{ref_id}/consent")
def capture_consent(
    ref_id: int,
    data: ConsentIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Explicit consent capture — separate from create() so consent can be
    recorded *after* scheduling but *before* uploading the recording."""
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    now = datetime.utcnow()
    if data.consent_given:
        ref.consent_given = True
        ref.consent_given_at = now
        ref.consent_text = (data.consent_text or DEFAULT_CONSENT_TEXT)
        ref.consent_captured_by = user.id
    else:
        # Withdraw consent → wipe recording / transcript / summary to honour
        # the implicit deletion request. **Fail-closed**: if the storage
        # delete fails we MUST NOT mark the DB state as wiped (would leave
        # an orphaned blob accessible by anyone who already minted a signed
        # URL). Bubble the failure so the caller can retry.
        if ref.recording_file_key:
            storage = get_storage()
            try:
                storage.delete(ref.recording_file_key)
            except Exception as exc:  # noqa: BLE001
                logger.exception("consent-withdraw: storage delete failed")
                raise HTTPException(
                    status_code=503,
                    detail=("Could not delete the recording from storage; "
                            "consent state unchanged. Please retry. "
                            f"(error: {exc})"),
                )
            # Verify the object is actually gone before we wipe DB pointers.
            try:
                still_there = storage.head(ref.recording_file_key)
            except Exception:  # noqa: BLE001
                still_there = None
            if still_there:
                logger.error("consent-withdraw: storage delete reported success "
                             "but head() still returns object %s",
                             ref.recording_file_key)
                raise HTTPException(
                    status_code=503,
                    detail="Recording still present in storage after delete; "
                           "consent state unchanged.",
                )
        ref.consent_given = False
        ref.consent_given_at = None
        ref.consent_text = None
        ref.consent_captured_by = None
        ref.recording_file_key = None
        ref.recording_size_bytes = None
        ref.recording_content_type = None
        ref.recording_uploaded_at = None
        ref.transcript = None
        ref.transcribed_at = None
        ref.summary_json = None
        ref.summarized_at = None
        ref.status = "scheduled"
    ref.updated_at = now
    session.add(ref); session.commit(); session.refresh(ref)
    _audit(session, user, "consent_captured" if data.consent_given else "consent_withdrawn", ref)
    return _to_dto(ref)


@router.post("/{ref_id}/recording")
async def upload_recording(
    ref_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    # Hard consent gate — no recording may be uploaded without it.
    if not ref.consent_given:
        raise HTTPException(
            status_code=400,
            detail="Consent must be captured before uploading a recording.",
        )

    ct = (file.content_type or "").lower().split(";", 1)[0].strip()
    if ct not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio type: {ct or 'unknown'}",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(data) > MAX_RECORDING_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Recording exceeds {MAX_RECORDING_BYTES // (1024*1024)} MB limit",
        )

    ext = {
        "audio/mpeg": "mp3", "audio/mp3": "mp3",
        "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
        "audio/wav": "wav", "audio/x-wav": "wav",
        "audio/webm": "webm", "audio/ogg": "ogg", "audio/flac": "flac",
    }.get(ct, "bin")
    key = f"references/{ref.uid}/recording.{ext}"
    try:
        get_storage().put(key, data, ct)
    except Exception as exc:  # noqa: BLE001
        logger.exception("reference recording upload failed")
        raise HTTPException(status_code=500, detail=f"Storage write failed: {exc}")

    now = datetime.utcnow()
    ref.recording_file_key = key
    ref.recording_size_bytes = len(data)
    ref.recording_content_type = ct
    ref.recording_uploaded_at = now
    ref.status = "recorded"
    ref.updated_at = now
    session.add(ref); session.commit(); session.refresh(ref)
    _audit(session, user, "recording_uploaded", ref, f"({len(data)} bytes, {ct})")
    return _to_dto(ref)


@router.get("/{ref_id}/recording-url")
def get_recording_url(
    ref_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mint a short-lived signed URL for streaming the recording. The
    bucket is private — bytes only flow through this proxy or a token URL."""
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref or not ref.recording_file_key:
        raise HTTPException(status_code=404, detail="No recording on file")
    token = mint_signed_token(ref.recording_file_key, ttl_seconds=300, actor=user.email)
    return {
        "url": f"/api/files/references/{token}",
        "expires_in_seconds": 300,
        "content_type": ref.recording_content_type,
    }


# --- Transcription (Whisper) ------------------------------------------------
def _whisper_transcribe(data: bytes, content_type: str) -> dict:
    """Returns {transcript, ai_used, fallback_reason}. Falls back to a
    deterministic placeholder when OPENAI_API_KEY is unset so the workflow
    is still demonstrable end-to-end."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return {
            "transcript": (
                "[Transcript unavailable — OPENAI_API_KEY not configured. "
                "Recording stored; transcribe manually or set the API key "
                "and retry.]"
            ),
            "ai_used": False,
            "fallback_reason": "OPENAI_API_KEY not configured",
        }
    try:
        import openai
        client = openai.OpenAI(api_key=key)
        ext = {
            "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
            "audio/m4a": "m4a", "audio/x-m4a": "m4a",
            "audio/wav": "wav", "audio/x-wav": "wav",
            "audio/webm": "webm", "audio/ogg": "ogg", "audio/flac": "flac",
        }.get(content_type, "mp3")
        buf = io.BytesIO(data)
        buf.name = f"reference.{ext}"
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=buf,
            response_format="text",
        )
        text_out = result if isinstance(result, str) else getattr(result, "text", str(result))
        return {"transcript": text_out.strip(), "ai_used": True, "fallback_reason": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("whisper transcribe failed: %s", exc)
        return {
            "transcript": f"[Transcription failed: {exc}]",
            "ai_used": False,
            "fallback_reason": str(exc),
        }


@router.post("/{ref_id}/transcribe")
def transcribe(
    ref_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    if not ref.consent_given:
        raise HTTPException(status_code=400, detail="Consent required")
    if not ref.recording_file_key:
        raise HTTPException(status_code=400, detail="No recording uploaded yet")

    try:
        data = get_storage().get(ref.recording_file_key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Storage read failed: {exc}")

    result = _whisper_transcribe(data, ref.recording_content_type or "audio/mpeg")
    now = datetime.utcnow()
    ref.transcript = result["transcript"]
    ref.transcribed_at = now
    ref.status = "transcribed"
    ref.updated_at = now
    session.add(ref); session.commit(); session.refresh(ref)
    _audit(session, user, "transcribed", ref, f"(ai={result['ai_used']})")
    return {
        **_to_dto(ref, include_transcript=True),
        "ai_used": result["ai_used"],
        "fallback_reason": result["fallback_reason"],
    }


# --- Summarisation (Llama / OpenAI) -----------------------------------------
def _llm_summarize(transcript: str, *, reference_name: str, reference_role: Optional[str]) -> dict:
    """Returns {summary, tags[], red_flags[], strengths[], quotes[],
    overall_sentiment, ai_used, fallback_reason}.

    Prefers Llama via `LLAMA_API_URL` + `LLAMA_API_KEY` (OpenAI-compatible
    endpoint, e.g. Together / Groq / self-hosted vLLM). Falls back to OpenAI
    `gpt-4o-mini`. Falls back to a deterministic keyword scan when neither
    is configured so the surface still renders something useful in dev."""
    prompt = f"""Analyse this venture-capital reference call transcript for {reference_name}{f' ({reference_role})' if reference_role else ''}.

Return ONLY valid JSON with this exact shape:
{{
  "summary": "2-3 sentence overview of what the reference said",
  "tags": ["3-6 short topical tags, lowercase, hyphenated"],
  "strengths": ["3-5 specific strengths the reference highlighted"],
  "red_flags": ["concerns, hesitations, or warnings — empty array if none"],
  "quotes": ["1-3 direct verbatim quotes from the transcript that best capture the reference's view"],
  "overall_sentiment": "positive|mixed|negative|insufficient"
}}

Transcript:
{transcript[:12000]}"""

    llama_url = os.environ.get("LLAMA_API_URL")
    llama_key = os.environ.get("LLAMA_API_KEY")
    llama_model = os.environ.get("LLAMA_MODEL", "meta-llama/Llama-3.1-70B-Instruct")
    if llama_url and llama_key:
        try:
            import openai
            client = openai.OpenAI(api_key=llama_key, base_url=llama_url)
            r = client.chat.completions.create(
                model=llama_model,
                messages=[
                    {"role": "system", "content": "You are a senior VC analyst summarising reference calls. Always return strict JSON."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2, max_tokens=900,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(r.choices[0].message.content)
            return {**_normalize_summary(parsed), "ai_used": True, "ai_provider": "llama", "fallback_reason": None}
        except Exception as exc:  # noqa: BLE001
            logger.warning("llama summarize failed, falling back: %s", exc)

    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)
            r = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a senior VC analyst summarising reference calls. Always return strict JSON."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2, max_tokens=900,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(r.choices[0].message.content)
            return {**_normalize_summary(parsed), "ai_used": True, "ai_provider": "openai", "fallback_reason": None}
        except Exception as exc:  # noqa: BLE001
            logger.warning("openai summarize failed: %s", exc)

    return {**_keyword_summary(transcript), "ai_used": False, "ai_provider": None,
            "fallback_reason": "No LLM provider configured"}


_RED_FLAG_KEYWORDS = (
    "concern", "worried", "issue", "problem", "struggle", "dishonest",
    "unreliable", "missed", "fail", "fired", "let go", "conflict",
    "lawsuit", "warning", "red flag", "wouldn't recommend", "not recommend",
)
_STRENGTH_KEYWORDS = (
    "excellent", "exceptional", "brilliant", "talented", "trustworthy",
    "reliable", "delivered", "smart", "hardworking", "leader", "honest",
    "would hire", "recommend", "best", "outstanding",
)


def _keyword_summary(transcript: str) -> dict:
    t = (transcript or "").strip()
    sentences = [s.strip() for s in t.replace("\n", " ").split(".") if s.strip()]
    red = [s for s in sentences if any(k in s.lower() for k in _RED_FLAG_KEYWORDS)][:5]
    strengths = [s for s in sentences if any(k in s.lower() for k in _STRENGTH_KEYWORDS)][:5]
    if not t or len(t) < 40:
        sentiment = "insufficient"
    elif red and not strengths:
        sentiment = "negative"
    elif red and strengths:
        sentiment = "mixed"
    elif strengths:
        sentiment = "positive"
    else:
        sentiment = "mixed"
    return {
        "summary": (sentences[0][:280] if sentences else "Transcript too short to summarise."),
        "tags": ["keyword-fallback"],
        "strengths": strengths,
        "red_flags": red,
        "quotes": sentences[:2],
        "overall_sentiment": sentiment,
    }


def _normalize_summary(parsed: dict) -> dict:
    def _str_list(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()][:10]
        return []
    sentiment = str(parsed.get("overall_sentiment", "")).lower()
    if sentiment not in ("positive", "mixed", "negative", "insufficient"):
        sentiment = "mixed"
    return {
        "summary": str(parsed.get("summary", ""))[:1200],
        "tags": _str_list(parsed.get("tags")),
        "strengths": _str_list(parsed.get("strengths")),
        "red_flags": _str_list(parsed.get("red_flags")),
        "quotes": _str_list(parsed.get("quotes")),
        "overall_sentiment": sentiment,
    }


@router.post("/{ref_id}/summarize")
def summarize(
    ref_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    if not ref.transcript:
        raise HTTPException(status_code=400, detail="Transcribe before summarising")

    result = _llm_summarize(
        ref.transcript,
        reference_name=ref.reference_name,
        reference_role=ref.reference_role,
    )
    summary_payload = {k: result[k] for k in
                       ("summary", "tags", "strengths", "red_flags", "quotes", "overall_sentiment")}
    now = datetime.utcnow()
    ref.summary_json = json.dumps(summary_payload)
    ref.summarized_at = now
    ref.status = "summarized"
    ref.updated_at = now
    session.add(ref); session.commit(); session.refresh(ref)
    _audit(session, user, "summarized", ref,
           f"(ai={result['ai_used']} provider={result.get('ai_provider')} flags={len(summary_payload['red_flags'])})")
    return {
        **_to_dto(ref, include_transcript=True),
        "ai_used": result["ai_used"],
        "ai_provider": result.get("ai_provider"),
        "fallback_reason": result["fallback_reason"],
    }


@router.delete("/{ref_id}")
def delete_reference(
    ref_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin_or_investor(user)
    ref = session.get(Reference, ref_id)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    if ref.recording_file_key:
        try:
            get_storage().delete(ref.recording_file_key)
        except Exception as exc:  # noqa: BLE001
            logger.warning("delete: storage cleanup failed: %s", exc)
    session.delete(ref); session.commit()
    _audit(session, user, "deleted", ref)
    return {"deleted": True, "id": ref_id}
