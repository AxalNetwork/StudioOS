#!/usr/bin/env python3
"""Give every taxonomy sector a market signal a reader can inspect.

WHY THIS EXISTS. `/research/markets/sector/:slug` calls
`GET /api/signals?sector=<taxonomy name>` and the worker matches that label
case-insensitively against `signals.sector`. The seeded feed only ever carried
`Financial Services`, `Technology` and `Healthcare`, so 79 of the 82 sector
pages said "No exact live signal is recorded for this taxonomy label yet" —
true, and useless. This script closes that gap with one sector-labelled signal
per taxonomy row.

WHAT A SIGNAL HERE IS, AND IS NOT. Every signal is drafted from two inputs that
are themselves on the record: the sector's real company records (Wikidata
identity facts) and live evidence pulled from keyless public APIs — a Hacker
News thread, a public repository, a Stack Exchange question. The drafting model
is instructed to invent nothing: no market size, no funding, no valuation, no
claim about a named company beyond the identity facts it was handed. Every
claim in `thesis`/`why_now` is traceable to an attached evidence row, and each
evidence row carries the URL a reader can open.

USAGE
  python3 scripts/build-sector-signals.py --sql-out /tmp/sector_signals.sql
  python3 scripts/build-sector-signals.py --only ai,fintech --limit 5

Requires OPENAI_API_KEY/OPENAI_API_BASE (Manus LLM proxy) for the drafting step.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "frontend/src/data/marketDirectory.json"
COMPANIES = ROOT / "frontend/src/data/companyDirectory.json"
CACHE = ROOT / ".cache/sector-evidence"
UA = "AxalStudioOS-research/1.0 (research@axal.vc)"
MODEL = "gpt-5-mini"

# The signal vocabulary the seeded feed already uses (see SIGNAL_TYPES in
# cloudflare-worker). Stay inside it: a new `type` would render as an unlabelled
# chip on a page that has a label table for these nine and nothing else.
SIGNAL_TYPES = [
    "underserved_segment", "workflow_digitization", "vertical_software",
    "regulatory_pressure", "geographic_expansion", "emerging_niche_demand",
    "category_creation", "consolidation_signal", "midcap_momentum",
]
CUSTOMER_TYPES = ["smb", "mid_market", "enterprise", "consumer",
                  "financial_institution", "government", "developer", "prosumer"]
MATURITY_STAGES = ["emerging", "scaling", "established", "incumbent"]
CAP_BANDS = ["micro", "small", "mid", "large"]

REGION_BY_COUNTRY = {
    # A deliberately small table: it only has to be right for the countries the
    # company records actually carry, and an unknown country falls through to
    # the sector's region rather than to a guess.
    "united states": "North America", "canada": "North America",
    "united kingdom": "Europe", "germany": "Europe", "france": "Europe",
    "spain": "Europe", "italy": "Europe", "netherlands": "Europe",
    "sweden": "Europe", "switzerland": "Europe", "belgium": "Europe",
    "denmark": "Europe", "norway": "Europe", "finland": "Europe",
    "ireland": "Europe", "poland": "Europe", "portugal": "Europe",
    "austria": "Europe", "czech republic": "Europe", "estonia": "Europe",
    "lithuania": "Europe", "latvia": "Europe", "greece": "Europe",
    "romania": "Europe", "hungary": "Europe", "ukraine": "Europe",
    "israel": "Middle East", "united arab emirates": "Middle East",
    "saudi arabia": "Middle East", "turkey": "Middle East", "egypt": "Africa",
    "south africa": "Africa", "kenya": "Africa", "nigeria": "Africa",
    "ghana": "Africa", "morocco": "Africa", "tunisia": "Africa",
    "china": "Asia", "japan": "Asia", "india": "Asia", "singapore": "Asia",
    "south korea": "Asia", "indonesia": "Asia", "malaysia": "Asia",
    "thailand": "Asia", "vietnam": "Asia", "philippines": "Asia",
    "hong kong": "Asia", "taiwan": "Asia", "pakistan": "Asia",
    "bangladesh": "Asia", "australia": "Oceania", "new zealand": "Oceania",
    "brazil": "Latin America", "mexico": "Latin America", "argentina": "Latin America",
    "chile": "Latin America", "colombia": "Latin America", "peru": "Latin America",
    "uruguay": "Latin America", "costa rica": "Latin America",
}

# The source rows these signals cite. `wikidata` and `company_website` are new:
# reporting a Wikidata fact under `registry_opencorporates` would attribute it to
# a different register with a different licence. The three that already exist in
# the seeded feed are declared here too, with `insert_only`, because a migration
# that inserts evidence referencing them has to guarantee the row is there —
# their own seed lives in migration 136, which a fresh database never executes
# (`BASELINE_CUTOFF`), so without this the foreign key fails on a fresh build.
SOURCE_ROWS = [
    ("wikidata", "Wikidata (CC0 entity records)", "registry", "free", 0.7, 365,
     "https://www.wikidata.org", "upsert",
     "Identity facts: legal/official name, official website, country, inception. CC0."),
    ("company_website", "Company website on record", "registry", "free", 0.55, 180,
     "https://www.wikidata.org", "upsert",
     "The official website a company record points at. Identity only."),
    ("hn_discussion", "Hacker News discussion", "discussion", "free", 0.5, 14,
     "https://hn.algolia.com/api", "insert_only",
     "Practitioner threads via the free, keyless Algolia HN Search API."),
    ("github_activity", "GitHub repository activity", "developer", "free", 0.6, 45,
     "https://docs.github.com/en/rest/search", "insert_only",
     "Repository search via the keyless GitHub REST API, ranked by recent pushes."),
    ("stackexchange_questions", "Stack Exchange question activity", "discussion", "free", 0.55, 30,
     "https://api.stackexchange.com/docs", "insert_only",
     "Question volume via the keyless Stack Exchange API."),
]


def cache_path(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / (hashlib.md5(name.encode()).hexdigest() + ".json")


def fetch_json(url: str, headers: dict | None = None, timeout: int = 45, tries: int = 3):
    hit = cache_path(url)
    if hit.exists():
        try:
            return json.loads(hit.read_text())
        except Exception:
            hit.unlink(missing_ok=True)
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers=headers or {"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode())
            hit.write_text(json.dumps(payload))
            return payload
        except Exception as error:
            if attempt == tries - 1:
                print(f"  ~ evidence fetch failed {url[:70]}: {error}", file=sys.stderr)
            time.sleep(1.5 + 2 * attempt)
    return None


def iso(value: str | None) -> str:
    if not value:
        return date.today().isoformat() + "T00:00:00.000Z"
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return date.today().isoformat() + "T00:00:00.000Z"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def hn_evidence(term: str) -> list[dict]:
    url = ("https://hn.algolia.com/api/v1/search?" + urllib.parse.urlencode({
        "query": term, "tags": "story", "numericFilters": "points>5", "hitsPerPage": 3}))
    payload = fetch_json(url) or {}
    out = []
    for hit in payload.get("hits", [])[:2]:
        title = (hit.get("title") or "").strip()
        if not title:
            continue
        link = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        points = hit.get("points") or 0
        comments = hit.get("num_comments") or 0
        out.append({
            "kind": "discussion", "source_key": "hn_discussion", "title": title, "url": link,
            "detail": f"Hacker News thread · {points} points · {comments} comments",
            "weight": round(min(0.85, 0.35 + points / 600), 2), "observed_at": iso(hit.get("created_at")),
        })
    return out


def github_evidence(term: str) -> list[dict]:
    url = ("https://api.github.com/search/repositories?" + urllib.parse.urlencode({
        "q": term, "sort": "updated", "order": "desc", "per_page": 3}))
    payload = fetch_json(url) or {}
    out = []
    for repo in payload.get("items", [])[:2]:
        name = repo.get("full_name")
        if not name:
            continue
        out.append({
            "kind": "developer", "source_key": "github_activity", "title": name,
            "url": repo.get("html_url"),
            "detail": f"Public repository · {repo.get('language') or 'unspecified'} · last pushed "
                      f"{iso(repo.get('pushed_at'))[:10]} · {repo.get('open_issues_count', 0)} open issues",
            "weight": 0.55, "observed_at": iso(repo.get("pushed_at")),
        })
    return out


def stackevidence(term: str) -> list[dict]:
    url = ("https://api.stackexchange.com/2.3/search/advanced?" + urllib.parse.urlencode({
        "order": "desc", "sort": "activity", "q": term, "site": "stackoverflow", "pagesize": 3}))
    payload = fetch_json(url) or {}
    out = []
    for item in payload.get("items", [])[:2]:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        out.append({
            "kind": "discussion", "source_key": "stackexchange_questions", "title": title,
            "url": item.get("link"),
            "detail": f"Stack Overflow question · {item.get('answer_count', 0)} answers · "
                      f"{item.get('view_count', 0)} views · last activity {iso(item.get('last_activity_date') and datetime.fromtimestamp(item['last_activity_date'], timezone.utc).isoformat())[:10]}",
            "weight": 0.5, "observed_at": iso(item.get("last_activity_date") and datetime.fromtimestamp(item["last_activity_date"], timezone.utc).isoformat()),
        })
    return out


def registry_evidence(companies: list[dict], sector_name: str) -> list[dict]:
    out = []
    for company in companies[:3]:
        facts = [company["name"]]
        if company.get("country"):
            facts.append(company["country"])
        if company.get("founded_year"):
            facts.append(f"founded {company['founded_year']}")
        out.append({
            "kind": "registry", "source_key": "wikidata",
            "title": f"Wikidata record · {company['name']}",
            "url": company.get("source_url") or f"https://www.wikidata.org/wiki/{company['uid'].upper()}",
            "detail": f"{' · '.join(facts)}. Industry label on the record maps to the {sector_name} sector.",
            "weight": 0.7, "observed_at": date.today().isoformat() + "T00:00:00.000Z",
        })
    return out


DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": SIGNAL_TYPES},
        "title": {"type": "string"},
        "thesis": {"type": "string"},
        "why_now": {"type": "string"},
        "industry": {"type": "string"},
        "niche": {"type": "string"},
        "market_cap_band": {"type": "string", "enum": CAP_BANDS},
        "target_customers": {"type": "array", "items": {"type": "string", "enum": CUSTOMER_TYPES}},
        "maturity_stage": {"type": "string", "enum": MATURITY_STAGES},
        "founder_opportunity": {"type": "string"},
        "advisor_note": {"type": "string"},
        "build_headline": {"type": "string"},
        "build_wedge": {"type": "string"},
        "build_icp": {"type": "string"},
        "build_gtm": {"type": "string"},
        "build_moat": {"type": "string"},
        "build_risks": {"type": "string"},
        "growth_direction": {"type": "string", "enum": ["accelerating", "steady", "cooling"]},
        "tags": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["type", "title", "thesis", "why_now", "industry", "niche", "market_cap_band",
                 "target_customers", "maturity_stage", "founder_opportunity", "advisor_note",
                 "build_headline", "build_wedge", "build_icp", "build_gtm", "build_moat",
                 "build_risks", "growth_direction", "tags"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You write one market signal for a venture-capital research desk, working ONLY from the facts you are given.

HARD RULES
1. Invent nothing. No market sizes, growth rates, funding amounts, valuations, revenue figures, headcounts, or dates that are not in the input.
2. Never state or imply that a named company did something specific (raised, launched, acquired, partnered) unless the input says so. Named companies may only be described by the identity facts given (name, country, founding year).
3. Evidence-backed only: the thesis and why_now must be supported by the evidence titles you are given. When the evidence is a public discussion thread or a public repository, describe it as exactly that — a thread or a repository — never as a filing, a funding event, or a company statement.
4. If the evidence is thin, write a narrower signal and say what is still unverified rather than filling the gap.
5. Voice: plain, specific, senior. No hype words ("revolutionary", "game-changing"), no emoji, no bullet lists inside fields, no markdown. Each field is one to three sentences, except title and niche which are short phrases.
6. `niche` is a specific wedge, not a restatement of the sector. `tags` are 3-5 lowercase slugs (a-z, 0-9, '-')."""


