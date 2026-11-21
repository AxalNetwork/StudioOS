#!/usr/bin/env python3
"""D8008 offline preflight: source hashes first; build inputs remain fail-closed."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import struct
import tarfile
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def elf_details(data):
    if data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('expected 64-bit little-endian ELF')
    machine = struct.unpack_from('<H', data, 18)[0]
    if machine != 62:
        raise ValueError('expected ELF machine x86_64, got ' + str(machine))
    offset = struct.unpack_from('<Q', data, 32)[0]
    size, count = struct.unpack_from('<HH', data, 54)
    headers = [struct.unpack_from('<IIQQQQQQ', data, offset + i * size) for i in range(count)]
    interpreter, needed, strtab = None, [], None
    for kind, _, pos, _, _, length, _, _ in headers:
        if kind == 3:
            interpreter = data[pos:pos + length].rstrip(b'\0').decode()
        if kind == 2:
            for i in range(pos, pos + length, 16):
                tag, value = struct.unpack_from('<qQ', data, i)
                if tag == 0:
                    break
                if tag == 1:
                    needed.append(value)
                if tag == 5:
                    strtab = value
    libraries = []
    if needed:
        tables = [h[2] + strtab - h[3] for h in headers
                  if strtab is not None and h[0] == 1 and h[3] <= strtab < h[3] + h[5]]
        if len(tables) != 1:
            raise ValueError('ELF dynamic string table not uniquely mapped')
        for index in needed:
            start = tables[0] + index
            end = data.index(b'\0', start)
            libraries.append(data[start:end].decode())
    return {'machine': 'x86_64', 'interpreter': interpreter, 'needed': libraries,
            'observed_abi_version_strings': sorted({x.decode() for x in re.findall(
                rb'(?:GLIBCXX|GLIBC|CXXABI)_[0-9]+(?:\.[0-9]+)*', data)})}


def inspect(manifest, inputs):
    results = []
    for artifact in manifest['artifacts']:
        if artifact['scope'] != 'candidate':
            continue
        file = inputs / artifact['filename']
        with file.open('rb') as source:
            digest = hashlib.sha256()
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != artifact['sha256']:
            raise ValueError('runtime archive checksum mismatch: ' + artifact['name'])
        elf, bundled_npm = [], None
        with tarfile.open(file, 'r:gz') as archive:
            for member in archive:
                if not member.isfile():
                    continue
                stream = archive.extractfile(member)
                prefix = stream.read(4)
                if prefix == b'\x7fELF':
                    data = prefix + stream.read()
                    elf.append(dict(path=member.name, sha256=hashlib.sha256(data).hexdigest(),
                                    **elf_details(data)))
                elif member.name == artifact['directory'] + '/lib/node_modules/npm/package.json':
                    bundled_npm = json.loads(prefix + stream.read())['version']
        if not elf:
            raise ValueError('no native ELF runtime found: ' + artifact['name'])
        results.append({'name': artifact['name'], 'filename': artifact['filename'],
                        'archive_sha256': digest.hexdigest(), 'bundled_npm': bundled_npm, 'elf': elf})
    return {'schema_version': 1, 'status': 'verified archive bytes; native execution not performed',
            'limitations': 'ELF strings are observed, not a version-need proof. Dependencies may be supplied by the same archive. Rootfs, dynamic loading, signatures, image build/scan and intended-node compatibility remain unverified.',
            'artifacts': results}



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', type=pathlib.Path,
                        help='Verify pre-acquired offline build inputs; never download')
    parser.add_argument('--inspect-runtime-archives', type=pathlib.Path,
                        help='Verify acquired runtime bytes and inspect ELF without extraction or execution')
    args = parser.parse_args()
    manifest = json.loads((HERE / 'components.json').read_text())
    if args.inspect_runtime_archives is not None:
        print(json.dumps(inspect(manifest, args.inspect_runtime_archives), indent=2))
        return 0
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
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError, struct.error) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(2)
