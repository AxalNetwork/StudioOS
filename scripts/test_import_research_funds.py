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


if __name__ == '__main__':
    unittest.main()