def draft(client, sector: dict, companies: list[dict], evidence: list[dict], region: str, country: str) -> dict:
    facts = {
        "sector": sector["name"],
        "supplied_taxonomy_count": sector["company_count"],
        "recorded_company_sample": [
            {"name": c["name"], "country": c.get("country"), "founded_year": c.get("founded_year")}
            for c in companies[:8]
        ],
        "recorded_company_total": len(companies),
        "modal_region": region,
        "modal_country": country,
        "evidence": [
            {"kind": e["kind"], "source": e["source_key"], "title": e["title"], "detail": e["detail"]}
            for e in evidence
        ],
    }
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content":
                "Draft the signal for this sector.\n\n" + json.dumps(facts, ensure_ascii=False, indent=1) +
                "\n\n`supplied_taxonomy_count` is an unverified supplied count: you may mention it only as a "
                "supplied discovery count, never as a market size. If `recorded_company_sample` is empty, "
                "say the sector's recorded universe is thin rather than describing companies you were not given."},
        ],
        response_format={"type": "json_schema", "json_schema": {
            "name": "sector_signal", "strict": True, "schema": DRAFT_SCHEMA}},
        max_completion_tokens=2000,
        extra_body={"reasoning": {"effort": "low"}},
    )
    return json.loads(response.choices[0].message.content)


