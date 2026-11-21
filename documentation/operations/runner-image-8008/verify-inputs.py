#!/usr/bin/env python3
"""D8008 offline preflight: source hashes first; build inputs remain fail-closed."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', type=pathlib.Path,
                        help='Verify pre-acquired offline build inputs; never download')
    args = parser.parse_args()
    manifest = json.loads((HERE / 'components.json').read_text())
    for source in manifest['source_revisions']:
        revision = source['revision']
        if not re.fullmatch('[a-f0-9]{40}', revision):
            raise ValueError('source revision must be a full SHA')
        for item in source['files']:
            data = subprocess.check_output(['git', 'show', revision + ':' + item['path']], cwd=ROOT)
            if digest(data) != item['sha256']:
                raise ValueError('recorded source hash mismatch: ' + item['path'])
            if source['label'] == 'chosen_main' and digest((ROOT / item['path']).read_bytes()) != item['sha256']:
                raise ValueError('working source drift: ' + item['path'])
    profile = json.loads((ROOT / 'scripts/ci/runners/profiles.json').read_text())['profiles']['linux-x64']
    for artifact in manifest['artifacts']:
        name = artifact['name']
        expected = profile['artifacts'][name]
        if artifact['version'] != profile[name + '_version'] or any(artifact[k] != expected[k] for k in ['url', 'sha256', 'directory']):
            raise ValueError('profile pin mismatch: ' + name)
    for lock in manifest['locks']:
        if digest((ROOT / lock['path']).read_bytes()) != lock['sha256']:
            raise ValueError('lockfile drift: ' + lock['path'])
    print('PASS source revisions, profile pins and lockfile hashes (offline review only)', flush=True)
    if args.context is None:
        print('NOT RUN build input verification; missing inputs: ' + ', '.join(x['id'] for x in manifest['missing_inputs']))
        return 0
    # Missing provenance/tool pins require review, not a network fallback or a guessed base.
    if manifest['missing_inputs']:
        print('REFUSED build context: ' + ', '.join(x['id'] for x in manifest['missing_inputs']), file=sys.stderr)
        return 2
    rootfs = manifest['rootfs']
    if not rootfs.get('url') or not rootfs.get('version') or not rootfs.get('packages'):
        raise ValueError('rootfs official source, version and package ledger required')
    for package in rootfs['packages']:
        if not package.get('name') or not package.get('version') or not package.get('url') or not re.fullmatch('[a-f0-9]{64}', package.get('sha256', '')):
            raise ValueError('incomplete rootfs package provenance')
    for artifact in [rootfs] + [x for x in manifest['artifacts'] if x['scope'] == 'candidate']:
        filename = artifact['filename']
        if pathlib.PurePath(filename).name != filename or not re.fullmatch('[a-f0-9]{64}', artifact.get('sha256') or ''):
            raise ValueError('missing immutable input pin')
        file = args.context / filename
        if file.is_symlink() or not file.is_file() or digest(file.read_bytes()) != artifact['sha256']:
            raise ValueError('offline input missing/hash mismatch: ' + filename)
    print('PASS offline bytes only; authenticity, build, scan and native evidence remain separate')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(2)
