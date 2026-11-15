"""D6428: synthetic-only backup, immutable archive, corruption, registry, lock and suppression regressions."""
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import os
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
        self.assertEqual(drill.drill(), {'mode': 'synthetic_only', 'outcome': 'verified', 'restored': 1, 'suppressed': 1})

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


if __name__ == '__main__':
    unittest.main()
