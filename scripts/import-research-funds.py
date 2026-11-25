#!/usr/bin/env python3
# Migration 378: the fund directory and its reports, rebuilt from the two public
# spreadsheets in `attached_assets/` (D535). `parse_shai` reads the third list
# from a CSV with that sheet's shape; `fixtures/shai-goldman-sample.csv` is the
# fixture. Those rows are US cents under the list's own name (1A) and are not
# written into migration 378. Since D7166 (#7166) the EuroTech list is keyed by
# vehicle (manager plus fund number) and `eurotech-migration STEM` writes its
# re-import as a new migration; run with no argument it refuses, because 378 is
# applied.
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

The third list (Shai Goldman, "$M USD") is `parse_shai`. Currency is 1A: the
list's name is the currency, and there is no new column. Those rows are not
folded into migration 378, which is already applied. `shai_upsert_sql` emits
the uid-keyed upserts a later migration would apply.
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


_MILLIONS_RE = re.compile(r'\d\s*m\s*$', re.IGNORECASE)


def euro_cents_exact(value: str | None) -> int | None:
    """Column 67 ("€1,375,000,000.00") is full euros, not millions.

    D7166 (#7166): on the sheet's newer rows column 67 holds the shorthand
    ("€ 121m") instead. Read as full euros that stored a millionth of the size
    (Angular Ventures III: €121m as 12100 cents, 232 rows), so a value ending
    in 'm' is millions, like column 5.
    """
    if value and _MILLIONS_RE.search(value.strip()):
        return euro_cents_from_millions(value)
    amount = parse_amount(value)
    return round(amount * 100) if amount is not None else None  # EUR -> cents


def vehicle_uid(manager: str, fund_number: str | None) -> str:
    """D7166 (#7166): one row per vehicle, keyed by manager plus fund number.

    'Dawn Capital' + 'V' is `dawncapital-v`; a row with no fund number keeps
    the manager's own key (`dawncapital`). The same two inputs always give
    the same uid, so a re-import never moves a vehicle.
    """
    number = normalized(fund_number or '')
    return f'{normalized(manager)}-{number}' if number else normalized(manager)


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


def parse_euro(today: date, moves: dict[str, str] | None = None) -> tuple[dict[str, dict], dict[str, dict], int]:
    """Returns (directory_by_uid, reports_by_(uid,period), raw_row_count).

    D7166 (#7166): keyed by vehicle (`vehicle_uid`), so a manager's Fund V and
    its Opportunity fund are two rows, each with its own reports. `moves`, when
    given, receives each manager key migration 378 used whose vehicle now has
    another uid: the vehicle 378's row showed, which is the fund number on the
    manager's first sheet row (378 never updated the number).
    """
    with EURO.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    directory: dict[str, dict] = {}
    reports: dict[tuple[str, str], dict] = {}
    for row in rows[1:]:
        name = (row[0] if row else '').strip()
        if not name:
            continue
        hq = FLAG_RE.sub('', row[3] if len(row) > 3 else '').strip() or None
        fund_number = (row[4] if len(row) > 4 else '').strip() or None
        uid = vehicle_uid(name, fund_number)
        if moves is not None and normalized(name) not in moves:
            moves[normalized(name)] = uid
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
            'source_name': EURO_SOURCE, 'source_url': EURO_URL,
        })
        # The vehicle's row with the latest period wins its "current" snapshot,
        # every field of it (D7166), not only the size and date.
        if uid in directory and period and (not item.get('quarter') or period > item['quarter']):
            item.update({
                'fund_size_cents': size_cents, 'fund_date': report_date, 'quarter': period, 'hq': hq,
                'website': (row[1] if len(row) > 1 else '').strip() or None,
                'linkedin': (row[2] if len(row) > 2 else '').strip() or None,
                'sector_focus': (row[9] if len(row) > 9 else '').strip() or None,
                'notable_lps': (row[10] if len(row) > 10 else '').strip() or None,
                'eif_flag': lp_flags(row[10] if len(row) > 10 else '')[0],
                'eifo_flag': lp_flags(row[10] if len(row) > 10 else '')[1],
            })
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
    if moves is not None:
        for key in [k for k, v in moves.items() if k == v or k in directory]:
            del moves[key]
    return directory, reports, len(rows) - 1


