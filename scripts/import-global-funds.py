#!/usr/bin/env python3
"""D7325: validate cited manager facts and render a repeatable worldwide seed.

Offline only. Reads the pinned, committed catalogue migrations; never contacts
or writes D1. The JSON is the reviewed input, not a scrape of a fund directory.
Run --check to compare the generated migration without changing any file.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'cloudflare-worker/sql/migrations'
MANIFEST = ROOT / 'data/research-funds/global-managers-2026-11-18.json'
SOURCE = 'Axal VC — verified fund manager websites'
BASELINE = (
    '378_research_fund_directory_rebuild.sql',
    '406_research_fund_sources.sql',
    '413_research_fund_source_terms_review.sql',
    '429_research_fund_directory_shai_list.sql',
    '202611180052_7166_research_fund_directory_vehicles.sql',
)
COUNTRIES = {
    'United States': ('US', 'North America'), 'Canada': ('CA', 'North America'),
    'Mexico': ('MX', 'Latin America'), 'Brazil': ('BR', 'Latin America'),
    'Argentina': ('AR', 'Latin America'), 'Chile': ('CL', 'Latin America'),
    'Colombia': ('CO', 'Latin America'), 'Peru': ('PE', 'Latin America'),
    'Ecuador': ('EC', 'Latin America'), 'Uruguay': ('UY', 'Latin America'),
    'Paraguay': ('PY', 'Latin America'), 'Bolivia': ('BO', 'Latin America'),
    'Costa Rica': ('CR', 'Latin America'), 'Panama': ('PA', 'Latin America'),
    'Guatemala': ('GT', 'Latin America'), 'Puerto Rico': ('PR', 'Latin America'),
    'Dominican Republic': ('DO', 'Latin America'), 'Jamaica': ('JM', 'Latin America'),
    'United Kingdom': ('GB', 'Europe'), 'Ireland': ('IE', 'Europe'),
    'France': ('FR', 'Europe'), 'Germany': ('DE', 'Europe'),
    'Switzerland': ('CH', 'Europe'), 'Austria': ('AT', 'Europe'),
    'Spain': ('ES', 'Europe'), 'Portugal': ('PT', 'Europe'), 'Italy': ('IT', 'Europe'),
    'Netherlands': ('NL', 'Europe'), 'Belgium': ('BE', 'Europe'),
    'Luxembourg': ('LU', 'Europe'), 'Sweden': ('SE', 'Europe'),
    'Denmark': ('DK', 'Europe'), 'Norway': ('NO', 'Europe'),
    'Finland': ('FI', 'Europe'), 'Iceland': ('IS', 'Europe'),
    'Estonia': ('EE', 'Europe'), 'Latvia': ('LV', 'Europe'), 'Lithuania': ('LT', 'Europe'),
    'Poland': ('PL', 'Europe'), 'Czechia': ('CZ', 'Europe'), 'Slovakia': ('SK', 'Europe'),
    'Hungary': ('HU', 'Europe'), 'Romania': ('RO', 'Europe'), 'Bulgaria': ('BG', 'Europe'),
    'Croatia': ('HR', 'Europe'), 'Slovenia': ('SI', 'Europe'), 'Serbia': ('RS', 'Europe'),
    'North Macedonia': ('MK', 'Europe'), 'Bosnia and Herzegovina': ('BA', 'Europe'),
    'Albania': ('AL', 'Europe'), 'Montenegro': ('ME', 'Europe'),
    'Greece': ('GR', 'Europe'), 'Cyprus': ('CY', 'Europe'), 'Malta': ('MT', 'Europe'),
    'Ukraine': ('UA', 'Europe'), 'Moldova': ('MD', 'Europe'), 'Turkey': ('TR', 'Europe'),
    'Armenia': ('AM', 'Asia'), 'Georgia': ('GE', 'Asia'), 'Azerbaijan': ('AZ', 'Asia'),
    'Israel': ('IL', 'Middle East'), 'United Arab Emirates': ('AE', 'Middle East'),
    'Saudi Arabia': ('SA', 'Middle East'), 'Bahrain': ('BH', 'Middle East'),
    'Qatar': ('QA', 'Middle East'), 'Kuwait': ('KW', 'Middle East'),
    'Oman': ('OM', 'Middle East'), 'Jordan': ('JO', 'Middle East'),
    'Lebanon': ('LB', 'Middle East'), 'Iraq': ('IQ', 'Middle East'),
    'Palestine': ('PS', 'Middle East'),
    'Egypt': ('EG', 'Africa'), 'Morocco': ('MA', 'Africa'), 'Tunisia': ('TN', 'Africa'),
    'Algeria': ('DZ', 'Africa'), 'Nigeria': ('NG', 'Africa'), 'Ghana': ('GH', 'Africa'),
    'Senegal': ('SN', 'Africa'), "Côte d'Ivoire": ('CI', 'Africa'),
    'Kenya': ('KE', 'Africa'), 'Uganda': ('UG', 'Africa'), 'Tanzania': ('TZ', 'Africa'),
    'Rwanda': ('RW', 'Africa'), 'Ethiopia': ('ET', 'Africa'),
    'South Africa': ('ZA', 'Africa'), 'Zambia': ('ZM', 'Africa'),
    'Zimbabwe': ('ZW', 'Africa'), 'Botswana': ('BW', 'Africa'), 'Namibia': ('NA', 'Africa'),
    'Mauritius': ('MU', 'Africa'), 'Cameroon': ('CM', 'Africa'), 'Benin': ('BJ', 'Africa'),
    'India': ('IN', 'Asia'), 'Pakistan': ('PK', 'Asia'), 'Bangladesh': ('BD', 'Asia'),
    'Sri Lanka': ('LK', 'Asia'), 'Nepal': ('NP', 'Asia'), 'Kazakhstan': ('KZ', 'Asia'),
    'Uzbekistan': ('UZ', 'Asia'), 'Mongolia': ('MN', 'Asia'),
    'China': ('CN', 'Asia'), 'Hong Kong': ('HK', 'Asia'), 'Taiwan': ('TW', 'Asia'),
    'Japan': ('JP', 'Asia'), 'South Korea': ('KR', 'Asia'),
    'Singapore': ('SG', 'Asia'), 'Malaysia': ('MY', 'Asia'), 'Indonesia': ('ID', 'Asia'),
    'Philippines': ('PH', 'Asia'), 'Thailand': ('TH', 'Asia'), 'Vietnam': ('VN', 'Asia'),
    'Cambodia': ('KH', 'Asia'), 'Laos': ('LA', 'Asia'),
    'Australia': ('AU', 'Oceania'), 'New Zealand': ('NZ', 'Oceania'),
}


def normalized(value: str) -> str:
    value = unicodedata.normalize('NFKD', value)
    return re.sub(r'[^a-z0-9]', '', value.lower())


def manager_name(value: str) -> str:
    # Shai's rows include a vehicle suffix; EuroTech keeps it in fund_number.
    value = re.sub(r'\s+(?:fund\s+)?(?:[IVX]{1,7}|\d{1,2})\s*$', '', value, flags=re.I)
    return normalized(value)


def manager_keys(value: str) -> set[str]:
    # "Fund" may be part of the manager's actual name (Savannah Fund II).
    # Match both the manager-name reading and the ordinary "Name Fund II"
    # vehicle reading, just as the apply-time guard does.
    numeral_only = re.sub(r'\s+(?:[IVX]{1,7}|\d{1,2})\s*$', '', value, flags=re.I)
    return {manager_name(value), normalized(numeral_only)}


def host(value: str) -> str:
    if not value:
        return ''
    parsed = urlsplit(value if '://' in value else 'https://' + value)
    return (parsed.hostname or '').lower().removeprefix('www.').rstrip('.')


def valid_url(value: object) -> bool:
    if not isinstance(value, str) or any(c.isspace() for c in value):
        return False
    parsed = urlsplit(value)
    return (parsed.scheme in ('http', 'https') and bool(parsed.hostname)
            and parsed.username is None and parsed.password is None
            and bool(re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', parsed.hostname.lower())))


def validate(rows: object) -> list[dict]:
    if not isinstance(rows, list) or not rows:
        raise ValueError('manifest must be a nonempty array')
    names, domains = set(), set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('every row must be an object')
        name = row.get('name')
        if not isinstance(name, str) or not name.strip() or len(name) > 180:
            raise ValueError('name must be nonempty and at most 180 characters')
        if not normalized(name):
            raise ValueError('name needs an ASCII letter or digit for a stable manager UID; use a sourced romanized name')
        for field in ('website', 'source_url'):
            if not valid_url(row.get(field)):
                raise ValueError(f'{name}: invalid {field}')
        if row.get('hq_country') is not None and row['hq_country'] not in COUNTRIES:
            raise ValueError(f'{name}: unknown headquarters country {row["hq_country"]!r}')
        for field in ('sector_focus', 'stage', 'cheque_range'):
            if row.get(field) is not None and (not isinstance(row[field], str) or not row[field].strip()):
                raise ValueError(f'{name}: {field} must be text or null')
        if not isinstance(row.get('region'), str) or not row['region']:
            raise ValueError(f'{name}: research region is required')
        try:
            date.fromisoformat(row['verified_on'])
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f'{name}: invalid verified_on') from exc
        aliases = row.get('aliases', [])
        if not isinstance(aliases, list) or any(not isinstance(a, str) or not a.strip() for a in aliases):
            raise ValueError(f'{name}: aliases must be nonempty strings')
        evidence = row.get('evidence')
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f'{name}: primary-source evidence is required')
        for item in evidence:
            if not isinstance(item, dict) or not valid_url(item.get('url')) or not isinstance(item.get('claim'), str) or not item['claim'].strip():
                raise ValueError(f'{name}: each evidence item needs a URL and factual claim')
        if row['source_url'] not in {e['url'] for e in evidence}:
            raise ValueError(f'{name}: source_url must have a corresponding evidence item')
        official_host = host(row['website'])
        if not any(host(e['url']) == official_host or host(e['url']).endswith('.' + official_host) for e in evidence):
            raise ValueError(f'{name}: evidence from the manager website is required')
        key, domain = normalized(name), host(row['website'])
        if key in names or domain in domains:
            raise ValueError(f'{name}: duplicate name or manager website in manifest')
        names.add(key)
        domains.add(domain)
    return sorted(rows, key=lambda row: (normalized(row['name']), row['website']))


def baseline() -> list[dict]:
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    # Only the reference columns needed by the vehicle import. No user data.
    db.executescript('''CREATE TABLE research_funds(uid TEXT,owner_user_id INTEGER,name TEXT,catalogue_uid TEXT);
        CREATE TABLE raise_prospects(id INTEGER,research_fund_uid TEXT);
        CREATE TABLE research_project_subjects(id INTEGER,project_id INTEGER,kind TEXT,directory_uid TEXT);''')
    for filename in BASELINE:
        db.executescript((MIGRATIONS / filename).read_text())
    rows = [dict(r) for r in db.execute('''SELECT d.* FROM research_fund_directory d
        WHERE NOT EXISTS (SELECT 1 FROM research_fund_sources s
        WHERE s.source_name=d.source_name AND s.verdict='not allowed')''')]
    db.close()
    return rows


def select_new(rows: list[dict], existing: list[dict]) -> tuple[list[dict], list[dict]]:
    accepted, skipped = [], []
    by_name, by_host = {}, {}

    def register(record: dict) -> None:
        for label in [record['name'], *record.get('aliases', [])]:
            for key in manager_keys(label):
                by_name.setdefault(key, set()).add(record['uid'])
        if record.get('website'):
            by_host.setdefault(host(record['website']), set()).add(record['uid'])

    for record in existing:
        register(record)
    for row in rows:
        keys = set().union(*(manager_keys(a) for a in [row['name'], *row.get('aliases', [])]))
        matches = set(by_host.get(host(row['website']), set()))
        for key in keys:
            matches.update(by_name.get(key, set()))
        if matches:
            skipped.append({'name': row['name'], 'existing_uids': sorted(matches)})
        else:
            accepted.append(row)
            register({**row, 'uid': uid(row)})
    return accepted, skipped


def uid(row: dict) -> str:
    key = normalized(row['name'])
    if len(key) > 57:
        key = key[:46] + '-' + hashlib.sha256(key.encode()).hexdigest()[:10]
    return 'global-' + key


def sql(value: object) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def canonical_focus(value: str | None) -> str | None:
    """Format cited classifications for the existing comma-separated crosswalk.

    Only spelling-equivalent labels are converted. Broad labels such as
    Healthcare remain broad; they are never inferred to mean Digital Health.
    """
    if value is None:
        return None
    aliases = {
        'artificial intelligence': 'AI', 'ai / ml': 'AI/ML',
        'climatetech': 'climate tech', 'agritech': 'agri tech', 'agtech': 'agri tech',
        'agrifood': 'agri food', 'edtech': 'ed tech', 'proptech': 'prop tech',
        'contech': 'construction tech', 'health tech': 'healthtech',
        'digital healthcare': 'digital health', 'defensetech': 'defense tech',
        'defencetech': 'defence tech',
    }
    tokens = [t.strip() for t in re.split('[;,·]', value) if t.strip()]
    return ', '.join(dict.fromkeys(aliases.get(t.lower(), t) for t in tokens)) or None


RUNTIME_PUNCTUATION = " .-'&_/(),"


def runtime_name(value: str) -> str:
    # SQLite lower() folds ASCII; Python casefold() would promise more than it can do.
    value = value.translate(str.maketrans('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
    return ''.join(c for c in value if c not in RUNTIME_PUNCTUATION)


def duplicate_guard(row: dict) -> str:
    name_expr = 'lower(d.name)'
    for char in RUNTIME_PUNCTUATION:
        name_expr = f'replace({name_expr},{sql(char)},\'\')'
    names = sorted({runtime_name(n) for n in [row['name'], *row.get('aliases', [])]})
    domain = host(row['website'])
    authority = "replace(replace(lower(trim(coalesce(d.website,''))),'https://',''),'http://','')"
    website_expr = f"rtrim(CASE WHEN substr({authority},1,4)='www.' THEN substr({authority},5) ELSE {authority} END,'/')"
    # urlsplit() treats a trailing DNS dot and explicit port as the same host.
    # A dot is only equivalent at the host boundary, never before another label.
    host_matches = ' OR '.join(
        f"f.website_host={sql(form)} OR f.website_host GLOB {sql(form + '[/?#:]*')}"
        for form in (domain, domain + '.')
    )
    keys = sql(json.dumps(names, ensure_ascii=False))
    suffix = 'substr(f.name_key,length(n.base)+1)'
    # A Shai-style display name can include Fund II even when fund_number is
    # absent. Require a whitespace-separated final numeral, not a fuzzy prefix.
    return ("NOT EXISTS (SELECT 1 FROM (SELECT d.source_name,lower(trim(d.name)) AS display_name,\n"
            f"  {name_expr} AS name_key,{website_expr} AS website_host FROM research_fund_directory d) f\n"
            "  WHERE NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name=f.source_name AND s.verdict='not allowed')\n"
            f"  AND ({host_matches}\n"
            f"    OR f.name_key IN ({','.join(sql(n) for n in names)})\n"
            f"    OR EXISTS (SELECT 1 FROM (SELECT value AS base FROM json_each({keys})\n"
            f"      UNION ALL SELECT value || 'fund' AS base FROM json_each({keys})) n\n"
            "      WHERE substr(f.name_key,1,length(n.base))=n.base\n"
            f"      AND ((length({suffix}) BETWEEN 1 AND 7 AND {suffix} NOT GLOB '*[^ivx]*')\n"
            f"        OR (length({suffix}) BETWEEN 1 AND 2 AND {suffix} NOT GLOB '*[^0-9]*'))\n"
            f"      AND substr(f.display_name,-(length({suffix})+1))=' ' || {suffix})))")


def render(rows: list[dict], stem: str, existing: list[dict], manifest_repo_path: str = 'data/research-funds/global-managers-2026-11-18.json') -> tuple[str, dict]:
    if not re.fullmatch(r'\d{12}_7325_[a-z0-9_]+', stem):
        raise ValueError('migration stem must be YYYYMMDDHHMM_7325_slug')
    accepted, skipped = select_new(validate(rows), existing)
    reviewed = max(r['verified_on'] for r in rows)
    path = manifest_repo_path
    lines = [
        '-- D7325 (#7325): independently verified worldwide fund managers.',
        f'-- Generated by scripts/import-global-funds.py from {path}.',
        '-- Manager records have no claimed vehicle, fund size, vintage or LP data.',
        '-- Existing served managers/vehicles win by name, aliases or website host.',
        '-- A retired manager UID is never revived; its canonical redirect survives replay.',
        '-- Source-specific withheld rows remain withheld; independent evidence is separately cited.',
        '-- published_url is NULL so each fund cites its own source_url.',
        '-- Additive and replay-safe; no existing record or later source verdict is overwritten.',
        '',
        'INSERT OR IGNORE INTO research_fund_sources',
        '(source_name,title,publisher,published_url,terms_status,terms_quote,evidence_url,evidence,verdict,verdict_reason,reviewed_on,repo_copy,repo_copy_note)',
        'VALUES (' + ','.join(sql(v) for v in (
            SOURCE, 'Official manager websites — verified identities', 'Fund managers; compiled by Axal VC',
            None, 'not found', None, 'https://github.com/AxalNetwork/StudioOS/blob/main/' + path,
            'Individually retrieved manager-owned pages. Per-record evidence URLs and brief factual paraphrases are preserved in the source manifest. Headquarters is recorded only where supported; investment geography is not headquarters.',
            'cite only', 'Cited factual identities and classifications only. No website text, performance claims or permission to republish a source are implied; individual website reuse terms have not been established.',
            reviewed, path, 'Original research manifest; not a copy of a third-party fund directory. Stage and cheque evidence is retained for review, not imported into unsupported directory fields.',
        )) + ');', '',
    ]
    base_countries = (MIGRATIONS / '376_research_taxonomy.sql').read_text()
    for country in sorted({r['hq_country'] for r in accepted if r.get('hq_country')}):
        code, region = COUNTRIES[country]
        lines.append('INSERT OR IGNORE INTO research_countries (code,name,region) VALUES ('
                     + ','.join(sql(v) for v in (code, country, region)) + ');')
        # Existing countries already have exact aliases. New countries use the
        # existing override store, preserving any later manually pinned mapping.
        if f"('{code}'," not in base_countries:
            # Overrides are keyed by the original raw string, before normalization.
            raw = country
            lines.append("INSERT OR IGNORE INTO research_taxonomy_overrides (kind,raw_value,target,note) SELECT "
                         + ','.join(sql(v) for v in ('fund_hq', raw, code, 'D7325: exact country name from cited manager headquarters.'))
                         + f" WHERE NOT EXISTS (SELECT 1 FROM research_taxonomy_overrides WHERE kind='fund_hq' AND raw_value={sql(raw)});")
    lines.append('')
    for row in accepted:
        values = (uid(row), row['name'], row['website'], None, row.get('hq_country'),
                  None, None, None, None, None, canonical_focus(row.get('sector_focus')), None, 0, 0,
                  SOURCE, row['source_url'], row['verified_on'])
        lines.extend([
            'INSERT OR IGNORE INTO research_fund_directory',
            '(uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of)',
            'SELECT ' + ','.join(sql(v) for v in values),
            'WHERE ' + duplicate_guard(row)
            + f"\nAND NOT EXISTS (SELECT 1 FROM research_fund_directory_uid_moves WHERE old_uid={sql(uid(row))});", '',
        ])
    report = {'verified': len(rows), 'new_managers': len(accepted), 'existing_managers': skipped,
              'regions': {region: sum(r['region'] == region for r in accepted) for region in sorted({r['region'] for r in accepted})},
              'recorded_hq': sum(r.get('hq_country') is not None for r in accepted),
              'recorded_sector': sum(r.get('sector_focus') is not None for r in accepted)}
    return '\n'.join(lines), report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=MANIFEST)
    parser.add_argument('--stem', required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        manifest_repo_path = args.manifest.resolve().relative_to(ROOT).as_posix()
        output, report = render(json.loads(args.manifest.read_text()), args.stem, baseline(), manifest_repo_path)
        report['baseline_migrations'] = list(BASELINE)
        report['comparison_scope'] = 'Pinned served catalogue only; apply-time guards may further reduce additions.'
        target = MIGRATIONS / (args.stem + '.sql')
        if args.check:
            if not target.exists() or target.read_text() != output:
                raise ValueError('committed migration differs from verified manifest output')
        else:
            if target.exists() and target.read_text() != output:
                raise ValueError('refusing to rewrite a migration; use a new stem')
            target.write_text(output)
        if args.report:
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False))
    except (ValueError, OSError, sqlite3.Error) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
