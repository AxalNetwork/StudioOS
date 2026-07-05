"""LinkedIn profile import — FastAPI dev mirror of
`cloudflare-worker/src/services/linkedinImport.ts`.

Pure, dependency-free parsing of a LinkedIn "Save to PDF" export into a
structured, editable proposal. NOTHING here writes to the DB — the route layer
applies the (user-reviewed) proposal. Real LinkedIn PDFs FlateDecode-compress
their content streams, so we inflate with the stdlib `zlib` before extracting
text. No external calls, no code execution.

Keep this in lock-step with the worker parser: identical section headers, date
heuristics, sanitisation, size cap, and SSRF host allowlist.
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
import zlib
from typing import Any, Optional
from urllib.parse import urlparse

MAX_PDF_BYTES = 8 * 1024 * 1024  # 8 MB hard ceiling.
PDF_MIME = "application/pdf"

logger = logging.getLogger("studioos.linkedin_import")

# Hard ceilings on text length before it reaches the parsing/collapse regexes —
# keeps the ReDoS worst-case bounded even on adversarial PDF text.
_MAX_SANITIZE_INPUT = 20_000
_MAX_CONTENT_CHARS = 2_000_000


class LinkedInImportError(Exception):
    """User-facing import failure. `status` maps to the HTTP response code."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


# --- text sanitisation ------------------------------------------------------

_CTRL_RE = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]")
_WS_RE = re.compile(r"[ \t\u00a0]+")
# Collapse whitespace around newlines. `[^\S\n]*` (horizontal whitespace only,
# never a newline) has no overlap with the literal `\n`, so this stays linear
# and non-backtracking — unlike the old `\s*\n\s*`, flagged by CodeQL as ReDoS.
_NL_RE = re.compile(r"[^\S\n]*\n\s*")


def sanitize_text(v: Any, max_len: int = 500) -> str:
    if v is None:
        return ""
    s = str(v)
    # Bound the working length before any regex runs so the collapse passes
    # below stay cheap even on adversarial PDF text (ReDoS defense).
    if len(s) > _MAX_SANITIZE_INPUT:
        s = s[:_MAX_SANITIZE_INPUT]
    s = _CTRL_RE.sub(" ", s)
    s = s.replace("<", " ").replace(">", " ")
    s = _WS_RE.sub(" ", s)
    s = _NL_RE.sub("\n", s).strip()
    return s[:max_len]


def _clean(v: Any, max_len: int = 200) -> Optional[str]:
    s = sanitize_text(v, max_len).replace("\n", " ").strip()
    return s or None


# --- upload validation ------------------------------------------------------


def decode_pdf_data_uri(data_uri: Any) -> bytes:
    """Validate + decode a `data:application/pdf;base64,...` upload. Raises
    LinkedInImportError with a user-facing message on any rejection."""
    if not isinstance(data_uri, str) or not data_uri.startswith("data:"):
        raise LinkedInImportError("invalid_upload", "Upload must be a data: URI.")
    comma = data_uri.find(",")
    if comma < 0:
        raise LinkedInImportError("invalid_upload", "Malformed data URI.")
    meta = data_uri[5:comma]  # strip "data:"
    mime = meta.replace(";base64", "").strip().lower()
    if mime != PDF_MIME:
        raise LinkedInImportError(
            "not_pdf", "Only PDF files are accepted (LinkedIn → Save to PDF)."
        )
    if not re.search(r";base64$", meta, re.IGNORECASE):
        raise LinkedInImportError("invalid_upload", "PDF must be base64-encoded.")
    b64 = data_uri[comma + 1:]
    limit_mb = round(MAX_PDF_BYTES / (1024 * 1024))
    if (len(b64) * 3) // 4 > MAX_PDF_BYTES:
        raise LinkedInImportError("too_large", f"PDF exceeds the {limit_mb}MB limit.", 413)
    try:
        raw = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        raise LinkedInImportError("invalid_upload", "Could not decode the uploaded file.")
    if len(raw) > MAX_PDF_BYTES:
        raise LinkedInImportError("too_large", f"PDF exceeds the {limit_mb}MB limit.", 413)
    # Magic-byte check: genuine PDFs start with "%PDF-".
    if raw[:5] != b"%PDF-":
        raise LinkedInImportError("not_pdf", "File is not a valid PDF.")
    return raw


