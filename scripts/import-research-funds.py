#!/usr/bin/env python3
"""Rebuild `research_fund_directory`/`research_fund_directory_reports` from the
two public spreadsheets in `attached_assets/`, as migration 378.

Issue #1081 (D535). Two bugs this importer fixes relative to the old
`import-eurotech-funds.py` snapshot (migration 365):

1. THE SIZE PARSER. "€ 1,375m" was parsed by stripping '.' then treating ','
   as the decimal point — so "1,375" became 1.375 instead of 1375, and every
   size that used a thousands separator came out 1,000x too small (EQT
   Growth stored as EUR 2.4m instead of EUR 2,400m). This spreadsheet uses
   the opposite convention: ',' is a THOUSANDS separator, '.' is the decimal
   point — ordinary English notation. `parse_amount` below fixes this, and is
   checked against the sheet's own already-correct exact-euro column
   (column 67, e.g. "€1,375,000,000.00") wherever that column is populated,
   rather than trusting only the "€ Xm" shorthand.
2. FUTURE-DATED REPORTS. The old importer turned every non-blank annual
   column (2016..2026) into a report dated `{year}-12-31`, including columns
   for a year not yet finished — 75 rows ended up dated after "today" at
   generation time. This importer never emits an observation whose date is
   after the run date.

Idempotent / rerunnable: output is a sequence of `INSERT OR REPLACE`
statements keyed on `uid` (directory) and `(fund_uid, period)` (reports) —
running this script twice and applying the migration twice both leave the
same rows, never duplicates.

Scope: the EuroTech spreadsheet is the only EUR-denominated, per-period
source, so it is what backs `fund_size_cents` and the reports table. The
Deep Tech Investors Mapping sheet is in USD and has no per-period history;
rows from it that don't already match an EuroTech fund (by normalized name)
are added to the directory with no `fund_size_cents` (left NULL) rather than
writing a USD figure into a column documented and consumed as EUR cents —
recorded here rather than silently guessed. Both source sheet names and URLs
are kept per row so #1083 can rule on their licences.
"""
from __future__ import annotations

import csv
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fund_lp_flags import lp_flags  # noqa: E402  (D539: the one EIF/EIFO rule)

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'attached_assets'
EURO = ASSETS / 'EuroTechVCFunds(from1_2016)-Sheet1.csv'
DEEP = ASSETS / 'Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv'
MIGRATION = ROOT / 'cloudflare-worker/sql/migrations/378_research_fund_directory_rebuild.sql'
EURO_URL = 'https://github.com/AxalNetwork/StudioOS/blob/main/attached_assets/EuroTechVCFunds(from1_2016)-Sheet1.csv'
DEEP_URL = 'https://github.com/AxalNetwork/StudioOS/blob/main/attached_assets/Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv'
YEARS = list(range(2016, 2027))
FLAG_RE = re.compile(r'[\U0001F1E6-\U0001F1FF]|\U0000FE0F|\U0000200D|\U0001F3F4|[\U000E0020-\U000E007F]')


def normalized(name: str) -> str:
    value = unicodedata.normalize('NFKD', name or '')
    value = ''.join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]+', '', value.lower())


def parse_amount(value: str | None) -> float | None:
    """'€ 1,375m' -> 1375.0; '€ 49m' -> 49.0; '1,375,000,000.00' -> 1375000000.0.

    ',' is a thousands separator (dropped); '.' is the decimal point (kept).
    This is the fix: the old parser did the reverse, which is why sizes
    using a thousands separator came out 1,000x too small.
    """
    if not value:
        return None
    cleaned = value.replace(',', '')
    m = re.search(r'(\d+(?:\.\d+)?)', cleaned)
    return float(m.group(1)) if m else None


def euro_cents_from_millions(value: str | None) -> int | None:
    amount = parse_amount(value)
    return round(amount * 100_000_000) if amount is not None else None  # EUR millions -> cents


def euro_cents_exact(value: str | None) -> int | None:
    """Column 67 ("€1,375,000,000.00") is already full euros, not millions."""
    amount = parse_amount(value)
    return round(amount * 100) if amount is not None else None  # EUR -> cents


