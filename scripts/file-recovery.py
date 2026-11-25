#!/usr/bin/env python3
# D6428: approved-class-only, lock-verified R2 snapshots and
# suppression-required restore primitive; live activation waits for
# counsel/#6650/#6654.
"""D6428: append-only, checksum-verified R2 file snapshots for counsel-approved record classes only.

Live copies require an approved registry and a verified seven-year destination
prefix lock. Live restore waits for #6654; restore() always requires a suppression
checker. No object keys, contents, credentials or manifests are printed.

D6654 supplied it: `file-recovery.py restore` reads the whole D1 record suppression
ledger first and never puts an erased object back.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ARCHIVE_PREFIX = 'files-recovery/'
RETENTION_DAYS = 2557  # At least seven calendar years, including leap days.
# D6654: the ledger the Worker's one record-erasure path writes (cloudflare-worker/src/services/recordErasure.ts).
SUPPRESSION_BUCKET = 'studioos-files'
LEDGER_PAGE = 5000
LEDGER_QUERY = ('SELECT id, bucket, key_hash, erased_at FROM record_suppression_ledger '
                'WHERE id > ? ORDER BY id LIMIT ?')
# An object written more than this long after its key was erased is a new object under a reused key and may be
# restored. Anything closer, or with no recorded write time, stays suppressed (clock skew fails toward suppression).
SUPPRESSION_MARGIN_SECONDS = 300
PRODUCTION_D1_ID = '16a23acd-c82e-4ff1-a6c0-408e3eb014c8'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def approved_classes(registry):
    if not isinstance(registry, dict) or registry.get('version') != 1:
        raise ValueError('A versioned counsel-approved registry is required (#6650).')
    classes = registry.get('classes')
    if not isinstance(classes, list) or not classes:
        raise ValueError('No eligible record class is approved; no live copy is allowed.')
    eligible = []
    for item in classes:
        # #6650/#6654 classify the inventory explicitly. A missing/no lock
        # mark, replaceable/log class, unconfirmed basis or another bucket
        # never becomes eligible merely because it shares a prefix spelling.
        if not isinstance(item, dict):
            raise ValueError('An unreadable inventory class is refused.')
        if item.get('locked_copy') != 'yes' or item.get('class') != 'record' or item.get('bucket') != 'studioos-files':
            continue
        basis = item.get('retention_basis')
        if not isinstance(basis, str) or not basis.strip() or basis.strip().lower() in ('not recorded', 'pending', 'unconfirmed'):
            continue
        if item.get('retention_days') != RETENTION_DAYS:
            continue
        if (not isinstance(item.get('prefix'), str) or not item['prefix'].endswith('/')
                or item['prefix'].startswith('/') or '..' in item['prefix'].split('/')
                or len(item['prefix']) < 2):
            raise ValueError('An eligible class needs an explicit safe prefix.')
        eligible.append(item)
    if not eligible:
        raise ValueError('No eligible legally retained record class is approved; no live copy is allowed.')
    classes = eligible
    prefixes = [item['prefix'] for item in classes]
    if len(set(prefixes)) != len(prefixes) or any(a != b and a.startswith(b) for a in prefixes for b in prefixes):
        raise ValueError('Overlapping record prefixes are refused.')
    return classes


def lock_covers(rules):
    # An indefinite or longer overlapping lock would retain personal records
    # beyond this registry's approved basis. Do not silently accept it.
    overlapping = [r for r in rules if r.get('enabled') is True and
                   (ARCHIVE_PREFIX.startswith(r.get('prefix', '')) or r.get('prefix', '').startswith(ARCHIVE_PREFIX))]
    limit = RETENTION_DAYS * 86400
    if any(r.get('condition', {}).get('type') != 'Age' or r['condition'].get('maxAgeSeconds', 0) > limit for r in overlapping):
        return False
    return any(ARCHIVE_PREFIX.startswith(r.get('prefix', '')) and r['condition'].get('maxAgeSeconds') == limit for r in overlapping)


class AwsStore:
    def __init__(self, account, source='studioos-files', destination='studioos-backups'):
        if not re.fullmatch('[a-f0-9]{32}', account):
            raise ValueError('A valid Cloudflare account reference is required.')
        self.endpoint = f'https://{account}.r2.cloudflarestorage.com'
        self.source, self.destination = source, destination
        self.last_modified = {}

    def command(self, *args):
        bucket = args[args.index('--bucket') + 1]
        credential_scope = 'DESTINATION' if bucket == self.destination else 'SOURCE'
        env = os.environ.copy()
        for suffix in ['ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']:
            value = os.environ.get(f'FILE_RECOVERY_{credential_scope}_{suffix}')
            if not value:
                raise ValueError('Separate source read-only and destination archive credentials are required.')
            env[f'AWS_{suffix}'] = value
        result = subprocess.run(['aws', '--no-cli-pager', 's3api', *args, '--endpoint-url', self.endpoint,
                                 '--region', 'auto'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, env=env)
        if result.returncode:
            raise RuntimeError('R2 operation failed; no complete snapshot was recorded.')
        return json.loads(result.stdout or b'{}')

    def list(self, prefix):
        token = None
        while True:
            args = ['list-objects-v2', '--bucket', self.source, '--prefix', prefix, '--max-keys', '1000', '--no-paginate']
            if token:
                args.extend(['--continuation-token', token])
            page = self.command(*args)
            for item in page.get('Contents', []):
                self.last_modified[item['Key']] = item.get('LastModified')
                yield item['Key'], item['ETag']
            if not page.get('IsTruncated'):
                break
            next_token = page.get('NextContinuationToken')
            if not next_token or next_token == token:
                raise RuntimeError('Incomplete object listing; no snapshot was committed.')
            token = next_token

    def get(self, key, archive=False, etag=None):
        with tempfile.TemporaryDirectory(prefix='file-recovery-') as tmp:
            target = Path(tmp) / 'object'
            args = ['get-object', '--bucket', self.destination if archive else self.source, '--key', key]
            if etag:
                args.extend(['--if-match', etag])
            self.command(*args, str(target))
            return target.read_bytes()

    def put(self, key, data):
        with tempfile.TemporaryDirectory(prefix='file-recovery-') as tmp:
            path = Path(tmp) / 'object'
            path.write_bytes(data)
            self.command('put-object', '--bucket', self.destination, '--key', key, '--body', str(path), '--if-none-match', '*')


def snapshot(store, registry, run_id=None):
    classes = approved_classes(registry)
    run_id = run_id or str(uuid.uuid4())
    if not re.fullmatch('[a-f0-9-]{36}', run_id):
        raise ValueError('Invalid snapshot identity.')
    prefix = ARCHIVE_PREFIX + run_id + '/'
    entries = []
    for record_class in classes:
        for key, etag in store.list(record_class['prefix']):
            if not key.startswith(record_class['prefix']):
                raise ValueError('Source listing escaped the approved class.')
            data = store.get(key, etag=etag)
            digest = sha(data)
            archive = prefix + 'objects/' + sha(key.encode()) + '/' + digest
            store.put(archive, data)
            if sha(store.get(archive, archive=True)) != digest:
                raise ValueError('Archive verification failed; no complete snapshot was recorded.')
            written = parse_time(getattr(store, 'last_modified', {}).get(key))
            entries.append({'key': key, 'archive': archive, 'sha256': digest, 'size': len(data),
                            'retention_basis': record_class['retention_basis'],
                            'last_modified': written.isoformat() if written else None})
    times = [getattr(store, 'last_modified', {}).get(entry['key']) for entry in entries]
    newest = None
    try:
        if times and all(times):
            newest = max(datetime.fromisoformat(value.replace('Z', '+00:00')) for value in times)
            if newest.tzinfo is None:
                newest = None
    except (AttributeError, TypeError, ValueError):
        newest = None
    manifest = {'version': 1, 'run_id': run_id, 'at': datetime.now(timezone.utc).isoformat(),
                'newest_key_at': newest.isoformat() if newest else None,
                'newest_key_at_status': 'recorded' if newest else 'unavailable' if entries else 'not_recorded',
                'registry_sha256': sha(json.dumps(registry, sort_keys=True).encode()), 'entries': entries}
    encoded = json.dumps(manifest, sort_keys=True).encode()
    key = prefix + 'manifest.json'
    store.put(key, encoded)
    if store.get(key, archive=True) != encoded:
        raise ValueError('Manifest verification failed.')
    return manifest


def parse_time(value):
    """An aware UTC datetime from an R2 LastModified or ledger time, or None when absent or unreadable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00').replace(' ', 'T', 1))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class SuppressedObjectRefused(ValueError):
    """A restore asked for an object the suppression ledger names. Refused, never warned (D6654)."""


