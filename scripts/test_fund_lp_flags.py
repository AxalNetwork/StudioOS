"""D539 (#1084) — the EIF/EIFO matcher (`scripts/fund_lp_flags.py`), and its
agreement with migration 380's SQL.

Run: python3 -m unittest scripts/test_fund_lp_flags.py
"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
import unittest
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fund_lp_flags import lp_flags  # noqa: E402

spec = importlib.util.spec_from_file_location('import_research_funds', HERE / 'import-research-funds.py')
importer = importlib.util.module_from_spec(spec)
sys.modules['import_research_funds'] = importer
spec.loader.exec_module(importer)  # type: ignore[union-attr]

MIGRATIONS = HERE.parent / 'cloudflare-worker' / 'sql' / 'migrations'
SQL_380 = next(MIGRATIONS.glob('380_*.sql')).read_text(encoding='utf-8')


class MatcherTests(unittest.TestCase):
    def test_the_issues_table(self):
        cases = {
            'EIFO': (False, True),
            'European Investment Fund (EIF), CDP': (True, False),
            'EIF, EIFO': (True, True),
            'Seifert Capital': (False, False),
            'EIFFEL': (False, False),
            '': (False, False),
        }
        for lps, want in cases.items():
            self.assertEqual(lp_flags(lps), want, lps)
        self.assertEqual(lp_flags(None), (False, False))

    def test_the_spreadsheets_eifo_spellings(self):
        for lps in ['Export and Investment Fund of Denmark', 'Export and Investment Fund (EIFO)',
                    'Denmark’s Export and Investment Fund (EIFO)']:
            self.assertEqual(lp_flags(lps), (False, True), lps)

    def test_a_token_needs_no_letter_beside_it(self):
        self.assertEqual(lp_flags('EIF-backed'), (True, False))
        self.assertEqual(lp_flags('(EIF)'), (True, False))
        self.assertEqual(lp_flags('XEIF'), (False, False))
        self.assertEqual(lp_flags('european investment fund'), (True, False), 'the full name in any case')


class AgreesWithMigration380(unittest.TestCase):
    def test_380_changes_nothing_on_the_fixed_importers_output(self):
        directory, _reports, _n = importer.parse_euro(date(2026, 10, 4))
        self.assertGreater(len(directory), 1000)
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE research_fund_directory (uid TEXT PRIMARY KEY, notable_lps TEXT, '
                   'eif_flag INTEGER NOT NULL DEFAULT 0, eifo_flag INTEGER NOT NULL DEFAULT 0, source_name TEXT NOT NULL)')
        db.executemany('INSERT INTO research_fund_directory VALUES (?, ?, ?, ?, ?)', [
            (x['uid'], x['notable_lps'], int(x['eif_flag']), int(x['eifo_flag']), x['source_name']) for x in directory.values()])
        changed = db.execute(SQL_380).rowcount
        self.assertEqual(changed, 0, 'the importer and migration 380 disagree on some row')
        # And both found funds of each kind, so the agreement is not two empty sets.
        eif, eifo = db.execute('SELECT SUM(eif_flag), SUM(eifo_flag) FROM research_fund_directory').fetchone()
        self.assertGreater(eif, 100)
        self.assertGreater(eifo, 5)


if __name__ == '__main__':
    unittest.main()
