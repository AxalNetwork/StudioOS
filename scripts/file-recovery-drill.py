#!/usr/bin/env python3
"""D6428: synthetic-only recovery drill; no credential, provider or production file is read."""
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('file_recovery', Path(__file__).with_name('file-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class SyntheticStore:
    def __init__(self):
        self.source = {'synthetic-contracts/one': b'Synthetic contract v1', 'synthetic-contracts/suppressed': b'Synthetic erasure record',
                       'personal/not-eligible': b'Must never be copied'}
        self.archive = {}

    def list(self, prefix):
        return [(key, recovery.sha(value)) for key, value in self.source.items() if key.startswith(prefix)]

    def get(self, key, archive=False, etag=None):
        data = (self.archive if archive else self.source)[key]
        if etag is not None and recovery.sha(data) != etag:
            raise ValueError('Synthetic concurrent overwrite')
        return data

    def put(self, key, data):
        if key in self.archive:
            raise ValueError('Synthetic immutable archive cannot overwrite')
        self.archive[key] = data


def drill():
    store = SyntheticStore()
    registry = {'version': 1, 'classes': [{'prefix': 'synthetic-contracts/', 'locked_copy': 'yes', 'class': 'record', 'bucket': 'studioos-files',
                'retention_basis': 'synthetic-only-drill', 'retention_days': recovery.RETENTION_DAYS}]}
    manifest = recovery.snapshot(store, registry)
    store.source.clear()  # Simulate losing the source; recover only from verified archive bytes.
    with tempfile.TemporaryDirectory(prefix='synthetic-recovery-') as tmp:
        result = recovery.restore(store, manifest, Path(tmp) / 'restored',
                                  lambda key: 'suppress' if key.endswith('/suppressed') else 'restore')
        expected = Path(tmp) / 'restored' / recovery.sha(b'synthetic-contracts/one')
        assert expected.read_bytes() == b'Synthetic contract v1'
        assert result == {'restored': 1, 'suppressed': 1}
        assert len(manifest['entries']) == 2
    return {'mode': 'synthetic_only', 'outcome': 'verified', **result}


if __name__ == '__main__':
    print(json.dumps(drill()))