# D597's source_name, byte for byte, so a row joins research_fund_sources.
SHAI_SOURCE = 'Shai Goldman \u2014 new VC funds at/below $200M'
SHAI_URL = 'https://docs.google.com/spreadsheets/d/1ebGZ6-ivf_3woBGC4Kz_3217DhjGsefoRu_5iP3nuFQ/edit'
_EMAIL_RE = re.compile(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}')
SHAI_FILE_NAME = 'shai-goldman-new-vc-funds.csv'
EURO_SOURCE = 'EuroTech VC Funds (public spreadsheet)'
DEEP_SOURCE = 'Deep Tech Investors Mapping (public spreadsheet)'
# D597 (migration 413): the lists the Worker still serves. The third list
# defers only to these. A firm known only from a list that is not served
# (Deep Tech, "not allowed") would otherwise vanish from the directory: its
# row is withheld, and the third list would have skipped it.
SERVED_SOURCES = frozenset({EURO_SOURCE})
SHAI = ASSETS / SHAI_FILE_NAME
_USD_M_RE = re.compile(r'\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?')


def usd_cents_from_millions(value: str | None) -> int | None:
    """'$160' is 160 million US dollars, in cents. Anything else is not a size.

    The sheet's column is 'Amount Raised $M USD'. A cell that is not that
    shape ('93/3', a totals label) is left unset rather than guessed.
    """
    if not value:
        return None
    text = value.strip()
    if not _USD_M_RE.fullmatch(text):
        return None
    amount = parse_amount(text)
    return round(amount * 100_000_000) if amount is not None else None


def parse_us_date(value: str | None) -> str | None:
    """US sheet dates: M/D/YYYY, or M/YYYY when no day was recorded."""
    if not value:
        return None
    text = value.strip()
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', text)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None
    m = re.fullmatch(r'(\d{1,2})/(\d{4})', text)
    if m:
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return f'{year}-{month:02d}-01'
    return None


def shai_year(value: str | None) -> int | None:
    if not value:
        return None
    text = value.strip()
    return int(text) if re.fullmatch(r'(?:19|20)\d{2}', text) else None


def quarter_of(iso: str | None, year: int | None) -> str | None:
    if iso and re.match(r'^\d{4}-\d{2}-\d{2}$', iso):
        y, month, _ = iso.split('-')
        return f'{y}-Q{(int(month) - 1) // 3 + 1}'
    if year:
        return f'{year}-Q4'
    return None


def parse_shai(directory: dict[str, dict], path: Path, defer_to: frozenset[str] | None = None) -> int:
    """Add the third list. A firm already in `directory` is left as it is.

    `defer_to`, when given, narrows that to firms whose row comes from one of
    those lists: a firm known only from another list is added from this one,
    and a row with the same uid is replaced (#1081, D597).

    The sheet's grain is one raise: the same firm can have Fund I and Fund II.
    Those stay two rows when the firm is not already in the directory. The uid
    is the normalized name plus the fund number. Rows above the 'Fund Name'
    header, and the totals row under the list, are not funds.
    """
    with path.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    header_at = next((i for i, row in enumerate(rows) if any(cell.strip() == 'Fund Name' for cell in row)), None)
    if header_at is None:
        raise ValueError('the sheet has no Fund Name header')
    header = [cell.strip() for cell in rows[header_at]]

    def index(label: str) -> int:
        try:
            return header.index(label)
        except ValueError as exc:
            raise ValueError(f'the sheet has no {label} column') from exc

    i_name, i_amt = index('Fund Name'), index('Amount Raised $M USD')
    i_date, i_year = index('Date announced and or Raised'), index('Year Raised')
    i_num, i_loc = index('Fund Number'), index('Location')

    def cell(row: list[str], idx: int) -> str:
        return row[idx].strip() if idx < len(row) else ''

    # A firm is known by its manager key, whichever vehicle row holds it
    # (D7166 keys EuroTech by vehicle, so `dawncapital-v` is Dawn Capital).
    managers: dict[str, dict] = {}
    for item in directory.values():
        managers.setdefault(normalized(item.get('name') or ''), item)
    added = 0
    for row in rows[header_at + 1:]:
        name = cell(row, i_name)
        amount = cell(row, i_amt)
        if not name or name.casefold() == 'year raised' or amount.casefold() == 'millions usd':
            continue
        if _EMAIL_RE.search(name):
            continue
        known = directory.get(normalized(name)) or managers.get(normalized(name))
        if known is not None and (defer_to is None or known.get('source_name') in defer_to):
            continue
        number = cell(row, i_num) or None
        # 'I' is a letter, not a word inside the firm name. Match it as its own token.
        already = bool(number) and re.search(
            rf'(?<![A-Za-z0-9]){re.escape(number)}(?![A-Za-z0-9])', name, re.IGNORECASE,
        )
        shown = name if not number or already else f'{name} {number}'
        uid = normalized(shown)
        held = directory.get(uid)
        if held is not None and (defer_to is None or held.get('source_name') in defer_to or held.get('source_name') == SHAI_SOURCE):
            continue
        announced = parse_us_date(cell(row, i_date))
        year = shai_year(cell(row, i_year))
        if year is None and announced:
            year = int(announced[:4])
        directory[uid] = {
            'uid': uid, 'name': shown,
            'website': None, 'linkedin': None,
            'hq': cell(row, i_loc) or None, 'fund_number': number,
            'fund_size_cents': usd_cents_from_millions(amount),
            'fund_date': announced, 'quarter': quarter_of(announced, year),
            'sector_focus': None, 'notable_lps': None,
            'eif_flag': False, 'eifo_flag': False,
            'source_name': SHAI_SOURCE, 'source_url': SHAI_URL,
        }
        added += 1
    return added