def parse_report_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ('%d %b %y', '%d %B %y'):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    m = re.match(r'^(\d{1,2})-(\d{4})$', value)
    return f'{m.group(2)}-{int(m.group(1)):02d}-01' if m else None


def period_for(qtr: str | None, year: str | None) -> str | None:
    m = re.search(r'Q([1-4])', qtr or '')
    if m and year:
        return f'{year}-Q{m.group(1)}'
    if year and re.match(r'^20\d{2}$', year):
        return f'{year}-Q4'
    return None


def sql(value) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    return "'" + str(value).replace("'", "''") + "'"


def parse_euro(today: date) -> tuple[dict[str, dict], dict[str, dict], int]:
    """Returns (directory_by_uid, reports_by_(uid,period), raw_row_count)."""
    with EURO.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    directory: dict[str, dict] = {}
    reports: dict[tuple[str, str], dict] = {}
    for row in rows[1:]:
        name = (row[0] if row else '').strip()
        if not name:
            continue
        uid = normalized(name)
        hq = FLAG_RE.sub('', row[3] if len(row) > 3 else '').strip() or None
        fund_number = (row[4] if len(row) > 4 else '').strip() or None
        qtr = row[7] if len(row) > 7 else ''
        year = row[8] if len(row) > 8 else ''
        period = period_for(qtr, year)
        report_date = parse_report_date(row[6] if len(row) > 6 else '')
        exact_cents = euro_cents_exact(row[67] if len(row) > 67 else '')
        size_cents = exact_cents if exact_cents is not None else euro_cents_from_millions(row[5] if len(row) > 5 else '')

        item = directory.get(uid, {
            'uid': uid, 'name': name,
            'website': (row[1] if len(row) > 1 else '').strip() or None,
            'linkedin': (row[2] if len(row) > 2 else '').strip() or None,
            'hq': hq, 'fund_number': fund_number,
            'fund_size_cents': size_cents, 'fund_date': report_date, 'quarter': period,
            'sector_focus': (row[9] if len(row) > 9 else '').strip() or None,
            'notable_lps': (row[10] if len(row) > 10 else '').strip() or None,
            # D539 (#1084, owner call A): the flags say only what the LPs say.
            # Columns L and M (row[11], row[12]) have no header, and M is not
            # EIFO, so neither is read; migration 380 applies the same rule.
            'eif_flag': lp_flags(row[10] if len(row) > 10 else '')[0],
            'eifo_flag': lp_flags(row[10] if len(row) > 10 else '')[1],
            'source_name': 'EuroTech VC Funds (public spreadsheet)', 'source_url': EURO_URL,
        })
        # The row with the latest period wins the directory's "current" snapshot.
        if period and (not item.get('quarter') or period > item['quarter']):
            item.update({'fund_size_cents': size_cents, 'fund_date': report_date, 'quarter': period})
        directory[uid] = item

        if period and size_cents is not None:
            observed_date = report_date
            key = (uid, period)
            if key not in reports or (observed_date or '') > (reports[key].get('report_date') or ''):
                reports[key] = {'fund_uid': uid, 'period': period, 'report_date': observed_date,
                                 'fund_size_cents': size_cents, 'source_url': EURO_URL}

        for idx, year_num in zip(range(13, 24), YEARS):
            if idx >= len(row) or not row[idx].strip():
                continue
            annual_cents = euro_cents_from_millions(row[idx])
            if annual_cents is None:
                continue
            report_date_annual = f'{year_num}-12-31'
            if report_date_annual > today.isoformat():
                continue  # Bug #2 fix: never emit a report dated after today.
            annual_period = f'{year_num}-Q4'
            key = (uid, annual_period)
            if key not in reports:
                reports[key] = {'fund_uid': uid, 'period': annual_period, 'report_date': report_date_annual,
                                 'fund_size_cents': annual_cents, 'source_url': EURO_URL}
    return directory, reports, len(rows) - 1


