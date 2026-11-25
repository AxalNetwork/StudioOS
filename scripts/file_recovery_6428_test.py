# D6428: synthetic registry, lock duration, archive immutability, corruption,
# copy failure and suppression regressions.
"""D6428: synthetic-only backup, immutable archive, corruption, registry, lock and suppression regressions."""
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import os
import json
import sqlite3
from pathlib import Path

spec = importlib.util.spec_from_file_location('drill', Path(__file__).with_name('file-recovery-drill.py'))
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)
r = drill.recovery


def registry():
    return {'version': 1, 'classes': [{'prefix': 'synthetic-contracts/', 'locked_copy': 'yes', 'class': 'record', 'bucket': 'studioos-files',
            'retention_basis': 'synthetic-only', 'retention_days': r.RETENTION_DAYS}]}


class Recovery(unittest.TestCase):
    def test_drill(self):
        self.assertEqual(drill.drill(), {'mode': 'synthetic_only', 'outcome': 'verified', 'ledger': 'sqlite', 'restored': 1, 'suppressed': 1})

    def test_unapproved_and_unclassified_never_copy(self):
        for bad in [{}, {'version': 1, 'classes': []}, {'version': 1, 'classes': [{'prefix': 'personal/'}]}]:
            with self.assertRaises(ValueError):
                r.snapshot(drill.SyntheticStore(), bad)
        s = drill.SyntheticStore()
        m = r.snapshot(s, registry())
        self.assertEqual(len(m['entries']), 2)
        self.assertFalse(any(e['key'].startswith('personal/') for e in m['entries']))
        self.assertTrue(all(r.sha(s.archive[e['archive']]) == e['sha256'] for e in m['entries']))

    def test_lock_requires_approved_duration_and_full_prefix(self):
        valid = {'enabled': True, 'prefix': r.ARCHIVE_PREFIX, 'condition': {'type': 'Age', 'maxAgeSeconds': r.RETENTION_DAYS * 86400}}
        self.assertTrue(r.lock_covers([valid]))
        for patch in [{'enabled': False}, {'prefix': 'elsewhere/'}, {'prefix': r.ARCHIVE_PREFIX + 'one-only/'}, {'condition': {'type': 'Age', 'maxAgeSeconds': 365 * 86400}}, {'condition': {'type': 'Indefinite'}}]:
            self.assertFalse(r.lock_covers([{**valid, **patch}]))
        self.assertFalse(r.lock_covers([valid, {'enabled': True, 'prefix': '', 'condition': {'type': 'Indefinite'}}]))
        self.assertFalse(r.lock_covers([]))

    def test_unknown_suppression_fails_closed(self):
        s = drill.SyntheticStore(); m = r.snapshot(s, registry())
        with tempfile.TemporaryDirectory() as tmp:
            for i, check in enumerate([None, lambda key: None]):
                with self.assertRaises(ValueError):
                    r.restore(s, m, Path(tmp) / str(i), check)

    def test_tampering_never_restores(self):
        s = drill.SyntheticStore(); m = r.snapshot(s, registry())
        s.archive[m['entries'][0]['archive']] = b'corrupted'
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                r.restore(s, m, Path(tmp) / 'restore', lambda key: 'restore')

    def test_two_snapshots_preserve_old_bytes_without_overwrite(self):
        s = drill.SyntheticStore(); first = r.snapshot(s, registry())
        s.source['synthetic-contracts/one'] = b'Synthetic v2'
        second = r.snapshot(s, registry())
        self.assertNotEqual(first['run_id'], second['run_id'])
        self.assertEqual(s.archive[first['entries'][0]['archive']], b'Synthetic contract v1')
        self.assertEqual(s.archive[second['entries'][0]['archive']], b'Synthetic v2')
        with self.assertRaises(ValueError):
            s.put(first['entries'][0]['archive'], b'overwrite')

    def test_failed_copy_has_no_complete_manifest(self):
        s = drill.SyntheticStore()
        def fail(key, data):
            raise RuntimeError('synthetic copy failure')
        s.put = fail
        with self.assertRaises(RuntimeError):
            r.snapshot(s, registry())
        self.assertFalse(any(k.endswith('manifest.json') for k in s.archive))

    def test_suppressed_bytes_are_not_fetched_or_restored(self):
        s = drill.SyntheticStore(); m = r.snapshot(s, registry()); original = s.get
        def get(key, **kwargs):
            if key == m['entries'][1]['archive']:
                raise AssertionError('suppressed archive must not be fetched')
            return original(key, **kwargs)
        s.get = get
        with tempfile.TemporaryDirectory() as tmp:
            result = r.restore(s, m, Path(tmp) / 'restore', lambda key: 'suppress' if key.endswith('/suppressed') else 'restore')
            self.assertEqual(result, {'restored': 1, 'suppressed': 1})

    def test_every_registry_field_requires_explicit_approval(self):
        for patch_value in [{'locked_copy': 'no'}, {'retention_basis': ''}, {'retention_days': 365}, {'prefix': ''}, {'prefix': '../'}]:
            reg = registry(); reg['classes'][0].update(patch_value)
            with self.assertRaises(ValueError):
                r.approved_classes(reg)

    def test_copy_checks_checksum_and_concurrent_source_revision(self):
        store = drill.SyntheticStore(); original = store.get
        def corrupt(key, archive=False, **kwargs):
            return b'corrupted' if archive else original(key, **kwargs)
        store.get = corrupt
        with self.assertRaises(ValueError):
            r.snapshot(store, registry())
        self.assertFalse(any(k.endswith('manifest.json') for k in store.archive))
        store = drill.SyntheticStore(); original_list = store.list
        def changed(prefix):
            rows = original_list(prefix)
            store.source['synthetic-contracts/one'] = b'Synthetic concurrent overwrite'
            return rows
        store.list = changed
        with self.assertRaises(ValueError):
            r.snapshot(store, registry())

    def test_adapter_paginates_and_refuses_an_incomplete_listing(self):
        store = r.AwsStore('a' * 32)
        pages = [{'Contents': [{'Key': 'synthetic-contracts/one', 'ETag': 'v1'}], 'IsTruncated': True, 'NextContinuationToken': 'next'}, {'Contents': [], 'IsTruncated': False}]
        calls = []
        def command(*args):
            calls.append(args)
            return pages.pop(0)
        store.command = command
        self.assertEqual(list(store.list('synthetic-contracts/')), [('synthetic-contracts/one', 'v1')])
        self.assertIn('--continuation-token', calls[1]); self.assertIn('next', calls[1])
        store.command = lambda *args: {'IsTruncated': True}
        with self.assertRaises(RuntimeError):
            list(store.list('synthetic-contracts/'))

    def test_adapter_uses_separate_source_and_destination_credentials_and_conditional_writes(self):
        store = r.AwsStore('a' * 32)
        env = {'FILE_RECOVERY_SOURCE_ACCESS_KEY_ID': 'synthetic-source', 'FILE_RECOVERY_SOURCE_SECRET_ACCESS_KEY': 'synthetic-source-secret',
               'FILE_RECOVERY_DESTINATION_ACCESS_KEY_ID': 'synthetic-destination', 'FILE_RECOVERY_DESTINATION_SECRET_ACCESS_KEY': 'synthetic-destination-secret'}
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs['env']['AWS_ACCESS_KEY_ID']))
            return SimpleNamespace(returncode=0, stdout=b'{}', stderr=b'')
        with patch.dict(os.environ, env, clear=True), patch.object(r.subprocess, 'run', run):
            store.command('list-objects-v2', '--bucket', 'studioos-files')
            store.put('files-recovery/synthetic', b'synthetic')
        self.assertEqual([v for _, v in calls], ['synthetic-source', 'synthetic-destination'])
        self.assertIn('--if-none-match', calls[1][0]); self.assertIn('*', calls[1][0])
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                store.command('list-objects-v2', '--bucket', 'studioos-files')

    def test_mixed_inventory_excludes_unlocked_unconfirmed_media_and_other_buckets(self):
        reg = registry(); base = dict(reg['classes'][0]); base['prefix'] = 'personal/'
        for patch_value in [{'locked_copy': 'no'}, {'retention_basis': 'not recorded'}, {'retention_basis': ''}, {'class': 'replaceable'}, {'bucket': 'other-bucket'}]:
            mixed = {'version': 1, 'classes': [reg['classes'][0], {**base, **patch_value}]}
            manifest = r.snapshot(drill.SyntheticStore(), mixed)
            self.assertEqual(len(manifest['entries']), 2)
            self.assertFalse(any(e['key'].startswith('personal/') for e in manifest['entries']))