def shai_upsert_sql(directory: dict[str, dict], as_of: str) -> str:
    """Uid-keyed upserts for the third list only. Does not write a migration file."""
    lines = [
        '-- D535 — the Shai Goldman list, uid-keyed. fund_size_cents is US cents;',
        '-- the list name is the currency (1A). Not part of migration 378.',
    ]
    items = [directory[uid] for uid in sorted(directory) if directory[uid].get('source_name') == SHAI_SOURCE]
    for item in items:
        year_m = re.match(r'^(\d{4})', item.get('quarter') or '')
        fund_year = int(year_m.group(1)) if year_m else None
        lines.append(
            'INSERT OR REPLACE INTO research_fund_directory '
            '(uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) '
            'VALUES (%s);' % ','.join(map(sql, [
                item['uid'], item['name'], item['website'], item['linkedin'], item['hq'], item['fund_number'],
                item['fund_size_cents'], item['fund_date'], item['quarter'], fund_year,
                item['sector_focus'], item['notable_lps'], item['eif_flag'], item['eifo_flag'],
                item['source_name'], item['source_url'], as_of,
            ]))
        )
    return '\n'.join(lines) + '\n'


# The columns `parse_shai` reads, in the sheet's order. The committed copy of
# the third list keeps these and nothing else (#1081, S10).
SHAI_COLUMNS = (
    'Fund Name', 'Amount Raised $M USD', 'Date announced and or Raised',
    'Year Raised', 'Fund Number', 'Location',
)
_PERSON_LINK_RE = re.compile(r'(twitter\.com|x\.com|linkedin\.com/in)/', re.IGNORECASE)


def clean_shai_csv(raw: str) -> str:
    """The third list as it may be committed: no personal data.

    The export's rows above the 'Fund Name' header are the author's notes, with
    his email, X handle and LinkedIn; they are dropped. Its 'Notes' column links
    to individual people's posts and is never read; it is dropped with every
    other column `parse_shai` does not use. A kept row whose cells hold an email
    or a link to a person is dropped too, so nothing personal survives a change
    in the sheet. The result parses exactly as the raw export does.
    """
    rows = list(csv.reader(raw.splitlines()))
    header_at = next((i for i, row in enumerate(rows) if any(cell.strip() == 'Fund Name' for cell in row)), None)
    if header_at is None:
        raise ValueError('the sheet has no Fund Name header')
    header = [cell.strip() for cell in rows[header_at]]
    try:
        keep = [header.index(label) for label in SHAI_COLUMNS]
    except ValueError as exc:
        raise ValueError(f'the sheet is missing a column the importer reads: {exc}') from exc

    out: list[list[str]] = [list(SHAI_COLUMNS)]
    for row in rows[header_at + 1:]:
        cells = [row[i].strip() if i < len(row) else '' for i in keep]
        if not any(cells):
            continue
        if any(_EMAIL_RE.search(c) or _PERSON_LINK_RE.search(c) for c in cells):
            continue
        out.append(cells)
    buf: list[str] = []
    for cells in out:
        line = []
        for c in cells:
            line.append('"%s"' % c.replace('"', '""') if any(ch in c for ch in ',"\n') else c)
        buf.append(','.join(line))
    return '\n'.join(buf) + '\n'