class SuppressionLedger:
    """The complete record suppression ledger, read before a restore touches any archive object (D6654)."""

    def __init__(self, rows):
        self.erased = {}
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('bucket'), str) or not row['bucket']:
                raise ValueError('The suppression ledger is unavailable or incomplete.')
            key_hash = row.get('key_hash')
            at = parse_time(row.get('erased_at'))
            if not isinstance(key_hash, str) or not re.fullmatch('[a-f0-9]{64}', key_hash) or at is None:
                raise ValueError('The suppression ledger is unavailable or incomplete.')
            slot = (row['bucket'], key_hash)
            self.erased[slot] = max(self.erased.get(slot, at), at)

    def __len__(self):
        return len(self.erased)

    def decision(self, entry):
        """'suppress' when the entry's key was erased and this copy is not clearly a later object; else 'restore'."""
        erased_at = self.erased.get((SUPPRESSION_BUCKET, sha(entry['key'].encode())))
        if erased_at is None:
            return 'restore'
        written = parse_time(entry.get('last_modified'))
        if written is None or (written - erased_at).total_seconds() <= SUPPRESSION_MARGIN_SECONDS:
            return 'suppress'
        return 'restore'


def load_ledger(query):
    """Read every ledger row through `query(sql, params) -> rows`, page by page. Any failure refuses the restore."""
    rows, after = [], 0
    while True:
        try:
            page = query(LEDGER_QUERY, [after, LEDGER_PAGE])
        except Exception as error:
            raise ValueError('The suppression ledger is unavailable or incomplete.') from error
        if not isinstance(page, list):
            raise ValueError('The suppression ledger is unavailable or incomplete.')
        rows.extend(page)
        if len(page) < LEDGER_PAGE:
            return SuppressionLedger(rows)
        last = page[-1].get('id') if isinstance(page[-1], dict) else None
        if not isinstance(last, int) or last <= after:
            raise ValueError('The suppression ledger is unavailable or incomplete.')
        after = last


