#!/usr/bin/env python3
# D6653: encrypted independent snapshots, private run heartbeats and synthetic-only outside-preview restore proof.
"""D6653: encrypted independent file copies, metadata heartbeats and synthetic-only outside-store drills.

Credentials are role-scoped to child processes. No key, member content, bucket,
endpoint, manifest or provider error body is printed. No delete operation exists.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('file-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
HEARTBEAT = 'heartbeat-files.json'
UUID = re.compile(r'[a-f0-9-]{36}')


def child_env(role, env):
    prefixes = {'copy': 'FILE_DR_COPY', 'restore': 'FILE_DR_RESTORE',
                'health-write': 'FILE_RECOVERY_DESTINATION', 'health-read': 'FILE_RECOVERY_HEALTH'}
    prefix = prefixes[role]
    clean = {key: value for key, value in env.items() if key in
             ('PATH', 'HOME', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
              'http_proxy', 'https_proxy', 'no_proxy', 'AWS_CA_BUNDLE')}
    for suffix in ('ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'):
        value = env.get(prefix + '_' + suffix)
        if not value:
            raise ValueError('A scoped file recovery credential is missing.')
        clean['AWS_' + suffix] = value
    clean.update(AWS_EC2_METADATA_DISABLED='true', AWS_CONFIG_FILE=os.devnull,
                 AWS_SHARED_CREDENTIALS_FILE=os.devnull, AWS_PAGER='')
    return clean


def independent_config(env):
    if not re.fullmatch(r'[a-f0-9]{32}', env.get('CLOUDFLARE_ACCOUNT_ID', '')):
        raise ValueError('A production account reference is required to verify separation.')
    endpoint, bucket = env.get('DR_COPY_ENDPOINT', ''), env.get('DR_COPY_BUCKET', '')
    parsed = urlsplit(endpoint)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('An independent HTTPS store origin is required.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
        raise ValueError('An independent bucket is required.')
    # Account-scoped R2 origins let us reject an accidentally in-account destination.
    if parsed.hostname.endswith('.r2.cloudflarestorage.com'):
        account = parsed.hostname.split('.')[0]
        if not re.fullmatch(r'[a-f0-9]{32}', account) or account == env.get('CLOUDFLARE_ACCOUNT_ID'):
            raise ValueError('The independent store must be outside the production account.')
    elif env.get('FILE_DR_EXTERNAL_ACCOUNT_CONFIRMED') != 'true':
        raise ValueError('The owner must confirm external account ownership for this provider.')
    return endpoint.rstrip('/'), bucket, (env.get('DR_COPY_REGION') or 'auto')


class Store:
    def __init__(self, endpoint, bucket, region, role, env, run=subprocess.run):
        self.endpoint, self.bucket, self.region, self.role = endpoint, bucket, region, role
        self.env, self.run = child_env(role, env), run

    def call(self, operation, key, *args, allow_existing=False):
        allowed = ('put-object', 'head-object') if self.role in ('copy', 'health-write') else ('get-object',)
        if operation not in allowed:
            raise ValueError('The credential role cannot perform that operation.')
        if self.role.startswith('health') and key != HEARTBEAT and not re.fullmatch(r'files-recovery-health/runs/[1-9][0-9]*-[1-9][0-9]*\.json', key):
            raise ValueError('Heartbeat credentials cannot access file records.')
        if not self.role.startswith('health') and not re.fullmatch(r'files-recovery/[a-f0-9-]{36}/(?:copy\.json|heartbeat\.json|manifest\.json\.age|objects/[a-f0-9]{64}/[a-f0-9]{64}\.age)', key):
            raise ValueError('Independent file reference is invalid.')
        result = self.run(['aws', '--no-cli-pager', 's3api', operation, '--bucket', self.bucket, '--key', key,
                           *args, '--endpoint-url', self.endpoint, '--region', self.region],
                          env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            if allow_existing and re.search(rb'PreconditionFailed|\(412\)', result.stderr):
                return None
            if operation == 'get-object' and re.search(rb'NoSuchKey|\(404\)', result.stderr):
                raise FileNotFoundError('The metadata or synthetic object is missing.')
            raise RuntimeError('File recovery store operation failed.')
        return json.loads(result.stdout or b'{}')

    def put(self, key, data, plaintext_sha=None, mutable=False):
        digest = recovery.sha(data)
        metadata = {'sha256': digest, 'plaintext-sha256': plaintext_sha or digest}
        with tempfile.TemporaryDirectory(prefix='independent-file-put-') as tmp:
            path = Path(tmp) / 'object'
            recovery.write_private(path, data)
            args = ['--body', str(path), '--checksum-algorithm', 'SHA256', '--checksum-sha256',
                    base64.b64encode(hashlib.sha256(data).digest()).decode(), '--metadata', json.dumps(metadata)]
            if not mutable:
                args += ['--if-none-match', '*']
            result = self.call('put-object', key, *args, allow_existing=not mutable)
        head = self.call('head-object', key)
        recorded = head.get('Metadata', {})
        if recorded.get('plaintext-sha256') != metadata['plaintext-sha256']:
            raise ValueError('The stored copy belongs to different plaintext.')
        if (not isinstance(head.get('ContentLength'), int) or head['ContentLength'] < 1
                or not re.fullmatch(r'[a-f0-9]{64}', recorded.get('sha256', ''))):
            raise ValueError('The stored copy has no valid integrity metadata.')
        if result is not None and (head['ContentLength'] != len(data) or recorded['sha256'] != digest):
            raise ValueError('The stored copy differs from the upload.')
        return {'size': head['ContentLength'], 'sha256': recorded['sha256']}

    def get(self, key):
        with tempfile.TemporaryDirectory(prefix='independent-file-get-') as tmp:
            path = Path(tmp) / 'object'
            self.call('get-object', key, str(path))
            return path.read_bytes()


def age(data, recipient=None, identity=None):
    with tempfile.TemporaryDirectory(prefix='independent-file-age-') as tmp:
        source, target = Path(tmp) / 'source', Path(tmp) / 'target'
        recovery.write_private(source, data)
        args = ['age', '-r', recipient] if recipient else ['age', '-d', '-i', str(identity)]
        result = subprocess.run([*args, '-o', str(target), str(source)], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')})
        if result.returncode:
            raise RuntimeError('File recovery encryption or decryption failed.')
        return target.read_bytes()


def copy_bundle(bundle, writer, encrypt):
    root = Path(bundle)
    manifests = list(root.glob('files-recovery/*/manifest.json'))
    if len(manifests) != 1:
        raise ValueError('Exactly one completed staged snapshot is required.')
    raw = manifests[0].read_bytes()
    manifest = json.loads(raw)
    run_id = manifest.get('run_id', '')
    if manifest.get('version') != 1 or not UUID.fullmatch(run_id) or manifests[0].parent.name != run_id:
        raise ValueError('The staged snapshot identity is invalid.')
    for entry in manifest['entries']:
        key = entry['archive']
        if not re.fullmatch(r'files-recovery/' + re.escape(run_id) + r'/objects/[a-f0-9]{64}/[a-f0-9]{64}', key):
            raise ValueError('The staged object escaped its snapshot.')
        data = (root / key).read_bytes()
        if len(data) != entry['size'] or recovery.sha(data) != entry['sha256']:
            raise ValueError('A staged object differs from the verified manifest.')
        writer.put(key + '.age', encrypt(data), plaintext_sha=entry['sha256'])
    prefix = 'files-recovery/' + run_id + '/'
    encrypted = writer.put(prefix + 'manifest.json.age', encrypt(raw), plaintext_sha=recovery.sha(raw))
    receipt = recovery.receipt(manifest)
    descriptor = {**receipt, 'version': 1, 'at': manifest['at'], 'manifest_sha256': recovery.sha(raw),
                  'manifest_cipher_sha256': encrypted['sha256'], 'manifest_cipher_size': encrypted['size']}
    writer.put(prefix + 'copy.json', json.dumps(descriptor, sort_keys=True).encode())
    return receipt


def restore_one(reader, run_id, target, decrypt):
    """Synthetic drill only. This is not a live restore or a suppression-ledger bypass."""
    if not UUID.fullmatch(run_id):
        raise ValueError('Invalid synthetic snapshot identity.')
    prefix = 'files-recovery/' + run_id + '/'
    descriptor = json.loads(reader.get(prefix + 'copy.json'))
    cipher = reader.get(prefix + 'manifest.json.age')
    if len(cipher) != descriptor['manifest_cipher_size'] or recovery.sha(cipher) != descriptor['manifest_cipher_sha256']:
        raise ValueError('The independent manifest was corrupted.')
    raw = decrypt(cipher)
    if recovery.sha(raw) != descriptor['manifest_sha256']:
        raise ValueError('The independent plaintext manifest was corrupted.')
    manifest = json.loads(raw)
    if manifest.get('run_id') != run_id or len(manifest.get('entries', [])) != 1:
        raise ValueError('Only the one-record synthetic fixture can be drilled here.')
    entry = manifest['entries'][0]
    if entry.get('key') != 'synthetic-contracts/independent-drill':
        raise ValueError('The synthetic drill cannot restore member records.')
    key = prefix + 'objects/' + recovery.sha(entry['key'].encode()) + '/' + entry['sha256'] + '.age'
    if entry.get('archive') + '.age' != key:
        raise ValueError('The synthetic object reference was corrupted.')
    data = decrypt(reader.get(key))
    if data != b'Synthetic independent recovery drill' or recovery.sha(data) != entry['sha256'] or len(data) != entry['size']:
        raise ValueError('The synthetic outside-copy restore failed integrity verification.')
    recovery.write_private(target, data)
    return {'outcome': 'verified', 'restored': 1, 'source': 'independent', 'synthetic_only': True}


def make_heartbeat(primary, independent, primary_outcome, copy_outcome, required, run_id, attempt, now):
    if not re.fullmatch(r'[1-9][0-9]*', str(run_id)) or not re.fullmatch(r'[1-9][0-9]*', str(attempt)):
        raise ValueError('A workflow run identity is required.')
    valid = isinstance(primary, dict) and primary.get('outcome') == 'verified'
    if valid:
        valid = all(isinstance(primary.get(key), int) and not isinstance(primary[key], bool) and primary[key] >= 0
                    for key in ('object_count', 'byte_count'))
    copy_state = independent.get('outcome') if isinstance(independent, dict) else 'not_attempted'
    matched = valid and isinstance(independent, dict) and all(independent.get(key) == primary.get(key)
                  for key in ('snapshot_id', 'object_count', 'byte_count'))
    success = primary_outcome == 'success' and valid and copy_outcome == 'success' and (copy_state == 'verified' and matched if required else copy_state == 'not_configured')
    return {'schema_version': 1, 'kind': 'file_recovery', 'at': now.isoformat(), 'run_id': str(run_id), 'run_attempt': int(attempt),
            'outcome': 'success' if success else 'failure', 'independent': copy_state,
            'object_count': primary['object_count'] if valid else None, 'byte_count': primary['byte_count'] if valid else None,
            'newest_key_at': primary.get('newest_key_at') if valid else None,
            'newest_key_at_status': primary.get('newest_key_at_status', 'unavailable') if valid else 'unavailable'}


def load_receipt(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['copy', 'heartbeat', 'read-heartbeat', 'drill'])
    parser.add_argument('--bundle-dir')
    parser.add_argument('--receipt')
    parser.add_argument('--primary-receipt')
    parser.add_argument('--independent-receipt')
    parser.add_argument('--primary-outcome')
    parser.add_argument('--copy-outcome')
    parser.add_argument('--out')
    args = parser.parse_args()
    env = os.environ
    enabled = env.get('FILE_DR_SECOND_COPY_ENABLED') == 'true'
    if args.mode in ('copy', 'drill') and not enabled:
        result = {'outcome': 'not_configured'}
        if args.receipt:
            recovery.write_private(args.receipt, json.dumps(result).encode())
        print('::notice::Independent file copy is not configured; no outside-store access attempted.')
        return
    if args.mode in ('copy', 'drill'):
        endpoint, bucket, region = independent_config(env)
        recipient = env.get('DR_AGE_RECIPIENT', '')
        if args.mode == 'copy':
            if not re.fullmatch(r'age1[0-9a-z]{58}', recipient):
                raise ValueError('An age public recipient is required.')
            result = copy_bundle(args.bundle_dir, Store(endpoint, bucket, region, 'copy', env), lambda data: age(data, recipient=recipient))
            if args.receipt:
                recovery.write_private(args.receipt, json.dumps(result).encode())
        else:
            if env.get('FILE_DR_SYNTHETIC_PREVIEW') != 'true':
                raise ValueError('The hosted drill requires explicit synthetic preview configuration.')
            result = hosted_drill(endpoint, bucket, region, env)
    else:
        account = env.get('CLOUDFLARE_ACCOUNT_ID', '')
        if not re.fullmatch(r'[a-f0-9]{32}', account):
            raise ValueError('A heartbeat account reference is required.')
        store = Store(f'https://{account}.r2.cloudflarestorage.com', 'studioos-backups', 'auto',
                      'health-write' if args.mode == 'heartbeat' else 'health-read', env)
        if args.mode == 'heartbeat':
            result = make_heartbeat(load_receipt(args.primary_receipt), load_receipt(args.independent_receipt),
                                    args.primary_outcome, args.copy_outcome, enabled, env.get('GITHUB_RUN_ID'),
                                    env.get('GITHUB_RUN_ATTEMPT'), datetime.now(timezone.utc))
            raw = json.dumps(result, sort_keys=True).encode()
            store.put(f"files-recovery-health/runs/{result['run_id']}-{result['run_attempt']}.json", raw)
            store.put(HEARTBEAT, raw, mutable=True)
        else:
            try:
                raw = json.loads(store.get(HEARTBEAT))
                result = {'read': 'ok', 'heartbeat': {key: raw.get(key) for key in
                          ('schema_version', 'kind', 'at', 'run_id', 'run_attempt', 'outcome', 'independent',
                           'object_count', 'byte_count', 'newest_key_at', 'newest_key_at_status')}}
            except FileNotFoundError:
                result = {'read': 'missing'}
            except (ValueError, TypeError, AttributeError):
                result = {'read': 'invalid'}
            recovery.write_private(args.out, json.dumps(result).encode())
            result = {'outcome': 'metadata_read'}
    print(json.dumps(result))


def hosted_drill(endpoint, bucket, region, env):
    """Write/read only one fresh synthetic snapshot, using ephemeral age keys and separate outside-store roles."""
    with tempfile.TemporaryDirectory(prefix='independent-file-drill-') as tmp:
        root = Path(tmp)
        identity = root / 'identity'
        generated = subprocess.run(['age-keygen', '-o', str(identity)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')})
        if generated.returncode:
            raise RuntimeError('Synthetic identity generation failed.')
        public = subprocess.run(['age-keygen', '-y', str(identity)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')})
        recipient = public.stdout.decode().strip()
        if public.returncode or not re.fullmatch(r'age1[0-9a-z]{58}', recipient):
            raise RuntimeError('Synthetic identity generation failed.')
        run_id, data = str(uuid.uuid4()), b'Synthetic independent recovery drill'
        key = 'synthetic-contracts/independent-drill'
        archive = f'files-recovery/{run_id}/objects/{recovery.sha(key.encode())}/{recovery.sha(data)}'
        manifest = {'version': 1, 'run_id': run_id, 'at': datetime.now(timezone.utc).isoformat(),
                    'entries': [{'key': key, 'archive': archive, 'sha256': recovery.sha(data), 'size': len(data)}]}
        bundle = root / 'bundle'
        (bundle / archive).parent.mkdir(mode=0o700, parents=True)
        recovery.write_private(bundle / archive, data)
        recovery.write_private(bundle / f'files-recovery/{run_id}/manifest.json', json.dumps(manifest).encode())
        writer = Store(endpoint, bucket, region, 'copy', env)
        copy_bundle(bundle, writer, lambda value: age(value, recipient=recipient))
        heartbeat = {'at': manifest['at'], 'object_count': 1, 'byte_count': len(data),
                     'newest_key_at': manifest['at'], 'outcome': 'success'}
        writer.put(f'files-recovery/{run_id}/heartbeat.json', json.dumps(heartbeat).encode())
        # No source or primary archive remains. Only the outside store can satisfy the restore.
        import shutil
        shutil.rmtree(bundle)
        reader = Store(endpoint, bucket, region, 'restore', env)
        result = restore_one(reader, run_id, root / 'restored',
                             lambda value: age(value, identity=identity))
        observed = json.loads(reader.get(f'files-recovery/{run_id}/heartbeat.json'))
        if observed != heartbeat:
            raise ValueError('The synthetic outside heartbeat was corrupted.')
        result['heartbeat'] = observed
        return result


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Independent file recovery failed; check approved private configuration and scoped credentials.')
