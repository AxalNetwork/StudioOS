# D6653: fixtures for independent integrity, isolated credential roles, unconfigured skips and failure heartbeats.
"""D6653: synthetic independent snapshots, integrity, isolated credentials and heartbeat fixtures."""
import base64
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('independent', Path(__file__).with_name('file-recovery-independent.py'))
i = importlib.util.module_from_spec(spec); spec.loader.exec_module(i)
r = i.recovery
spec = importlib.util.spec_from_file_location('drill', Path(__file__).with_name('file-recovery-drill.py'))
d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
RUN = '12345678-1234-1234-1234-123456789abc'
NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)


def registry():
    return {'version': 1, 'classes': [{'prefix': 'synthetic-contracts/', 'class': 'record', 'bucket': 'studioos-files',
            'locked_copy': 'yes', 'retention_basis': 'synthetic-only', 'retention_days': r.RETENTION_DAYS}]}


def env():
    return {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'DR_COPY_ENDPOINT': 'https://' + 'b' * 32 + '.r2.cloudflarestorage.com',
            'DR_COPY_BUCKET': 'synthetic-preview', 'FILE_DR_COPY_ACCESS_KEY_ID': 'synthetic-writer',
            'FILE_DR_COPY_SECRET_ACCESS_KEY': 'synthetic-writer-key', 'FILE_DR_RESTORE_ACCESS_KEY_ID': 'synthetic-reader',
            'FILE_DR_RESTORE_SECRET_ACCESS_KEY': 'synthetic-reader-key', 'CLOUDFLARE_API_TOKEN': 'synthetic-never-forward',
            'FILE_RECOVERY_SOURCE_ACCESS_KEY_ID': 'synthetic-never-forward', 'AWS_SESSION_TOKEN': 'synthetic-never-forward'}


def encrypt(data): return b'age-fixture:' + base64.b64encode(data)
def decrypt(data):
    if not data.startswith(b'age-fixture:'): raise ValueError('Invalid fixture ciphertext')
    return base64.b64decode(data[len(b'age-fixture:'):], validate=True)


class Outside:
    def __init__(self): self.data, self.calls = {}, []
    def put(self, key, data, plaintext_sha=None):
        self.calls.append(key)
        if key in self.data and self.data[key] != data: raise ValueError('Immutable fixture')
        self.data[key] = data
        return {'size': len(data), 'sha256': r.sha(data)}
    def get(self, key): return self.data[key]