def sqlite_query(connection):
    """The ledger query against a SQLite database built from the D1 migrations (the synthetic drill)."""
    def query(sql, params):
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(sql, params).fetchall()]
    return query


def d1_query(account, database_id, token):
    """The ledger query through the Cloudflare D1 HTTP API. Read-only SQL; the token needs D1 read only."""
    if not re.fullmatch('[a-f0-9]{32}', account or '') or not re.fullmatch('[a-f0-9-]{36}', database_id or '') or not token:
        raise ValueError('The suppression ledger is unavailable or incomplete.')
    url = f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database_id}/query'

    def query(sql, params):
        return d1_post(url, token, sql, params)
    return query


def d1_post(url, token, sql, params):
    request = Request(url, data=json.dumps({'sql': sql, 'params': params}).encode(), method='POST',
                      headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    # The URL is a fixed https:// Cloudflare API address; only the hex account and database ids checked above vary.
    with urlopen(request, timeout=60) as response:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        result = json.load(response)
    batches = result.get('result') if result.get('success') else None
    if not isinstance(batches, list) or len(batches) != 1 or not batches[0].get('success'):
        raise ValueError('The D1 query failed.')
    return batches[0].get('results', [])


def restore(store, manifest, target, suppression_check, keys=None):
    """Restore a verified snapshot, skipping every suppressed object; asking for a suppressed one is refused.

    `suppression_check` is the SuppressionLedger read before this call (or, in unit tests, a callable from key to
    'restore' | 'suppress'). There is no default empty ledger and no override.
    """
    if isinstance(suppression_check, SuppressionLedger):
        decide = suppression_check.decision
    elif callable(suppression_check):
        decide = lambda entry: suppression_check(entry['key'])  # noqa: E731
    else:
        raise ValueError('A current suppression-ledger checker is required (#6654).')
    if manifest.get('version') != 1 or not re.fullmatch('[a-f0-9-]{36}', manifest.get('run_id', '')):
        raise ValueError('Invalid manifest.')
    entries = manifest['entries']
    decisions = []
    for entry in entries:
        decision = decide(entry)
        if decision not in ('restore', 'suppress'):
            raise ValueError('The suppression ledger is unavailable or incomplete.')
        decisions.append(decision)
    if keys is not None:
        wanted = set(keys)
        if not wanted <= {entry['key'] for entry in entries}:
            raise ValueError('A requested object is not in this snapshot.')
        if any(entry['key'] in wanted and decision == 'suppress' for entry, decision in zip(entries, decisions)):
            raise SuppressedObjectRefused('Restoring an erased object is refused (D6654).')
    target = Path(target)
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    count = suppressed = 0
    for entry, decision in zip(entries, decisions):
        if keys is not None and entry['key'] not in wanted:
            continue
        if decision == 'suppress':
            suppressed += 1
            continue
        if not entry['archive'].startswith(ARCHIVE_PREFIX + manifest['run_id'] + '/objects/'):
            raise ValueError('Archive reference escaped the snapshot.')
        data = store.get(entry['archive'], archive=True)
        if len(data) != entry['size'] or sha(data) != entry['sha256']:
            raise ValueError('Restore checksum mismatch.')
        path = target / sha(entry['key'].encode())
        path.write_bytes(data)
        path.chmod(0o600)
        count += 1
    return {'restored': count, 'suppressed': suppressed}


def verify_live_lock(account):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        raise ValueError('Control-plane access is required to verify retention.')
    if not re.fullmatch('[a-f0-9]{32}', account or ''):
        raise ValueError('A valid Cloudflare account reference is required.')
    request = Request(f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/studioos-backups/lock',
                      headers={'Authorization': 'Bearer ' + token})
    # The URL is a fixed https:// Cloudflare API address; only the 32-hex account checked above varies, so no
    # file:// or other scheme can reach urlopen.
    with urlopen(request, timeout=30) as response:  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        result = json.load(response)
    if not result.get('success') or not lock_covers(result.get('result', {}).get('rules', [])):
        raise ValueError('A verified seven-year archive-prefix bucket lock is required before copying.')


def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)