def write_shai_migration(directory: dict[str, dict], out: Path, number: str, as_of: str) -> int:
    """Write the third list's uid-keyed upserts as migration `number` at `out`.

    `number` is the migration's name as its header and the source note cite
    it: migration 429's number when it was written, a D4106 stem from the CLI
    since D8605. The importer never picks one. Returns how many rows it writes.
    """
    body = shai_upsert_sql(directory, as_of)
    header = (
        f'-- {number} — the third fund list, "{SHAI_SOURCE}" (D535, #1081).\n'
        '-- Generated by scripts/import-research-funds.py from\n'
        f'-- attached_assets/{SHAI_FILE_NAME}, the export without its notes, its Notes\n'
        '-- column or any personal data. fund_size_cents is US cents: the list name\n'
        '-- is the currency (1A).\n'
        '--\n'
        "-- Production already held this list's rows from an import that was never in\n"
        '-- the repository, under uids nothing here can reproduce. They are removed\n'
        '-- first, with any report rows (D1 does not enforce the cascade in a batch),\n'
        "-- so this list's rows become exactly the ones written below and can be\n"
        "-- rebuilt from the repository. No other list's rows are deleted.\n"
        '--\n'
        '-- A firm already in a served list (EuroTech) is not written. A Deep Tech\n'
        '-- row with the same uid is replaced: D597 (migration 413) withholds Deep\n'
        '-- Tech, so without this the firm would be shown by no list.\n'
        '-- Re-runnable: the same deletes, then uid-keyed INSERT OR REPLACE.\n'
        '-- A reviewed Network link whose fund is no longer listed is set to\n'
        '-- needs_review (D8605).\n'
    )
    bridge = '\n'.join(bridge_statements(with_moves=False)) + '\n'
    purge = (
        'DELETE FROM research_fund_directory_reports WHERE fund_uid IN '
        '(SELECT uid FROM research_fund_directory WHERE source_name = %s);\n'
        'DELETE FROM research_fund_directory WHERE source_name = %s;\n' % (sql(SHAI_SOURCE), sql(SHAI_SOURCE))
    )
    # D597 (migration 413) recorded the list's repo copy as not committed.
    # This migration commits it, so the source row says where it is now.
    trailer = (
        'UPDATE research_fund_sources SET repo_copy = %s, repo_copy_note = %s WHERE source_name = %s;\n' % (
            sql(f'attached_assets/{SHAI_FILE_NAME}'),
            sql('The export without its notes, its Notes column or any personal data (scripts/import-research-funds.py shai-clean). '
                f'Migration {number} imported it.'),
            sql(SHAI_SOURCE),
        )
    )
    out.write_text(header + purge + body + bridge + trailer)
    return body.count('INSERT OR REPLACE')


def _directory_insert(item: dict, as_of: str) -> str:
    year_m = re.match(r'^(\d{4})', item.get('quarter') or '')
    fund_year = int(year_m.group(1)) if year_m else None
    return (
        'INSERT OR REPLACE INTO research_fund_directory '
        '(uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) '
        'VALUES (%s);' % ','.join(map(sql, [
            item['uid'], item['name'], item['website'], item['linkedin'], item['hq'], item['fund_number'],
            item['fund_size_cents'], item['fund_date'], item['quarter'], fund_year,
            item['sector_focus'], item['notable_lps'], item['eif_flag'], item['eifo_flag'],
            item['source_name'], item['source_url'], as_of,
        ]))
    )


MOVES_TABLE = 'research_fund_directory_uid_moves'
# The columns that hold a directory uid, and the filter each needs. Each is
# remapped through the moves table, so a saved fund, a raise prospect or a
# project subject keeps the vehicle it named.
UID_REFERENCES = (
    ('research_funds', 'catalogue_uid', ''),
    ('raise_prospects', 'research_fund_uid', ''),
    ('research_project_subjects', 'directory_uid', "kind = 'fund' AND "),
)


BRIDGE_TABLE = 'network_directory_research_links'