# --- PDF text extraction (Flate-aware) --------------------------------------


def _inflate(raw: bytes) -> bytes:
    # PDF FlateDecode is zlib-wrapped; a few producers emit raw DEFLATE.
    for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
        try:
            out = zlib.decompress(raw, wbits)
            if out:
                return out
        except zlib.error:
            continue
    # Last resort: streaming inflate that tolerates trailing garbage.
    try:
        d = zlib.decompressobj()
        out = d.decompress(raw)
        if out:
            return out
    except zlib.error:
        logger.debug("streaming inflate failed", exc_info=True)
    return b""


def _decode_pdf_literal(s: str) -> str:
    s = s.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
    s = s.replace("\\b", "\b").replace("\\f", "\f")
    s = s.replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")
    s = re.sub(r"\\([0-7]{1,3})", lambda m: chr(int(m.group(1), 8)), s)
    return s


_CONTENT_RE = re.compile(
    r"\(((?:\\.|[^\\)])*)\)\s*(Tj|')"
    r"|\[((?:[^\]\\]|\\.)*)\]\s*TJ"
    # Number sub-pattern is linear (no `\d*…\d+` overlap) to avoid polynomial
    # backtracking (CodeQL py/polynomial-redos) while matching the same set.
    r"|(-?(?:\d+\.\d+|\.\d+|\d+))\s+(-?(?:\d+\.\d+|\.\d+|\d+))\s+(Td|TD)"
    r"|(T\*)",
    re.DOTALL,
)
_LIT_RE = re.compile(r"\(((?:\\.|[^\\)])*)\)", re.DOTALL)
_WS_COLLAPSE = re.compile(r"\s+")


def _content_to_lines(content: str, out: list) -> None:
    # Bound content length before the finditer scan below (belt-and-braces with
    # the 500k match guard) so a pathological stream can't blow up parsing time.
    if len(content) > _MAX_CONTENT_CHARS:
        content = content[:_MAX_CONTENT_CHARS]
    cur = {"s": ""}

    def push() -> None:
        t = _WS_COLLAPSE.sub(" ", cur["s"]).strip()
        if t:
            out.append(t)
        cur["s"] = ""

    guard = 0
    for m in _CONTENT_RE.finditer(content):
        guard += 1
        if guard > 500000:
            break
        if m.group(2) is not None:
            lit = _decode_pdf_literal(m.group(1))
            if m.group(2) == "'":
                push()
                cur["s"] += lit
            else:
                cur["s"] += lit
        elif m.group(3) is not None:
            for lm in _LIT_RE.finditer(m.group(3)):
                cur["s"] += _decode_pdf_literal(lm.group(1))
        elif m.group(6) is not None:
            ty = float(m.group(5))
            if abs(ty) > 0.01:
                push()
            else:
                cur["s"] += " "
        elif m.group(7) is not None:
            push()
    push()


_STREAM_RE = re.compile(r"stream\r?\n")


def extract_pdf_lines(raw: bytes) -> list:
    """Extract text lines from a PDF, inflating FlateDecode streams first.
    latin1 keeps 1 byte per char so string offsets == byte offsets."""
    txt = raw.decode("latin1")
    lines: list = []
    guard = 0
    saw_stream = False
    for m in _STREAM_RE.finditer(txt):
        guard += 1
        if guard > 5000:
            break
        saw_stream = True
        dict_start = txt.rfind("<<", 0, m.start())
        dct = txt[dict_start:m.start()] if dict_start >= 0 else ""
        data_start = m.end()
        end_idx = txt.find("endstream", data_start)
        if end_idx < 0:
            continue
        if "/FlateDecode" in dct:
            chunk = raw[data_start:end_idx]
            inflated = _inflate(chunk)
            if inflated:
                _content_to_lines(inflated.decode("latin1"), lines)
        elif not re.search(r"/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)", dct):
            _content_to_lines(txt[data_start:end_idx], lines)
        if len(lines) > 6000:
            break
    if not saw_stream:
        _content_to_lines(txt, lines)
    return lines[:6000]


