"""D4962 — what a company's General fields may hold, as the Worker holds it.

The Cloudflare Worker (`cloudflare-worker/src/services/companyProfileFields.ts`)
is the production contract. This is its dev-backend twin: pure Python, no
FastAPI or database imports, so the golden cases in
`cloudflare-worker/test/fixtures/company_field_cases.json` can run against it
anywhere (`backend/tests/test_company_fields_d4962.py`). The two cannot drift
without a case saying which one differs.

`validate_company_fields(body)` returns `(values, None)` — the values to store,
trimmed, an empty string or null cleared to None, URLs and regions canonical —
or `(None, {"code", "field", "detail"})` for the first refusal.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional, Tuple
from urllib.parse import urlsplit

STAGES = (
    "idea", "pre_seed", "seed", "series_a", "series_b",
    "series_c_plus", "growth", "profitable", "public",
)
LIMITS = {
    "revenue_range": 100,
    "current_products": 1000,
    "expansion_goals": 1000,
    "description": 280,
    "website": 500,
    "linkedin_url": 300,
    "region": 80,
    "regions": 30,
    "employee_count": 1_000_000,
}
GENERAL_FIELDS = (
    "company_name", "stage", "revenue_range", "employee_count", "current_products",
    "international_presence", "expansion_goals", "website", "linkedin_url",
    "description", "default_currency",
)

_CONTROL = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]")
_HAS_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)

Refusal = dict


def _refuse(code: str, field: str, detail: str) -> Tuple[None, Refusal]:
    return None, {"code": code, "field": field, "detail": detail}


def normalize_website(raw: str) -> Optional[str]:
    """http or https, a dotted host, no credentials. A bare host gets https; a bare host's trailing slash is dropped."""
    t = (raw or "").strip()
    if not t or re.search(r"\s", t):
        return None
    try:
        parts = urlsplit(t if _HAS_SCHEME.match(t) else f"https://{t}")
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    if parts.username or parts.password:
        return None
    if "." not in host or host.startswith(".") or host.endswith("."):
        return None
    path = "" if parts.path in ("", "/") and not parts.query and not parts.fragment else (parts.path or "/")
    netloc = f"{host}:{port}" if port else host
    return (
        f"{parts.scheme}://{netloc}{path}"
        f"{'?' + parts.query if parts.query else ''}{'#' + parts.fragment if parts.fragment else ''}"
    )


def normalize_linkedin(raw: str) -> Optional[str]:
    """A LinkedIn company, school or showcase page on linkedin.com or one of its country hosts, as https."""
    site = normalize_website(raw)
    if not site:
        return None
    parts = urlsplit(site)
    host = (parts.hostname or "").lower()
    if host != "linkedin.com" and not host.endswith(".linkedin.com"):
        return None
    m = re.match(r"^/(company|school|showcase)/([^/]+)/?$", parts.path, re.I)
    if not m:
        return None
    return f"https://{'www.linkedin.com' if host == 'linkedin.com' else host}/{m.group(1).lower()}/{m.group(2)}"


def _text(field: str, value: Any, label: str):
    if value is None:
        return None, None
    if not isinstance(value, str):
        return _refuse(f"{field}_invalid", field, f"{label} must be text.")
    t = value.strip()
    if _CONTROL.search(t):
        return _refuse(f"{field}_invalid", field, f"{label} contains characters that cannot be stored.")
    if len(t) > LIMITS[field]:
        return _refuse(f"{field}_too_long", field, f"{label} is at most {LIMITS[field]} characters.")
    return (t or None), None


def _regions(value: Any):
    bad = "international_presence"
    if isinstance(value, list):
        parts = value
    elif isinstance(value, str):
        parts = value.split(",")
    else:
        return _refuse(f"{bad}_invalid", bad, "Regions must be a list of names.")
    seen, out = set(), []
    for p in parts:
        if not isinstance(p, str):
            return _refuse(f"{bad}_invalid", bad, "Regions must be a list of names.")
        r = re.sub(r"\s+", " ", p).strip()
        if not r:
            continue
        if _CONTROL.search(r) or "," in r:
            return _refuse(f"{bad}_invalid", bad, "A region name cannot contain a comma or control characters.")
        if len(r) > LIMITS["region"]:
            return _refuse(f"{bad}_invalid", bad, f"A region name is at most {LIMITS['region']} characters.")
        if r.lower() in seen:
            continue
        seen.add(r.lower())
        out.append(r)
    if len(out) > LIMITS["regions"]:
        return _refuse(f"{bad}_invalid", bad, f"At most {LIMITS['regions']} regions.")
    return (", ".join(out) or None), None


def _head_count(value: Any):
    if value is None or value == "":
        return None, None
    n: Optional[int] = None
    if isinstance(value, bool):
        n = None
    elif isinstance(value, int):
        n = value
    elif isinstance(value, float) and value.is_integer():
        n = int(value)
    elif isinstance(value, str) and re.fullmatch(r"\d{1,7}", value.strip()):
        n = int(value.strip())
    if n is None or n < 0 or n > LIMITS["employee_count"]:
        return _refuse(
            "employee_count_invalid", "employee_count",
            f"Employee count is a whole number from 0 to {LIMITS['employee_count']:,}.",
        )
    return n, None


_LABELS = {
    "revenue_range": "Revenue range", "current_products": "Current products",
    "expansion_goals": "Expansion goals", "description": "The description",
}


def validate_company_fields(body: Any, allowed: Iterable[str] = GENERAL_FIELDS):
    """Validate the General fields present in `body`. `logo_url` is never writable: the logo has its own route."""
    allowed = tuple(allowed)
    if not isinstance(body, dict):
        return _refuse("body_invalid", "", "Send the fields as a JSON object.")
    if "logo_url" in body:
        return _refuse(
            "logo_url_not_writable", "logo_url",
            "A logo is changed by uploading or removing it, not by setting a link.",
        )
    unknown = [k for k in body if k not in allowed]
    if unknown:
        return _refuse("unknown_field", unknown[0], f"Not a company field: {', '.join(unknown[:5])}.")
    values: dict = {}
    for f in allowed:
        if f not in body:
            continue
        v = body[f]
        if f in ("company_name", "default_currency"):
            continue  # the route's own checks
        if f == "stage":
            if v is None or v == "":
                values["stage"] = None
            elif isinstance(v, str) and v in STAGES:
                values["stage"] = v
            else:
                return _refuse("stage_invalid", "stage", f"Stage is one of: {', '.join(STAGES)}.")
        elif f == "employee_count":
            n, err = _head_count(v)
            if err:
                return None, err
            values[f] = n
        elif f == "international_presence":
            r, err = _regions(v)
            if err:
                return None, err
            values[f] = r
        elif f in ("website", "linkedin_url"):
            t, err = _text(f, v, "The website" if f == "website" else "The LinkedIn address")
            if err:
                return None, err
            if t is None:
                values[f] = None
                continue
            url = normalize_website(t) if f == "website" else normalize_linkedin(t)
            if not url:
                return _refuse(
                    f"{f}_invalid", f,
                    "Enter a web address that starts with http:// or https:// (https is assumed when it is left off)."
                    if f == "website"
                    else "Enter the address of a LinkedIn company, school or showcase page, such as linkedin.com/company/your-company.",
                )
            if len(url) > LIMITS[f]:
                return _refuse(f"{f}_too_long", f, f"The address is at most {LIMITS[f]} characters.")
            values[f] = url
        elif f in _LABELS:
            t, err = _text(f, v, _LABELS[f])
            if err:
                return None, err
            values[f] = t
    return values, None
