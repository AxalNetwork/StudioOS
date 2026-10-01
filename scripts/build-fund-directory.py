#!/usr/bin/env python3
"""Build the source-backed frontend fund directory from the attached CSV exports.

The output is intentionally a read-only catalog. It is not the founder's private
research list; the UI lets a founder add a catalog row to that list explicitly.
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "attached_assets"
OUTPUT = ROOT / "frontend/src/data/fundDirectory.json"
EURO = ASSETS / "Euro_Tech_VC_Funds_(from_1_2016)_-_Sheet1_1783956632756.csv"
DEEP = ASSETS / "Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv"
PLACEHOLDERS = {"", "-", "--", "---", "—", "n/a", "na", "n.a.", "tbd", "?", "."}
FLAG_RE = re.compile(r"[\U0001F1E6-\U0001F1FF]|\U0000FE0F|\U0000200D|\U0001F3F4|[\U000E0020-\U000E007F]")
ROMAN_RE = re.compile(r"^[IVXLCDM]+$", re.IGNORECASE)
STAGES = [(10, "Pre-seed"), (11, "Seed"), (12, "Series A"), (13, "Series B+")]
REGIONS = [(16, "Europe"), (17, "Israel"), (18, "USA"), (19, "Canada"), (20, "Asia"), (21, "Worldwide"), (22, "Other")]
SECTORS = [(23, "Aerospace"), (24, "AI/ML"), (25, "Electronics"), (26, "Industry 4.0 / Robotics"), (27, "Energy"), (28, "Materials"), (29, "Healthtech"), (30, "Biotech"), (31, "Food & Ag"), (32, "Cleantech"), (33, "Mobility")]


def clean(value: str | None) -> str:
    return (value or "").strip()


def optional(value: str | None) -> str | None:
    value = clean(value)
    return None if value.lower() in PLACEHOLDERS else value


def normalized(name: str) -> str:
    value = unicodedata.normalize("NFKD", name or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def checked(value: str | None) -> bool:
    return clean(value).lower() in {"x", "yes", "true", "1", "✓"}


def split_focus(value: str | None) -> list[str]:
    value = optional(value)
    return [part.strip() for part in re.split(r"[,;|]", value) if part.strip()] if value else []


def tags(row: list[str], columns: list[tuple[int, str]]) -> list[str]:
    return [label for index, label in columns if index < len(row) and checked(row[index])]


def merge(base: dict, extra: dict) -> dict:
    result = dict(base)
    for key, value in extra.items():
        if key in {"id", "name"}:
            continue
        if isinstance(value, list):
            result[key] = list(dict.fromkeys([*(result.get(key) or []), *value]))
        elif value not in (None, "") and not result.get(key):
            result[key] = value
    sources = set((result.get("source") or "").split(",")) | set((extra.get("source") or "").split(","))
    sources.discard("")
    result["source"] = ",".join(sorted(sources))
    return result


def parse_euro(records: dict[str, dict]) -> None:
    with EURO.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        for row in reader:
            name = clean(row[0] if row else "")
            if not name:
                continue
            item = {
                "id": normalized(name),
                "name": name,
                "website": optional(row[1] if len(row) > 1 else ""),
                "hq": FLAG_RE.sub("", clean(row[3] if len(row) > 3 else "")).strip() or None,
                "type": "CVC" if clean(row[4] if len(row) > 4 else "").upper() == "CVC" else "VC Fund",
                "fund_number": clean(row[4] if len(row) > 4 and (ROMAN_RE.match(clean(row[4])) or clean(row[4]).isdigit()) else "") or None,
                "fund_size": optional(row[5] if len(row) > 5 else ""),
                "fund_date": optional(row[6] if len(row) > 6 else ""),
                "sectors": split_focus(row[9] if len(row) > 9 else ""),
                "notable_lps": optional(row[10] if len(row) > 10 else ""),
                "stages": [],
                "regions": [],
                "min_ticket": None,
                "max_ticket": None,
                "deep_tech_only": None,
                "source": "euro_vc",
            }
            records[item["id"]] = merge(records[item["id"]], item) if item["id"] in records else item


def parse_deep(records: dict[str, dict]) -> None:
    with DEEP.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        for row in reader:
            name = clean(row[0] if row else "")
            if not name:
                continue
            deep_only_raw = clean(row[6] if len(row) > 6 else "").lower()
            deep_only = True if deep_only_raw in {"yes", "y", "true"} else False if deep_only_raw in {"no", "n", "false"} else None
            item = {
                "id": normalized(name),
                "name": name,
                "website": optional(row[2] if len(row) > 2 else ""),
                "hq": FLAG_RE.sub("", clean(row[5] if len(row) > 5 else "")).strip() or None,
                "type": optional(row[3] if len(row) > 3 else ""),
                "fund_number": None,
                "fund_size": optional(row[8] if len(row) > 8 else ""),
                "fund_date": optional(row[9] if len(row) > 9 else ""),
                "sectors": tags(row, SECTORS),
                "notable_lps": None,
                "stages": tags(row, STAGES),
                "regions": tags(row, REGIONS),
                "min_ticket": optional(row[14] if len(row) > 14 else ""),
                "max_ticket": optional(row[15] if len(row) > 15 else ""),
                "deep_tech_only": deep_only,
                "source": "deep_tech",
            }
            records[item["id"]] = merge(records[item["id"]], item) if item["id"] in records else item


def build() -> dict:
    records: dict[str, dict] = {}
    parse_euro(records)
    parse_deep(records)
    items = sorted(records.values(), key=lambda item: (item["name"].lower(), item["id"]))
    for item in items:
        item["source_label"] = {
            "deep_tech,euro_vc": "Both public mappings",
            "euro_vc": "Euro tech VC fund mapping",
            "deep_tech": "Deep tech investor mapping",
        }[item["source"]]
        for key in ("fund_number", "fund_size", "fund_date", "notable_lps", "min_ticket", "max_ticket", "deep_tech_only"):
            if item.get(key) is None:
                item.pop(key, None)
        for key in ("sectors", "stages", "regions"):
            item[key] = item.get(key) or []
    return {"generated_from": [EURO.name, DEEP.name], "generated_at": date.today().isoformat(), "items": items}


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "items": len(payload["items"]), "bytes": OUTPUT.stat().st_size}, indent=2))