# --- LinkedIn profile section parser ----------------------------------------

_SECTION_HEADERS = {
    "summary": "about", "about": "about",
    "experience": "experience",
    "education": "education",
    "licenses & certifications": "certifications",
    "licenses and certifications": "certifications",
    "certifications": "certifications",
    "skills": "skills",
    "top skills": "skills",
    "languages": "skills",
    "honors & awards": "skills",
    "honors-awards": "skills",
    "publications": "skills",
    "projects": "skills",
    "volunteering": "skills",
    "volunteer experience": "skills",
    "recommendations": "skills",
    "interests": "skills",
    "contact": "contact",
    "courses": "skills",
}


def _header_for(line: str) -> Optional[str]:
    k = re.sub(r"\s+", " ", line.strip().lower())
    if len(k) > 32:
        return None
    return _SECTION_HEADERS.get(k)


_DATE_RANGE_RE = re.compile(
    r"((?:[A-Z][a-z]{2,8}\.?\s+)?\d{4})\s*[-\u2013\u2014to]+\s*"
    r"(Present|(?:[A-Z][a-z]{2,8}\.?\s+)?\d{4})",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def _split_date_range(line: str) -> dict:
    m = _DATE_RANGE_RE.search(line)
    if not m:
        return {}
    return {"start": _clean(m.group(1), 32), "end": _clean(m.group(2), 32)}


def _is_role_meta(line: str) -> bool:
    return " \u00b7 " in line and not _DATE_RANGE_RE.search(line)


def _parse_experience(block: list) -> list:
    out: list = []
    i = 0
    n = len(block)
    while i < n and len(out) < 30:
        meta_idx = next((idx for idx in range(i, n) if _is_role_meta(block[idx])), -1)
        if meta_idx < 0:
            break
        title = _clean(block[meta_idx - 1]) if meta_idx - 1 >= i else None
        company = _clean(block[meta_idx].split(" \u00b7 ")[0])
        entry: dict = {}
        if title:
            entry["title"] = title
        if company:
            entry["company"] = company
        desc: list = []
        j = meta_idx + 1
        while j < n and j < meta_idx + 8:
            line = block[j]
            if _is_role_meta(line):
                break
            dr = _split_date_range(line)
            if dr.get("start") and not entry.get("start"):
                entry["start"] = dr.get("start")
                entry["end"] = dr.get("end")
                j += 1
                continue
            if re.match(r"^[A-Za-z].{0,60},", line) and not desc and not entry.get("start"):
                j += 1
                continue
            desc.append(line)
            j += 1
        if desc:
            entry["description"] = _clean(" ".join(desc), 500)
        if entry.get("title") or entry.get("company"):
            out.append(entry)
        i = next((idx for idx in range(meta_idx + 1, n) if _is_role_meta(block[idx])), -1)
        if i < 0:
            break
    return out


def _parse_education(block: list) -> list:
    out: list = []
    buf: list = []

    def flush() -> None:
        nonlocal buf
        if not buf:
            return
        entry: dict = {}
        school = _clean(buf[0])
        if school:
            entry["school"] = school
        if len(buf) > 1 and buf[1]:
            parts = buf[1].split(",")
            entry["degree"] = _clean(parts[0])
            if len(parts) > 1:
                entry["field"] = _clean(",".join(parts[1:]))
        if entry.get("school") or entry.get("degree"):
            out.append(entry)
        buf = []

    for line in block:
        dr = _split_date_range(line)
        if dr.get("start") or _YEAR_RE.search(line):
            if buf:
                flush()
                if out:
                    out[-1]["start"] = dr.get("start")
                    out[-1]["end"] = dr.get("end")
            continue
        buf.append(line)
        if len(buf) >= 3:
            flush()
    flush()
    return out[:30]


def _parse_certifications(block: list) -> list:
    out: list = []
    i = 0
    n = len(block)
    while i < n and len(out) < 30:
        name = block[i]
        if re.match(r"^(issued|expires|credential|show credential|see credential)", name, re.IGNORECASE):
            i += 1
            continue
        entry: dict = {"name": _clean(name)}
        nxt = block[i + 1] if i + 1 < n else None
        if (
            nxt
            and not re.match(r"^(issued|expires|credential)", nxt, re.IGNORECASE)
            and not _DATE_RANGE_RE.search(nxt)
        ):
            entry["issuer"] = _clean(nxt)
            i += 2
        else:
            i += 1
        after = block[i] if i < n else None
        if after and re.search(r"issued", after, re.IGNORECASE):
            ym = _YEAR_RE.search(after)
            if ym:
                entry["year"] = ym.group(0)
            i += 1
        if entry.get("name"):
            out.append(entry)
    return out


def parse_linkedin_profile(lines: list) -> dict:
    """Parse extracted lines into a structured, editable proposal. Best-effort:
    unparseable sections yield empty arrays + a warning, never an exception."""
    proposal: dict = {
        "source": "pdf",
        "fields": {},
        "experience": [],
        "education": [],
        "certifications": [],
        "warnings": [],
    }
    clamped = [
        c for c in (sanitize_text(l, 500).replace("\n", " ").strip() for l in lines) if c
    ]
    if not clamped:
        proposal["warnings"].append(
            "No readable text was found in this PDF. It may be image-only — use "
            "the connected-account option or fill fields manually."
        )
        return proposal

    first_section = next((idx for idx, l in enumerate(clamped) if _header_for(l)), -1)
    if first_section < 0:
        first_section = min(len(clamped), 4)
    head = clamped[:first_section]
    if head:
        proposal["fields"]["display_name"] = _clean(head[0], 120)
        proposal["fields"]["full_legal_name"] = _clean(head[0], 200)
    if len(head) > 1 and not _header_for(head[1]):
        proposal["fields"]["headline"] = _clean(head[1], 220)
    loc = next((l for l in head[2:] if "," in l and len(l) <= 60), None)
    if loc:
        proposal["fields"]["location"] = _clean(loc, 100)

    sections: dict = {}
    current_key: Optional[str] = None
    for i in range(first_section, len(clamped)):
        h = _header_for(clamped[i])
        if h:
            current_key = h
            sections.setdefault(h, [])
            continue
        if current_key:
            sections[current_key].append(clamped[i])

    if sections.get("about"):
        proposal["fields"]["bio"] = sanitize_text("\n".join(sections["about"]), 2000)
    if sections.get("experience"):
        proposal["experience"] = _parse_experience(sections["experience"])
        if not proposal["experience"]:
            proposal["warnings"].append(
                "Could not detect individual roles in the Experience section — "
                "please add them manually."
            )
    if sections.get("education"):
        proposal["education"] = _parse_education(sections["education"])
    if sections.get("certifications"):
        proposal["certifications"] = _parse_certifications(sections["certifications"])

    if not proposal["experience"] and not proposal["education"] and not proposal["fields"].get("bio"):
        proposal["warnings"].append(
            "Little structured data was detected. Review the fields below and "
            "edit as needed before saving."
        )
    return proposal


# --- account-source mapping -------------------------------------------------


def build_account_proposal(row: Optional[dict]) -> dict:
    proposal: dict = {
        "source": "account",
        "fields": {},
        "experience": [],
        "education": [],
        "certifications": [],
        "photo_url": None,
        "warnings": [],
    }
    if not row or not row.get("linkedin_sub"):
        raise LinkedInImportError(
            "not_connected",
            "Connect your LinkedIn account first, or upload a PDF export.",
            409,
        )
    if row.get("linkedin_name"):
        proposal["fields"]["display_name"] = _clean(row["linkedin_name"], 120)
        proposal["fields"]["full_legal_name"] = _clean(row["linkedin_name"], 200)
    pic = row.get("linkedin_picture_url")
    if pic and is_linkedin_image_host(pic):
        proposal["photo_url"] = str(pic)[:1000]
    proposal["warnings"].append(
        "LinkedIn only shares your name and photo through the connection. For "
        "experience, education and certifications, upload your LinkedIn PDF export."
    )
    return proposal


def is_linkedin_image_host(url: Any) -> bool:
    """SSRF guard: only ever fetch a profile photo from LinkedIn's own CDN."""
    try:
        u = urlparse(str(url))
    except (ValueError, TypeError):
        return False
    if u.scheme != "https":
        return False
    h = (u.hostname or "").lower()
    return (
        h == "licdn.com"
        or h.endswith(".licdn.com")
        or h == "linkedin.com"
        or h.endswith(".linkedin.com")
    )


# --- apply-time normalisation ----------------------------------------------


def _pick_arr(v: Any) -> list:
    if not isinstance(v, list):
        return []
    return [x for x in v if isinstance(x, dict)][:30]


def normalize_proposal_for_apply(body: Any) -> dict:
    """Whitelist + clamp an incoming (user-edited) proposal so apply never
    trusts the client blindly. Mirrors the worker normaliser for parity."""
    b = body if isinstance(body, dict) else {}
    f = b.get("fields") if isinstance(b.get("fields"), dict) else {}
    fields: dict = {}
    dn = _clean(f.get("display_name"), 120)
    if dn:
        fields["display_name"] = dn
    fn = _clean(f.get("full_legal_name"), 200)
    if fn:
        fields["full_legal_name"] = fn
    hl = _clean(f.get("headline"), 220)
    if hl:
        fields["headline"] = hl
    bio = sanitize_text(f.get("bio"), 2000)
    if bio:
        fields["bio"] = bio
    loc = _clean(f.get("location"), 100)
    if loc:
        fields["location"] = loc
    web = _clean(f.get("website"), 300)
    if web:
        fields["website"] = web

    experience = []
    for e in _pick_arr(b.get("experience")):
        rec = {
            "title": _clean(e.get("title")),
            "company": _clean(e.get("company")),
            "start": _clean(e.get("start"), 32),
            "end": _clean(e.get("end"), 32),
            "description": sanitize_text(e.get("description"), 500) or None,
        }
        if rec["title"] or rec["company"]:
            experience.append({k: v for k, v in rec.items() if v is not None})

    education = []
    for e in _pick_arr(b.get("education")):
        rec = {
            "school": _clean(e.get("school")),
            "degree": _clean(e.get("degree")),
            "field": _clean(e.get("field")),
            "start": _clean(e.get("start"), 32),
            "end": _clean(e.get("end"), 32),
        }
        if rec["school"] or rec["degree"]:
            education.append({k: v for k, v in rec.items() if v is not None})

    certifications = []
    for e in _pick_arr(b.get("certifications")):
        rec = {
            "name": _clean(e.get("name")),
            "issuer": _clean(e.get("issuer")),
            "year": _clean(e.get("year"), 16),
        }
        if rec["name"]:
            certifications.append({k: v for k, v in rec.items() if v is not None})

    photo_url = None
    raw_photo = b.get("photo_url")
    if isinstance(raw_photo, str) and is_linkedin_image_host(raw_photo):
        photo_url = raw_photo[:1000]

    return {
        "fields": fields,
        "experience": experience,
        "education": education,
        "certifications": certifications,
        "photo_url": photo_url,
    }