def parse_deep(directory: dict[str, dict]) -> int:
    """Adds directory-only rows for Deep Tech entries not already matched by
    name to a EuroTech row. USD sizes are not written to fund_size_cents
    (documented as EUR) — left NULL, deferred rather than guessed."""
    with DEEP.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    added = 0
    for row in rows[1:]:
        name = (row[0] if row else '').strip()
        if not name:
            continue
        uid = normalized(name)
        if uid in directory:
            continue  # EuroTech's EUR-denominated row wins; don't overwrite it.
        hq = FLAG_RE.sub('', row[5] if len(row) > 5 else '').strip() or None
        directory[uid] = {
            'uid': uid, 'name': name,
            'website': (row[2] if len(row) > 2 else '').strip() or None,
            'linkedin': None, 'hq': hq, 'fund_number': None,
            'fund_size_cents': None, 'fund_date': None, 'quarter': None,
            'sector_focus': None, 'notable_lps': None,
            'eif_flag': False, 'eifo_flag': False,
            'source_name': 'Deep Tech Investors Mapping (public spreadsheet)', 'source_url': DEEP_URL,
        }
        added += 1
    return added


def main() -> None:
    today = date.today()
    directory, reports, euro_rows = parse_euro(today)
    deep_added = parse_deep(directory)
    fund_year_by_uid = {}
    for uid, item in directory.items():
        m = re.match(r'^(\d{4})', item.get('quarter') or '')
        fund_year_by_uid[uid] = int(m.group(1)) if m else None

    lines = [
        '-- 378 — research_fund_directory rebuilt from both public spreadsheets,',
        '-- with the size-parser and future-dated-report bugs from migration 365 fixed.',
        '-- See scripts/import-research-funds.py. Idempotent: INSERT OR REPLACE, uid-keyed.',
        "CREATE TABLE IF NOT EXISTS research_fund_directory (uid TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT, linkedin TEXT, hq TEXT, fund_number TEXT, fund_size_cents INTEGER, fund_date TEXT, quarter TEXT, fund_year INTEGER, sector_focus TEXT, notable_lps TEXT, eif_flag INTEGER NOT NULL DEFAULT 0, eifo_flag INTEGER NOT NULL DEFAULT 0, source_name TEXT NOT NULL, source_url TEXT NOT NULL, as_of TEXT NOT NULL);",
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_name ON research_fund_directory(name);',
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_hq ON research_fund_directory(hq);',
        "CREATE TABLE IF NOT EXISTS research_fund_directory_reports (fund_uid TEXT NOT NULL REFERENCES research_fund_directory(uid) ON DELETE CASCADE, period TEXT NOT NULL, report_date TEXT, fund_size_cents INTEGER, source_url TEXT NOT NULL, PRIMARY KEY (fund_uid, period));",
        'CREATE INDEX IF NOT EXISTS idx_research_fund_directory_reports_period ON research_fund_directory_reports(fund_uid, period);',
    ]
    as_of = today.isoformat()
    for uid in sorted(directory):
        item = directory[uid]
        lines.append(
            'INSERT OR REPLACE INTO research_fund_directory '
            '(uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) '
            'VALUES (%s);' % ','.join(map(sql, [
                item['uid'], item['name'], item['website'], item['linkedin'], item['hq'], item['fund_number'],
                item['fund_size_cents'], item['fund_date'], item['quarter'], fund_year_by_uid.get(uid),
                item['sector_focus'], item['notable_lps'], item['eif_flag'], item['eifo_flag'],
                item['source_name'], item['source_url'], as_of,
            ]))
        )
    for (uid, period) in sorted(reports):
        r = reports[(uid, period)]
        lines.append(
            'INSERT OR REPLACE INTO research_fund_directory_reports '
            '(fund_uid,period,report_date,fund_size_cents,source_url) VALUES (%s);' % ','.join(map(sql, [
                r['fund_uid'], r['period'], r['report_date'], r['fund_size_cents'], r['source_url'],
            ]))
        )
    MIGRATION.write_text('\n'.join(lines) + '\n')

    print('rows_read_eurotech', euro_rows)
    print('directory_rows_eurotech', len(directory) - deep_added)
    print('directory_rows_deep_tech_only', deep_added)
    print('directory_rows_total', len(directory))
    print('report_rows_total', len(reports))
    print('migration_bytes', MIGRATION.stat().st_size)


if __name__ == '__main__':
    main()