def bridge_statements(with_moves: bool) -> list[str]:
    """D8605 (#8605): keep the Network-to-Research bridge honest after a list import.

    The bridge holds a fund uid as a plain reference, so a re-import never fails
    on it. A link is never silently re-pointed: a uid move can turn a manager
    key into a vehicle row, so every moved link is set to `needs_review`, and a
    withdrawn link stays withdrawn.

    With `with_moves`, a link whose fund uid is gone and has a recorded move is
    carried to the new uid, but only when that uid is listed, holds no link yet,
    and no other link on a gone uid moves onto it, so the bridge's unique index
    can never fail the migration. Then, for every import, a reviewed link whose
    fund is no longer in the catalogue (not carried, or its row left the list)
    is set to `needs_review`. Both statements are correct on an empty bridge and
    on a replay. They need the bridge, so a file carrying them must sort after
    BRIDGE_READY_STAMP (`is_bridge_ready_stem`).
    """
    b = BRIDGE_TABLE
    gone = f'NOT EXISTS (SELECT 1 FROM research_fund_directory d WHERE d.uid = {b}.fund_directory_uid)'
    gone_l = 'NOT EXISTS (SELECT 1 FROM research_fund_directory d3 WHERE d3.uid = l.fund_directory_uid)'
    lines = []
    if with_moves:
        target = f'(SELECT m.new_uid FROM {MOVES_TABLE} m WHERE m.old_uid = {b}.fund_directory_uid)'
        lines.append(
            f"UPDATE {b} SET fund_directory_uid = {target}, "
            f"status = CASE status WHEN 'withdrawn' THEN 'withdrawn' ELSE 'needs_review' END "
            f'WHERE {gone} '
            f'AND EXISTS (SELECT 1 FROM research_fund_directory d2 WHERE d2.uid = {target}) '
            f'AND NOT EXISTS (SELECT 1 FROM {b} o WHERE o.fund_directory_uid = {target}) '
            f'AND (SELECT COUNT(*) FROM {b} l JOIN {MOVES_TABLE} m2 ON m2.old_uid = l.fund_directory_uid '
            f'WHERE {gone_l} AND m2.new_uid = {target}) = 1;'
        )
    lines.append(f"UPDATE {b} SET status = 'needs_review' WHERE status = 'reviewed' AND fund_directory_uid IS NOT NULL AND {gone};")
    return lines


def is_migration_stem(text: str) -> bool:
    """A D4106 migration stem: UTC minute, issue number, slug."""
    return re.fullmatch(r'\d{12}_\d+_[a-z0-9_]+', text) is not None


# D8605: the migration that makes the bridge's Research uids plain and adds
# `needs_review`. A list import carries `bridge_statements`, so it must run
# after it: a numbered file, or a stem stamped at or before this minute, sorts
# earlier and would break every fresh schema build.
BRIDGE_READY_STAMP = '202611251148'


def is_bridge_ready_stem(text: str) -> bool:
    """A D4106 stem that sorts after the bridge migration (D8605)."""
    return is_migration_stem(text) and text[:12] > BRIDGE_READY_STAMP


def eurotech_vehicle_migration(today: date, stem: str, bridge: bool = True) -> tuple[str, dict]:
    """D7166 (#7166): the EuroTech list again, one row per vehicle, sizes fixed.

    Returns the migration text and its counts. Only EuroTech rows and their
    reports are replaced; every other list is left as it is. Each manager key
    migration 378 used whose vehicle now has another uid is recorded in
    `research_fund_directory_uid_moves`, and the columns that hold a directory
    uid are moved with it.

    `bridge` (D8605) adds the Network link statements and their header lines.
    Migration 202611180052_7166 was written before the bridge existed, so it is
    reproduced with `bridge=False`; every list import written from now on keeps
    the default.
    """
    moves: dict[str, str] = {}
    directory, reports, rows = parse_euro(today, moves)
    as_of = today.isoformat()
    src = sql(EURO_SOURCE)
    lines = [
        f'-- {stem} — the EuroTech fund list re-imported, one row per vehicle (D7166, #7166).',
        '-- Generated by scripts/import-research-funds.py eurotech-migration from',
        f'-- attached_assets/{EURO.name}, as of {as_of}.',
        '--',
        '-- 1. One row per vehicle. Migration 378 keyed the list by manager, so a',
        "--    manager's funds were one row (Dawn Capital V merged into Opp) and its",
        "--    reports drew different vehicles as one fund's size over time. Rows are",
        '--    now keyed by manager plus fund number (`dawncapital-v`); a row with no',
        "--    fund number keeps the manager's key.",
        "-- 2. Sizes. The sheet writes newer rows' exact-euro column as '€ 121m';",
        '--    378 read that as full euros, a millionth of the size. It is millions.',
        "-- 3. Moves. Each 378 uid that no longer names a row maps to the vehicle 378's",
        '--    row showed, and every saved reference to it is moved with it.',
        *([
            '-- 4. Network links (D8605). A link on a moved uid is carried and set to',
            "--    needs_review; a reviewed link whose fund is gone is set to needs_review.",
        ] if bridge else []),
        '--',
        "-- Only this list's rows and reports are replaced. Re-runnable: the same",
        '-- deletes, uid-keyed upserts, and updates that find nothing left to move.',
        f'CREATE TABLE IF NOT EXISTS {MOVES_TABLE} (old_uid TEXT PRIMARY KEY, new_uid TEXT NOT NULL, moved_on TEXT NOT NULL);',
    ]
    for old in sorted(moves):
        lines.append(f'INSERT OR REPLACE INTO {MOVES_TABLE} (old_uid,new_uid,moved_on) VALUES ({sql(old)},{sql(moves[old])},{sql(as_of)});')
    lines.append(f'DELETE FROM research_fund_directory_reports WHERE fund_uid IN (SELECT uid FROM research_fund_directory WHERE source_name = {src});')
    lines.append(f'DELETE FROM research_fund_directory WHERE source_name = {src};')
    for uid in sorted(directory):
        lines.append(_directory_insert(directory[uid], as_of))
    for (uid, period) in sorted(reports):
        r = reports[(uid, period)]
        lines.append(
            'INSERT OR REPLACE INTO research_fund_directory_reports '
            '(fund_uid,period,report_date,fund_size_cents,source_url) VALUES (%s);' % ','.join(map(sql, [
                r['fund_uid'], r['period'], r['report_date'], r['fund_size_cents'], r['source_url'],
            ]))
        )
    for table, column, extra in UID_REFERENCES:
        lines.append(
            f'UPDATE {table} SET {column} = (SELECT m.new_uid FROM {MOVES_TABLE} m WHERE m.old_uid = {table}.{column}) '
            f'WHERE {extra}{column} IN (SELECT old_uid FROM {MOVES_TABLE} '
            'WHERE old_uid NOT IN (SELECT uid FROM research_fund_directory));'
        )
    if bridge:
        lines.extend(bridge_statements(with_moves=True))
    counts = {'rows_read': rows, 'vehicles': len(directory), 'reports': len(reports), 'moves': len(moves)}
    return '\n'.join(lines) + '\n', counts


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
            'source_name': DEEP_SOURCE, 'source_url': DEEP_URL,
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