def band_for(companies: list[dict]) -> str:
    """Size proxy from what the records support: how established the sector looks.

    Not a market cap. Private companies in the directory have no cap at all, so
    the band says where the recorded universe sits by age and count, and the UI
    already labels the field "Size proxy".
    """
    years = [c["founded_year"] for c in companies if isinstance(c.get("founded_year"), int)]
    if not years:
        return "small"
    median = sorted(years)[len(years) // 2]
    if len(companies) < 25 or median >= 2016:
        return "micro"
    if median >= 2010:
        return "small"
    if median >= 2000:
        return "mid"
    return "large"


def evidence_weight_ok(evidence: list[dict]) -> bool:
    """A signal needs at least two source families, or it is one thread's opinion."""
    return len({e["source_key"] for e in evidence}) >= 2


def confidence(evidence: list[dict]) -> int:
    """Port of the worker's own computeConfidence (`d_e`), so the stored hint and
    the value the feed recomputes at read time agree."""
    if not evidence:
        return 0
    quality = {row[0]: (row[4], row[5]) for row in SOURCE_ROWS}
    quality.update({"hn_discussion": (0.5, 14), "github_activity": (0.6, 45),
                    "stackexchange_questions": (0.55, 30), "filing": (0.9, 120)})
    total = 0.0
    weighted = 0.0
    for item in evidence:
        default = quality.get(item["source_key"], (0.4, 30))[0]
        weight = item.get("weight") or default
        total += weight
        weighted += weight * default
    mean = (weighted / total) if total else 0.0
    kinds = len({item["kind"] for item in evidence})
    spread = [0, 0.35, 0.7, 0.9, 1][min(kinds, 4)]
    fresh = freshness(evidence) / 100
    score = 100 * (0.45 * mean + 0.35 * spread + 0.2 * fresh)
    if kinds <= 1:
        score = min(score, 55)
    return round(max(0.0, min(1.0, score / 100)) * 100)


def freshness(evidence: list[dict]) -> int:
    """Port of the worker's `xB`: 70% of the freshest item, 30% of the mean."""
    if not evidence:
        return 0
    halflife = {row[0]: row[5] for row in SOURCE_ROWS}
    halflife.update({"hn_discussion": 14, "github_activity": 45, "stackexchange_questions": 30})
    scores = []
    for item in evidence:
        seen = datetime.fromisoformat(item["observed_at"].replace("Z", "+00:00"))
        age = max(0.0, (datetime.now(timezone.utc) - seen).total_seconds() / 86400)
        life = max(1, halflife.get(item["source_key"], 30))
        scores.append(max(0.0, min(1.0, 0.5 ** (age / life))))
    return round((0.7 * max(scores) + 0.3 * (sum(scores) / len(scores))) * 100)


def write_signals_sql(path: Path, results: list[dict]) -> None:
    lines = [
        "-- Sector signals + evidence, generated by scripts/build-sector-signals.py.",
        "-- Idempotent per signal id; evidence rows are replaced for that signal.",
        "",
    ]
    for row in SOURCE_ROWS:
        key, name, kind, tier, weight, halflife_days, homepage, mode, notes = row
        conflict = (
            "DO UPDATE SET name=excluded.name, kind=excluded.kind, tier=excluded.tier, "
            "quality_weight=excluded.quality_weight, "
            "freshness_halflife_days=excluded.freshness_halflife_days, "
            "homepage=excluded.homepage, notes=excluded.notes, updated_at=datetime('now')"
            if mode == "upsert"
            else "DO NOTHING"
        )
        lines.append(
            "INSERT INTO signal_sources (key,name,kind,tier,quality_weight,"
            "freshness_halflife_days,homepage,enabled,notes) VALUES ("
            f"{sql_value(key)},{sql_value(name)},{sql_value(kind)},{sql_value(tier)},"
            f"{sql_value(weight)},{sql_value(halflife_days)},{sql_value(homepage)},1,"
            f"{sql_value(notes)}) ON CONFLICT(key) {conflict};"
        )
    for signal in results:
        lines.append("")
        lines.append("DELETE FROM signal_evidence WHERE signal_id = " + sql_value(signal["id"]) + ";")
        lines.append(
            "INSERT INTO signals (id,type,title,thesis,why_now,region,country,sector,industry,niche,"
            "market_cap_band,target_customers,maturity_stage,founder_opportunity,advisor_note,"
            "build_opportunity,market_context,confidence_score,freshness_score,rank_score,tags,status,"
            "created_at,updated_at) VALUES ("
            + ",".join([
                sql_value(signal["id"]), sql_value(signal["type"]), sql_value(signal["title"]),
                sql_value(signal["thesis"]), sql_value(signal["why_now"]), sql_value(signal["region"]),
                sql_value(signal["country"]), sql_value(signal["sector"]), sql_value(signal["industry"]),
                sql_value(signal["niche"]), sql_value(signal["market_cap_band"]),
                sql_value(json.dumps(signal["target_customers"])), sql_value(signal["maturity_stage"]),
                sql_value(signal["founder_opportunity"]), sql_value(signal["advisor_note"]),
                sql_value(json.dumps(signal["build"])), sql_value(json.dumps(signal["market"])),
                sql_value(signal["confidence_score"]), sql_value(signal["freshness_score"]), "0",
                sql_value(json.dumps(signal["tags"])), "'active'", "datetime('now')", "datetime('now')",
            ])
            + ") ON CONFLICT(id) DO UPDATE SET type=excluded.type, title=excluded.title, "
              "thesis=excluded.thesis, why_now=excluded.why_now, region=excluded.region, "
              "country=excluded.country, sector=excluded.sector, industry=excluded.industry, "
              "niche=excluded.niche, market_cap_band=excluded.market_cap_band, "
              "target_customers=excluded.target_customers, maturity_stage=excluded.maturity_stage, "
              "founder_opportunity=excluded.founder_opportunity, advisor_note=excluded.advisor_note, "
              "build_opportunity=excluded.build_opportunity, market_context=excluded.market_context, "
              "confidence_score=excluded.confidence_score, freshness_score=excluded.freshness_score, "
              "tags=excluded.tags, status='active', updated_at=datetime('now');"
        )
        for item in signal["evidence"]:
            lines.append(
                "INSERT INTO signal_evidence (id,signal_id,kind,title,detail,source_key,url,weight,"
                "observed_at) VALUES ("
                + ",".join([
                    sql_value(str(uuid.uuid4())), sql_value(signal["id"]), sql_value(item["kind"]),
                    sql_value(item["title"]), sql_value(item["detail"]), sql_value(item["source_key"]),
                    sql_value(item["url"]), sql_value(item["weight"]), sql_value(item["observed_at"]),
                ]) + ");"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"sql": str(path), "signals": len(results), "bytes": os.path.getsize(path)}, indent=2))




