#!/usr/bin/env python3
# D6428: approved-class-only, lock-verified R2 snapshots and
# suppression-required restore primitive; live activation waits for
# counsel/#6650/#6654.
"""D6428: append-only, checksum-verified R2 file snapshots for counsel-approved record classes only.

Live copies require an approved registry and a verified seven-year destination
prefix lock. Live restore waits for #6654; restore() always requires a suppression
checker. No object keys, contents, credentials or manifests are printed.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ARCHIVE_PREFIX = 'files-recovery/'
RETENTION_DAYS = 2557  # At least seven calendar years, including leap days.


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
            entries.append({'key': key, 'archive': archive, 'sha256': digest, 'size': len(data),
                            'retention_basis': record_class['retention_basis']})
    manifest = {'version': 1, 'run_id': run_id, 'at': datetime.now(timezone.utc).isoformat(),
                'registry_sha256': sha(json.dumps(registry, sort_keys=True).encode()), 'entries': entries}
    encoded = json.dumps(manifest, sort_keys=True).encode()
    key = prefix + 'manifest.json'
    store.put(key, encoded)
    if store.get(key, archive=True) != encoded:
        raise ValueError('Manifest verification failed.')
    return manifest


def restore(store, manifest, target, suppression_check):
    # Fail closed until the current suppression ledger is available. No default
    # empty ledger: #6654 provides the live adapter, not this script.
    if not callable(suppression_check):
        raise ValueError('A current suppression-ledger checker is required (#6654).')
    if manifest.get('version') != 1 or not re.fullmatch('[a-f0-9-]{36}', manifest.get('run_id', '')):
        raise ValueError('Invalid manifest.')
    target = Path(target)
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    count = suppressed = 0
    for entry in manifest['entries']:
        decision = suppression_check(entry['key'])
        if decision not in ('restore', 'suppress'):
            raise ValueError('The suppression ledger is unavailable or incomplete.')
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
    request = Request(f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/studioos-backups/lock',
                      headers={'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get('success') or not lock_covers(result.get('result', {}).get('rules', [])):
        raise ValueError('A verified seven-year archive-prefix bucket lock is required before copying.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', required=True, help='Approved #6650 registry JSON; no default personal-file prefixes')
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text())
    approved_classes(registry)
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    store = AwsStore(account)
    verify_live_lock(account)
    manifest = snapshot(store, registry)
    print(json.dumps({'outcome': 'verified', 'objects': len(manifest['entries']), 'snapshot': manifest['run_id']}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # AWS/HTTP exceptions can carry paths or operational details: keep them
        # out of public runner logs. Failure never advances a freshness marker.
        raise SystemExit('File recovery snapshot failed; consult approved configuration and private operator diagnostics.')
