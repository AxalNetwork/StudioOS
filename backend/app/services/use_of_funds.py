"""Task #2 — Use of Funds allocator helpers (THE ASK) — dev FastAPI twin.

Mirrors cloudflare-worker/src/util/useOfFunds.ts. The founder intake persists
Use of Funds as a JSON array of {"label", "pct"} objects (only non-zero
sections, canonical order). We store JSON rather than a delimited string
because the canonical section labels contain colons
(e.g. "GTM: sales and marketing"), which a delimiter parser would mis-split.
Legacy projects still carry free-text, so every reader falls back to the old
"Eng 55%, GTM 30%" text parser for backward compatibility.
"""
from __future__ import annotations

import json
import re
from typing import List, Dict, Optional, Tuple

_FREE_RE = re.compile(r"^(.+?)[:\s]+(\d{1,3})\s*%?$")


def _parse_free_text(raw: str) -> List[Dict]:
    out: List[Dict] = []
    for part in re.split(r"[,;\n]", raw):
        part = part.strip()
        if not part:
            continue
        m = _FREE_RE.match(part)
        if m:
            pct = max(0, min(100, int(m.group(2))))
            out.append({"label": m.group(1).strip(), "pct": pct})
    total = sum(x["pct"] for x in out)
    if len(out) >= 2 and 80 <= total <= 120:
        return out[:5]
    return []


def _clean_json_alloc(arr) -> List[Dict]:
    out: List[Dict] = []
    for x in arr:
        if not isinstance(x, dict):
            continue
        label = str(x.get("label") or "").strip()
        try:
            pct = round(float(x.get("pct")))
        except (TypeError, ValueError):
            continue
        if label and pct > 0:
            out.append({"label": label, "pct": pct})
    return out[:5]


def parse_use_of_funds_value(raw: Optional[str]) -> List[Dict]:
    """Parse a stored use_of_funds value into [{label, pct}] for rendering.

    JSON-first (the structured allocator), then legacy free-text fallback.
    """
    s = (raw or "").strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                cleaned = _clean_json_alloc(arr)
                if cleaned:
                    return cleaned
        except (ValueError, TypeError):
            # not a JSON allocation list — fall back to free-text parsing
            pass
    return _parse_free_text(s)


def normalize_use_of_funds(raw: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Validate + canonicalize a submitted value for storage.

    Returns (value, error). ``value`` is a canonical JSON string or None;
    ``error`` is a user-facing message or None.
    """
    s = (raw or "").strip()
    if not s:
        return None, None
    if s.startswith("["):
        try:
            arr = json.loads(s)
        except (ValueError, TypeError):
            return None, "Use of Funds is not valid JSON."
        if not isinstance(arr, list):
            return None, "Use of Funds must be a list of sections."
        for x in arr:
            pct = x.get("pct") if isinstance(x, dict) else None
            try:
                pctf = float(pct)
            except (TypeError, ValueError):
                return None, "Use of Funds percentages must be between 0 and 100."
            if pctf < 0 or pctf > 100:
                return None, "Use of Funds percentages must be between 0 and 100."
        non_zero = _clean_json_alloc(arr)
        if not non_zero:
            return None, None
        total = sum(x["pct"] for x in non_zero)
        if total != 100:
            return None, "Use of Funds must total exactly 100%."
        return json.dumps(non_zero), None
    return s, None


def format_use_of_funds_text(raw: Optional[str]) -> str:
    """Human-readable one-line rendering for non-ASK text surfaces."""
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("["):
        parsed = parse_use_of_funds_value(s)
        if parsed:
            return "; ".join(f"{f['label']} {f['pct']}%" for f in parsed)
    return s
