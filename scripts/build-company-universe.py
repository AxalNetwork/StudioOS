#!/usr/bin/env python3
"""Build the source-backed company universe behind each market sector.

WHY THIS EXISTS. `/research/markets` shows one card per taxonomy sector with a
supplied company count (488 advertising, 3,083 AI) and nothing behind it. The
directory that was supposed to answer for those counts shipped 300 rows with
`sector = NULL`, so opening a sector showed the headline number and an empty
universe. This script gives every taxonomy sector a real, openable set of
company records, each one carrying the label the sector page filters on.

WHAT IT IS NOT. It does not try to reach the supplied counts. Those are
Axal-provided taxonomy counts, and the UI already says they are discovery
counts rather than TAM. This builds the subset that can be sourced: companies
Wikidata records as being in an industry, with an official website, a country
and an inception year. The record's own `source_url` is the citation.

INPUTS
  frontend/src/data/marketDirectory.json  the 82-sector taxonomy (slugs+names)
  scripts/sector-industry-map.json        sector slug -> Wikidata industry QIDs
  frontend/src/data/companyDirectory.json the previous baseline, preserved

OUTPUTS
  frontend/src/data/companyDirectory.json the directory the SPA ships
  (optional) --sql-out                    an idempotent upsert for D1

USAGE
  python3 scripts/build-company-universe.py
  python3 scripts/build-company-universe.py --sql-out /tmp/company_universe.sql
  python3 scripts/build-company-universe.py --only ai,fintech --per-industry 50
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "frontend/src/data/marketDirectory.json"
INDUSTRY_MAP = ROOT / "scripts/sector-industry-map.json"
PREVIOUS = ROOT / "frontend/src/data/companyDirectory.json"
OUTPUT = ROOT / "frontend/src/data/companyDirectory.json"
CACHE = ROOT / ".cache/wikidata"
UA = "AxalStudioOS-research/1.0 (research@axal.vc)"
SPARQL = "https://query.wikidata.org/sparql"
SOURCE_LICENSE = "CC0 (Wikidata data); website links are references"

# Classes that identify a company-like entity. Direct `P31` membership only: the
# transitive `P279*` walk is what made the first draft of this query time out,
# and the direct list covers the classes companies actually carry.
COMPANY_CLASSES = [
    "Q4830453",   # business
    "Q6881511",   # enterprise
    "Q783794",    # company
    "Q1058914",   # software company
    "Q18388277",  # technology company
    "Q891723",    # public company
    "Q1589009",   # privately held company
    "Q129238",    # startup company
    "Q20057897",  # business enterprise
    "Q5621421",   # private company
    "Q167037",    # corporation
    "Q658255",    # subsidiary company
    "Q149789",    # limited liability company
    "Q17376040",  # private limited company
]

# Names Wikidata uses for a category, a list or an event rather than a company.
# `P452` is an industry property but it is not only used on companies: the first
# pull returned "Smart Country Convention" and "AI@Centech" beside Perplexity.
NAME_STOPWORDS = (
    "convention", "association", "list of", "foundation", "initiative",
    "network", "consortium", "alliance", "conference", "expo", "summit",
)


def cache_path(url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / (hashlib.md5(url.encode()).hexdigest() + ".json")


def sparql(query: str, timeout: int = 180, tries: int = 4) -> list[dict]:
    url = SPARQL + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    hit = cache_path(url)
    if hit.exists():
        try:
            cached = json.loads(hit.read_text())["results"]["bindings"]
            # An empty result is never served from cache. The query service
            # answers an over-budget IP with a well-formed, empty result set,
            # and a cached one of those silently reads as "this industry has no
            # companies" for every later run.
            if cached:
                return cached
        except Exception:
            pass
        hit.unlink(missing_ok=True)
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode())
            bindings = payload["results"]["bindings"]
            if bindings:
                hit.write_text(json.dumps(payload))
                return bindings
            # Empty and no error: wait longer before asking again, because the
            # usual cause is the query service answering while rate-limited.
            time.sleep(10 + 10 * attempt)
        except Exception as error:  # noqa: BLE001 - retried, then reported
            if attempt == tries - 1:
                print(f"  ! SPARQL failed after {tries} tries: {error}", file=sys.stderr)
            time.sleep(2 + 4 * attempt)
    return []


def pull(industry_qid: str, limit: int) -> list[dict]:
    """Companies in one Wikidata industry, best-known first.

    ORDERED BY SITELINKS, NOT BY QID. "software industry" holds ~2,500
    companies and a sector keeps a few dozen of them; the ones a reader
    recognises are the ones with Wikipedia articles in many languages, so
    sitelink count is the cheapest honest relevance signal Wikidata offers. The
    uid tiebreak keeps the result stable between runs.
    """
    classes = " ".join("wd:" + qid for qid in COMPANY_CLASSES)
    query = f"""SELECT ?c ?cLabel ?site ?inception ?countryLabel ?sl WHERE {{
  ?c wdt:P452 wd:{industry_qid} ; wdt:P856 ?site ; wdt:P31 ?t .
  VALUES ?t {{ {classes} }}
  ?c wikibase:sitelinks ?sl .
  OPTIONAL {{ ?c wdt:P571 ?inception }}
  OPTIONAL {{ ?c wdt:P17 ?country }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}} ORDER BY DESC(?sl) ?c LIMIT {limit}"""
    found: list[dict] = []
    seen: set[str] = set()
    for row in sparql(query):
        qid = row["c"]["value"].rsplit("/", 1)[-1]
        name = (row.get("cLabel", {}).get("value") or "").strip()
        website = (row.get("site", {}).get("value") or "").strip()
        if not name or not website or qid in seen:
            continue
        if any(word in name.lower() for word in NAME_STOPWORDS):
            continue
        seen.add(qid)
        inception = (row.get("inception", {}).get("value") or "")[:4]
        found.append({
            "uid": qid.lower(), "name": name, "website": website,
            "country": (row.get("countryLabel", {}).get("value") or None),
            "founded_year": int(inception) if inception.isdigit() else None,
        })
    return found


def record(company: dict, sector_name: str, as_of: str) -> dict:
    return {
        "uid": company["uid"],
        "name": company["name"],
        "website": company["website"],
        "country": company["country"],
        "founded_year": company["founded_year"],
        "sector": sector_name,
        "source_name": "Wikidata",
        "source_url": f"https://www.wikidata.org/wiki/{company['uid'].upper()}",
        "source_license": SOURCE_LICENSE,
        "as_of": as_of,
    }


def sql_escape(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


# Rows per statement. SQLite treats a multi-row VALUES list as a compound
# SELECT, and SQLITE_MAX_COMPOUND_SELECT is 500, so 200 leaves room for the
# upsert clause without ever approaching it.
SQL_BATCH = 200

# The citation every generated row carries. It is written by the closing UPDATE
# rather than repeated in all ~3,000 value tuples: `source_url` is derivable
# from the uid, and a generated file whose payload is three quarters of the same
# literal is a file nobody reads.
CITATION_URL_PREFIX = "https://www.wikidata.org/wiki/"
CITATION_MARKER = "pending"


def write_sql(path: Path, rows: list[dict], as_of: str) -> None:
    lines = [
        "-- Company universe per taxonomy sector, generated by",
        "-- scripts/build-company-universe.py.",
        "--",
        "-- Idempotent: a uid that already exists keeps its row and takes the",
        "-- sector this pull assigned it. `source_url` is written as a marker and",
        "-- filled in from the uid by the closing UPDATE, which is why the value",
        "-- tuples are readable.",
        "",
    ]
    for start in range(0, len(rows), SQL_BATCH):
        batch = rows[start:start + SQL_BATCH]
        values = ",".join(
            "(" + ",".join([
                sql_escape(row["uid"]), sql_escape(row["name"]), sql_escape(row["website"]),
                sql_escape(row["country"]), sql_escape(row["founded_year"]), sql_escape(row["sector"]),
                sql_escape(CITATION_MARKER), sql_escape(as_of),
            ]) + ")"
            for row in batch
        )
        lines.append(
            "INSERT INTO research_company_directory "
            "(uid,name,website,country,founded_year,sector,source_url,as_of) VALUES " + values
            + " ON CONFLICT(uid) DO UPDATE SET name=excluded.name, website=excluded.website, "
              "country=excluded.country, founded_year=excluded.founded_year, sector=excluded.sector, "
              "updated_at=CURRENT_TIMESTAMP;"
        )
    lines.append("")
    lines.append(
        "UPDATE research_company_directory SET "
        f"source_url='{CITATION_URL_PREFIX}' || upper(uid), source_name='Wikidata', "
        f"source_license='{SOURCE_LICENSE}', as_of='{as_of}', updated_at=CURRENT_TIMESTAMP "
        f"WHERE source_url = '{CITATION_MARKER}';"
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated sector slugs")
    parser.add_argument("--per-industry", type=int, default=120, help="companies pulled per industry id")
    parser.add_argument("--industries-per-sector", type=int, default=3)
    # Two caps, because the two stores want different things. The database is
    # the universe a reader browses and pages through, so it takes as much as
    # the pull can source. The SPA's bundled copy only has to draw the first
    # paint and survive an API failure, and every row of it is shipped to the
    # browser — so it stays small on purpose.
    parser.add_argument("--per-sector", type=int, default=60, help="records kept per sector in the database")
    parser.add_argument("--bundle-per-sector", type=int, default=12, help="records per sector kept in the bundled JSON")
    parser.add_argument("--sql-out", default="", help="also write an idempotent upsert for D1")
    parser.add_argument("--as-of", default=date.today().isoformat())
    args = parser.parse_args()

    taxonomy = json.loads(TAXONOMY.read_text())["items"]
    industry_map = json.loads(INDUSTRY_MAP.read_text())
    previous = json.loads(PREVIOUS.read_text()) if PREVIOUS.exists() else {"items": []}
    only = {slug.strip() for slug in args.only.split(",") if slug.strip()}

    # The baseline is kept, keyed by uid: this run adds records and fills in the
    # sector label it can source, and never drops a row it did not re-pull.
    kept: dict[str, dict] = {item["uid"]: dict(item) for item in previous.get("items", [])}
    assigned: dict[str, dict] = {}
    per_sector: dict[str, int] = {}

    for sector in taxonomy:
        slug = sector["slug"]
        if only and slug not in only:
            continue
        # The map stores one object per sector — `{name, industries[]}` — and
        # iterating that object yields its KEYS, which turn into `wd:industries`
        # and an empty result that looks exactly like an industry with no
        # companies. Read the list it actually holds.
        mapped = industry_map.get(slug) or []
        if isinstance(mapped, dict):
            mapped = mapped.get("industries", [])
        qids = [entry["id"] if isinstance(entry, dict) else entry
                for entry in mapped][:args.industries_per_sector]
        if not qids:
            print(f"[{slug}] no industry mapping; skipped", flush=True)
            continue
        claimed = 0
        pulled = 0
        # Industries are walked in the mapping's own order, most specific first,
        # and each one is pulled on its own. Asking for all of a sector's
        # industries in one query returns them interleaved, which is how a
        # "SaaS" sector's few dozen records would fill up with the software
        # industry at large instead of with SaaS companies.
        for qid in qids:
            if claimed >= args.per_sector:
                break
            rows = pull(qid, args.per_industry)
            pulled += len(rows)
            # First sector to claim a company wins, in taxonomy order. A
            # company's Wikidata industry list is not single-valued, so a second
            # claim is not a correction — it is the same company in two markets,
            # and the directory stores one label per row.
            for company in rows:
                uid = company["uid"]
                if uid in assigned:
                    continue
                if claimed >= args.per_sector:
                    break
                assigned[uid] = record(company, sector["name"], args.as_of)
                claimed += 1
        per_sector[slug] = claimed
        print(f"[{slug:28s}] {sector['name'][:26]:28s} industries={len(qids)} pulled={pulled:5d} claimed={claimed:4d}", flush=True)

    items = dict(kept)
    items.update(assigned)
    # The bundle keeps the first `bundle-per-sector` records of each sector, in
    # the pull's own order, plus everything the baseline already carried. A uid
    # present in both is one row, not two.
    bundle_seen: dict[str, int] = {}
    bundle_items: dict[str, dict] = {}
    for uid, item in items.items():
        label = item.get("sector") or ""
        if label:
            count = bundle_seen.get(label, 0)
            if count >= args.bundle_per_sector and uid not in kept:
                continue
            bundle_seen[label] = count + 1
        bundle_items[uid] = item
    payload = {
        "version": 1,
        "source": {
            "name": "Wikidata",
            "query_url": "https://query.wikidata.org/",
            "license": "CC0 for Wikidata data",
            "retrieved_at": args.as_of,
            "boundary": (
                "A per-sector subset of companies Wikidata records with an official website, "
                "country and inception year. Sector labels are the Axal taxonomy names. "
                "These are discovery records, not the supplied taxonomy counts, and carry no "
                "funding, valuation, revenue or market-size claim."
            ),
            "bundle_note": (
                f"This bundle carries up to {args.bundle_per_sector} records per sector for first "
                "paint; the directory page reads the full set from the API."
            ),
        },
        "items": sorted(bundle_items.values(), key=lambda item: item["name"].lower()),
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    labelless = sum(1 for item in payload["items"] if not item.get("sector"))
    print(json.dumps({
        "output": str(OUTPUT),
        "bundle_items": len(payload["items"]),
        "database_items": len(items),
        "labelled": len(items) - sum(1 for item in items.values() if not item.get("sector")),
        "without_sector": labelless,
        "bytes": OUTPUT.stat().st_size,
        "sectors_with_records": sum(1 for n in per_sector.values() if n),
        "sectors_pulled": len(per_sector),
    }, indent=2))

    if args.sql_out:
        path = Path(args.sql_out)
        write_sql(path, sorted(items.values(), key=lambda item: item["name"].lower()), args.as_of)
        print(json.dumps({"sql": str(path), "rows": len(items), "bytes": os.path.getsize(path)}, indent=2))


if __name__ == "__main__":
    main()
