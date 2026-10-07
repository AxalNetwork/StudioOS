"""Issue #1081 (D535) — unit coverage for scripts/import-research-funds.py.

Covers the two bugs the issue named in migration 365's generator
(`import-eurotech-funds.py`) and pins that this importer's output is
idempotent. Mutation-checked: each assertion was verified to fail against
the pre-fix parser/date logic before being written against the fix.

`unittest` (stdlib) rather than `pytest`, which isn't installed in this
sandbox; `python3 -m unittest` runs it directly and pytest (used by the
`backend/` suite elsewhere in this repo) can also collect unittest-style
tests, so this stays runnable either way.
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent / 'import-research-funds.py'
spec = importlib.util.spec_from_file_location('import_research_funds', MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
sys.modules['import_research_funds'] = mod
spec.loader.exec_module(mod)  # type: ignore[union-attr]


class ParseAmountTests(unittest.TestCase):
    def test_thousands_comma_is_not_a_decimal_point(self):
        # The bug: the old parser read "€ 1,375m" as 1.375 (comma treated as
        # decimal point). It must read as 1375 — the comma is a thousands
        # separator, matching the sheet's own exact-euro column for the same
        # fund ("€1,375,000,000.00" = 1375 million).
        self.assertEqual(mod.parse_amount('€ 1,375m'), 1375.0)

    def test_plain_value_with_no_thousands_separator(self):
        self.assertEqual(mod.parse_amount('€ 49m'), 49.0)

    def test_decimal_point_is_still_a_decimal_point(self):
        self.assertEqual(mod.parse_amount('€ 45.5m'), 45.5)

    def test_empty_and_none(self):
        self.assertIsNone(mod.parse_amount(''))
        self.assertIsNone(mod.parse_amount(None))

    def test_euro_cents_from_millions_matches_known_fund(self):
        # EQT Growth: stored as €2.4m by the old (buggy) importer; the
        # sheet's own exact-euro column for the same fund confirms €2,400m.
        self.assertEqual(mod.euro_cents_from_millions('€ 2,400m'), 240_000_000_000)

    def test_euro_cents_exact_parses_the_sheets_own_precise_column(self):
        self.assertEqual(mod.euro_cents_exact('€1,375,000,000.00'), 137_500_000_000)


class ReportDateTests(unittest.TestCase):
    def test_day_month_year_format(self):
        self.assertEqual(mod.parse_report_date('10 Jul 24'), '2024-07-10')

    def test_month_dash_year_format(self):
        self.assertEqual(mod.parse_report_date('7-2024'), '2024-07-01')

    def test_unparseable_is_none(self):
        self.assertIsNone(mod.parse_report_date('not a date'))
        self.assertIsNone(mod.parse_report_date(''))


class PeriodForTests(unittest.TestCase):
    def test_quarter_and_year(self):
        self.assertEqual(mod.period_for('Q3 24', '2024'), '2024-Q3')

    def test_year_only_falls_back_to_q4(self):
        self.assertEqual(mod.period_for('', '2020'), '2020-Q4')

    def test_neither_is_none(self):
        self.assertIsNone(mod.period_for('', ''))


class FutureDatedReportTests(unittest.TestCase):
    """The bug: migration 365's generator turned every non-blank annual
    column (including the current, not-yet-finished year) into a report
    dated `{year}-12-31` — 75 rows ended up dated after "today" at
    generation time. `parse_euro` takes `today` as an explicit argument
    precisely so this is testable without waiting for a real calendar date.
    """

    def test_no_annual_derived_report_is_dated_after_today(self):
        # A row's own explicitly reported date (from the sheet's "Month"
        # column) is real sheet data and can legitimately be any date the
        # sheet contains — that's not the bug. The bug was specifically the
        # *derived* `{year}-12-31` dates synthesized from the blank annual
        # columns (2016..2026): one of those, for the still-open current
        # year, is necessarily in the future. Pin "today" a few months
        # before a year-end to make that reproducible without waiting for a
        # real calendar date, and check only the derived Q4 observations.
        today = date(2026, 6, 1)
        _, reports, _ = mod.parse_euro(today)
        annual_derived_future = [
            r for r in reports.values()
            if r['period'].endswith('-Q4') and r['period'].split('-')[0] == '2026'
            and (r.get('report_date') or '') > today.isoformat()
        ]
        self.assertEqual(
            annual_derived_future, [],
            f'{len(annual_derived_future)} derived 2026-Q4 report(s) dated after {today.isoformat()}',
        )

    def test_a_years_report_is_included_once_that_year_has_passed(self):
        # Sanity check the fix isn't just suppressing everything: with
        # "today" set past 2022, at least one 2022-dated annual observation
        # must still appear (positive control for the filter above).
        today = date(2023, 1, 1)
        _, reports, _ = mod.parse_euro(today)
        has_2022 = any((r.get('report_date') or '').startswith('2022') for r in reports.values())
        self.assertTrue(has_2022, 'expected at least one 2022 report once 2022 has passed')


class IdempotencyTests(unittest.TestCase):
    def test_running_twice_produces_byte_identical_migration_output(self):
        today = date(2026, 10, 4)
        directory1, reports1, _ = mod.parse_euro(today)
        deep_added1 = mod.parse_deep(directory1)
        directory2, reports2, _ = mod.parse_euro(today)
        deep_added2 = mod.parse_deep(directory2)
        self.assertEqual(directory1, directory2)
        self.assertEqual(reports1, reports2)
        self.assertEqual(deep_added1, deep_added2)

    def test_deep_tech_rows_never_overwrite_a_matched_eurotech_row(self):
        today = date(2026, 10, 4)
        directory, _, _ = mod.parse_euro(today)
        before = dict(directory)
        mod.parse_deep(directory)
        for uid, item in before.items():
            self.assertEqual(directory[uid], item, f'{uid} was overwritten by a Deep Tech row')

    def test_deep_tech_only_rows_carry_no_eur_figure(self):
        # Deep Tech sizes are in USD; writing one into fund_size_cents
        # (documented and consumed as EUR) would be a silent currency bug.
        today = date(2026, 10, 4)
        directory, _, _ = mod.parse_euro(today)
        matched_uids = set(directory)
        mod.parse_deep(directory)
        deep_only = {uid: item for uid, item in directory.items() if uid not in matched_uids}
        self.assertTrue(deep_only, 'expected at least one Deep-Tech-only row to test')
        for item in deep_only.values():
            self.assertIsNone(item['fund_size_cents'])


FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'shai-goldman-sample.csv'


class ShaiListTests(unittest.TestCase):
    """The third list, on a fixture with the sheet's shape (D535, currency 1A).

    The real export is not in the repo: the rows above its header name a
    person. This fixture keeps that shape, including a notes line, two
    vintages of one firm, a dollar amount with a thousands separator, a
    size that is not a dollar amount, a month-only date, and the totals row.
    """

    def test_dollar_millions_are_us_cents_and_a_non_amount_is_unset(self):
        self.assertEqual(mod.usd_cents_from_millions('$160'), 16_000_000_000)
        self.assertEqual(mod.usd_cents_from_millions('$7.5'), 750_000_000)
        self.assertEqual(mod.usd_cents_from_millions('$4,100'), 410_000_000_000)
        self.assertIsNone(mod.usd_cents_from_millions('93/3'))
        self.assertIsNone(mod.usd_cents_from_millions('Millions USD'))
        self.assertIsNone(mod.usd_cents_from_millions(''))

    def test_dates_are_the_sheets_us_order(self):
        self.assertEqual(mod.parse_us_date('1/5/2026'), '2026-01-05')
        self.assertEqual(mod.parse_us_date('10/2014'), '2014-10-01')
        self.assertIsNone(mod.parse_us_date('not a date'))
        self.assertIsNone(mod.shai_year('$82'))
        self.assertEqual(mod.shai_year('2026'), 2026)

    def test_the_fixture_keeps_two_vintages_and_drops_the_preamble_and_the_totals(self):
        directory: dict = {}
        added = mod.parse_shai(directory, FIXTURE)
        self.assertEqual(added, 6)
        names = {item['name'] for item in directory.values()}
        self.assertEqual(names, {
            'Example Ventures II', 'Example Ventures I', 'Northwind Capital I',
            'Plain Amount III', 'Odd Size III', 'Month Only I',
        })
        newer = directory['exampleventuresii']
        self.assertEqual(newer['fund_size_cents'], 16_000_000_000)
        self.assertEqual(newer['fund_date'], '2026-01-05')
        self.assertEqual(newer['quarter'], '2026-Q1')
        self.assertEqual(newer['hq'], 'NYC')
        self.assertEqual(newer['fund_number'], 'II')
        self.assertEqual(newer['source_name'], mod.SHAI_SOURCE)
        self.assertEqual(newer['source_url'], mod.SHAI_URL)
        self.assertIsNone(directory['oddsizeiii']['fund_size_cents'])
        self.assertEqual(directory['plainamountiii']['fund_size_cents'], 410_000_000_000)
        self.assertEqual(directory['monthonlyi']['fund_date'], '2014-10-01')
        self.assertEqual(directory['monthonlyi']['quarter'], '2014-Q4')
        blob = repr(directory)
        self.assertNotIn('founder@example.test', blob)
        self.assertNotIn('year raised', blob.casefold())

    def test_a_firm_already_in_the_directory_is_not_replaced(self):
        kept = {
            'uid': 'exampleventures', 'name': 'Example Ventures',
            'fund_size_cents': 100, 'source_name': 'EuroTech VC Funds (public spreadsheet)',
        }
        directory = {'exampleventures': dict(kept)}
        added = mod.parse_shai(directory, FIXTURE)
        self.assertEqual(directory['exampleventures'], kept)
        self.assertNotIn('exampleventuresii', directory)
        self.assertNotIn('exampleventuresi', directory)
        # The other firms are still added. Example Ventures' two rows are not.
        self.assertEqual(added, 4)

    def test_running_twice_adds_nothing_the_second_time(self):
        directory: dict = {}
        first = mod.parse_shai(directory, FIXTURE)
        snapshot = {uid: dict(item) for uid, item in directory.items()}
        second = mod.parse_shai(directory, FIXTURE)
        self.assertGreater(first, 0)
        self.assertEqual(second, 0)
        self.assertEqual(directory, snapshot)

    def test_the_upsert_is_uid_keyed_and_carries_us_cents(self):
        directory: dict = {}
        mod.parse_shai(directory, FIXTURE)
        sql_text = mod.shai_upsert_sql(directory, '2026-10-07')
        self.assertIn('INSERT OR REPLACE INTO research_fund_directory', sql_text)
        self.assertEqual(sql_text.count('INSERT OR REPLACE'), 6)
        self.assertIn("'exampleventuresii'", sql_text)
        self.assertIn('16000000000', sql_text)
        self.assertIn(mod.SHAI_SOURCE, sql_text)
        self.assertIn("'2026'", sql_text)
        self.assertNotIn('founder@example.test', sql_text)
        self.assertNotIn('migration 378', sql_text.split('\n', 2)[-1])



FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'shai-goldman-sample.csv'
# The export's shape around its personal data: notes above the header with a
# contact, and a Notes column linking to a person's post. All of it invented.
RAW_WITH_PEOPLE = (
    ',,,\n'
    ',sorted by year raised as this is a resource for founders,,\n'
    '"DM to add, or email someone@example.test",,,\n'
    'Linkedin https://www.linkedin.com/in/someone/,,,\n'
    ' ,Fund Name,Amount Raised $M USD,Date announced and or Raised,Year Raised,Fund Number,Location,Notes\n'
    '1,Example Ventures,$160,1/5/2026,2026,II,NYC,https://twitter.com/someone/status/1\n'
    '2,"Comma, Capital","$4,100",4/1/2021,2021,III,SF,\n'
    '3,Mail Fund someone@example.test,$10,1/1/2020,2020,I,LA,\n'
    '4,Linked Fund https://x.com/someone,$12,1/1/2020,2020,I,LA,\n'
    ',,,,,,,\n'
)


class ShaiCleanTests(unittest.TestCase):
    """The committable copy of the third list (#1081, S10): no personal data,
    and it parses exactly as the raw export does."""

    def test_only_the_columns_the_importer_reads_survive(self):
        clean = mod.clean_shai_csv(RAW_WITH_PEOPLE)
        self.assertEqual(clean.splitlines()[0], ','.join(mod.SHAI_COLUMNS))
        self.assertNotIn('Notes', clean)
        self.assertNotIn('twitter.com', clean)

    def test_the_notes_above_the_header_are_dropped(self):
        clean = mod.clean_shai_csv(RAW_WITH_PEOPLE)
        self.assertNotIn('DM to add', clean)
        self.assertNotIn('sorted by year raised', clean, 'a note with no contact in it is still not a fund')
        self.assertNotIn('linkedin.com', clean)

    def test_a_row_carrying_an_email_or_a_person_link_is_dropped(self):
        clean = mod.clean_shai_csv(RAW_WITH_PEOPLE)
        self.assertNotIn('@', clean)
        self.assertNotIn('x.com', clean)
        self.assertNotIn('Mail Fund', clean)
        self.assertNotIn('Linked Fund', clean)

    def test_quoted_cells_survive_and_blank_rows_go(self):
        clean = mod.clean_shai_csv(RAW_WITH_PEOPLE)
        self.assertEqual(clean.splitlines(), [
            ','.join(mod.SHAI_COLUMNS),
            'Example Ventures,$160,1/5/2026,2026,II,NYC',
            '"Comma, Capital","$4,100",4/1/2021,2021,III,SF',
        ])

    def test_the_clean_copy_parses_exactly_as_the_raw_export(self):
        import tempfile
        raw = FIXTURE.read_text(encoding='utf-8-sig')
        with tempfile.TemporaryDirectory() as tmp:
            clean_path = Path(tmp) / 'clean.csv'
            clean_path.write_text(mod.clean_shai_csv(raw))
            a, b = {}, {}
            self.assertEqual(mod.parse_shai(a, FIXTURE), mod.parse_shai(b, clean_path))
            self.assertEqual(a, b)
            self.assertGreater(len(a), 0)

    def test_a_sheet_without_a_column_the_importer_reads_is_refused(self):
        with self.assertRaises(ValueError):
            mod.clean_shai_csv('Fund Name,Location\nA,NYC\n')


class ShaiMigrationTests(unittest.TestCase):
    def test_the_migration_names_its_number_and_holds_one_upsert_per_added_row(self):
        import tempfile
        directory: dict = {}
        added = mod.parse_shai(directory, FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / '999_x.sql'
            written = mod.write_shai_migration(directory, out, '999', '2026-10-07')
            text = out.read_text()
        self.assertEqual(written, added)
        self.assertTrue(text.startswith('-- 999 — the third fund list'))
        self.assertEqual(text.count('INSERT OR REPLACE INTO research_fund_directory '), added)
        self.assertNotIn('@', text)

    def test_the_migration_is_byte_identical_on_a_second_run(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            outs = []
            for i in range(2):
                directory: dict = {}
                mod.parse_shai(directory, FIXTURE)
                out = Path(tmp) / f'{i}.sql'
                mod.write_shai_migration(directory, out, '999', '2026-10-07')
                outs.append(out.read_text())
        self.assertEqual(outs[0], outs[1])

    def test_the_cli_refuses_a_number_that_is_not_one(self):
        for good in ('413', '0426', '999'):
            self.assertTrue(mod.is_migration_number(good), good)
        for bad in ('378; DROP', '42', '12345', '41a', ''):
            self.assertFalse(mod.is_migration_number(bad), bad)
        with self.assertRaises(SystemExit):
            mod.main_shai(['shai-migration', '378; DROP'])



class ShaiDefersOnlyToServedListsTests(unittest.TestCase):
    """D597 (migration 413) withholds Deep Tech. A firm known only from it must
    come from the third list, or it is shown by no list at all (#1081)."""

    @staticmethod
    def row(uid, source):
        return {'uid': uid, 'name': uid, 'source_name': source, 'fund_size_cents': None}

    def test_only_eurotech_is_served(self):
        self.assertEqual(mod.SERVED_SOURCES, frozenset({mod.EURO_SOURCE}))
        self.assertNotIn(mod.DEEP_SOURCE, mod.SERVED_SOURCES)

    def test_a_firm_known_only_from_deep_tech_is_added_from_the_third_list(self):
        key = mod.normalized('Northwind Capital')
        directory = {key: self.row(key, mod.DEEP_SOURCE)}
        mod.parse_shai(directory, FIXTURE, defer_to=mod.SERVED_SOURCES)
        shown = [v for v in directory.values() if v['source_name'] == mod.SHAI_SOURCE and v['name'].startswith('Northwind')]
        self.assertEqual(len(shown), 1, 'the Deep Tech row hid the third list\'s fund')

    def test_a_firm_from_eurotech_is_still_left_as_it_is(self):
        key = mod.normalized('Northwind Capital')
        directory = {key: self.row(key, mod.EURO_SOURCE)}
        mod.parse_shai(directory, FIXTURE, defer_to=mod.SERVED_SOURCES)
        self.assertEqual(directory[key]['source_name'], mod.EURO_SOURCE)
        self.assertFalse(any(v['name'].startswith('Northwind') and v['source_name'] == mod.SHAI_SOURCE for v in directory.values()))

    def test_a_deep_tech_row_with_the_same_uid_is_replaced(self):
        directory: dict = {}
        mod.parse_shai(directory, FIXTURE)
        uid = next(u for u, v in directory.items() if v['name'].startswith('Northwind'))
        target = {uid: self.row(uid, mod.DEEP_SOURCE)}
        mod.parse_shai(target, FIXTURE, defer_to=mod.SERVED_SOURCES)
        self.assertEqual(target[uid]['source_name'], mod.SHAI_SOURCE)

    def test_without_defer_to_every_known_firm_is_still_skipped(self):
        key = mod.normalized('Northwind Capital')
        directory = {key: self.row(key, mod.DEEP_SOURCE)}
        mod.parse_shai(directory, FIXTURE)
        self.assertFalse(any(v['source_name'] == mod.SHAI_SOURCE and v['name'].startswith('Northwind') for v in directory.values()))

    def test_the_migration_entry_point_defers_to_the_served_lists(self):
        src = MODULE_PATH.read_text()
        self.assertIn('added = parse_shai(directory, SHAI, defer_to=SERVED_SOURCES)', src)


if __name__ == '__main__':
    unittest.main()