def sql_value(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated sector slugs")
    parser.add_argument("--limit", type=int, default=0, help="sectors to process, in taxonomy order")
    parser.add_argument("--out", default=str(ROOT / ".cache/sector-signals.json"))
    parser.add_argument("--sql-out", default="")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--from-json", default="",
                        help="re-emit the SQL from a previous draft cache instead of re-drafting")
    args = parser.parse_args()

    if args.from_json:
        cached = json.loads(Path(args.from_json).read_text())
        if args.sql_out:
            write_signals_sql(Path(args.sql_out), cached)
        print(json.dumps({"from_json": args.from_json, "signals": len(cached)}, indent=2))
        return

    from openai import OpenAI  # imported here so --help works without the SDK

    taxonomy = json.loads(TAXONOMY.read_text())["items"]
    companies = json.loads(COMPANIES.read_text())["items"]
    by_sector: dict[str, list[dict]] = {}
    for item in companies:
        if item.get("sector"):
            by_sector.setdefault(item["sector"], []).append(item)

    only = {slug.strip() for slug in args.only.split(",") if slug.strip()}
    todo = [s for s in taxonomy if not only or s["slug"] in only]
    if args.limit:
        todo = todo[:args.limit]

    client = OpenAI()

    def build(sector: dict) -> dict | None:
        rows = by_sector.get(sector["name"], [])
        term = sector["name"]
        evidence = (registry_evidence(rows, sector["name"]) + hn_evidence(term)
                    + github_evidence(term) + stackevidence(term))
        countries = Counter(c["country"] for c in rows if c.get("country"))
        regions = Counter(REGION_BY_COUNTRY.get((c or "").lower(), "Global") for c in countries.elements())
        region = regions.most_common(1)[0][0] if regions else "Global"
        if len([r for r in regions if r != "Global"]) > 2:
            region = "Global"
        country = countries.most_common(1)[0][0] if countries else (region if region != "Global" else "United States")
        try:
            copy = draft(client, sector, rows, evidence, region, country)
        except Exception as error:
            print(f"  ! draft failed for {sector['slug']}: {error}", file=sys.stderr)
            return None
        signal_id = "sig_sector_" + sector["slug"].replace("-", "_")
        return {
            "id": signal_id,
            "sector_slug": sector["slug"],
            "sector": sector["name"],
            "type": copy["type"] if copy["type"] in SIGNAL_TYPES else "emerging_niche_demand",
            "title": copy["title"],
            "thesis": copy["thesis"],
            "why_now": copy["why_now"],
            "region": region,
            "country": country,
            "industry": copy["industry"],
            "niche": copy["niche"],
            "market_cap_band": copy["market_cap_band"] if copy["market_cap_band"] in CAP_BANDS else band_for(rows),
            "target_customers": [c for c in copy["target_customers"] if c in CUSTOMER_TYPES],
            "maturity_stage": copy["maturity_stage"],
            "founder_opportunity": copy["founder_opportunity"],
            "advisor_note": copy["advisor_note"],
            "build": {
                "headline": copy["build_headline"], "wedge": copy["build_wedge"], "icp": copy["build_icp"],
                "gtm": copy["build_gtm"], "moat": copy["build_moat"], "risks": copy["build_risks"],
            },
            "market": {
                "growth_direction": copy["growth_direction"],
                # The band the drafting model chose and the band the records
                # support, together — a spread that excluded the row's own band
                # would contradict the row it sits on.
                "cap_band_spread": sorted({
                    copy["market_cap_band"] if copy["market_cap_band"] in CAP_BANDS else band_for(rows),
                    band_for(rows),
                }),
                "tam_note": "Not recorded. The sector count shown on the markets page is a supplied discovery count, not TAM.",
            },
            "tags": [t for t in copy["tags"] if t][:6],
            "recorded_companies": len(rows),
            "confidence_score": confidence(evidence),
            "freshness_score": freshness(evidence),
            "evidence": evidence,
        }

    results: list[dict] = []
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for signal in pool.map(build, todo):
            if signal:
                results.append(signal)
                print(f"[{signal['sector_slug']:28s}] {signal['title'][:60]:62s} "
                      f"ev={len(signal['evidence'])} conf={signal['confidence_score']} "
                      f"fresh={signal['freshness_score']} companies={signal['recorded_companies']}", flush=True)

    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    thin = [s for s in results if not evidence_weight_ok(s["evidence"])]
    print(json.dumps({
        "signals": len(results), "sectors_requested": len(todo),
        "single_source_family": [s["sector_slug"] for s in thin],
        "no_recorded_companies": [s["sector_slug"] for s in results if not s["recorded_companies"]],
        "wrote": args.out,
    }, indent=2))

    if args.sql_out:
        write_signals_sql(Path(args.sql_out), results)


if __name__ == "__main__":
    main()