INVENTORY = Path(__file__).resolve().parent.parent / 'documentation' / 'operations' / 'R2_INVENTORY.json'


class RecordingStore(drill.SyntheticStore):
    """Fails the test the moment a prefix without `locked_copy: yes` is listed, read or copied (D6654)."""
    def __init__(self, approved, extra=None):
        super().__init__()
        self.source.update(extra or {})
        self.last_modified.update({key: drill.BACKED_UP_AT for key in self.source})
        self.approved = tuple(approved)

    def _check(self, key):
        if not key.startswith(self.approved):
            raise AssertionError('a prefix without locked_copy: yes reached the locked bucket: ' + key)

    def list(self, prefix):
        self._check(prefix)
        return super().list(prefix)

    def get(self, key, archive=False, etag=None):
        if not archive:
            self._check(key)
        return super().get(key, archive=archive, etag=etag)


class Suppression(unittest.TestCase):
    """D6654: the suppression ledger, the restore that reads it first, and the locked-copy filter."""

    def backed_up(self):
        s = drill.SyntheticStore(written_at=drill.BACKED_UP_AT); m = r.snapshot(s, registry())
        return s, m

    def test_an_erased_key_is_absent_after_restore_from_a_copy_that_still_holds_it(self):
        s, m = self.backed_up()
        erased = 'synthetic-contracts/suppressed'
        ledger = drill.SqliteLedger(); ledger.record(erased, 'dsr-synthetic')
        held = [e for e in m['entries'] if e['key'] == erased]
        self.assertEqual(len(held), 1)
        self.assertIn(held[0]['archive'], s.archive, 'the locked copy still holds the erased object')
        s.source.clear()
        with tempfile.TemporaryDirectory() as tmp:
            result = r.restore(s, m, Path(tmp) / 'restore', r.load_ledger(ledger.query()))
            self.assertEqual(result, {'restored': 1, 'suppressed': 1})
            self.assertFalse((Path(tmp) / 'restore' / r.sha(erased.encode())).exists())
            self.assertEqual(sorted(p.name for p in (Path(tmp) / 'restore').iterdir()), [r.sha(b'synthetic-contracts/one')])

    def test_restoring_a_suppressed_object_is_refused_not_warned(self):
        s, m = self.backed_up()
        ledger = drill.SqliteLedger(); ledger.record('synthetic-contracts/suppressed', 'dsr-synthetic')
        fetched = []
        original = s.get
        s.get = lambda key, **kw: fetched.append(key) or original(key, **kw)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(r.SuppressedObjectRefused):
                r.restore(s, m, Path(tmp) / 'one', r.load_ledger(ledger.query()),
                          keys=['synthetic-contracts/one', 'synthetic-contracts/suppressed'])
            self.assertFalse((Path(tmp) / 'one').exists())
            self.assertEqual(fetched, [], 'a refused restore reads no archive object')
            result = r.restore(s, m, Path(tmp) / 'two', r.load_ledger(ledger.query()), keys=['synthetic-contracts/one'])
            self.assertEqual(result, {'restored': 1, 'suppressed': 0})
            with self.assertRaises(ValueError):
                r.restore(s, m, Path(tmp) / 'three', r.load_ledger(ledger.query()), keys=['synthetic-contracts/absent'])

    def test_no_ledger_or_a_broken_ledger_restores_nothing(self):
        s, m = self.backed_up()
        def down(sql, params):
            raise OSError('synthetic D1 outage')
        for query in [down, lambda sql, params: None, lambda sql, params: [{'bucket': 'studioos-files', 'key_hash': 'x', 'erased_at': 'now'}],
                      lambda sql, params: [{'bucket': 'studioos-files', 'key_hash': 'a' * 64, 'erased_at': None}]]:
            with self.assertRaises(ValueError):
                r.load_ledger(query)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                r.restore(s, m, Path(tmp) / 'restore', [])
            self.assertFalse((Path(tmp) / 'restore').exists())

    def test_the_whole_ledger_is_read_page_by_page(self):
        ledger = drill.SqliteLedger()
        for i in range(7):
            ledger.record(f'synthetic-contracts/erased-{i}', 'dsr-synthetic')
        calls = []
        query = ledger.query()
        def paged(sql, params):
            calls.append(params[0])
            return query(sql, params)
        with patch.object(r, 'LEDGER_PAGE', 3):
            loaded = r.load_ledger(paged)
        self.assertEqual(len(loaded), 7)
        self.assertEqual(calls, [0, 3, 6])
        with patch.object(r, 'LEDGER_PAGE', 1):
            with self.assertRaises(ValueError):
                r.load_ledger(lambda sql, params: [{'id': 1, 'bucket': 'studioos-files', 'key_hash': 'a' * 64, 'erased_at': '2026-01-01T00:00:00Z'}])

    def test_a_new_object_under_a_reused_key_may_return_but_a_close_or_undated_one_may_not(self):
        key = 'synthetic-contracts/reused'
        ledger = r.SuppressionLedger([{'bucket': 'studioos-files', 'key_hash': r.sha(key.encode()), 'erased_at': '2026-03-01 12:00:00'}])
        decide = lambda written: ledger.decision({'key': key, 'last_modified': written})  # noqa: E731
        self.assertEqual(decide('2026-02-01T00:00:00+00:00'), 'suppress')
        self.assertEqual(decide('2026-03-01T12:04:59Z'), 'suppress')
        self.assertEqual(decide(None), 'suppress')
        self.assertEqual(decide('not a time'), 'suppress')
        self.assertEqual(decide('2026-03-01T12:05:01Z'), 'restore')
        self.assertEqual(ledger.decision({'key': 'synthetic-contracts/other', 'last_modified': None}), 'restore')
        other_bucket = r.SuppressionLedger([{'bucket': 'studioos-publications', 'key_hash': r.sha(key.encode()), 'erased_at': '2026-03-01 12:00:00'}])
        self.assertEqual(other_bucket.decision({'key': key, 'last_modified': None}), 'restore')

    def test_snapshot_records_each_object_write_time(self):
        s, m = self.backed_up()
        self.assertTrue(all(e['last_modified'] == drill.BACKED_UP_AT for e in m['entries']))

    def test_a_prefix_marked_locked_copy_no_never_reaches_the_locked_bucket(self):
        extra = {'personal/unconfirmed': b'Synthetic personal file', 'personal/media': b'Synthetic media'}
        base = registry()['classes'][0]
        for mark in ['no', None, 'NO', True, 'yes ']:
            other = {**base, 'prefix': 'personal/', 'locked_copy': mark}
            if mark is None:
                other.pop('locked_copy')
            store = RecordingStore(['synthetic-contracts/'], extra)
            manifest = r.snapshot(store, {'version': 1, 'classes': [base, other]})
            self.assertEqual(sorted(e['key'] for e in manifest['entries']), ['synthetic-contracts/one', 'synthetic-contracts/suppressed'])
            self.assertFalse(any(store.archive[k] in extra.values() for k in store.archive))
        # The recording store itself fails when an unmarked prefix is copied.
        with self.assertRaises(AssertionError):
            r.snapshot(RecordingStore(['synthetic-contracts/'], extra), {'version': 1, 'classes': [base, {**base, 'prefix': 'personal/'}]})

    def test_the_committed_inventory_approves_no_locked_copy_without_a_recorded_basis(self):
        inventory = json.loads(INVENTORY.read_text())
        for c in inventory['classes']:
            if c.get('retention_basis', 'not recorded') in ('not recorded', '', None):
                self.assertEqual(c['locked_copy'], 'no', c['id'])
        with self.assertRaises(ValueError):
            r.approved_classes(inventory)
        # Even flipped to yes with the approved period, a class with no recorded basis stays out.
        flipped = json.loads(INVENTORY.read_text())
        for c in flipped['classes']:
            c.update(locked_copy='yes', retention_days=r.RETENTION_DAYS)
        with self.assertRaises(ValueError):
            r.approved_classes(flipped)

    def test_the_drill_uses_the_ledger_table_the_migration_declares(self):
        ledger = drill.SqliteLedger()
        columns = [row[1] for row in ledger.connection.execute('PRAGMA table_info(record_suppression_ledger)')]
        self.assertEqual(columns, ['id', 'bucket', 'key_hash', 'record_class', 'reason', 'request_id', 'actor', 'erased_at'])
        ledger.record('synthetic-contracts/x', 'dsr-synthetic')
        with self.assertRaises(sqlite3.DatabaseError):
            ledger.connection.execute('DELETE FROM record_suppression_ledger')

    def test_the_preview_drill_refuses_production_and_a_missing_database(self):
        for database in ['', r.PRODUCTION_D1_ID, 'not-a-database']:
            with self.assertRaises(ValueError):
                drill.PreviewD1Ledger({'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'FILE_RECOVERY_PREVIEW_D1_TOKEN': 'synthetic', 'FILE_RECOVERY_PREVIEW_D1_ID': database})

    def test_the_d1_adapter_reads_one_result_set_and_refuses_anything_else(self):
        query = r.d1_query('a' * 32, '0' * 8 + '-0000-0000-0000-' + '0' * 12, 'synthetic-token')
        answers = [{'success': True, 'result': [{'success': True, 'results': [{'id': 1}]}]},
                   {'success': False, 'result': None}, {'success': True, 'result': []},
                   {'success': True, 'result': [{'success': False}]},
                   {'success': True, 'result': [{'success': True, 'results': []}, {'success': True, 'results': []}]}]
        sent = []

        class Response:
            def __init__(self, body):
                self.body = body
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self, *a):
                return json.dumps(self.body).encode()

        def opener(request, timeout):
            sent.append(json.loads(request.data))
            return Response(answers.pop(0))
        with patch.object(r, 'urlopen', opener):
            self.assertEqual(query(r.LEDGER_QUERY, [0, 5]), [{'id': 1}])
            for _ in range(4):
                with self.assertRaises(ValueError):
                    query(r.LEDGER_QUERY, [0, 5])
        self.assertEqual(sent[0], {'sql': r.LEDGER_QUERY, 'params': [0, 5]})
        self.assertTrue(r.LEDGER_QUERY.lstrip().upper().startswith('SELECT'))
        for bad in [('', '0' * 36, 't'), ('a' * 32, 'x', 't'), ('a' * 32, '0' * 36, '')]:
            with self.assertRaises(ValueError):
                r.d1_query(*bad)


if __name__ == '__main__':
    unittest.main()
