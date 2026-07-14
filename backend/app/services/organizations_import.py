"""Task #16 — import real VC funds / deep-tech investors into `organizations`.

Parses the two uploaded CSV directories, normalizes their columns into the
`organizations` table, deduplicates by a normalized name key (merging fields
when an org appears in both files), and upserts every row. Re-runnable: an
existing org (matched on `normalized_key`) is updated in place, so running the
import twice is a no-op beyond refreshing values.

Run from the workspace root:

    UV_PROJECT_ENVIRONMENT=.venv uv run python -m backend.app.services.organizations_import
"""
from __future__ import annotations

import csv
import json
import logging
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import Organization

logger = logging.getLogger("studioos.organizations_import")

# Workspace root = .../backend/app/services/organizations_import.py -> parents[3]
_ROOT = Path(__file__).resolve().parents[3]
ASSETS_DIR = _ROOT / "attached_assets"
EURO_FILE = ASSETS_DIR / "Euro_Tech_VC_Funds_(from_1_2016)_-_Sheet1_1783956632756.csv"
DEEP_FILE = ASSETS_DIR / "Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv"

# Deep-tech file fixed column layout (0-indexed). The header cells carry
# compound labels ("Investment Stage and Ticket Pre-seed", "Region ... Europe",
# "Sector Focus Aerospace"), so we map by position, which is stable for this
# export.
DT_STAGE_COLS = [(10, "Pre-seed"), (11, "Seed"), (12, "Series A"), (13, "Series B+")]
DT_REGION_COLS = [
    (16, "Europe"), (17, "Israel"), (18, "USA"), (19, "Canada"),
    (20, "Asia"), (21, "Worldwide"), (22, "Other"),
]
DT_SECTOR_COLS = [
    (23, "Aerospace"), (24, "AI/ML"), (25, "Electronics"),
    (26, "Industry 4.0 / Robotics"), (27, "Energy"), (28, "Materials"),
    (29, "Healthtech"), (30, "Biotech"), (31, "Food & Ag"),
    (32, "Cleantech"), (33, "Mobility"),
]

_ROMAN_RE = re.compile(r"^[IVXLCDM]+$", re.IGNORECASE)
# Regional-indicator flag emoji + variation selectors / zero-width joiners.
_FLAG_RE = re.compile(
    "[\U0001F1E6-\U0001F1FF\U0000FE0F\U0000200D\U0001F3F4\U000E0020-\U000E007F]"
)


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


# Placeholder tokens that mean "no value" in the source sheets.
_PLACEHOLDERS = {"", "-", "--", "---", "—", "n/a", "na", "n.a.", "tbd", "?", "."}


def _opt(value: Optional[str]) -> Optional[str]:
    """Return a cleaned optional string, or None for placeholder tokens."""
    v = _clean(value)
    return None if v.lower() in _PLACEHOLDERS else (v or None)


def _strip_flags(value: Optional[str]) -> str:
    """Remove flag emoji from an HQ cell like '🇩🇰 Denmark' -> 'Denmark'."""
    return _FLAG_RE.sub("", _clean(value)).strip()


def _norm_key(name: str) -> str:
    """Lowercased, accent-stripped, alphanumeric-only dedup key."""
    n = unicodedata.normalize("NFKD", name or "")
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[^a-z0-9]+", "", n.lower())
    return n


def _x(value: Optional[str]) -> bool:
    return _clean(value).lower() in ("x", "yes", "true", "1", "✓")


def _tags_from(row: List[str], cols) -> List[str]:
    out: List[str] = []
    for idx, label in cols:
        if idx < len(row) and _x(row[idx]):
            out.append(label)
    return out


def _cell(row: List[str], idx: int) -> str:
    return _clean(row[idx]) if idx < len(row) else ""


# --- Parsers ----------------------------------------------------------------
def parse_euro(path: Path) -> List[dict]:
    if not path.exists():
        logger.warning("organizations_import: euro file missing: %s", path)
        return []
    rows: List[dict] = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader, [])
        # Map year columns (header cell is a 4-digit year like "2016").
        year_cols: List[tuple] = []
        for i, cell in enumerate(header):
            c = _clean(cell)
            if re.fullmatch(r"(19|20)\d{2}", c):
                year_cols.append((i, c))
        for raw in reader:
            name = _cell(raw, 0)
            if not name:
                continue
            number = _cell(raw, 4)
            fund_number = number if _ROMAN_RE.match(number) or number.isdigit() else None
            org_type = "CVC" if number.upper() == "CVC" else "VC Fund"
            yearly: Dict[str, str] = {}
            for idx, year in year_cols:
                val = _cell(raw, idx)
                if val:
                    yearly[year] = val
            rows.append({
                "name": name,
                "website": _opt(_cell(raw, 1)),
                "linkedin": _opt(_cell(raw, 2)),
                "hq_country": _opt(_strip_flags(_cell(raw, 3))),
                "fund_number": fund_number,
                "org_type": org_type,
                "fund_size": _opt(_cell(raw, 5)),
                "latest_fund_date": _opt(_cell(raw, 6)),
                "sector_focus_text": _opt(_cell(raw, 9)),
                "notable_lps": _opt(_cell(raw, 10)),
                "yearly_raised": {y: v for y, v in yearly.items() if _opt(v)},
                "source": "euro_vc",
            })
    return rows