def shai_directory(today: date) -> tuple[dict[str, dict], int, int]:
    """The directory the third list's migration is written from: EuroTech and
    Deep Tech first, then the third list's rows no served list holds. Returns
    it with the row count before the third list and how many it added."""
    directory, _reports, _rows = parse_euro(today)
    parse_deep(directory)
    before = len(directory)
    added = parse_shai(directory, SHAI, defer_to=SERVED_SOURCES)
    return directory, before, added


def main_shai(argv: list[str]) -> None:
    """`shai-clean RAW` writes the committable copy to attached_assets/;
    `shai-migration STEM` writes migration STEM from it, and
    `eurotech-migration STEM` the EuroTech list. A STEM is a D4106 name stamped
    after the bridge migration (D8605): both migrations carry its statements.
    None touches migration 378, and none reads or writes a database."""
    if argv[0] == 'shai-clean' and len(argv) == 2:
        SHAI.write_text(clean_shai_csv(Path(argv[1]).read_text(encoding='utf-8-sig')))
        print('shai_clean_written', SHAI.relative_to(ROOT))
        return
    if argv[0] == 'shai-migration' and len(argv) == 2 and is_bridge_ready_stem(argv[1]):
        directory, before, added = shai_directory(date.today())
        out = ROOT / 'cloudflare-worker/sql/migrations' / f'{argv[1]}.sql'
        written = write_shai_migration(directory, out, argv[1], date.today().isoformat())
        print('directory_rows_before', before)
        print('shai_rows_added', added)
        print('shai_rows_written', written)
        print('migration', out.relative_to(ROOT))
        return
    if argv[0] == 'eurotech-migration' and len(argv) == 2 and is_bridge_ready_stem(argv[1]):
        text, counts = eurotech_vehicle_migration(date.today(), argv[1])
        out = ROOT / 'cloudflare-worker/sql/migrations' / f'{argv[1]}.sql'
        out.write_text(text)
        for key, value in counts.items():
            print(key, value)
        print('migration', out.relative_to(ROOT))
        return
    raise SystemExit(f'usage: import-research-funds.py [shai-clean RAW_CSV | shai-migration STEM | eurotech-migration STEM]; a STEM is stamped after {BRIDGE_READY_STAMP} (D8605)')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        main_shai(sys.argv[1:])
    else:
        # Migration 378 is applied and never rewritten. D7166 re-imports the
        # EuroTech list with `eurotech-migration STEM` instead.
        raise SystemExit('migration 378 is applied; use eurotech-migration STEM (D7166)')