class BundleStore:
    """Stage only verified archive writes for a credential-isolated independent-copy step."""
    def __init__(self, store, path):
        self.store, self.path = store, Path(path)
        self.path.mkdir(mode=0o700, exist_ok=False)
        self.last_modified = store.last_modified

    def list(self, prefix):
        return self.store.list(prefix)

    def get(self, key, **kwargs):
        return self.store.get(key, **kwargs)

    def put(self, key, data):
        if not re.fullmatch(r'files-recovery/[a-f0-9-]{36}/(?:manifest\.json|objects/[a-f0-9]{64}/[a-f0-9]{64})', key):
            raise ValueError('Invalid staged archive reference.')
        self.store.put(key, data)
        target = self.path / key
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_private(target, data)


def receipt(manifest):
    return {'outcome': 'verified', 'snapshot_id': manifest['run_id'],
            'object_count': len(manifest['entries']), 'byte_count': sum(e['size'] for e in manifest['entries']),
            'newest_key_at': manifest.get('newest_key_at'), 'newest_key_at_status': manifest.get('newest_key_at_status', 'unavailable')}


def restore_main(argv):
    """Restore one snapshot into a fresh private directory, after reading the whole suppression ledger (D6654)."""
    parser = argparse.ArgumentParser(prog='file-recovery.py restore', description=restore_main.__doc__)
    parser.add_argument('--run-id', required=True, help='The snapshot to restore')
    parser.add_argument('--target', required=True, help='A fresh private directory; files are named by key hash')
    parser.add_argument('--d1-database-id', required=True, help='The D1 database that holds record_suppression_ledger')
    args = parser.parse_args(argv)
    if not re.fullmatch('[a-f0-9-]{36}', args.run_id):
        raise ValueError('Invalid snapshot identity.')
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    # The ledger first: no archive object is read until the complete ledger is in hand.
    ledger = load_ledger(d1_query(account, args.d1_database_id, os.environ.get('CLOUDFLARE_API_TOKEN', '')))
    store = AwsStore(account)
    manifest = json.loads(store.get(ARCHIVE_PREFIX + args.run_id + '/manifest.json', archive=True))
    result = restore(store, manifest, args.target, ledger)
    print(json.dumps({'outcome': 'restored', **result}))


def main():
    if sys.argv[1:2] == ['restore']:
        return restore_main(sys.argv[2:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', required=True, help='Approved #6650 registry JSON; no default personal-file prefixes')
    parser.add_argument('--bundle-dir', help='Fresh private staging directory; never uploaded as a workflow artifact')
    parser.add_argument('--receipt', help='Private metadata-only result for heartbeat generation')
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text())
    approved_classes(registry)
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    store = AwsStore(account)
    verify_live_lock(account)
    if args.bundle_dir:
        store = BundleStore(store, args.bundle_dir)
    manifest = snapshot(store, registry)
    if args.receipt:
        write_private(args.receipt, json.dumps(receipt(manifest)).encode())
    print(json.dumps({'outcome': 'verified', 'objects': len(manifest['entries']), 'snapshot': manifest['run_id']}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # AWS/HTTP exceptions can carry paths or operational details: keep them
        # out of public runner logs. Failure never advances a freshness marker.
        raise SystemExit('File recovery failed; consult approved configuration and private operator diagnostics.')