def parse_deep(path: Path) -> List[dict]:
    if not path.exists():
        logger.warning("organizations_import: deep-tech file missing: %s", path)
        return []
    rows: List[dict] = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        next(reader, [])  # header (positional layout, see DT_* constants)
        for raw in reader:
            name = _cell(raw, 0)
            if not name:
                continue
            dt_only_raw = _cell(raw, 6).lower()
            deep_tech_only: Optional[bool] = None
            if dt_only_raw in ("yes", "y", "true"):
                deep_tech_only = True
            elif dt_only_raw in ("no", "n", "false"):
                deep_tech_only = False
            rows.append({
                "name": name,
                "website": _opt(_cell(raw, 2)),
                "org_type": _opt(_cell(raw, 3)),
                "parent_company": _opt(_cell(raw, 4)),
                "hq_country": _opt(_strip_flags(_cell(raw, 5))),
                "deep_tech_only": deep_tech_only,
                "dt_deal_count": _opt(_cell(raw, 7)),
                "fund_size": _opt(_cell(raw, 8)),
                "latest_fund_date": _opt(_cell(raw, 9)),
                "stage_focus": _tags_from(raw, DT_STAGE_COLS),
                "min_ticket": _opt(_cell(raw, 14)),
                "max_ticket": _opt(_cell(raw, 15)),
                "region_focus": _tags_from(raw, DT_REGION_COLS),
                "sector_tags": _tags_from(raw, DT_SECTOR_COLS),
                "additional_focus": _opt(_cell(raw, 34)),
                "source": "deep_tech",
            })
    return rows


# --- Merge + upsert ---------------------------------------------------------
def _merge(base: dict, extra: dict) -> dict:
    """Merge two records for the same org. `base` wins for scalar fields it
    already has; `extra` fills gaps. List/dict fields union. Source becomes
    'both' when the two records come from different files."""
    out = dict(base)
    for k, v in extra.items():
        if k == "source":
            continue
        if isinstance(v, list):
            merged = list(dict.fromkeys([*(out.get(k) or []), *v]))
            out[k] = merged
        elif isinstance(v, dict):
            merged = dict(out.get(k) or {})
            merged.update(v)
            out[k] = merged
        else:
            if not out.get(k) and v:
                out[k] = v
    if base.get("source") and extra.get("source") and base["source"] != extra["source"]:
        out["source"] = "both"
    else:
        out["source"] = base.get("source") or extra.get("source")
    return out


def build_records() -> Dict[str, dict]:
    """Parse both files and dedupe into a {normalized_key: record} map."""
    by_key: Dict[str, dict] = {}
    for rec in [*parse_euro(EURO_FILE), *parse_deep(DEEP_FILE)]:
        key = _norm_key(rec["name"])
        if not key:
            continue
        if key in by_key:
            by_key[key] = _merge(by_key[key], rec)
        else:
            by_key[key] = rec
    return by_key


def _apply(org: Organization, rec: dict) -> None:
    org.name = rec["name"]
    org.website = rec.get("website")
    org.linkedin = rec.get("linkedin")
    org.org_type = rec.get("org_type")
    org.hq_country = rec.get("hq_country")
    org.parent_company = rec.get("parent_company")
    org.sector_focus_text = rec.get("sector_focus_text")
    org.sector_tags_json = json.dumps(rec.get("sector_tags") or [])
    org.fund_size = rec.get("fund_size")
    org.fund_number = rec.get("fund_number")
    org.latest_fund_date = rec.get("latest_fund_date")
    org.notable_lps = rec.get("notable_lps")
    org.stage_focus_json = json.dumps(rec.get("stage_focus") or [])
    org.min_ticket = rec.get("min_ticket")
    org.max_ticket = rec.get("max_ticket")
    org.region_focus_json = json.dumps(rec.get("region_focus") or [])
    org.deep_tech_only = rec.get("deep_tech_only")
    org.dt_deal_count = rec.get("dt_deal_count")
    org.additional_focus = rec.get("additional_focus")
    org.yearly_raised_json = json.dumps(rec.get("yearly_raised") or {})
    org.source = rec.get("source") or "euro_vc"
    org.updated_at = datetime.utcnow()


def run_import() -> dict:
    """Parse, dedupe, and upsert. Returns a summary dict."""
    records = build_records()
    created = 0
    updated = 0
    with Session(engine) as session:
        existing = {o.normalized_key: o for o in session.exec(select(Organization)).all()}
        for key, rec in records.items():
            org = existing.get(key)
            if org:
                _apply(org, rec)
                session.add(org)
                updated += 1
            else:
                org = Organization(normalized_key=key)
                _apply(org, rec)
                session.add(org)
                created += 1
        session.commit()
    summary = {"parsed": len(records), "created": created, "updated": updated}
    logger.info("organizations_import: %s", summary)
    return summary


def bootstrap_organizations() -> None:
    """Deterministic startup seeding — populate the organizations directory on a
    fresh environment so the data is reproducible from code, not a manual step.

    Guarded: runs the import only when the table is empty AND at least one source
    CSV is present. Idempotent by construction (import upserts by normalized_key),
    and skipping when already populated keeps startup fast. Any failure is logged
    and swallowed so a missing CSV in production never blocks app boot.
    """
    try:
        from sqlalchemy import func

        with Session(engine) as session:
            count = session.exec(select(func.count()).select_from(Organization)).one()
        if count and count > 0:
            logger.info("organizations bootstrap: skipped (%s rows already present)", count)
            return
        if not EURO_FILE.exists() and not DEEP_FILE.exists():
            logger.warning("organizations bootstrap: skipped (no source CSVs found in %s)", ASSETS_DIR)
            return
        summary = run_import()
        logger.info("organizations bootstrap: seeded %s", summary)
    except Exception as exc:  # noqa: BLE001
        logger.warning("organizations bootstrap: failed (non-fatal): %s", exc)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    result = run_import()
    print(json.dumps(result, indent=2))
    sys.exit(0)