class RecoveryIndependent(unittest.TestCase):
    def bundle(self, root, one=False):
        source = d.SyntheticStore()
        if one: source.source = {'synthetic-contracts/independent-drill': b'Synthetic independent recovery drill'}
        source.last_modified = {key: '2026-11-18T11:30:00Z' for key in source.source}
        staged = r.BundleStore(source, root / 'bundle')
        manifest = r.snapshot(staged, registry(), run_id=RUN)
        return source, staged.path, manifest

    def test_same_objects_encrypted_and_manifest_committed_last(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, bundle, manifest = self.bundle(Path(tmp)); out = Outside()
            receipt = i.copy_bundle(bundle, out, encrypt)
            self.assertEqual(receipt['object_count'], 2)
            self.assertEqual(receipt['byte_count'], sum(e['size'] for e in manifest['entries']))
            self.assertEqual(receipt['newest_key_at'], '2026-11-18T11:30:00+00:00')
            self.assertTrue(out.calls[-1].endswith('/copy.json'))
            for entry in manifest['entries']:
                self.assertEqual(decrypt(out.data[entry['archive'] + '.age']), source.archive[entry['archive']])
                self.assertNotIn(source.archive[entry['archive']], out.data[entry['archive'] + '.age'])
            descriptor = out.data[out.calls[-1]]
            self.assertNotIn(b'synthetic-contracts/', descriptor)

    def test_failed_or_tampered_bundle_never_publishes_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, bundle, manifest = self.bundle(Path(tmp)); out = Outside()
            path = bundle / manifest['entries'][0]['archive']; original = path.read_bytes(); path.write_bytes(b'tampered')
            with self.assertRaises(ValueError): i.copy_bundle(bundle, out, encrypt)
            self.assertEqual(out.calls, [])
            path.write_bytes(original)
            def fail(key, data, **kwargs): raise RuntimeError('Synthetic provider failure')
            out.put = fail
            with self.assertRaises(RuntimeError): i.copy_bundle(bundle, out, encrypt)
            self.assertFalse(any(key.endswith('/copy.json') for key in out.data))

    def test_restore_uses_only_outside_copy_after_losing_primary_and_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source, bundle, _ = self.bundle(root, one=True); out = Outside()
            i.copy_bundle(bundle, out, encrypt)
            source.source.clear(); source.archive.clear()
            import shutil
            shutil.rmtree(bundle)
            target = root / 'restored'
            result = i.restore_one(out, RUN, target, decrypt)
            self.assertEqual(result, {'outcome': 'verified', 'restored': 1, 'source': 'independent', 'synthetic_only': True})
            self.assertEqual(target.read_bytes(), b'Synthetic independent recovery drill')
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_manifest_and_record_corruption_never_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); _, bundle, manifest = self.bundle(root, one=True); out = Outside(); i.copy_bundle(bundle, out, encrypt)
            for key in [f'files-recovery/{RUN}/manifest.json.age', manifest['entries'][0]['archive'] + '.age']:
                original = out.data[key]; out.data[key] = b'corrupt'
                with self.assertRaises(ValueError): i.restore_one(out, RUN, root / 'never', decrypt)
                self.assertFalse((root / 'never').exists()); out.data[key] = original

    def test_drill_cannot_restore_real_or_multiple_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); _, bundle, _ = self.bundle(root); out = Outside(); i.copy_bundle(bundle, out, encrypt)
            with self.assertRaises(ValueError): i.restore_one(out, RUN, root / 'never', decrypt)
            self.assertFalse((root / 'never').exists())
            second = root / 'second'; second.mkdir()
            _, bundle, manifest = self.bundle(second, one=True)
            entry = manifest['entries'][0]
            previous = bundle / entry['archive']
            entry['key'] = 'private/synthetic-member'
            entry['archive'] = f"files-recovery/{RUN}/objects/{r.sha(entry['key'].encode())}/{entry['sha256']}"
            replacement = bundle / entry['archive']
            replacement.parent.mkdir(parents=True)
            previous.rename(replacement)
            (bundle / f'files-recovery/{RUN}/manifest.json').write_text(json.dumps(manifest))
            out = Outside(); i.copy_bundle(bundle, out, encrypt)
            with self.assertRaises(ValueError): i.restore_one(out, RUN, root / 'never', decrypt)
            self.assertFalse((root / 'never').exists())

    def test_newest_key_time_is_unknown_when_source_metadata_is_missing(self):
        source = d.SyntheticStore(); manifest = r.snapshot(source, registry())
        self.assertIsNone(r.receipt(manifest)['newest_key_at'])
        self.assertEqual(r.receipt(manifest)['newest_key_at_status'], 'unavailable')

    def test_heartbeat_distinguishes_success_failure_skipped_and_unknown_counts(self):
        primary = {'outcome': 'verified', 'snapshot_id': RUN, 'object_count': 2, 'byte_count': 50, 'newest_key_at': NOW.isoformat()}
        good = i.make_heartbeat(primary, dict(primary), 'success', 'success', True, '123', '1', NOW)
        self.assertEqual(good['outcome'], 'success'); self.assertEqual(good['object_count'], 2)
        self.assertEqual(i.make_heartbeat(primary, {'outcome': 'not_configured'}, 'success', 'success', False, '123', '1', NOW)['outcome'], 'success')
        for copy in [None, {**primary, 'snapshot_id': 'other'}, {**primary, 'byte_count': 1}]:
            self.assertEqual(i.make_heartbeat(primary, copy, 'success', 'success', True, '123', '1', NOW)['outcome'], 'failure')
        failed = i.make_heartbeat(None, None, 'failure', 'skipped', True, '123', '1', NOW)
        self.assertEqual(failed['outcome'], 'failure'); self.assertIsNone(failed['object_count']); self.assertIsNone(failed['byte_count'])
        self.assertEqual(i.make_heartbeat({**primary, 'object_count': 0, 'byte_count': 0}, {**primary, 'object_count': 0, 'byte_count': 0}, 'success', 'success', True, '123', '1', NOW)['outcome'], 'success')

    def test_unconfigured_step_is_clean_and_never_touches_provider(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True), patch.object(i.subprocess, 'run', side_effect=AssertionError('Must not call provider')):
            receipt = Path(tmp) / 'receipt'
            with patch('sys.argv', ['copy', 'copy', '--receipt', str(receipt)]), redirect_stdout(io.StringIO()) as output:
                i.main()
            self.assertEqual(json.loads(receipt.read_text()), {'outcome': 'not_configured'})
            self.assertIn('::notice::', output.getvalue())

    def test_independent_account_and_https_configuration_are_required(self):
        config = env(); self.assertEqual(i.independent_config(config)[1], 'synthetic-preview')
        for override in [{'CLOUDFLARE_ACCOUNT_ID': ''}, {'DR_COPY_ENDPOINT': 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com'},
                         {'DR_COPY_ENDPOINT': 'http://example.test'}, {'DR_COPY_ENDPOINT': 'https://user:secret@example.test'},
                         {'DR_COPY_ENDPOINT': 'https://example.test/path'}, {'DR_COPY_ENDPOINT': 'https://example.test?key=private'},
                         {'DR_COPY_ENDPOINT': 'https://other-provider.test'}]:
            with self.assertRaises(ValueError): i.independent_config({**config, **override})
        self.assertEqual(i.independent_config({**config, 'DR_COPY_ENDPOINT': 'https://other-provider.test', 'FILE_DR_EXTERNAL_ACCOUNT_CONFIRMED': 'true'})[0], 'https://other-provider.test')

    def test_transport_uses_checksums_conditional_puts_and_scoped_credentials(self):
        values, calls = {}, []
        def run(cmd, **kwargs):
            op = cmd[cmd.index('s3api') + 1]; key = cmd[cmd.index('--key') + 1]; calls.append((op, key, kwargs['env']))
            if op == 'put-object':
                self.assertIn('--if-none-match', cmd)
                data = Path(cmd[cmd.index('--body') + 1]).read_bytes()
                self.assertEqual(cmd[cmd.index('--checksum-sha256') + 1], base64.b64encode(__import__('hashlib').sha256(data).digest()).decode())
                if key in values: return SimpleNamespace(returncode=1, stdout=b'', stderr=b'PreconditionFailed (412)')
                values[key] = {'ContentLength': len(data), 'Metadata': json.loads(cmd[cmd.index('--metadata') + 1])}
                result = {}
            else: result = values[key]
            return SimpleNamespace(returncode=0, stdout=json.dumps(result).encode(), stderr=b'')
        config = env(); store = i.Store(*i.independent_config(config), 'copy', config, run=run)
        key = f'files-recovery/{RUN}/manifest.json.age'; plain = r.sha(b'original')
        first = store.put(key, b'cipher-one', plaintext_sha=plain)
        self.assertEqual(store.put(key, b'randomized-cipher-two', plaintext_sha=plain), first)
        with self.assertRaises(ValueError): store.put(key, b'cipher', plaintext_sha=r.sha(b'other'))
        with self.assertRaises(ValueError): store.call('get-object', key)
        for _, _, credentials in calls:
            self.assertEqual(credentials['AWS_ACCESS_KEY_ID'], 'synthetic-writer')
            self.assertNotIn('CLOUDFLARE_API_TOKEN', credentials); self.assertNotIn('FILE_RECOVERY_SOURCE_ACCESS_KEY_ID', credentials)
            self.assertNotIn('AWS_SESSION_TOKEN', credentials)
        values[key]['ContentLength'] = -1
        with self.assertRaises(ValueError): store.put(key, b'cipher', plaintext_sha=plain)

    def test_heartbeat_role_cannot_read_member_records_or_write_outside_metadata(self):
        config = {**env(), 'FILE_RECOVERY_HEALTH_ACCESS_KEY_ID': 'synthetic-health', 'FILE_RECOVERY_HEALTH_SECRET_ACCESS_KEY': 'synthetic-health-secret'}
        store = i.Store('https://example.test', 'synthetic', 'auto', 'health-read', config, run=lambda *a, **k: self.fail('No call allowed'))
        with self.assertRaises(ValueError): store.call('get-object', f'files-recovery/{RUN}/copy.json')
        with self.assertRaises(ValueError): store.call('put-object', i.HEARTBEAT)


if __name__ == '__main__': unittest.main()
