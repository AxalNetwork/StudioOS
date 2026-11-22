#!/usr/bin/env python3
"""D6428: synthetic-only recovery drill; no credential, provider or production file is read."""
import importlib.util
import json
# D6654: backs up synthetic objects, erases one after the backup (a suppression-ledger row, as the
# Worker's one record-erasure path writes), loses the source, reads the ledger first and restores:
# the erased object must not come back, and asking for it by key is refused.
#
#   python3 scripts/file-recovery-drill.py               # local: the ledger is SQLite built from the D1 migration
#   python3 scripts/file-recovery-drill.py --preview-d1  # hosted: the preview D1 ledger, read through the same D1
#                                                        # adapter a live restore uses; production is refused.
#                                                        # Its only credential is a preview D1 token.
import argparse
import os
import re
import sqlite3
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('file_recovery', Path(__file__).with_name('file-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)

MIGRATIONS = Path(__file__).resolve().parent.parent / 'cloudflare-worker' / 'sql' / 'migrations'
LEDGER_INSERT = ('INSERT INTO record_suppression_ledger (bucket, key_hash, record_class, reason, request_id, actor, erased_at) '
                 'VALUES (?, ?, ?, ?, ?, ?, ?)')
BACKED_UP_AT = '2026-01-01T00:00:00+00:00'


class SyntheticStore:
    def __init__(self, prefix='synthetic-contracts/', written_at=None):
        self.source = {prefix + 'one': b'Synthetic contract v1', prefix + 'suppressed': b'Synthetic erasure record',
                       'personal/not-eligible': b'Must never be copied'}
        # No write time unless one is given: a store without source metadata is a case of its own (D6653).
        self.last_modified = {key: written_at for key in self.source} if written_at else {}
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


def ledger_migration():
    files = sorted(MIGRATIONS.glob('*_6654_record_suppression_ledger.sql'))
    if len(files) != 1:
        raise ValueError('The D6654 ledger migration is missing.')
    return files[0].read_text()


def ledger_row(key, request_id):
    return [recovery.SUPPRESSION_BUCKET, recovery.sha(key.encode()), 'synthetic-drill', 'erasure_request', request_id,
            'operator', datetime.now(timezone.utc).isoformat()]


class SqliteLedger:
    """The local form: the ledger table exactly as the migration declares it."""
    name = 'sqlite'

    def __init__(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.executescript(ledger_migration())

    def record(self, key, request_id):
        self.connection.execute(LEDGER_INSERT, ledger_row(key, request_id))

    def query(self):
        return recovery.sqlite_query(self.connection)


class PreviewD1Ledger:
    """The hosted form: the preview D1's ledger. Refuses the production database."""
    name = 'preview-d1'

    def __init__(self, env):
        self.account, self.database = env.get('CLOUDFLARE_ACCOUNT_ID', ''), env.get('FILE_RECOVERY_PREVIEW_D1_ID', '')
        self.token = env.get('FILE_RECOVERY_PREVIEW_D1_TOKEN', '')
        if not re.fullmatch('[a-f0-9-]{36}', self.database) or self.database == recovery.PRODUCTION_D1_ID:
            raise ValueError('A preview D1 database (never production) is required.')
        self.read = recovery.d1_query(self.account, self.database, self.token)

    def record(self, key, request_id):
        url = f'https://api.cloudflare.com/client/v4/accounts/{self.account}/d1/database/{self.database}/query'
        recovery.d1_post(url, self.token, LEDGER_INSERT, ledger_row(key, request_id))

    def query(self):
        return self.read


def drill(ledger=None):
    ledger = ledger or SqliteLedger()
    run = str(uuid.uuid4())
    prefix = 'synthetic-contracts/' if ledger.name == 'sqlite' else f'synthetic-drill-{run}/'
    store = SyntheticStore(prefix, written_at=BACKED_UP_AT)
    registry = {'version': 1, 'classes': [{'prefix': prefix, 'locked_copy': 'yes', 'class': 'record', 'bucket': 'studioos-files',
                'retention_basis': 'synthetic-only-drill', 'retention_days': recovery.RETENTION_DAYS}]}
    manifest = recovery.snapshot(store, registry)
    assert len(manifest['entries']) == 2
    # Erased after the backup: the live object goes and the ledger row lands, as eraseRecordObjects does.
    erased = prefix + 'suppressed'
    ledger.record(erased, 'drill:' + run)
    del store.source[erased]
    store.source.clear()  # Then the source is lost; recover only from verified archive bytes.
    suppression = recovery.load_ledger(ledger.query())  # The ledger first, before any archive object is read.
    with tempfile.TemporaryDirectory(prefix='synthetic-recovery-') as tmp:
        result = recovery.restore(store, manifest, Path(tmp) / 'restored', suppression)
        assert (Path(tmp) / 'restored' / recovery.sha((prefix + 'one').encode())).read_bytes() == b'Synthetic contract v1'
        assert not (Path(tmp) / 'restored' / recovery.sha(erased.encode())).exists()
        assert result == {'restored': 1, 'suppressed': 1}
        try:
            recovery.restore(store, manifest, Path(tmp) / 'asked', suppression, keys=[erased])
        except recovery.SuppressedObjectRefused:
            pass
        else:
            raise AssertionError('Restoring the erased object was not refused')
        assert not (Path(tmp) / 'asked').exists()
    return {'mode': 'synthetic_only', 'outcome': 'verified', 'ledger': ledger.name, **result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-d1', action='store_true', help='Use the preview D1 ledger (FILE_RECOVERY_PREVIEW_D1_ID)')
    args = parser.parse_args()
    try:
        print(json.dumps(drill(PreviewD1Ledger(os.environ) if args.preview_d1 else None)))
    except Exception:
        if not args.preview_d1:
            raise
        # Provider errors can carry account details: keep them out of public runner logs.
        sys.exit('Synthetic suppression drill failed; consult private operator diagnostics.')
